// ==UserScript==
// @name         Dekanat batch module marks
// @namespace    local.dekanat.batch-module-marks
// @version      1.4
// @description  Select groups, semesters, subjects, then fill 1M/2M component marks.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function(){
  'use strict';
  if(window.top !== window.self) return;

  const PANEL_ID = 'dbmf-panel';
  const STORAGE_KEY = 'dbmf_state_v1';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const MODULES = [
    {
      label: '1М',
      test: '1М Тест',
      fields: [
        { title: '1М Посещаемость', min: 3, max: 5 },
        { title: '1М Активность', min: 6, max: 10 },
        { title: '1М СРС', min: 11, max: 15 }
      ]
    },
    {
      label: '2М',
      test: '2М Тест',
      fields: [
        { title: '2М Посещаемость', min: 3, max: 5 },
        { title: '2М Активность', min: 6, max: 10 },
        { title: '2М СРС', min: 11, max: 15 }
      ]
    }
  ];

  const state = loadState();
  const runState = { running: false, stop: false };
  let panel, groupsEl, semestersEl, subjectsEl, logEl, statEl;

  function loadState(){
    try{
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
        selectedGroupIds: Array.isArray(parsed.selectedGroupIds) ? parsed.selectedGroupIds : [],
        subjectsByGroup: parsed.subjectsByGroup && typeof parsed.subjectsByGroup === 'object' ? parsed.subjectsByGroup : {},
        selectedSemesters: Array.isArray(parsed.selectedSemesters) ? parsed.selectedSemesters : [],
        selectedSubjectKeys: Array.isArray(parsed.selectedSubjectKeys) ? parsed.selectedSubjectKeys : [],
        panelPosition: parsed.panelPosition && typeof parsed.panelPosition === 'object' ? parsed.panelPosition : null
      };
    }catch(e){
      return { groups: [], selectedGroupIds: [], subjectsByGroup: {}, selectedSemesters: [], selectedSubjectKeys: [], panelPosition: null };
    }
  }

  function saveState(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

  function short(text, max = 500){
    return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function selectedOptionText(el){
    if(!el || el.tagName !== 'SELECT') return '';
    const opt = el.options[el.selectedIndex];
    return opt ? short(opt.textContent, 220) : '';
  }

  function norm(text){
    return String(text ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/[МмM]/g, 'm')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function paramsOf(url){
    try{
      const params = {};
      new URL(url, location.origin).searchParams.forEach((value, key) => {
        params[key] = value;
      });
      return params;
    }catch(e){
      return {};
    }
  }

  function absoluteUrl(url){
    try{ return new URL(url, location.origin).href; }
    catch(e){ return String(url || ''); }
  }

  function uniqueBy(items, keyFn){
    const seen = new Set();
    const result = [];
    items.forEach(item => {
      const key = keyFn(item);
      if(seen.has(key)) return;
      seen.add(key);
      result.push(item);
    });
    return result;
  }

  function selectedGroups(){
    const selected = new Set(state.selectedGroupIds.map(String));
    return state.groups.filter(group => selected.has(String(group.groupId)));
  }

  function updateGroupSelectionFromDom(){
    if(!groupsEl) return;
    state.selectedGroupIds = [...groupsEl.querySelectorAll('input[data-group-id]:checked')]
      .map(input => input.dataset.groupId);
    saveState();
    renderSubjects();
  }

  function mergeGroups(groups){
    const byId = new Map(state.groups.map(group => [String(group.groupId), group]));
    groups.forEach(group => byId.set(String(group.groupId), group));
    state.groups = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    saveState();
    renderGroups();
    renderSubjects();
  }

  function scanGroupsFromDom(){
    const groups = uniqueBy(
      [...document.querySelectorAll('a[href*="GroupJurnal?idGroup="], a[href*="groupjurnal?idGroup="]')]
        .map(a => {
          const href = absoluteUrl(a.getAttribute('href'));
          const groupId = paramsOf(href).idGroup;
          return {
            groupId,
            name: short(a.textContent, 120),
            href
          };
        })
        .filter(group => group.groupId && group.name),
      group => group.groupId
    );

    mergeGroups(groups);
    log('Найдено групп на текущей странице: ' + groups.length, groups.length ? '#06c' : '#c60');
  }

  async function scanAllDataTablePages(){
    scanGroupsFromDom();

    const pageLinks = [...document.querySelectorAll('#dataTables_paginate a')]
      .filter(a => /^\d+$/.test(a.textContent.trim()));
    if(!pageLinks.length){
      log('Пагинация DataTables не найдена. Собрал только текущую страницу.', '#c60');
      return;
    }

    const pageNumbers = pageLinks.map(a => a.textContent.trim());
    for(const page of pageNumbers){
      const link = [...document.querySelectorAll('#dataTables_paginate a')]
        .find(a => a.textContent.trim() === page);
      if(!link) continue;
      link.click();
      await sleep(450);
      scanGroupsFromDom();
      log('Просканирована страница групп: ' + page);
    }
  }

  function subjectUniqueKey(subject){
    const p = subject.params || {};
    return [
      subject.groupId || '',
      p.idSem || subject.semester || '',
      p.idDis || '',
      p.idExam || '',
      p.rules || '',
      p.idPlan || '',
      norm(subject.name)
    ].join('|');
  }

  function subjectFromAnchor(a, group){
    const href = absoluteUrl(a.getAttribute('href'));
    const params = paramsOf(href);
    const row = a.closest('tr');
    const cells = row ? [...row.querySelectorAll('td')] : [];
    const semesterText = short(cells[1] && cells[1].textContent, 80);
    const ruleSelect = row && row.querySelector('select[name="item.rules"], select#item_rules');
    return {
      groupId: group.groupId,
      groupName: group.name,
      name: short(a.textContent, 180),
      href,
      params,
      semester: params.idSem || (semesterText.match(/\d+/) || [''])[0],
      semesterText,
      credit: short(cells[3] && cells[3].textContent, 40),
      control: short(cells[4] && cells[4].textContent, 120),
      ruleText: selectedOptionText(ruleSelect)
    };
  }

  function parseSubjectsFromRoot(root, group){
    return uniqueBy(
      [...root.querySelectorAll('a[href*="/Dekanat/Open?"], a[href*="/dekanat/open?"]')]
        .map(a => subjectFromAnchor(a, group))
        .filter(subject => subject.params.idDis && subject.params.idGroup),
      subjectUniqueKey
    );
  }

  function parseSubjectsFromRows(rows, group){
    const subjects = [];
    [...rows].forEach(row => {
      [...row.querySelectorAll('a[href*="/Dekanat/Open?"], a[href*="/dekanat/open?"]')]
        .forEach(a => subjects.push(subjectFromAnchor(a, group)));
    });
    return uniqueBy(
      subjects.filter(subject => subject.params.idDis && subject.params.idGroup),
      subjectUniqueKey
    );
  }

  function parseSubjectsFromHtml(html, group){
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return parseSubjectsFromRoot(doc, group);
  }

  async function fetchText(url){
    const res = await fetch(url, { credentials: 'same-origin' });
    const text = await res.text();
    if(!res.ok) throw new Error(url + ': HTTP ' + res.status + ' ' + short(text, 300));
    return text;
  }

  function waitFor(check, timeout = 10000, interval = 150){
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        let value = null;
        try{ value = check(); }
        catch(e){}
        if(value) {
          resolve(value);
          return;
        }
        if(Date.now() - started > timeout){
          reject(new Error('timeout'));
          return;
        }
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  function getDataTableInstance(win){
    try{
      const jq = win.jQuery || win.$;
      if(!jq || !jq.fn || !jq.fn.dataTable) return null;
      const table = jq('#table');
      if(!table.length) return null;
      if(jq.fn.dataTable.isDataTable && !jq.fn.dataTable.isDataTable(table[0])) return null;
      if(typeof table.DataTable === 'function') return table.DataTable();
    }catch(e){}
    return null;
  }

  function dataTableRows(dt){
    try{
      const nodes = dt.rows().nodes();
      return nodes && typeof nodes.toArray === 'function' ? nodes.toArray() : [...nodes];
    }catch(e){
      return [];
    }
  }

  function dataTableInfo(dt){
    try{ return dt.page && dt.page.info ? dt.page.info() : null; }
    catch(e){ return null; }
  }

  function drawDataTable(win, action){
    return new Promise(resolve => {
      const jq = win.jQuery || win.$;
      const table = jq && jq('#table');
      let done = false;
      const finish = () => {
        if(done) return;
        done = true;
        try{ if(table && table.off) table.off('draw.dt', finish); }
        catch(e){}
        setTimeout(resolve, 80);
      };
      try{ if(table && table.one) table.one('draw.dt', finish); }
      catch(e){}
      try{ action(); }
      catch(e){ finish(); }
      setTimeout(finish, 1200);
    });
  }

  function createHiddenFrame(url){
    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = [
        'position:fixed',
        'left:-20000px',
        'top:0',
        'width:1200px',
        'height:900px',
        'opacity:0',
        'pointer-events:none'
      ].join(';');

      let done = false;
      const timer = setTimeout(() => finish(new Error('iframe load timeout')), 18000);
      const finish = error => {
        if(done) return;
        done = true;
        clearTimeout(timer);
        iframe.onload = null;
        iframe.onerror = null;
        if(error){
          iframe.remove();
          reject(error);
        }else{
          resolve(iframe);
        }
      };
      iframe.onload = () => finish();
      iframe.onerror = () => finish(new Error('iframe load error'));
      document.body.appendChild(iframe);
      iframe.src = url;
    });
  }

  async function scanSubjectsViaFrame(group){
    const iframe = await createHiddenFrame(group.href);
    const collected = [];
    const add = subjects => collected.push(...subjects);

    try{
      const win = iframe.contentWindow;
      const doc = iframe.contentDocument || (win && win.document);
      if(!win || !doc) throw new Error('iframe недоступен');

      await waitFor(
        () => doc.querySelector('#table, a[href*="/Dekanat/Open?"], a[href*="/dekanat/open?"]'),
        12000
      );
      add(parseSubjectsFromRoot(doc, group));

      const dt = await waitFor(() => getDataTableInstance(win), 8000).catch(() => null);
      if(dt){
        add(parseSubjectsFromRows(dataTableRows(dt), group));

        const firstInfo = dataTableInfo(dt);
        const pages = Math.min(Number(firstInfo && firstInfo.pages) || 1, 80);
        for(let page = 0; page < pages; page++){
          if(runState.stop) break;
          await drawDataTable(win, () => dt.page(page).draw('page'));
          add(parseSubjectsFromRoot(doc, group));
          add(parseSubjectsFromRows(dataTableRows(dt), group));
        }

        if(firstInfo && Number(firstInfo.recordsTotal) <= 500){
          await drawDataTable(win, () => dt.page.len(-1).draw(false));
          add(parseSubjectsFromRoot(doc, group));
          add(parseSubjectsFromRows(dataTableRows(dt), group));
        }
      }

      return uniqueBy(collected, subjectUniqueKey);
    }finally{
      iframe.remove();
    }
  }

  async function scanSubjectsForGroup(group){
    // Быстрый путь: DataTables разбивает строки на страницы уже в браузере, а сервер
    // в обычном HTML отдает сразу ВСЕ строки всех семестров. Поэтому один fetch без
    // iframe возвращает полный список дисциплин за ~0.3с вместо 12-20с на iframe.
    try{
      const html = await fetchText(group.href);
      if(/\/Dekanat\/Open\?|\/dekanat\/open\?/i.test(html)){
        return parseSubjectsFromHtml(html, group);
      }
      log(group.name + ': в HTML нет строк дисциплин, пробую DataTables-iframe', '#c60');
    }catch(e){
      log(group.name + ': HTML-скан не прошел, пробую DataTables-iframe (' + e.message + ')', '#c60');
    }

    // Резерв: на случай серверной (ajax) пагинации DataTables, когда HTML приходит пустым.
    try{
      return await scanSubjectsViaFrame(group);
    }catch(e){
      log(group.name + ': DataTables-iframe не прошел (' + e.message + ')', '#c33');
      return [];
    }
  }

  function syncSemestersAfterScan(){
    const sems = availableSemesters();
    const semSet = new Set(sems.map(String));
    state.selectedSemesters = state.selectedSemesters.filter(sem => semSet.has(String(sem)));
    if(!state.selectedSemesters.length && sems.length){
      state.selectedSemesters = sems;
    }

    const selectedKeys = new Set(allScannedSubjects().map(subjectKey));
    state.selectedSubjectKeys = state.selectedSubjectKeys.filter(key => selectedKeys.has(String(key)));
  }

  async function scanSubjectsForSelectedGroups(){
    const groups = selectedGroups();
    if(!groups.length){
      log('Сначала отметьте группы.', '#c33');
      return;
    }

    runState.running = true;
    runState.stop = false;
    uiBusy(true);
    try{
      for(const group of groups){
        if(runState.stop) break;
        log('Сканирую дисциплины: ' + group.name + '...');
        try{
          const subjects = await scanSubjectsForGroup(group);
          state.subjectsByGroup[group.groupId] = subjects;
          syncSemestersAfterScan();
          saveState();
          log(group.name + ': дисциплин найдено ' + subjects.length + ', семестры: ' + availableSemesters().join(', '), subjects.length ? '#06c' : '#c60');
        }catch(e){
          log(group.name + ': ' + e.message, '#c33');
        }
        renderSubjects();
        await sleep(100);
      }
      log('Скан дисциплин завершен. Теперь отметьте семестр и предметы.', '#06c');
    }finally{
      runState.running = false;
      uiBusy(false);
      renderSubjects();
    }
  }

  function allScannedSubjects(){
    return selectedGroups().flatMap(group => state.subjectsByGroup[group.groupId] || []);
  }

  function subjectSemester(subject){
    return String(subject.semester || (subject.params && subject.params.idSem) || '').trim();
  }

  function subjectKey(subject){
    const p = subject.params || {};
    return [
      subjectSemester(subject),
      p.idDis || '',
      p.idExam || '',
      p.rules || '',
      norm(subject.name)
    ].join('|');
  }

  function availableSemesters(){
    return [...new Set(allScannedSubjects().map(subjectSemester).filter(Boolean))]
      .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b, 'ru'));
  }

  function selectedSemesterSet(){
    return new Set(state.selectedSemesters.map(String));
  }

  function semesterMatches(subject){
    const sem = subjectSemester(subject);
    return sem && selectedSemesterSet().has(sem);
  }

  function aggregateVisibleSubjects(){
    const byKey = new Map();
    allScannedSubjects().forEach(subject => {
      if(!semesterMatches(subject)) return;
      const key = subjectKey(subject);
      if(!byKey.has(key)){
        const p = subject.params || {};
        byKey.set(key, {
          key,
          sem: subjectSemester(subject),
          name: subject.name,
          idDis: p.idDis || '',
          idExam: p.idExam || '',
          rules: p.rules || '',
          ruleText: subject.ruleText || '',
          groups: []
        });
      }
      byKey.get(key).groups.push(subject.groupName || subject.groupId);
    });

    return [...byKey.values()].sort((a, b) =>
      Number(a.sem) - Number(b.sem) ||
      a.name.localeCompare(b.name, 'ru') ||
      a.idDis.localeCompare(b.idDis)
    );
  }

  function allSelectedSubjects(){
    const keys = new Set(state.selectedSubjectKeys.map(String));
    if(!keys.size || !state.selectedSemesters.length) return [];
    return allScannedSubjects().filter(subject => semesterMatches(subject) && keys.has(subjectKey(subject)));
  }

  function subjectParams(subject){
    const p = subject.params || {};
    return {
      idDis: p.idDis,
      idExam: p.idExam,
      kredit: p.kredit,
      idYear: p.idYear,
      idSem: p.idSem,
      idVed: p.idVed,
      idGroup: p.idGroup,
      rules: p.rules,
      idPlan: p.idPlan,
      idPotok: p.idPotok && p.idPotok !== 'undefined' ? p.idPotok : '0',
      idLoad: p.idLoad && p.idLoad !== 'undefined' ? p.idLoad : 'undefined'
    };
  }

  function makeUrl(path, params){
    const url = new URL(path, location.origin);
    Object.entries(params).forEach(([key, value]) => {
      if(value !== '' && value != null) url.searchParams.set(key, value);
    });
    return url.pathname + '?' + url.searchParams.toString();
  }

  async function fetchJson(url){
    const res = await fetch(url, { credentials: 'same-origin' });
    const text = await res.text();
    if(!res.ok) throw new Error(url + ': HTTP ' + res.status + ' ' + short(text, 300));
    try{ return text ? JSON.parse(text) : null; }
    catch(e){ throw new Error(url + ': bad JSON ' + short(text, 300)); }
  }

  async function postJurnals(models){
    if(window.$ && typeof window.$.ajax === 'function'){
      return new Promise((resolve, reject) => {
        window.$.ajax({
          dataType: 'json',
          type: 'POST',
          data: { json: JSON.stringify(models) },
          url: '/Dekanat/JurnalPopup',
          success: resolve,
          error: xhr => reject(new Error('/Dekanat/JurnalPopup HTTP ' + (xhr && xhr.status) + ' ' + short(xhr && xhr.responseText, 300)))
        });
      });
    }

    const body = new URLSearchParams({ json: JSON.stringify(models) });
    const res = await fetch('/Dekanat/JurnalPopup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body
    });
    const text = await res.text();
    if(!res.ok) throw new Error('/Dekanat/JurnalPopup HTTP ' + res.status + ' ' + short(text, 300));
    return text ? JSON.parse(text) : {};
  }

  function findKey(row, title){
    const wanted = norm(title);
    return Object.keys(row).find(key => norm(key) === wanted) || '';
  }

  function num(value){
    if(value == null) return 0;
    const n = Number(String(value).replace(',', '.').trim());
    return Number.isFinite(n) ? n : 0;
  }

  function randomInt(min, max){
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function buildModels(rows, dopuskSet, overwrite){
    const modelsByRow = [];

    rows.forEach(row => {
      const rowModels = [];
      MODULES.forEach(module => {
        const testKey = findKey(row, module.test);
        if(!testKey || num(row[testKey]) === 0) return;

        module.fields.forEach(field => {
          const fieldKey = findKey(row, field.title);
          if(!fieldKey) return;
          if(!overwrite && num(row[fieldKey]) !== 0) return;
          rowModels.push({
            JurnalID: row.JurnalID,
            PoleName: fieldKey,
            StudentID: row.StudentID,
            StudentOtcenka: randomInt(field.min, field.max),
            hasDopusk: dopuskSet.has(Number(row.StudentID))
          });
        });
      });
      if(rowModels.length) modelsByRow.push(rowModels);
    });

    return modelsByRow;
  }

  async function fillSubject(subject, overwrite){
    const p = subjectParams(subject);
    const journalUrl = makeUrl('/Dekanat/jurnalprocedure', {
      idDis: p.idDis,
      idExam: p.idExam,
      idPlan: p.idPlan,
      idYear: p.idYear,
      idSem: p.idSem,
      idVed: p.idVed,
      idGroup: p.idGroup,
      rules: p.rules,
      idPotok: p.idPotok,
      idLoad: p.idLoad
    });
    const dopuskUrl = makeUrl('/Dekanat/GroupSmetas', {
      idYear: p.idYear,
      idSemestr: p.idSem,
      idGroup: p.idGroup,
      idPotok: p.idPotok,
      idLoad: p.idLoad
    });

    const rows = await fetchJson(journalUrl);
    if(!Array.isArray(rows)) throw new Error('jurnalprocedure вернул не массив');
    const dopusks = await fetchJson(dopuskUrl).catch(() => []);
    const dopuskSet = new Set((Array.isArray(dopusks) ? dopusks : [])
      .filter(item => item && item.dopusk)
      .map(item => Number(item.StudentID)));

    const modelsByRow = buildModels(rows, dopuskSet, overwrite);
    let cells = 0;
    for(const rowModels of modelsByRow){
      if(runState.stop) break;
      await postJurnals(rowModels);
      cells += rowModels.length;
      await sleep(120);
    }

    return { rows: rows.length, changedRows: modelsByRow.length, cells };
  }

  async function startFill(){
    if(!selectedGroups().length){
      log('Сначала отметьте группы.', '#c33');
      return;
    }
    if(!state.selectedSemesters.length){
      log('Выберите семестр.', '#c33');
      return;
    }
    if(!state.selectedSubjectKeys.length){
      log('Выберите предметы.', '#c33');
      return;
    }

    const subjects = allSelectedSubjects();
    if(!subjects.length){
      log('Нет выбранных дисциплин для этих групп/семестров. Нажмите "Скан дисциплин" и отметьте предметы.', '#c33');
      return;
    }

    runState.running = true;
    runState.stop = false;
    uiBusy(true);

    const overwrite = panel.querySelector('#dbmf-overwrite').checked;
    let done = 0;
    let cells = 0;
    try{
      for(const subject of subjects){
        if(runState.stop) break;
        setStat('Обработка ' + (done + 1) + '/' + subjects.length);
        log(subject.groupName + ' | ' + subject.name + '...');
        try{
          const result = await fillSubject(subject, overwrite);
          cells += result.cells;
          done++;
          log('OK: строк ' + result.rows + ', изменено строк ' + result.changedRows + ', ячеек ' + result.cells, '#0a0');
        }catch(e){
          log('Ошибка: ' + e.message, '#c33');
        }
      }
      setStat('Готово: дисциплин ' + done + '/' + subjects.length + ', ячеек ' + cells);
    }finally{
      runState.running = false;
      uiBusy(false);
    }
  }

  function renderGroups(){
    if(!groupsEl) return;
    const selected = new Set(state.selectedGroupIds.map(String));
    groupsEl.innerHTML = state.groups.length
      ? state.groups.map(group => `
        <label style="display:block;margin:2px 0">
          <input type="checkbox" data-group-id="${group.groupId}" ${selected.has(String(group.groupId)) ? 'checked' : ''}>
          ${escapeHtml(group.name)} <span style="color:#777">#${group.groupId}</span>
        </label>`).join('')
      : '<div style="color:#777">Группы еще не собраны.</div>';

    groupsEl.querySelectorAll('input[data-group-id]').forEach(input => {
      input.onchange = updateGroupSelectionFromDom;
    });
    updateStat();
  }

  function updateSemesterSelectionFromDom(){
    if(!semestersEl) return;
    state.selectedSemesters = [...semestersEl.querySelectorAll('input[data-sem]:checked')]
      .map(input => input.dataset.sem);
    saveState();
    renderSubjects();
  }

  function updateSubjectSelectionFromDom(){
    if(!subjectsEl) return;
    const visibleKeys = new Set([...subjectsEl.querySelectorAll('input[data-subject-key]')]
      .map(input => input.dataset.subjectKey));
    const keptHidden = state.selectedSubjectKeys.filter(key => !visibleKeys.has(String(key)));
    const checkedVisible = [...subjectsEl.querySelectorAll('input[data-subject-key]:checked')]
      .map(input => input.dataset.subjectKey);
    state.selectedSubjectKeys = [...new Set([...keptHidden, ...checkedVisible])];
    saveState();
    updateStat();
  }

  function setVisibleSubjectsSelected(checked){
    const selected = new Set(state.selectedSubjectKeys.map(String));
    [...subjectsEl.querySelectorAll('input[data-subject-key]')].forEach(input => {
      if(checked) selected.add(input.dataset.subjectKey);
      else selected.delete(input.dataset.subjectKey);
    });
    state.selectedSubjectKeys = [...selected];
    saveState();
    renderSubjects();
  }

  function setAllSemestersSelected(checked){
    state.selectedSemesters = checked ? availableSemesters() : [];
    saveState();
    renderSubjects();
  }

  function updateStat(){
    const sem = state.selectedSemesters.length ? state.selectedSemesters.join(',') : '-';
    const chosenSubjectKeys = new Set(state.selectedSubjectKeys.map(String));
    const visibleChosen = aggregateVisibleSubjects().filter(item => chosenSubjectKeys.has(item.key)).length;
    setStat(
      'Групп: ' + state.groups.length +
      ', выбрано групп: ' + selectedGroups().length +
      ', семестр: ' + sem +
      ', предметов выбрано: ' + visibleChosen +
      ', к обработке: ' + allSelectedSubjects().length
    );
  }

  function renderSubjects(){
    if(!semestersEl || !subjectsEl) return;
    const groups = selectedGroups();
    const scannedCount = allScannedSubjects().length;
    const sems = availableSemesters();
    const selectedSems = selectedSemesterSet();

    semestersEl.innerHTML = sems.length
      ? sems.map(sem => `
        <label style="display:inline-flex;align-items:center;gap:3px;margin:0 8px 4px 0">
          <input type="checkbox" data-sem="${escapeHtml(sem)}" ${selectedSems.has(String(sem)) ? 'checked' : ''}>
          ${escapeHtml(sem)} сем
        </label>`).join('')
      : '<span style="color:#777">Семестры появятся после скана дисциплин.</span>';

    semestersEl.querySelectorAll('input[data-sem]').forEach(input => {
      input.onchange = updateSemesterSelectionFromDom;
    });

    const subjects = aggregateVisibleSubjects();
    const chosen = new Set(state.selectedSubjectKeys.map(String));
    subjectsEl.innerHTML = subjects.length
      ? subjects.map(item => `
        <label style="display:block;margin:3px 0;padding-bottom:3px;border-bottom:1px solid #e4e4e4">
          <input type="checkbox" data-subject-key="${escapeHtml(item.key)}" ${chosen.has(item.key) ? 'checked' : ''}>
          <span>${escapeHtml(item.sem)} сем | ${escapeHtml(item.name)}</span>
          <span style="color:#777">#${escapeHtml(item.idDis)} | ${escapeHtml((item.ruleText && item.ruleText !== '---') ? item.ruleText : ('rules=' + item.rules))} | групп: ${item.groups.length}</span>
        </label>`).join('')
      : (
        groups.length
          ? (scannedCount ? 'Выберите семестр, потом отметьте предметы.' : 'Нажмите "Скан дисциплин".')
          : 'Выберите группы.'
      );

    subjectsEl.querySelectorAll('input[data-subject-key]').forEach(input => {
      input.onchange = updateSubjectSelectionFromDom;
    });
    updateStat();
  }

  function escapeHtml(value){
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function clearAll(){
    state.groups = [];
    state.selectedGroupIds = [];
    state.subjectsByGroup = {};
    state.selectedSemesters = [];
    state.selectedSubjectKeys = [];
    saveState();
    renderGroups();
    renderSubjects();
    logEl.innerHTML = '';
    log('Очищено.');
  }

  function uiBusy(busy){
    ['dbmf-scan-page','dbmf-scan-all','dbmf-scan-subjects','dbmf-start','dbmf-clear','dbmf-overwrite','dbmf-select-visible','dbmf-unselect-visible','dbmf-select-sems','dbmf-unselect-sems']
      .forEach(id => {
        const el = panel && panel.querySelector('#' + id);
        if(el) el.disabled = busy;
      });
    ['dbmf-groups','dbmf-semesters','dbmf-subjects'].forEach(id => {
      const el = panel && panel.querySelector('#' + id);
      if(el) el.querySelectorAll('input').forEach(input => { input.disabled = busy; });
    });
    const stop = panel && panel.querySelector('#dbmf-stop');
    if(stop) stop.disabled = !busy;
  }

  function clampPanelPosition(left, top){
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    return {
      left: Math.min(Math.max(8, left), maxLeft),
      top: Math.min(Math.max(8, top), maxTop)
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
    panel.style.bottom = 'auto';
  }

  function savePanelPosition(left, top){
    const pos = clampPanelPosition(left, top);
    state.panelPosition = {
      left: Math.round(pos.left),
      top: Math.round(pos.top)
    };
    saveState();
    applyPanelPosition();
  }

  function makePanelDraggable(){
    const header = panel.querySelector('#dbmf-header');
    if(!header) return;

    let drag = null;
    header.addEventListener('pointerdown', event => {
      if(event.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: rect.left,
        top: rect.top
      };
      header.setPointerCapture(event.pointerId);
    });

    header.addEventListener('pointermove', event => {
      if(!drag || event.pointerId !== drag.pointerId) return;
      const next = clampPanelPosition(
        drag.left + event.clientX - drag.x,
        drag.top + event.clientY - drag.y
      );
      panel.style.left = next.left + 'px';
      panel.style.top = next.top + 'px';
    });

    const finish = event => {
      if(!drag || event.pointerId !== drag.pointerId) return;
      const rect = panel.getBoundingClientRect();
      drag = null;
      savePanelPosition(rect.left, rect.top);
    };
    header.addEventListener('pointerup', finish);
    header.addEventListener('pointercancel', finish);
    window.addEventListener('resize', applyPanelPosition);
  }

  function buildPanel(){
    if(document.getElementById(PANEL_ID)) return;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed',
      'right:12px',
      'bottom:12px',
      'z-index:2147483646',
      'width:720px',
      'max-width:calc(100vw - 24px)',
      'max-height:calc(100vh - 24px)',
      'overflow:auto',
      'background:#fff',
      'border:1px solid #777',
      'border-radius:8px',
      'box-shadow:0 4px 18px rgba(0,0,0,.25)',
      'font:14px/1.35 Segoe UI,Arial,sans-serif',
      'color:#222',
      'padding:10px'
    ].join(';');

    panel.innerHTML = `
      <div id="dbmf-header" style="display:flex;align-items:center;justify-content:space-between;font-weight:bold;margin-bottom:8px;cursor:move;user-select:none">
        <span>Batch оценки 1М/2М</span>
        <button id="dbmf-close" style="border:0;background:#eee;border-radius:4px;padding:2px 7px;cursor:pointer">x</button>
      </div>
      <div id="dbmf-stat" style="color:#06c;margin-bottom:8px"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <button id="dbmf-scan-page" style="padding:8px;background:#36c;color:#fff;border:0;border-radius:5px;cursor:pointer">Скан страницы</button>
        <button id="dbmf-scan-all" style="padding:8px;background:#36c;color:#fff;border:0;border-radius:5px;cursor:pointer">Скан всех страниц</button>
        <button id="dbmf-scan-subjects" style="padding:8px;background:#555;color:#fff;border:0;border-radius:5px;cursor:pointer">Скан дисциплин</button>
        <button id="dbmf-clear" style="padding:8px;background:#777;color:#fff;border:0;border-radius:5px;cursor:pointer">Очистить</button>
      </div>
      <label style="display:block;margin-bottom:8px">
        <input id="dbmf-overwrite" type="checkbox" checked> перезаписывать уже заполненные ячейки
      </label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <button id="dbmf-start" style="padding:8px;background:#0a7;color:#fff;border:0;border-radius:5px;cursor:pointer">Старт</button>
        <button id="dbmf-stop" style="padding:8px;background:#c33;color:#fff;border:0;border-radius:5px;cursor:pointer" disabled>Стоп</button>
      </div>
      <div style="display:grid;grid-template-columns:260px 1fr;gap:8px">
        <div>
          <div style="font-weight:bold;margin-bottom:4px">Группы</div>
          <div id="dbmf-groups" style="height:230px;overflow:auto;background:#f7f7f7;border:1px solid #ddd;border-radius:5px;padding:8px"></div>
        </div>
        <div>
          <div style="font-weight:bold;margin-bottom:4px">Семестр и предметы</div>
          <div id="dbmf-semesters" style="min-height:30px;background:#f7f7f7;border:1px solid #ddd;border-radius:5px;padding:7px;margin-bottom:6px"></div>
          <div style="display:flex;gap:6px;margin-bottom:6px">
            <button id="dbmf-select-sems" style="flex:1;padding:6px;background:#36c;color:#fff;border:0;border-radius:5px;cursor:pointer">Все семестры</button>
            <button id="dbmf-unselect-sems" style="flex:1;padding:6px;background:#777;color:#fff;border:0;border-radius:5px;cursor:pointer">Снять семестры</button>
          </div>
          <div style="display:flex;gap:6px;margin-bottom:6px">
            <button id="dbmf-select-visible" style="flex:1;padding:6px;background:#666;color:#fff;border:0;border-radius:5px;cursor:pointer">Выбрать видимые</button>
            <button id="dbmf-unselect-visible" style="flex:1;padding:6px;background:#777;color:#fff;border:0;border-radius:5px;cursor:pointer">Снять видимые</button>
          </div>
          <div id="dbmf-subjects" style="height:164px;overflow:auto;background:#f7f7f7;border:1px solid #ddd;border-radius:5px;padding:8px"></div>
        </div>
      </div>
      <div style="font-weight:bold;margin:8px 0 4px">Лог</div>
      <div id="dbmf-log" style="height:170px;overflow:auto;background:#f7f7f7;border:1px solid #ddd;border-radius:5px;padding:8px"></div>`;

    document.body.appendChild(panel);
    groupsEl = panel.querySelector('#dbmf-groups');
    semestersEl = panel.querySelector('#dbmf-semesters');
    subjectsEl = panel.querySelector('#dbmf-subjects');
    logEl = panel.querySelector('#dbmf-log');
    statEl = panel.querySelector('#dbmf-stat');

    panel.querySelector('#dbmf-close').onclick = () => panel.remove();
    panel.querySelector('#dbmf-scan-page').onclick = scanGroupsFromDom;
    panel.querySelector('#dbmf-scan-all').onclick = scanAllDataTablePages;
    panel.querySelector('#dbmf-scan-subjects').onclick = scanSubjectsForSelectedGroups;
    panel.querySelector('#dbmf-clear').onclick = clearAll;
    panel.querySelector('#dbmf-start').onclick = startFill;
    panel.querySelector('#dbmf-select-sems').onclick = () => setAllSemestersSelected(true);
    panel.querySelector('#dbmf-unselect-sems').onclick = () => setAllSemestersSelected(false);
    panel.querySelector('#dbmf-select-visible').onclick = () => setVisibleSubjectsSelected(true);
    panel.querySelector('#dbmf-unselect-visible').onclick = () => setVisibleSubjectsSelected(false);
    panel.querySelector('#dbmf-stop').onclick = () => {
      runState.stop = true;
      log('Остановка запрошена.', '#c33');
    };

    applyPanelPosition();
    makePanelDraggable();
    renderGroups();
    renderSubjects();
  }

  function ready(fn){
    if(document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  ready(buildPanel);
})();
