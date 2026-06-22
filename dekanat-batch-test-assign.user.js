// ==UserScript==
// @name         Dekanat batch test assign
// @namespace    local.dekanat.batch-test-assign
// @version      1.0
// @description  Pick a test, load groups only as student filters, then assign the test to selected students in bulk.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function(){
  'use strict';
  if(window.top !== window.self) return;

  const PATH_OK = /\/tests?(\/|$)/i.test(location.pathname);
  if(!PATH_OK) return;

  const PANEL_ID = 'dta-panel';
  const STORAGE_KEY = 'dta_state_v1';
  const DEFAULTS = {
    yearText: '2025-2026',
    yearId: '25',
    facultyText: 'mf',
    facultyId: '1',
    vedomostText: 'vedomost',
    vedomostId: '1',
    testTypeId: '1',
    questions: 30,
    minutes: 30,
    attempts: 1,
    showResults: '0'
  };

  const runState = { running: false, stop: false };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const state = loadState();
  let panel, logEl, statEl;

  function loadState(){
    const base = {
      panelPosition: null,
      mode: 'students',
      selectedTest: null,
      testFilters: { q: '', dateFrom: '', dateTo: '' },
      tests: [],
      testsTotal: 0,
      testRuleOptions: [],
      values: {
        testRuleId: '',
        ayearId: DEFAULTS.yearId,
        semesterId: '',
        facultyId: DEFAULTS.facultyId,
        disciplineId: '',
        examinationId: '',
        vedomostId: DEFAULTS.vedomostId,
        vedRuleId: '',
        modulId: '',
        questions: DEFAULTS.questions,
        minutes: DEFAULTS.minutes,
        attempts: DEFAULTS.attempts,
        dateI: '',
        dateF: '',
        timeI: '',
        timeF: ''
      },
      options: {
        years: [],
        semesters: [],
        faculties: [],
        disciplines: [],
        examinations: [],
        vedomosts: [],
        vedRules: [],
        moduls: []
      },
      groups: [],
      selectedGroupIds: [],
      studentsByGroup: {},
      selectedStudentIds: [],
      categories: []
    };

    try{
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        ...base,
        ...parsed,
        mode: 'students',
        testFilters: { ...base.testFilters, ...(parsed.testFilters || {}) },
        values: { ...base.values, ...(parsed.values || {}) },
        options: { ...base.options, ...(parsed.options || {}) },
        tests: Array.isArray(parsed.tests) ? parsed.tests : [],
        testsTotal: Number(parsed.testsTotal) || 0,
        testRuleOptions: Array.isArray(parsed.testRuleOptions) ? parsed.testRuleOptions : [],
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
        selectedGroupIds: Array.isArray(parsed.selectedGroupIds) ? parsed.selectedGroupIds : [],
        studentsByGroup: parsed.studentsByGroup && typeof parsed.studentsByGroup === 'object' ? parsed.studentsByGroup : {},
        selectedStudentIds: Array.isArray(parsed.selectedStudentIds) ? parsed.selectedStudentIds : [],
        categories: Array.isArray(parsed.categories) ? parsed.categories : []
      };
    }catch(e){
      return base;
    }
  }

  function saveState(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function norm(value){
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function short(value, max = 240){
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max - 1) + '...' : text;
  }

  function log(message, color){
    if(!logEl) return;
    const row = document.createElement('div');
    row.textContent = message;
    if(color) row.style.color = color;
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setStat(message){
    if(statEl) statEl.textContent = message;
  }

  function ready(fn){
    if(document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  function absoluteUrl(url){
    try{ return new URL(url, location.origin).href; }
    catch(e){ return String(url || ''); }
  }

  function makeUrl(path, params = {}){
    const url = new URL(path, location.origin);
    url.searchParams.set('_', String(Date.now()));
    Object.entries(params).forEach(([key, value]) => {
      if(value !== '' && value != null) url.searchParams.set(key, value);
    });
    return url.href;
  }

  async function fetchText(url, options = {}){
    const res = await fetch(url, {
      credentials: 'same-origin',
      redirect: 'follow',
      ...options
    });
    const text = await res.text();
    if(!res.ok) throw new Error((options.label || url) + ': HTTP ' + res.status + ' ' + short(text, 300));
    return text;
  }

  function parseFlexibleJson(text){
    let value = JSON.parse(text || 'null');
    if(typeof value === 'string' && /^[\[{]/.test(value.trim())){
      value = JSON.parse(value);
    }
    if(value && typeof value === 'object' && !Array.isArray(value)){
      const keys = Object.keys(value);
      if(keys.length === 1 && /^[\[{]/.test(keys[0].trim())){
        value = JSON.parse(keys[0]);
      }
    }
    return value;
  }

  async function fetchJson(path, params = {}){
    const text = await fetchText(makeUrl(path, params), {
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
      },
      label: path
    });
    return parseFlexibleJson(text);
  }

  async function postJsonLike(path){
    const text = await fetchText(absoluteUrl(path), {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
      },
      label: path
    });
    return parseFlexibleJson(text);
  }

  function optionList(items){
    return (Array.isArray(items) ? items : [])
      .filter(item => item && item.value != null)
      .map(item => ({
        value: String(item.value),
        text: short(item.text || item.Text || item.name || item.Name || item.value, 220),
        disabled: !!item.disabled
      }));
  }

  function selectOptionsHtml(options, placeholder = 'Select...'){
    const opts = optionList(options);
    if(!opts.some(o => o.value === '')){
      opts.unshift({ value: '', text: placeholder });
    }
    return opts.map(o => `<option value="${esc(o.value)}" ${o.disabled ? 'disabled' : ''}>${esc(o.text)}</option>`).join('');
  }

  function firstOptionValue(options, preferred){
    const opts = optionList(options).filter(o => o.value && !o.disabled);
    if(!opts.length) return '';
    if(preferred){
      const wanted = norm(preferred);
      const found = opts.find(o => norm(o.text).includes(wanted) || norm(o.value) === wanted);
      if(found) return found.value;
    }
    return opts[0].value;
  }

  function todayDate(){
    return formatDate(new Date());
  }

  function pad2(n){
    return String(n).padStart(2, '0');
  }

  function formatDate(date){
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
  }

  function formatTime(date){
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function refreshDatesToNow(){
    const now = new Date();
    const plus = new Date(now.getTime() + 60 * 60 * 1000);
    state.values.dateI = formatDate(now);
    state.values.dateF = formatDate(now);
    state.values.timeI = formatTime(now);
    state.values.timeF = formatTime(plus);
    saveState();
    renderSchedule();
  }

  function ensureScheduleDefaults(){
    if(!state.values.dateI || !state.values.dateF || !state.values.timeI || !state.values.timeF){
      refreshDatesToNow();
    }
  }

  function dateOnly(value){
    if(!value) return '';
    const date = new Date(value);
    if(Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function displayDate(value){
    if(!value) return '';
    const date = new Date(value);
    if(Number.isNaN(date.getTime())) return short(value, 30);
    return formatDate(date);
  }

  function currentTestIdFromPath(){
    const m = location.pathname.match(/\/tests\/details\/(\d+)/i);
    return m ? m[1] : '';
  }

  function currentTestFromPage(){
    const id = currentTestIdFromPath();
    if(!id) return null;
    const title = short(document.querySelector('h1,h2,h3,.page-title')?.textContent || document.title || ('Test #' + id), 160);
    return { id, title, description: '', author: '', createdDate: '', modifiedDate: '', questions: '' };
  }

  function testMatchesFilters(test){
    const q = norm(state.testFilters.q);
    if(q){
      const hay = norm([test.id, test.title, test.description, test.author, test.testType, test.statusText].join(' '));
      if(!hay.includes(q)) return false;
    }

    const d = dateOnly(test.createdDate || test.date || test.modifiedDate);
    if(state.testFilters.dateFrom && d && d < state.testFilters.dateFrom) return false;
    if(state.testFilters.dateTo && d && d > state.testFilters.dateTo) return false;
    return true;
  }

  function renderTests(){
    const box = panel && panel.querySelector('#dta-tests');
    if(!box) return;
    const rows = (state.tests || []).filter(testMatchesFilters);
    const selectedId = state.selectedTest && String(state.selectedTest.id);
    const total = Number(state.testsTotal) || state.tests.length;
    const summary = `<div class="dta-muted" style="margin-bottom:5px">Loaded: ${state.tests.length}/${total}. Matches: ${rows.length}.</div>`;

    box.innerHTML = summary + (rows.length
      ? rows.map(test => {
        const isSelected = selectedId === String(test.id);
        return `
          <button type="button" class="dta-test-row" data-test-id="${esc(test.id)}" style="${isSelected ? 'border-color:#078;background:#eefbf7' : ''}">
            <span class="dta-test-title">${esc(short(test.title, 110))}</span>
            <span class="dta-test-meta">#${esc(test.id)} | ${esc(displayDate(test.createdDate || test.date || test.modifiedDate))} | ${esc(short(test.description || '', 50))}</span>
            <span class="dta-test-meta">${esc(short(test.author || '', 120))}</span>
          </button>`;
      }).join('')
      : '<div class="dta-muted">No tests loaded or no matches.</div>');

    box.querySelectorAll('[data-test-id]').forEach(btn => {
      btn.onclick = () => {
        const found = state.tests.find(t => String(t.id) === String(btn.dataset.testId));
        if(found) selectTest(found);
      };
    });
    updateStat();
  }

  async function loadTests(){
    uiBusy(true);
    try{
      log('Loading tests from all /tests/Indexa pages...');
      const pageSize = 200;
      let first = await postTestsIndexPage(0, pageSize);
      if(!first.rows.length){
        first = indexRowsFromData(await postJsonLike('/tests/Indexa'));
      }
      const byId = new Map();
      addTestRows(byId, first.rows);

      const domTotal = readTestsTotalFromDom();
      const total = Math.max(first.total || 0, domTotal || 0, byId.size);
      state.testsTotal = total;
      log(`Page chunk 1: ${first.rows.length}, total: ${total || '?'}`);

      for(let skip = first.rows.length || pageSize; total && skip < total;){
        if(runState.stop) break;
        const before = byId.size;
        const page = await postTestsIndexPage(skip, pageSize);
        addTestRows(byId, page.rows);
        log(`Page chunk skip ${skip}: ${page.rows.length}, unique loaded: ${byId.size}/${total}`);
        if(page.total) state.testsTotal = Math.max(state.testsTotal, page.total);
        if(!page.rows.length || byId.size === before) break;
        skip += page.rows.length;
        await sleep(80);
      }

      state.tests = [...byId.values()].sort((a, b) => {
        const da = new Date(a.createdDate || a.modifiedDate || 0).getTime() || 0;
        const db = new Date(b.createdDate || b.modifiedDate || 0).getTime() || 0;
        return db - da || Number(b.id) - Number(a.id);
      });
      saveState();
      renderTests();
      log('Tests loaded: ' + state.tests.length + '/' + (state.testsTotal || state.tests.length), '#06c');
    }catch(e){
      log('Tests load failed: ' + e.message, '#c33');
    }finally{
      uiBusy(false);
    }
  }

  function testFromRow(row){
    return {
        id: String(row.id ?? row.Id ?? row.testId ?? row.TestId ?? ''),
        title: short(row.title ?? row.Title ?? '', 220),
        description: short(row.description ?? row.Description ?? '', 160),
        author: short(row.author ?? row.Author ?? '', 180),
        createdDate: row.createdDate ?? row.CreatedDate ?? row.date ?? row.Date ?? '',
        modifiedDate: row.modifiedDate ?? row.ModifiedDate ?? '',
        questions: row.questions ?? row.Questions ?? '',
        testType: row.testType ?? row.TestType ?? '',
        statusText: row.statusText ?? row.StatusText ?? '',
        hasAssignPermission: row.hasAssignPermission ?? row.HasAssignPermission ?? true
    };
  }

  function addTestRows(map, rows){
    (Array.isArray(rows) ? rows : []).forEach(row => {
      const test = testFromRow(row);
      if(test.id) map.set(String(test.id), test);
    });
  }

  function indexRowsFromData(data){
    const rows = Array.isArray(data)
      ? data
      : (data && (data.data || data.Data || data.items || data.Items || data.result || data.Result)) || [];
    const total = Array.isArray(data)
      ? 0
      : Number(data && (data.totalCount ?? data.TotalCount ?? data.total ?? data.Total ?? data.count ?? data.Count)) || 0;
    return { rows: Array.isArray(rows) ? rows : [], total };
  }

  async function postTestsIndexPage(skip, take){
    const body = new URLSearchParams();
    body.set('loadOptions[skip]', String(skip));
    body.set('loadOptions[take]', String(take));
    body.set('loadOptions[requireTotalCount]', 'true');
    body.set('loadOptions[searchOperation]', '"contains"');
    body.set('loadOptions[userData]', '{}');

    const text = await fetchText('/tests/Indexa', {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body,
      label: '/tests/Indexa'
    });
    return indexRowsFromData(parseFlexibleJson(text));
  }

  function readTestsTotalFromDom(){
    const info = document.querySelector('.dx-datagrid-pager .dx-info, .dx-info');
    const text = info && info.textContent;
    if(!text) return 0;
    const nums = text.match(/\d+/g);
    return nums && nums.length ? Number(nums[nums.length - 1]) || 0 : 0;
  }

  async function selectTest(test){
    state.selectedTest = test;
    state.testRuleOptions = [];
    state.categories = [];
    saveState();
    renderSelectedTest();
    renderTests();
    renderCategories();
    await loadAssignFormOptions();
    await loadCategories();
  }

  function renderSelectedTest(){
    const el = panel && panel.querySelector('#dta-selected-test');
    if(!el) return;
    const t = state.selectedTest;
    el.innerHTML = t
      ? `<b>${esc(short(t.title, 130))}</b><br><span class="dta-muted">#${esc(t.id)} | ${esc(displayDate(t.createdDate || t.date || t.modifiedDate))} | ${esc(short(t.author || '', 130))}</span>`
      : '<span class="dta-muted">No test selected.</span>';
  }

  function formTextFromBody(body){
    if(typeof body === 'string') return body;
    if(!body || typeof body !== 'object') return '';
    return Object.entries(body).map(([key, value]) => `${key}=${value}`).join('&');
  }

  async function fetchAssignForm(){
    if(!state.selectedTest) throw new Error('Select a test first.');
    const kind = 'AssignStudent';
    const url = makeUrl(`/Tests/${kind}/${state.selectedTest.id}`);
    const text = await fetchText(url, {
      headers: {
        'Accept': 'text/html, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
      },
      label: kind
    });
    const html = formTextFromBody(text);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = doc.querySelector('#assignform') || doc.querySelector('form');
    if(!form) throw new Error(kind + ': form not found.');
    return { doc, form, action: absoluteUrl(form.getAttribute('action') || url) };
  }

  function parseSelectOptions(sel){
    if(!sel) return [];
    return [...sel.options].map(o => ({ value: o.value, text: short(o.textContent, 220), disabled: o.disabled }));
  }

  async function loadAssignFormOptions(){
    if(!state.selectedTest) return;
    try{
      const { doc } = await fetchAssignForm();
      const rules = parseSelectOptions(doc.querySelector('#TestRuleId,[name="TestRuleId"]'));
      state.testRuleOptions = rules.filter(o => o.value || o.text);
      if(!state.values.testRuleId && state.testRuleOptions.length){
        state.values.testRuleId = firstOptionValue(state.testRuleOptions);
      }
      saveState();
      renderRules();
      log('Test rules loaded: ' + Math.max(0, state.testRuleOptions.length - 1), '#06c');
    }catch(e){
      log('Assign form load failed: ' + e.message, '#c33');
    }
  }

  async function loadYears(){
    const years = optionList(await fetchJson('/Tests/Year'));
    state.options.years = years;
    if(!state.values.ayearId){
      state.values.ayearId = firstOptionValue(years, DEFAULTS.yearText);
    }
    saveState();
    renderCatalog();
  }

  async function loadSemesters(){
    if(!state.values.ayearId) return;
    state.options.semesters = optionList(await fetchJson('/Tests/Semestr', { ayear_id: state.values.ayearId }));
    if(!state.options.semesters.some(o => o.value === state.values.semesterId)){
      state.values.semesterId = '';
    }
    clearDownstream('semester');
    saveState();
    renderCatalog();
  }

  async function loadFaculties(){
    const v = state.values;
    if(!v.ayearId || !v.semesterId) return;
    const faculties = optionList(await fetchJson('/Tests/Faculty', { ayear_id: v.ayearId, semester_id: v.semesterId }));
    state.options.faculties = faculties;
    if(!faculties.some(o => o.value === v.facultyId)){
      v.facultyId = firstOptionValue(faculties, DEFAULTS.facultyText) || DEFAULTS.facultyId;
    }
    clearDownstream('faculty');
    saveState();
    renderCatalog();
  }

  async function loadDisciplines(){
    const v = state.values;
    if(!v.ayearId || !v.semesterId || !v.facultyId) return;
    state.options.disciplines = optionList(await fetchJson('/Tests/Discipline', {
      ayear_id: v.ayearId,
      semester_id: v.semesterId,
      faculty_id: v.facultyId
    }));
    if(!state.options.disciplines.some(o => o.value === v.disciplineId)){
      v.disciplineId = '';
    }
    clearDownstream('discipline');
    saveState();
    renderCatalog();
  }

  async function loadExaminations(){
    const v = state.values;
    if(!v.ayearId || !v.semesterId || !v.facultyId || !v.disciplineId) return;
    const examinations = optionList(await fetchJson('/Tests/Examination', {
      ayear_id: v.ayearId,
      semester_id: v.semesterId,
      faculty_id: v.facultyId,
      discipline_id: v.disciplineId
    }));
    state.options.examinations = examinations;
    if(!examinations.some(o => o.value === v.examinationId)){
      v.examinationId = firstOptionValue(examinations);
    }
    clearDownstream('examination');
    saveState();
    renderCatalog();
  }

  async function loadVedomosts(){
    const v = state.values;
    if(!v.examinationId) return;
    const vedomosts = optionList(await fetchJson('/Tests/Vedomost', { is_select: 0 }));
    state.options.vedomosts = vedomosts;
    if(!vedomosts.some(o => o.value === v.vedomostId)){
      v.vedomostId = firstOptionValue(vedomosts, DEFAULTS.vedomostText) || DEFAULTS.vedomostId;
    }
    clearDownstream('vedomost');
    saveState();
    renderCatalog();
  }

  async function loadVedRules(){
    const v = state.values;
    if(!v.ayearId || !v.semesterId || !v.facultyId || !v.disciplineId || !v.examinationId || !v.vedomostId) return;
    state.options.vedRules = optionList(await fetchJson('/Tests/Rules', {
      ayear_id: v.ayearId,
      semester_id: v.semesterId,
      faculty_id: v.facultyId,
      dis_id: v.disciplineId,
      exam_id: v.examinationId,
      ved_id: v.vedomostId
    }));
    if(!state.options.vedRules.some(o => o.value === v.vedRuleId)){
      v.vedRuleId = firstOptionValue(state.options.vedRules);
    }
    clearDownstream('vedRule');
    saveState();
    renderCatalog();
  }

  async function loadModuls(){
    const v = state.values;
    if(!v.vedomostId || !v.vedRuleId) return;
    state.options.moduls = optionList(await fetchJson('/Tests/Modul', {
      ved_id: v.vedomostId,
      is_select: 0,
      rules: v.vedRuleId
    }));
    if(!state.options.moduls.some(o => o.value === v.modulId)){
      v.modulId = '';
    }
    clearDownstream('modul');
    saveState();
    renderCatalog();
  }

  async function loadGroups(){
    const v = state.values;
    if(!v.ayearId || !v.semesterId || !v.facultyId || !v.disciplineId || !v.examinationId || !v.vedomostId || !v.vedRuleId){
      log('Fill year/semester/faculty/discipline/control/vedomost/rule first.', '#c33');
      return;
    }
    uiBusy(true);
    try{
      const groups = optionList(await fetchJson('/Tests/Group', {
        ayear_id: v.ayearId,
        semester_id: v.semesterId,
        faculty_id: v.facultyId,
        discipline_id: v.disciplineId,
        examination_id: v.examinationId,
        is_select: 1,
        rules: v.vedRuleId,
        ved_id: v.vedomostId
      })).filter(o => o.value);
      state.groups = groups;
      const valid = new Set(groups.map(g => String(g.value)));
      state.selectedGroupIds = state.selectedGroupIds.filter(id => valid.has(String(id)));
      state.studentsByGroup = {};
      state.selectedStudentIds = [];
      saveState();
      renderGroups();
      renderStudents();
      log('Groups loaded: ' + groups.length, '#06c');
    }catch(e){
      log('Groups load failed: ' + e.message, '#c33');
    }finally{
      uiBusy(false);
    }
  }

  async function loadStudentsForSelectedGroups(){
    const groups = selectedGroups();
    if(!groups.length){
      log('Select groups first.', '#c33');
      return;
    }
    uiBusy(true);
    try{
      const v = state.values;
      for(const group of groups){
        if(runState.stop) break;
        const rows = optionList(await fetchJson('/Tests/Student', {
          ayear_id: v.ayearId,
          group_id: group.value,
          dis_id: v.disciplineId,
          sem_id: v.semesterId,
          exam_id: v.examinationId,
          ved_id: v.vedomostId
        })).filter(o => o.value);
        state.studentsByGroup[group.value] = rows;
        log(group.text + ': students ' + rows.length);
      }
      const valid = new Set(Object.values(state.studentsByGroup).flat().map(s => String(s.value)));
      state.selectedStudentIds = state.selectedStudentIds.filter(id => valid.has(String(id)));
      saveState();
      renderStudents();
      updateStat();
      log('Students loaded.', '#06c');
    }catch(e){
      log('Students load failed: ' + e.message, '#c33');
    }finally{
      uiBusy(false);
    }
  }

  function clearDownstream(level){
    const v = state.values;
    if(level === 'semester'){
      state.options.faculties = [];
      v.facultyId = DEFAULTS.facultyId;
    }
    if(['semester','faculty'].includes(level)){
      state.options.disciplines = [];
      v.disciplineId = '';
    }
    if(['semester','faculty','discipline'].includes(level)){
      state.options.examinations = [];
      v.examinationId = '';
    }
    if(['semester','faculty','discipline','examination'].includes(level)){
      state.options.vedomosts = [];
      v.vedomostId = DEFAULTS.vedomostId;
    }
    if(['semester','faculty','discipline','examination','vedomost'].includes(level)){
      state.options.vedRules = [];
      v.vedRuleId = '';
    }
    if(['semester','faculty','discipline','examination','vedomost','vedRule'].includes(level)){
      state.options.moduls = [];
      v.modulId = '';
    }
    if(['semester','faculty','discipline','examination','vedomost','vedRule','modul'].includes(level)){
      state.groups = [];
      state.selectedGroupIds = [];
      state.studentsByGroup = {};
      state.selectedStudentIds = [];
    }
  }

  async function autoLoadCatalog(){
    uiBusy(true);
    try{
      if(!state.options.years.length) await loadYears();
      if(!state.values.ayearId) state.values.ayearId = firstOptionValue(state.options.years, DEFAULTS.yearText) || DEFAULTS.yearId;
      if(!state.options.semesters.length) await loadSemesters();
      if(state.values.semesterId && !state.options.faculties.length) await loadFaculties();
      if(state.values.facultyId && !state.options.disciplines.length) await loadDisciplines();
      if(state.values.disciplineId && !state.options.examinations.length) await loadExaminations();
      if(state.values.examinationId && !state.options.vedomosts.length) await loadVedomosts();
      if(state.values.vedomostId && !state.options.vedRules.length) await loadVedRules();
      if(state.values.vedRuleId && !state.options.moduls.length) await loadModuls();
      renderCatalog();
    }catch(e){
      log('Catalog load failed: ' + e.message, '#c33');
    }finally{
      uiBusy(false);
    }
  }

  async function loadTestQuestionRows(testId){
    const base = new URL('/Tests/GetTestQues', location.origin);
    base.searchParams.set('loadOptions[searchOperation]', '"contains"');
    base.searchParams.set('loadOptions[userData]', '{}');
    base.searchParams.set('loadOptions[requireTotalCount]', 'true');
    base.searchParams.set('testId', testId);
    base.searchParams.set('_', String(Date.now()));

    const first = await fetchText(base.href, {
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
      },
      label: '/Tests/GetTestQues'
    });
    let parsed = parseFlexibleJson(first);
    let rows = Array.isArray(parsed) ? parsed : (parsed.data || parsed.Data || parsed.items || parsed.Items || []);
    const total = Number(parsed.totalCount ?? parsed.TotalCount ?? rows.length) || rows.length;
    if(total <= rows.length) return rows;

    const all = [];
    for(let skip = 0; skip < total; skip += 1000){
      const page = new URL(base.href);
      page.searchParams.set('loadOptions[skip]', String(skip));
      page.searchParams.set('loadOptions[take]', String(Math.min(1000, total - skip)));
      page.searchParams.set('_', String(Date.now()));
      parsed = parseFlexibleJson(await fetchText(page.href, {
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest'
        },
        label: '/Tests/GetTestQues'
      }));
      rows = Array.isArray(parsed) ? parsed : (parsed.data || parsed.Data || parsed.items || parsed.Items || []);
      all.push(...rows);
      if(rows.length < Math.min(1000, total - skip)) break;
    }
    return all.length ? all : rows;
  }

  async function loadCategoryOptionsFromQuestion(questionId){
    const html = await fetchText(makeUrl('/tests/AddQuestion', { questionId, isAppealed: 'true' }), {
      headers: {
        'Accept': 'text/html, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
      },
      label: '/tests/AddQuestion'
    });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sel = doc.querySelector('#question-category') || doc.querySelector('[name="TestCategory"]');
    return parseSelectOptions(sel).filter(o => o.value);
  }

  function rowQuestionId(row){
    return Number(row.id ?? row.Id ?? row.questionId ?? row.QuestionId) || 0;
  }

  function rowCategoryText(row){
    return short(row.category ?? row.Category ?? row.testCategory ?? row.TestCategory ?? '', 160);
  }

  async function loadCategories(){
    if(!state.selectedTest) return;
    uiBusy(true);
    try{
      log('Loading question categories...');
      const rows = await loadTestQuestionRows(state.selectedTest.id);
      const byName = new Map();
      rows.forEach(row => {
        const name = rowCategoryText(row);
        if(name && !byName.has(norm(name))) byName.set(norm(name), { name });
      });

      let categoryOptions = [];
      const sample = rows.map(rowQuestionId).find(Boolean);
      if(sample) categoryOptions = await loadCategoryOptionsFromQuestion(sample).catch(() => []);
      const optionByName = new Map(categoryOptions.map(o => [norm(o.text), o]));

      const categoryItems = [...byName.values()];
      let cats = categoryItems.map((item, idx) => {
        let opt = optionByName.get(norm(item.name));
        if(!opt && categoryOptions.length === categoryItems.length){
          opt = categoryOptions[idx];
        }
        return {
          id: opt ? opt.value : '',
          name: opt ? opt.text : item.name,
          count: 0,
          order: 0
        };
      });

      if(!cats.length && categoryOptions.length){
        cats = categoryOptions.map(o => ({ id: o.value, name: o.text, count: 0, order: 0 }));
      }

      const existingById = new Map(state.categories.map(c => [String(c.id || c.name), c]));
      cats.forEach((cat, idx) => {
        const old = existingById.get(String(cat.id || cat.name));
        cat.count = Number(old && old.count) || 0;
        cat.order = Number(old && old.order) || idx + 1;
      });

      state.categories = cats;
      distributeCategories(false);
      saveState();
      renderCategories();
      log('Categories loaded: ' + cats.length, '#06c');
    }catch(e){
      log('Categories load failed: ' + e.message, '#c33');
    }finally{
      uiBusy(false);
    }
  }

  function distributeCategories(force = true){
    const cats = state.categories || [];
    const total = Number(state.values.questions) || DEFAULTS.questions;
    if(!cats.length) return;
    const hasCounts = cats.some(c => Number(c.count) > 0);
    if(hasCounts && !force) return;
    const base = Math.floor(total / cats.length);
    const rem = total % cats.length;
    cats.forEach((cat, idx) => {
      cat.count = base + (idx >= cats.length - rem ? 1 : 0);
      cat.order = idx + 1;
    });
    saveState();
  }

  function categorySum(){
    return state.categories.reduce((sum, cat) => sum + (Number(cat.count) || 0), 0);
  }

  function categoryPayload(){
    return state.categories
      .filter(cat => Number(cat.count) > 0)
      .map(cat => {
        if(!cat.id) throw new Error('Category id not found for "' + cat.name + '". Open a question once or update categories.');
        return `${cat.id}_${Number(cat.count) || 0}_${Number(cat.order) || 0}`;
      })
      .join(',');
  }

  function renderCategories(){
    const box = panel && panel.querySelector('#dta-categories');
    if(!box) return;
    const cats = state.categories || [];
    const sum = categorySum();
    const total = Number(state.values.questions) || 0;
    box.innerHTML = cats.length
      ? `
        <div class="dta-cat-head">
          <span>Category</span><span>Questions</span><span>Order</span>
        </div>
        ${cats.map((cat, idx) => `
          <div class="dta-cat-row">
            <span title="${esc(cat.name)}">${esc(short(cat.name, 56))}<small>#${esc(cat.id || '?')}</small></span>
            <input type="number" min="0" data-cat-idx="${idx}" data-cat-field="count" value="${esc(cat.count || 0)}">
            <input type="number" min="1" data-cat-idx="${idx}" data-cat-field="order" value="${esc(cat.order || idx + 1)}">
          </div>`).join('')}
        <div class="${sum === total ? 'dta-ok' : 'dta-warn'}">Sum: ${sum}/${total || '-'}</div>`
      : '<div class="dta-muted">No categories loaded.</div>';

    box.querySelectorAll('[data-cat-idx]').forEach(input => {
      input.oninput = () => {
        const cat = state.categories[Number(input.dataset.catIdx)];
        if(!cat) return;
        cat[input.dataset.catField] = Math.max(0, parseInt(input.value, 10) || 0);
        saveState();
        renderCategories();
      };
    });
    updateStat();
  }

  function selectedGroups(){
    const selected = new Set(state.selectedGroupIds.map(String));
    return state.groups.filter(group => selected.has(String(group.value)));
  }

  function selectedStudentsByGroup(){
    const selected = new Set(state.selectedStudentIds.map(String));
    const result = new Map();
    for(const group of selectedGroups()){
      const rows = (state.studentsByGroup[group.value] || []).filter(s => selected.has(String(s.value)));
      if(rows.length) result.set(group.value, { group, students: rows });
    }
    return result;
  }

  function renderGroups(){
    const box = panel && panel.querySelector('#dta-groups');
    if(!box) return;
    const selected = new Set(state.selectedGroupIds.map(String));
    box.innerHTML = state.groups.length
      ? state.groups.map(group => `
        <label class="dta-check">
          <input type="checkbox" data-group-id="${esc(group.value)}" ${selected.has(String(group.value)) ? 'checked' : ''}>
          <span>${esc(group.text)} <small>#${esc(group.value)}</small></span>
        </label>`).join('')
      : '<div class="dta-muted">No groups loaded.</div>';

    box.querySelectorAll('[data-group-id]').forEach(input => {
      input.onchange = () => {
        state.selectedGroupIds = [...box.querySelectorAll('[data-group-id]:checked')].map(el => el.dataset.groupId);
        const validStudentIds = new Set(selectedGroups().flatMap(g => (state.studentsByGroup[g.value] || []).map(s => String(s.value))));
        state.selectedStudentIds = state.selectedStudentIds.filter(id => validStudentIds.has(String(id)));
        saveState();
        renderStudents();
        updateStat();
      };
    });
    updateStat();
  }

  function renderStudents(){
    const box = panel && panel.querySelector('#dta-students');
    if(!box) return;
    const selected = new Set(state.selectedStudentIds.map(String));
    const q = norm(panel.querySelector('#dta-student-search')?.value || '');
    const chunks = [];
    for(const group of selectedGroups()){
      const rows = state.studentsByGroup[group.value] || [];
      const filtered = rows.filter(s => !q || norm(s.text).includes(q) || norm(s.value).includes(q));
      if(!rows.length){
        chunks.push(`<div class="dta-muted">${esc(group.text)}: not loaded.</div>`);
        continue;
      }
      chunks.push(`<div class="dta-subhead">${esc(group.text)} (${filtered.length}/${rows.length})</div>`);
      filtered.forEach(student => {
        const checked = selected.has(String(student.value));
        chunks.push(`
          <label class="dta-check ${checked ? 'dta-selected-student' : ''}">
            <input type="checkbox" data-student-id="${esc(student.value)}" ${checked ? 'checked' : ''}>
            <span>${esc(student.text)} <small>#${esc(student.value)}</small></span>
          </label>`);
      });
    }
    box.innerHTML = chunks.length ? chunks.join('') : '<div class="dta-muted">Select groups and load students.</div>';
    box.querySelectorAll('[data-student-id]').forEach(input => {
      input.onchange = () => {
        const current = new Set(state.selectedStudentIds.map(String));
        if(input.checked) current.add(input.dataset.studentId);
        else current.delete(input.dataset.studentId);
        state.selectedStudentIds = [...current];
        saveState();
        renderStudents();
      };
    });
    renderSelectedStudentsSummary();
    updateStat();
  }

  function renderSelectedStudentsSummary(){
    const box = panel && panel.querySelector('#dta-selected-students');
    if(!box) return;
    const grouped = [...selectedStudentsByGroup().values()];
    const total = grouped.reduce((sum, item) => sum + item.students.length, 0);
    if(!total){
      box.innerHTML = '<div class="dta-muted">No students selected.</div>';
      return;
    }

    const chunks = [`<div class="dta-ok">Selected students: ${total}</div>`];
    grouped.forEach(item => {
      chunks.push(`<div class="dta-subhead">${esc(item.group.text)} (${item.students.length})</div>`);
      item.students.forEach(student => {
        chunks.push(`
          <div class="dta-selected-line">
            <span>${esc(student.text)} <small>#${esc(student.value)}</small></span>
            <button type="button" class="dta-mini" data-selected-remove="${esc(student.value)}">x</button>
          </div>`);
      });
    });
    box.innerHTML = chunks.join('');
    box.querySelectorAll('[data-selected-remove]').forEach(btn => {
      btn.onclick = () => {
        state.selectedStudentIds = state.selectedStudentIds.filter(id => String(id) !== String(btn.dataset.selectedRemove));
        saveState();
        renderStudents();
      };
    });
  }

  function renderRules(){
    const sel = panel && panel.querySelector('#dta-test-rule');
    if(!sel) return;
    sel.innerHTML = selectOptionsHtml(state.testRuleOptions, 'Select rule...');
    sel.value = state.values.testRuleId || '';
  }

  function renderCatalog(){
    if(!panel) return;
    const v = state.values;
    const selects = [
      ['dta-year', state.options.years, v.ayearId],
      ['dta-semester', state.options.semesters, v.semesterId],
      ['dta-faculty', state.options.faculties, v.facultyId],
      ['dta-discipline', state.options.disciplines, v.disciplineId],
      ['dta-exam', state.options.examinations, v.examinationId],
      ['dta-ved', state.options.vedomosts, v.vedomostId],
      ['dta-ved-rule', state.options.vedRules, v.vedRuleId],
      ['dta-modul', state.options.moduls, v.modulId]
    ];
    selects.forEach(([id, options, value]) => {
      const el = panel.querySelector('#' + id);
      if(!el) return;
      el.innerHTML = selectOptionsHtml(options);
      el.value = value || '';
    });
    renderGroups();
    renderStudents();
    updateStat();
  }

  function renderSchedule(){
    if(!panel) return;
    const v = state.values;
    [
      ['dta-questions', v.questions],
      ['dta-minutes', v.minutes],
      ['dta-attempts', DEFAULTS.attempts],
      ['dta-date-i', v.dateI],
      ['dta-date-f', v.dateF],
      ['dta-time-i', v.timeI],
      ['dta-time-f', v.timeF]
    ].forEach(([id, value]) => {
      const el = panel.querySelector('#' + id);
      if(el) el.value = value || '';
    });
  }

  function updateStat(){
    const groupCount = state.selectedGroupIds.length;
    const studentCount = state.selectedStudentIds.length;
    const cat = `${categorySum()}/${state.values.questions || '-'}`;
    setStat(
      `Student assignment | groups selected: ${groupCount}/${state.groups.length} | students selected: ${studentCount} | categories: ${cat}`
    );
  }

  function uiBusy(busy){
    if(!panel) return;
    panel.querySelectorAll('button,input,select').forEach(el => {
      if(el.id === 'dta-stop') el.disabled = !runState.running;
      else if(el.id === 'dta-attempts') el.disabled = true;
      else if(el.id !== 'dta-close') el.disabled = busy;
    });
  }

  function append(fd, name, value){
    if(value == null) return;
    fd.append(name, String(value));
  }

  function set(fd, name, value){
    if(value == null) return;
    fd.set(name, String(value));
  }

  function tokenFromForm(form){
    return form.querySelector('[name="__RequestVerificationToken"]')?.value || '';
  }

  function baseFormData(form){
    const v = state.values;
    const fd = new FormData();
    const token = tokenFromForm(form);
    if(token) set(fd, '__RequestVerificationToken', token);

    set(fd, 'TestId', state.selectedTest.id);
    set(fd, 'CategoryQuestions', categoryPayload());
    set(fd, 'TestRuleId', v.testRuleId);
    set(fd, 'NumberOfQuestions', Number(v.questions) || DEFAULTS.questions);
    set(fd, 'TotalTime', Number(v.minutes) || DEFAULTS.minutes);
    set(fd, 'NumberOfAttempts', DEFAULTS.attempts);
    set(fd, 'TestDateI', v.dateI || todayDate());
    set(fd, 'TestDateF', v.dateF || v.dateI || todayDate());
    set(fd, 'TimeI', v.timeI || '00:00');
    set(fd, 'TimeF', v.timeF || '23:59');
    set(fd, 'ShowResults', DEFAULTS.showResults);
    set(fd, 'GetCameraCaptures', 'false');
    set(fd, 'GetCameraVideoCapture', 'false');
    set(fd, 'TestTypeId', DEFAULTS.testTypeId);
    set(fd, 'AYearID', v.ayearId);
    set(fd, 'SemesterID', v.semesterId);
    set(fd, 'FacultyID', v.facultyId);
    set(fd, 'DisciplineID', v.disciplineId);
    set(fd, 'ExaminationID', v.examinationId);
    set(fd, 'VedomostID', v.vedomostId);
    set(fd, 'RuleID', v.vedRuleId);
    set(fd, 'rules', v.vedRuleId);
    set(fd, 'ModulID', v.modulId);
    set(fd, 'ModuleID', v.modulId);
    return fd;
  }

  async function postAssign(action, fd, label){
    const body = new URLSearchParams();
    fd.forEach((value, key) => body.append(key, value));
    const res = await fetch(action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
      credentials: 'same-origin',
      redirect: 'follow'
    });
    const text = await res.text();
    if(!res.ok) throw new Error(label + ': HTTP ' + res.status + ' ' + short(text, 300));
    if(/field-validation-error|validation-summary-errors/i.test(text)){
      log(label + ': server returned validation markup; check manually.', '#c60');
    }
    return text;
  }

  function validateBeforeRun(){
    if(!state.selectedTest) throw new Error('Select a test.');
    const v = state.values;
    const required = [
      ['test rule', v.testRuleId],
      ['year', v.ayearId],
      ['semester', v.semesterId],
      ['faculty', v.facultyId],
      ['discipline', v.disciplineId],
      ['control form', v.examinationId],
      ['vedomost', v.vedomostId],
      ['vedomost rule', v.vedRuleId],
      ['modul', v.modulId],
      ['date start', v.dateI],
      ['date end', v.dateF],
      ['time start', v.timeI],
      ['time end', v.timeF]
    ];
    const missing = required.filter(item => !item[1]).map(item => item[0]);
    if(missing.length) throw new Error('Missing: ' + missing.join(', '));
    if(!state.categories.length) throw new Error('Load categories.');
    if(categorySum() !== Number(v.questions)) throw new Error('Category sum must equal question count.');
    if(!state.selectedGroupIds.length) throw new Error('Select groups first, then load students.');
    if(!state.selectedStudentIds.length) throw new Error('Select students.');
  }

  async function startAssign(){
    if(runState.running) return;
    try{
      validateBeforeRun();
    }catch(e){
      log(e.message, '#c33');
      return;
    }

    runState.running = true;
    runState.stop = false;
    uiBusy(true);
    logEl.innerHTML = '';

    try{
      const targets = [...selectedStudentsByGroup().values()];
      let done = 0;
      for(const item of targets){
        if(runState.stop) break;
        const { form, action } = await fetchAssignForm();
        const fd = baseFormData(form);
        set(fd, 'GroupID', item.group.value);
        item.students.forEach(student => append(fd, 'StudentIds', student.value));
        log(`Assigning ${item.students.length} students: ${item.group.text}`);
        await postAssign(action, fd, item.group.text);
        done++;
        updateStat();
        await sleep(150);
      }
      log(runState.stop ? 'Stopped.' : `Done: ${done}/${targets.length} student batches.`, runState.stop ? '#c60' : '#0a0');
    }catch(e){
      log('STOP: ' + e.message, '#c33');
    }finally{
      runState.running = false;
      uiBusy(false);
      updateStat();
    }
  }

  function clearRecipients(){
    state.groups = [];
    state.selectedGroupIds = [];
    state.studentsByGroup = {};
    state.selectedStudentIds = [];
    saveState();
    renderGroups();
    renderStudents();
  }

  function wireEvents(){
    panel.querySelector('#dta-close').onclick = () => panel.remove();
    panel.querySelector('#dta-tests-load').onclick = loadTests;
    panel.querySelector('#dta-use-current').onclick = () => {
      const test = currentTestFromPage();
      if(!test) log('This page is not /Tests/Details/{id}.', '#c33');
      else selectTest(test);
    };
    panel.querySelector('#dta-filter-q').oninput = event => {
      state.testFilters.q = event.target.value;
      saveState();
      renderTests();
    };
    panel.querySelector('#dta-filter-date-from').oninput = event => {
      state.testFilters.dateFrom = event.target.value;
      saveState();
      renderTests();
    };
    panel.querySelector('#dta-filter-date-to').oninput = event => {
      state.testFilters.dateTo = event.target.value;
      saveState();
      renderTests();
    };

    panel.querySelector('#dta-test-rule').onchange = event => {
      state.values.testRuleId = event.target.value;
      saveState();
    };

    const catalogEvents = [
      ['dta-year', 'ayearId', async () => { clearDownstream('semester'); await loadSemesters(); }],
      ['dta-semester', 'semesterId', async () => {
        clearDownstream('semester');
        await loadFaculties();
        if(state.values.facultyId) await loadDisciplines();
      }],
      ['dta-faculty', 'facultyId', async () => { clearDownstream('faculty'); await loadDisciplines(); }],
      ['dta-discipline', 'disciplineId', async () => {
        clearDownstream('discipline');
        await loadExaminations();
        if(state.values.examinationId) await loadVedomosts();
        if(state.values.vedomostId) await loadVedRules();
        if(state.values.vedRuleId) await loadModuls();
      }],
      ['dta-exam', 'examinationId', async () => {
        clearDownstream('examination');
        await loadVedomosts();
        if(state.values.vedomostId) await loadVedRules();
        if(state.values.vedRuleId) await loadModuls();
      }],
      ['dta-ved', 'vedomostId', async () => {
        clearDownstream('vedomost');
        await loadVedRules();
        if(state.values.vedRuleId) await loadModuls();
      }],
      ['dta-ved-rule', 'vedRuleId', async () => { clearDownstream('vedRule'); await loadModuls(); }],
      ['dta-modul', 'modulId', async () => { clearDownstream('modul'); saveState(); renderCatalog(); }]
    ];
    catalogEvents.forEach(([id, key, handler]) => {
      panel.querySelector('#' + id).onchange = async event => {
        state.values[key] = event.target.value;
        saveState();
        try{ await handler(); }
        catch(e){ log(e.message, '#c33'); }
      };
    });

    panel.querySelector('#dta-catalog-load').onclick = autoLoadCatalog;
    panel.querySelector('#dta-groups-load').onclick = loadGroups;
    panel.querySelector('#dta-students-load').onclick = loadStudentsForSelectedGroups;
    panel.querySelector('#dta-groups-all').onclick = () => {
      state.selectedGroupIds = state.groups.map(g => String(g.value));
      saveState();
      renderGroups();
      renderStudents();
    };
    panel.querySelector('#dta-groups-none').onclick = () => {
      state.selectedGroupIds = [];
      state.selectedStudentIds = [];
      saveState();
      renderGroups();
      renderStudents();
    };
    panel.querySelector('#dta-students-all').onclick = () => {
      const q = norm(panel.querySelector('#dta-student-search').value || '');
      const selected = new Set(state.selectedStudentIds.map(String));
      for(const group of selectedGroups()){
        (state.studentsByGroup[group.value] || [])
          .filter(s => !q || norm(s.text).includes(q) || norm(s.value).includes(q))
          .forEach(s => selected.add(String(s.value)));
      }
      state.selectedStudentIds = [...selected];
      saveState();
      renderStudents();
    };
    panel.querySelector('#dta-students-none').onclick = () => {
      state.selectedStudentIds = [];
      saveState();
      renderStudents();
    };
    panel.querySelector('#dta-student-search').oninput = renderStudents;

    panel.querySelector('#dta-now').onclick = refreshDatesToNow;
    [
      ['dta-questions', 'questions'],
      ['dta-minutes', 'minutes'],
      ['dta-date-i', 'dateI'],
      ['dta-date-f', 'dateF'],
      ['dta-time-i', 'timeI'],
      ['dta-time-f', 'timeF']
    ].forEach(([id, key]) => {
      panel.querySelector('#' + id).oninput = event => {
        state.values[key] = event.target.value;
        if(key === 'questions') distributeCategories(true);
        saveState();
        renderCategories();
      };
    });

    panel.querySelector('#dta-cats-load').onclick = loadCategories;
    panel.querySelector('#dta-cats-distribute').onclick = () => {
      distributeCategories(true);
      renderCategories();
    };
    panel.querySelector('#dta-start').onclick = startAssign;
    panel.querySelector('#dta-stop').onclick = () => {
      runState.stop = true;
      log('Stop requested.', '#c33');
    };
  }

  function renderMode(){
    state.mode = 'students';
    const studentControls = panel.querySelector('#dta-student-controls');
    if(studentControls) studentControls.style.display = '';
    renderGroups();
    renderStudents();
    updateStat();
  }

  function installStyles(){
    if(document.getElementById('dta-style')) return;
    const style = document.createElement('style');
    style.id = 'dta-style';
    style.textContent = `
      #${PANEL_ID}{position:fixed;right:12px;top:12px;z-index:2147483645;width:760px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;background:#fff;border:1px solid #6b7280;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.24);font:13px/1.35 Segoe UI,Arial,sans-serif;color:#1f2937;padding:10px}
      #${PANEL_ID} *{box-sizing:border-box}
      #${PANEL_ID} button,#${PANEL_ID} input,#${PANEL_ID} select{font:inherit}
      #${PANEL_ID} button{cursor:pointer;border:0;border-radius:5px;padding:6px 8px;background:#e5e7eb;color:#111827}
      #${PANEL_ID} button.dta-primary{background:#08775b;color:#fff}
      #${PANEL_ID} button.dta-blue{background:#2563eb;color:#fff}
      #${PANEL_ID} button.dta-red{background:#b91c1c;color:#fff}
      #${PANEL_ID} input,#${PANEL_ID} select{width:100%;border:1px solid #cbd5e1;border-radius:5px;padding:5px;background:#fff}
      #${PANEL_ID} input[type="checkbox"],#${PANEL_ID} input[type="radio"]{width:auto;padding:0}
      #${PANEL_ID} label{display:block}
      #${PANEL_ID} .dta-header{display:flex;justify-content:space-between;align-items:center;font-weight:700;margin-bottom:8px}
      #${PANEL_ID} .dta-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      #${PANEL_ID} .dta-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
      #${PANEL_ID} .dta-row{display:flex;gap:6px;align-items:center;margin:6px 0}
      #${PANEL_ID} .dta-section{border-top:1px solid #e5e7eb;padding-top:8px;margin-top:8px}
      #${PANEL_ID} .dta-section-title{font-weight:700;margin-bottom:5px}
      #${PANEL_ID} .dta-muted{color:#6b7280;font-size:12px}
      #${PANEL_ID} .dta-ok{color:#08775b;font-weight:700}
      #${PANEL_ID} .dta-warn{color:#b45309;font-weight:700}
      #${PANEL_ID} .dta-scroll{overflow:auto;background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;padding:6px}
      #${PANEL_ID} .dta-test-row{display:block;width:100%;text-align:left;background:#fff;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:4px;padding:6px}
      #${PANEL_ID} .dta-test-title{display:block;font-weight:700}
      #${PANEL_ID} .dta-test-meta{display:block;color:#6b7280;font-size:12px}
      #${PANEL_ID} .dta-check{display:flex;gap:6px;align-items:flex-start;margin:2px 0}
      #${PANEL_ID} .dta-check input{width:auto;margin-top:2px}
      #${PANEL_ID} .dta-selected-student{background:#eefbf7;border:1px solid #86efac;border-radius:5px;padding:3px 4px}
      #${PANEL_ID} .dta-selected-line{display:flex;justify-content:space-between;gap:6px;align-items:center;border-bottom:1px solid #e5e7eb;padding:3px 0}
      #${PANEL_ID} .dta-selected-line:last-child{border-bottom:0}
      #${PANEL_ID} button.dta-mini{padding:1px 6px;border-radius:4px;background:#fee2e2;color:#991b1b}
      #${PANEL_ID} small{color:#6b7280;font-size:11px}
      #${PANEL_ID} .dta-subhead{font-weight:700;margin:6px 0 3px}
      #${PANEL_ID} .dta-cat-head,#${PANEL_ID} .dta-cat-row{display:grid;grid-template-columns:1fr 90px 70px;gap:6px;align-items:center;margin-bottom:4px}
      #${PANEL_ID} .dta-cat-head{font-weight:700;color:#4b5563}
      #dta-log{height:150px}
      #dta-tests{height:190px}
      #dta-groups{height:170px}
      #dta-students{height:180px}
      #dta-selected-students{max-height:160px;margin-top:6px}
      #dta-categories{min-height:84px}
    `;
    document.head.appendChild(style);
  }

  function clampPanelPosition(left, top){
    const rect = panel.getBoundingClientRect();
    return {
      left: Math.min(Math.max(8, left), Math.max(8, window.innerWidth - rect.width - 8)),
      top: Math.min(Math.max(8, top), Math.max(8, window.innerHeight - rect.height - 8))
    };
  }

  function applyPanelPosition(){
    if(!state.panelPosition) return;
    const left = Number(state.panelPosition.left);
    const top = Number(state.panelPosition.top);
    if(!Number.isFinite(left) || !Number.isFinite(top)) return;
    const pos = clampPanelPosition(left, top);
    panel.style.left = pos.left + 'px';
    panel.style.top = pos.top + 'px';
    panel.style.right = 'auto';
  }

  function makeDraggable(){
    const header = panel.querySelector('.dta-header');
    let drag = null;
    header.addEventListener('pointerdown', event => {
      if(event.target.closest('button,input,select')) return;
      const rect = panel.getBoundingClientRect();
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.right = 'auto';
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      header.setPointerCapture(event.pointerId);
    });
    header.addEventListener('pointermove', event => {
      if(!drag || drag.id !== event.pointerId) return;
      const pos = clampPanelPosition(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
      panel.style.left = pos.left + 'px';
      panel.style.top = pos.top + 'px';
    });
    const done = event => {
      if(!drag || drag.id !== event.pointerId) return;
      const rect = panel.getBoundingClientRect();
      drag = null;
      state.panelPosition = { left: Math.round(rect.left), top: Math.round(rect.top) };
      saveState();
    };
    header.addEventListener('pointerup', done);
    header.addEventListener('pointercancel', done);
    window.addEventListener('resize', applyPanelPosition);
  }

  function buildPanel(){
    if(document.getElementById(PANEL_ID)) return;
    ensureScheduleDefaults();
    installStyles();

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="dta-header">
        <span>Batch student test assign</span>
        <button id="dta-close" title="Close">x</button>
      </div>
      <div id="dta-stat" class="dta-muted"></div>

      <div class="dta-section">
        <div class="dta-section-title">1. Test</div>
        <div id="dta-selected-test" class="dta-scroll" style="min-height:44px"></div>
        <div class="dta-grid-3" style="margin-top:6px">
          <input id="dta-filter-q" type="search" placeholder="Search title, author, subject" value="${esc(state.testFilters.q)}">
          <input id="dta-filter-date-from" type="date" value="${esc(state.testFilters.dateFrom)}">
          <input id="dta-filter-date-to" type="date" value="${esc(state.testFilters.dateTo)}">
        </div>
        <div class="dta-row">
          <button id="dta-tests-load" class="dta-blue" type="button">Load tests</button>
          <button id="dta-use-current" type="button">Use current details page</button>
        </div>
        <div id="dta-tests" class="dta-scroll"></div>
      </div>

      <div class="dta-section">
        <div class="dta-section-title">2. Assignment fields</div>
        <div class="dta-row">
          <span class="dta-muted">Groups are used only to load students. The test is assigned only to selected students.</span>
          <button id="dta-catalog-load" class="dta-blue" type="button">Load catalogs</button>
        </div>
        <div class="dta-grid">
          <label>Test rule<select id="dta-test-rule"></select></label>
          <label>Year<select id="dta-year"></select></label>
          <label>Semester<select id="dta-semester"></select></label>
          <label>Faculty<select id="dta-faculty"></select></label>
          <label>Discipline<select id="dta-discipline"></select></label>
          <label>Control form<select id="dta-exam"></select></label>
          <label>Vedomost<select id="dta-ved"></select></label>
          <label>Vedomost rule<select id="dta-ved-rule"></select></label>
          <label>Modul<select id="dta-modul"></select></label>
          <label>Questions<input id="dta-questions" type="number" min="1"></label>
          <label>Minutes<input id="dta-minutes" type="number" min="1"></label>
          <label>Attempts<input id="dta-attempts" type="number" min="1" value="1" disabled></label>
        </div>
        <div class="dta-grid" style="margin-top:6px">
          <label>Date from<input id="dta-date-i" type="text" placeholder="dd/mm/yyyy"></label>
          <label>Date to<input id="dta-date-f" type="text" placeholder="dd/mm/yyyy"></label>
          <label>Time from<input id="dta-time-i" type="time"></label>
          <label>Time to<input id="dta-time-f" type="time"></label>
        </div>
        <div class="dta-row">
          <button id="dta-now" type="button">Today / now +1h</button>
        </div>
      </div>

      <div class="dta-section">
        <div class="dta-section-title">3. Select groups, then students</div>
        <div class="dta-row">
          <button id="dta-groups-load" class="dta-blue" type="button">Load groups for students</button>
          <button id="dta-groups-all" type="button">All groups</button>
          <button id="dta-groups-none" type="button">No groups</button>
        </div>
        <div id="dta-groups" class="dta-scroll"></div>
        <div id="dta-student-controls" style="margin-top:8px">
          <div class="dta-row">
            <button id="dta-students-load" class="dta-blue" type="button">Load students</button>
            <button id="dta-students-all" type="button">All visible students</button>
            <button id="dta-students-none" type="button">No students</button>
          </div>
          <input id="dta-student-search" type="search" placeholder="Filter students" style="margin-bottom:6px">
          <div id="dta-students" class="dta-scroll"></div>
          <div class="dta-subhead">Selected students</div>
          <div id="dta-selected-students" class="dta-scroll"></div>
        </div>
      </div>

      <div class="dta-section">
        <div class="dta-section-title">4. Categories</div>
        <div class="dta-row">
          <button id="dta-cats-load" class="dta-blue" type="button">Load categories</button>
          <button id="dta-cats-distribute" type="button">Distribute evenly</button>
        </div>
        <div id="dta-categories" class="dta-scroll"></div>
      </div>

      <div class="dta-section">
        <div class="dta-row">
          <button id="dta-start" class="dta-primary" type="button">Start assign</button>
          <button id="dta-stop" class="dta-red" type="button" disabled>Stop</button>
        </div>
        <div id="dta-log" class="dta-scroll"></div>
      </div>`;

    document.body.appendChild(panel);
    logEl = panel.querySelector('#dta-log');
    statEl = panel.querySelector('#dta-stat');
    wireEvents();
    makeDraggable();
    applyPanelPosition();
    renderSelectedTest();
    renderTests();
    renderRules();
    renderCatalog();
    renderSchedule();
    renderCategories();
    renderMode();

    const current = currentTestFromPage();
    if(current && !state.selectedTest){
      state.selectedTest = current;
      saveState();
      renderSelectedTest();
      loadAssignFormOptions();
      loadCategories();
    }

    if(!state.tests.length) loadTests();
    if(!state.options.years.length) autoLoadCatalog();
  }

  ready(buildPanel);
})();
