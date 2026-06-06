// ==UserScript==
// @name         Массовая категория вопросов FAST API
// @namespace    local.qcat.fast
// @version      2.0
// @description  Быстро получает все questionId через /Tests/GetTestQues и массово меняет категорию без перелистывания страниц.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function(){
  'use strict';
  if (window.top !== window.self) return;

  const LS_KEY = 'qcat_job_fast_v2';
  const DEFAULT_CONC = 6;
  const MAX_CONC = 16;
  const API_PAGE_SIZE = 1000;
  const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  async function waitFor(fn, timeout = 20000, step = 150){
    const t0 = Date.now();
    for(;;){
      let v;
      try { v = fn(); } catch(e) { v = null; }
      if(v) return v;
      if(Date.now() - t0 > timeout) throw new Error('timeout');
      await sleep(step);
    }
  }

  const hasGrid = () =>
    document.querySelector('#data-grid1 td[aria-colindex="9"] a[href*="AddQuestion"]');

  const cfg = { total: 0, rpp: 20, pages: 1, cats: [] };

  const rowsView = () => document.querySelector('#data-grid1 .dx-datagrid-rowsview');
  const getRows = () => [...(rowsView()?.querySelectorAll('tr.dx-data-row') || [])];
  const rowInfo = tr => {
    const a = tr.querySelector('td[aria-colindex="9"] a[href*="AddQuestion"]');
    const m = a ? (a.getAttribute('href').match(/questionId=(\d+)/) || [])[1] : null;
    return {
      num: parseInt((tr.querySelector('td[aria-colindex="1"]') || {}).innerText || '', 10),
      categoryText: norm((tr.querySelector('td[aria-colindex="3"]') || {}).innerText || ''),
      id: m ? parseInt(m, 10) : null
    };
  };

  const pager = () => document.querySelector('.dx-datagrid-pager');
  const pageBtns = () => [...(pager()?.querySelectorAll('.dx-page') || [])]
    .map(b => ({ b, n: parseInt(b.innerText.trim(), 10) }))
    .filter(x => !isNaN(x.n));
  const curPage = () => {
    const s = pager()?.querySelector('.dx-page.dx-selection');
    return s ? parseInt(s.innerText.trim(), 10) : (pageBtns()[0] ? 1 : null);
  };

  function getTestIdFromPath(){
    const m = location.pathname.match(/\/Tests\/Details\/(\d+)/i);
    return m ? m[1] : '';
  }

  function getGridApiUrl(){
    const fromPerf = performance.getEntriesByType('resource')
      .map(e => e.name)
      .reverse()
      .find(u => u.includes('/Tests/GetTestQues'));

    if(fromPerf) return fromPerf;

    const testId = getTestIdFromPath();
    if(!testId) return '';

    const u = new URL('/Tests/GetTestQues', location.origin);
    u.searchParams.set('loadOptions[searchOperation]', '"contains"');
    u.searchParams.set('loadOptions[userData]', '{}');
    u.searchParams.set('testId', testId);
    u.searchParams.set('_', String(Date.now()));
    return u.href;
  }

  async function fetchRetry(url, options, label){
    let lastErr;
    for(let attempt = 0; attempt < 3; attempt++){
      try{
        const res = await fetch(url, options);
        if(!RETRY_STATUSES.has(res.status) || attempt === 2) return res;
        lastErr = new Error(label + ': ' + res.status);
      }catch(e){
        lastErr = e;
        if(attempt === 2) throw e;
      }
      await sleep(500 * Math.pow(2, attempt) + Math.floor(Math.random() * 350));
    }
    throw lastErr;
  }

  function parseApiRows(j){
    const rows = Array.isArray(j) ? j : (j.data || j.Data || j.items || j.Items || j.result || j.Result || []);
    if(!Array.isArray(rows)) throw new Error('API GetTestQues вернул неожиданный формат.');
    rows.totalCount = Array.isArray(j)
      ? rows.length
      : (Number(j.totalCount ?? j.TotalCount ?? j.total ?? j.Total ?? j.count ?? j.Count) || rows.length);
    return rows;
  }

  async function requestApiRows(u){
    const res = await fetchRetry(u.href, { credentials: 'same-origin' }, 'API GetTestQues');
    if(!res.ok) throw new Error('API GetTestQues: ' + res.status);
    return parseApiRows(await res.json());
  }

  async function loadApiRows(){
    const api = getGridApiUrl();
    if(!api) throw new Error('Не найден API /Tests/GetTestQues. Обновите страницу и попробуйте снова.');

    const u = new URL(api, location.origin);
    u.searchParams.set('_', String(Date.now()));

    let rows = await requestApiRows(u);
    const total = Math.max(rows.totalCount || rows.length, cfg.total || 0);
    if(total > rows.length){
      const fullRows = [];
      for(let skip = 0; skip < total; skip += API_PAGE_SIZE){
        const page = new URL(u.href);
        page.searchParams.set('loadOptions[skip]', String(skip));
        page.searchParams.set('loadOptions[take]', String(Math.min(API_PAGE_SIZE, total - skip)));
        page.searchParams.set('loadOptions[requireTotalCount]', 'true');
        page.searchParams.set('_', String(Date.now()));
        const chunk = await requestApiRows(page);
        fullRows.push(...chunk);
        if(chunk.length < Math.min(API_PAGE_SIZE, total - skip)) break;
      }
      if(fullRows.length > rows.length){
        fullRows.totalCount = total;
        rows = fullRows;
      }
    }
    return rows;
  }

  function serialize(root){
    const fd = new FormData();
    root.querySelectorAll('input,select,textarea').forEach(el => {
      const name = el.getAttribute('name');
      if(!name || el.disabled) return;

      const type = (el.type || '').toLowerCase();
      if(type === 'file') return;

      if(type === 'checkbox' || type === 'radio'){
        if(el.hasAttribute('checked') || el.checked) fd.append(name, el.getAttribute('value') || 'on');
        return;
      }

      if(el.tagName === 'SELECT'){
        const o = el.querySelector('option[selected]') || el.options[el.selectedIndex] || el.options[0];
        fd.append(name, o ? o.value : '');
        return;
      }

      fd.append(name, el.value != null ? el.value : (el.getAttribute('value') || ''));
    });
    return fd;
  }

  async function getForm(id){
    const url = `/tests/AddQuestion?questionId=${id}&isAppealed=true`;
    const res = await fetchRetry(url, { credentials: 'same-origin' }, id + ': GET');
    if(!res.ok) throw new Error(id + ': GET ' + res.status);
    return {
      doc: new DOMParser().parseFromString(await res.text(), 'text/html'),
      url
    };
  }

  async function updateOne(id, value){
    const { doc, url } = await getForm(id);
    const sel = doc.querySelector('#question-category') || doc.querySelector('[name="TestCategory"]');
    if(!sel) throw new Error(id + ': нет селекта категории');

    const cur = sel.querySelector('option[selected]') || [...sel.options].find(o => o.selected);
    if(cur && cur.value === value) return 'already';

    if(![...sel.options].some(o => o.value === value)){
      throw new Error(id + ': нет опции ' + value);
    }

    const formEl = sel.closest('form') || doc.querySelector('form');
    const root = formEl || sel.closest('.modal-body') || doc.body;
    const fd = serialize(root);
    const fieldName = sel.getAttribute('name') || 'TestCategory';
    fd.set(fieldName, value);

    const action = (formEl && formEl.getAttribute('action')) || '';
    const postUrl = action ? new URL(action, location.origin).href : url;
    const res = await fetchRetry(postUrl, {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      redirect: 'follow'
    }, id + ': POST');

    if(!res.ok) throw new Error(id + ': POST ' + res.status);
    return 'done';
  }

  async function verifyOne(id){
    const { doc } = await getForm(id);
    const sel = doc.querySelector('#question-category') || doc.querySelector('[name="TestCategory"]');
    const o = sel && (sel.querySelector('option[selected]') || [...sel.options].find(x => x.selected));
    return o ? o.value : null;
  }

  async function detect(){
    let apiRows = [];
    try { apiRows = await loadApiRows(); } catch(e) {}

    let total = apiRows.length || 0;
    const info = document.querySelector('.dx-datagrid-pager .dx-info') || document.querySelector('.dx-info');
    if(!total && info){
      const m = info.textContent.match(/Всего[^0-9]*([0-9\s ]+)/i);
      if(m) total = parseInt(m[1].replace(/\D/g, ''), 10) || 0;
    }
    if(!total){
      const g = document.querySelector('#data-grid1 .dx-datagrid');
      total = parseInt(g?.getAttribute('aria-rowcount') || '0', 10) || 0;
    }

    const visibleRows = getRows().map(rowInfo).filter(r => r.num);
    const firstNum = visibleRows.length ? Math.min(...visibleRows.map(r => r.num)) : 1;
    const cp = curPage();
    let rpp = (cp && cp > 1 && firstNum > 1)
      ? Math.round((firstNum - 1) / (cp - 1))
      : (visibleRows.length || 20);
    if(!rpp || rpp < 1) rpp = 20;

    const maxBtn = Math.max(0, ...pageBtns().map(x => x.n));
    const pages = Math.max(maxBtn, total ? Math.ceil(total / rpp) : 1, 1);

    cfg.total = total;
    cfg.rpp = rpp;
    cfg.pages = pages;

    const a = document.querySelector('#data-grid1 a[href*="AddQuestion"]');
    const sampleFromLink = a ? (a.getAttribute('href').match(/questionId=(\d+)/) || [])[1] : null;
    const sampleId = sampleFromLink || (apiRows[0] && apiRows[0].id);

    cfg.cats = [];
    if(sampleId){
      const { doc } = await getForm(sampleId);
      const sel = doc.querySelector('#question-category') || doc.querySelector('[name="TestCategory"]');
      if(sel){
        cfg.cats = [...sel.options]
          .filter(o => o.value !== '' && o.value != null)
          .map(o => ({ value: o.value, name: (o.textContent || '').trim() }));
      }
    }

    return cfg;
  }

  const state = { running: false, stop: false };
  const saveJob = j => localStorage.setItem(LS_KEY, JSON.stringify(j));
  const loadJob = () => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); }
    catch(e) { return null; }
  };
  const clearJob = () => localStorage.removeItem(LS_KEY);

  let panel, logEl, statEl, infoEl, catEl, fromEl, toEl;
  const log = (msg, color) => {
    const d = document.createElement('div');
    if(color) d.style.color = color;
    d.textContent = msg;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  };
  const setStat = t => { statEl.textContent = t; };

  function fillCats(){
    const prev = catEl.value;
    catEl.innerHTML = cfg.cats.length
      ? cfg.cats.map(c => `<option value="${esc(c.value)}">${esc(c.name)} (${esc(c.value)})</option>`).join('')
      : '<option value="">- не удалось определить -</option>';

    if(prev && cfg.cats.some(c => c.value === prev)) catEl.value = prev;
  }

  function fillInfo(){
    infoEl.textContent = cfg.total
      ? `Всего вопросов: ${cfg.total} - страниц: ${cfg.pages} - на странице: ${cfg.rpp}`
      : 'Не удалось определить параметры';
  }

  async function doDetect(){
    infoEl.textContent = 'Определяю...';
    try{
      await detect();
      fillInfo();
      fillCats();
      if(cfg.total){
        if(!fromEl.value) fromEl.value = 1;
        if(!toEl.value) toEl.value = cfg.total;
      }
    }catch(e){
      infoEl.textContent = 'Ошибка определения: ' + e.message;
    }
  }

  function renderResume(){
    const r = panel.querySelector('#qcat-resume');
    const job = loadJob();
    if(job && job.todo && job.todo.length){
      r.innerHTML = '<button id="qcat-resume-btn" style="width:100%;padding:6px;margin-top:6px;background:#36c;color:#fff;border:0;border-radius:5px;cursor:pointer">Продолжить (' + job.todo.length + ')</button>';
      r.querySelector('#qcat-resume-btn').onclick = () => runJob(loadJob(), false);
    }else{
      r.innerHTML = '';
    }
  }

  function uiBusy(b){
    ['qcat-start','qcat-from','qcat-to','qcat-cat','qcat-conc','qcat-dry','qcat-refresh'].forEach(id => {
      const el = panel.querySelector('#' + id);
      if(el) el.disabled = b;
    });
    panel.querySelector('#qcat-stop').disabled = !b;
  }

  function buildPanel(){
    if(document.getElementById('qcat-panel')) return;

    panel = document.createElement('div');
    panel.id = 'qcat-panel';
    panel.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;width:330px;background:#fff;border:1px solid #888;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);font:13px/1.4 Segoe UI,Arial;color:#222;padding:10px';
    panel.innerHTML = `
      <div style="font-weight:bold;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
        <span>Массовая категория FAST</span>
        <span>
          <button id="qcat-refresh" title="Обновить данные" style="border:0;background:#eee;border-radius:4px;cursor:pointer;padding:2px 6px">↻</button>
          <span id="qcat-x" style="cursor:pointer;color:#888;margin-left:6px">×</span>
        </span>
      </div>
      <div id="qcat-info" style="font-size:12px;color:#06c;margin-bottom:6px">Определяю...</div>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <label style="flex:1">с №<br><input id="qcat-from" type="number" style="width:100%"></label>
        <label style="flex:1">по №<br><input id="qcat-to" type="number" style="width:100%"></label>
      </div>
      <label>Категория<br><select id="qcat-cat" style="width:100%"></select></label>
      <div style="display:flex;gap:6px;margin:6px 0;align-items:flex-end">
        <label style="flex:1">поток<br><input id="qcat-conc" type="number" value="${DEFAULT_CONC}" min="1" max="${MAX_CONC}" style="width:100%"></label>
        <label style="flex:2"><input id="qcat-dry" type="checkbox"> только показать план</label>
      </div>
      <div style="display:flex;gap:6px">
        <button id="qcat-start" style="flex:1;padding:6px;background:#0a7;color:#fff;border:0;border-radius:5px;cursor:pointer">Старт</button>
        <button id="qcat-stop" style="flex:1;padding:6px;background:#c33;color:#fff;border:0;border-radius:5px;cursor:pointer" disabled>Стоп</button>
      </div>
      <div id="qcat-stat" style="margin:6px 0;font-weight:bold"></div>
      <div id="qcat-log" style="height:150px;overflow:auto;background:#f7f7f7;border:1px solid #ddd;border-radius:5px;padding:6px;font-size:12px"></div>
      <div id="qcat-resume"></div>`;

    document.body.appendChild(panel);
    logEl = panel.querySelector('#qcat-log');
    statEl = panel.querySelector('#qcat-stat');
    infoEl = panel.querySelector('#qcat-info');
    catEl = panel.querySelector('#qcat-cat');
    fromEl = panel.querySelector('#qcat-from');
    toEl = panel.querySelector('#qcat-to');

    panel.querySelector('#qcat-x').onclick = () => panel.remove();
    panel.querySelector('#qcat-refresh').onclick = doDetect;
    panel.querySelector('#qcat-start').onclick = onStart;
    panel.querySelector('#qcat-stop').onclick = () => {
      state.stop = true;
      log('Остановка после текущих запросов...', '#c33');
    };

    renderResume();
    doDetect();
  }

  async function onStart(){
    if(state.running) return;

    const from = parseInt(fromEl.value, 10);
    const to = parseInt(toEl.value, 10);
    const value = catEl.value;
    const name = norm((cfg.cats.find(c => c.value === value) || {}).name || '');
    const conc = Math.max(1, Math.min(MAX_CONC, parseInt(panel.querySelector('#qcat-conc').value, 10) || DEFAULT_CONC));
    const dry = panel.querySelector('#qcat-dry').checked;

    if(!hasGrid()){
      log('Не вижу список вопросов на странице.', '#c33');
      return;
    }
    if(!value){
      log('Сначала выберите категорию. Если список пустой, нажмите ↻.', '#c33');
      return;
    }
    if(!(from >= 1) || !(to >= from)){
      log('Проверьте диапазон №.', '#c33');
      return;
    }

    state.stop = false;
    state.running = true;
    uiBusy(true);
    logEl.innerHTML = '';

    try{
      log('Беру id через API таблицы...');

      const rows = await loadApiRows();
      cfg.total = rows.length || cfg.total;
      fillInfo();

      if(rows.length && rows[0].category == null && rows[0].Category == null){
        log('В API не видно поля category, поэтому план может отправить все вопросы диапазона.', '#c60');
      }

      const all = rows
        .map((r, idx) => ({
          id: Number(r.id ?? r.Id ?? r.questionId ?? r.QuestionId),
          num: idx + 1,
          category: String(r.category ?? r.Category ?? r.testCategory ?? r.TestCategory ?? '')
        }))
        .filter(r => r.num >= from && r.num <= to && r.id);

      const todo = all
        .filter(r => r.category !== value)
        .map(r => ({ id: r.id, num: r.num }));

      log(
        'В диапазоне: ' + all.length +
        ', уже нужная категория: ' + (all.length - todo.length) +
        ', к изменению: ' + todo.length,
        '#06c'
      );

      if(!all.length){
        log('Ничего не собрано. Проверьте диапазон.', '#c33');
        return;
      }

      if(dry){
        setStat('DRY: ' + todo.length + ' шт.');
        log('План №: ' + (todo.map(r => r.num).join(', ') || 'пусто'));
        return;
      }

      const job = { from, to, value, name, conc, todo, done: [], err: [], _probed: false };
      saveJob(job);
      await runJob(job, true);
    }catch(e){
      log('ОСТАНОВ: ' + e.message, '#c33');
    }finally{
      state.running = false;
      uiBusy(false);
      renderResume();
    }
  }

  async function runJob(job, alreadyBusy){
    if(!job) return;
    if(state.running && !alreadyBusy) return;
    if(!alreadyBusy){
      state.stop = false;
      state.running = true;
      uiBusy(true);
    }

    try{
      const value = job.value;
      const conc = Math.max(1, Math.min(MAX_CONC, parseInt(job.conc, 10) || DEFAULT_CONC));

      if(!job.todo || !job.todo.length){
        log('Нечего делать.');
        clearJob();
        return;
      }

      if(!job._probed){
        const probe = job.todo[0];
        log('Пробую №' + probe.num + ' (id ' + probe.id + ')...');

        const r = await updateOne(probe.id, value);
        if(r === 'done'){
          const v = await verifyOne(probe.id);
          if(v !== value){
            throw new Error('Проверка не прошла: категория стала ' + v + ', ожидали ' + value + '. Останавливаю.');
          }
        }

        job.done.push(probe.id);
        job.todo = job.todo.slice(1);
        job._probed = true;
        saveJob(job);
        log('Пробный OK (' + r + ').', '#0a0');
      }

      const queue = job.todo.slice();
      const remaining = new Map(queue.map(it => [it.id, it]));
      const total = job.done.length + queue.length;
      const tick = () => setStat('Готово ' + job.done.length + '/' + total + ', ошибок ' + job.err.length);
      tick();

      let i = 0;
      async function worker(){
        while(i < queue.length){
          if(state.stop) return;

          const it = queue[i++];
          try{
            await updateOne(it.id, value);
            job.done.push(it.id);
          }catch(e){
            job.err.push(it.id);
            log(e.message, '#c33');
          }

          remaining.delete(it.id);
          job.todo = [...remaining.values()];
          saveJob(job);
          tick();
        }
      }

      await Promise.all(Array.from({ length: conc }, worker));

      if(state.stop){
        log('Остановлено. Нажмите "Продолжить", чтобы доделать.', '#c33');
        return;
      }

      log('ГОТОВО. Обработано ' + job.done.length + '/' + total + ', ошибок ' + job.err.length, '#06c');
      if(job.err.length) log('Не удалось id: ' + job.err.join(', '), '#c33');
      log('Обновите страницу (F5), чтобы увидеть результат в списке.');
      clearJob();
    }finally{
      if(!alreadyBusy){
        state.running = false;
        uiBusy(false);
      }
      renderResume();
    }
  }

  let tries = 0;
  const iv = setInterval(() => {
    if(hasGrid()){
      clearInterval(iv);
      buildPanel();
    }else if(++tries > 40){
      clearInterval(iv);
    }
  }, 500);
})();
