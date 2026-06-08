// ==UserScript==
// @name         Dekanat module marks filler
// @namespace    local.dekanat.module-marks
// @version      1.3
// @description  Mass-fill 1M/2M journal component marks and skip rows with zero module test.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function(){
  'use strict';
  if (window.top !== window.self) return;

  const PANEL_ID = 'dmf-panel';
  const WAIT_TIMEOUT = 30000;
  const WAIT_STEP = 250;
  const ROWS_PER_POST = 1;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const normalize = s => String(s ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[МмM]/g, 'm')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const MODULES = [
    {
      id: '1m',
      label: '1М',
      test: '1М Тест',
      fields: [
        { title: '1М Посещаемость', min: 3, max: 5 },
        { title: '1М Активность', min: 6, max: 10 },
        { title: '1М СРС', min: 11, max: 15 }
      ]
    },
    {
      id: '2m',
      label: '2М',
      test: '2М Тест',
      fields: [
        { title: '2М Посещаемость', min: 3, max: 5 },
        { title: '2М Активность', min: 6, max: 10 },
        { title: '2М СРС', min: 11, max: 15 }
      ]
    }
  ];

  const state = { running: false, stop: false };
  let panel, logEl, statEl, modeEl, overwriteEl;
  let lastPlan = null;
  const scanner = { active: false, installed: false, patchTimer: null };

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

  function grid(){
    try{
      if(!window.jQuery && !window.$) return null;
      const $ = window.jQuery || window.$;
      const el = $('#gridContainer');
      if(!el.length || !el.dxDataGrid) return null;
      return el.dxDataGrid('instance');
    }catch(e){
      return null;
    }
  }

  function hasGrid(){
    return Boolean(document.querySelector('#gridContainer .dx-datagrid')) || Boolean(grid());
  }

  async function waitFor(fn, timeout = WAIT_TIMEOUT, step = WAIT_STEP){
    const started = Date.now();
    for(;;){
      let value = null;
      try{ value = fn(); }catch(e){ value = null; }
      if(value) return value;
      if(Date.now() - started > timeout) throw new Error('timeout');
      await sleep(step);
    }
  }

  function getColumns(g){
    const cols = g && typeof g.getVisibleColumns === 'function' ? g.getVisibleColumns() : [];
    return cols.filter(c => c && (c.dataField || c.caption));
  }

  function resolveField(g, title){
    const wanted = normalize(title);
    const col = getColumns(g).find(c => (
      normalize(c.caption) === wanted ||
      normalize(c.dataField) === wanted ||
      normalize(c.name) === wanted
    ));
    return col ? (col.dataField || col.name || col.caption) : '';
  }

  function getRows(g){
    const visibleRows = g && typeof g.getVisibleRows === 'function' ? g.getVisibleRows() : [];
    const visibleData = Array.isArray(visibleRows)
      ? visibleRows.map(r => r && r.data).filter(Boolean)
      : [];
    if(visibleData.length) return visibleData;

    const ds = g && typeof g.getDataSource === 'function' ? g.getDataSource() : null;
    const items = ds && typeof ds.items === 'function' ? ds.items() : [];
    if(Array.isArray(items) && items.filter(Boolean).length) return items.filter(Boolean);

    if(Array.isArray(window.JurnalDataSource) && window.JurnalDataSource.length){
      return window.JurnalDataSource.filter(Boolean);
    }

    return [];
  }

  function toNumber(value){
    if(value == null) return 0;
    if(typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const text = String(value).replace(/\u00a0/g, ' ').replace(',', '.').trim();
    if(!text) return 0;
    const n = Number(text);
    return Number.isFinite(n) ? n : 0;
  }

  function randomInt(min, max){
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function shortText(text, max = 500){
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function meaningful(value){
    const text = String(value ?? '').trim();
    return text && text !== 'undefined' && text !== 'null' ? text : '';
  }

  function scanLog(message, color){
    if(!scanner.active) return;
    log('[scan] ' + message, color);
    try{ console.log('[DMF scan]', message); }catch(e){}
  }

  function elementLabel(el){
    if(!el || el.nodeType !== 1) return '';
    const parts = [el.tagName.toLowerCase()];
    if(el.id) parts.push('#' + el.id);
    const name = el.getAttribute('name');
    if(name) parts.push('[name="' + name + '"]');
    const role = el.getAttribute('role');
    if(role) parts.push('[role="' + role + '"]');
    const aria = el.getAttribute('aria-label');
    if(aria) parts.push('[aria-label="' + shortText(aria, 80) + '"]');
    const text = shortText(el.innerText || el.value || el.getAttribute('title') || '', 90);
    return parts.join('') + (text ? ' text="' + text + '"' : '');
  }

  function dataPreview(data){
    try{
      if(data == null) return '';
      if(typeof data === 'string') return shortText(data, 1200);
      if(data instanceof URLSearchParams) return shortText(data.toString(), 1200);
      if(data instanceof FormData){
        const pairs = [];
        data.forEach((v, k) => pairs.push(k + '=' + shortText(v, 200)));
        return shortText(pairs.join('&'), 1200);
      }
      return shortText(JSON.stringify(data), 1200);
    }catch(e){
      return shortText(String(data), 1200);
    }
  }

  function patchJqueryAjax(){
    const jq = window.jQuery || window.$;
    if(!jq || typeof jq.ajax !== 'function' || jq.ajax._dmfScanner) return;

    const originalAjax = jq.ajax;
    const wrappedAjax = function(urlOrOptions, maybeOptions){
      const options = typeof urlOrOptions === 'string'
        ? { ...(maybeOptions || {}), url: urlOrOptions }
        : { ...(urlOrOptions || {}) };
      const method = options.type || options.method || 'GET';
      const url = options.url || '';
      scanLog('$.ajax -> ' + method + ' ' + url + ' data=' + dataPreview(options.data), url.includes('/Dekanat/JurnalPopup') ? '#06c' : '#555');

      const originalSuccess = options.success;
      const originalError = options.error;
      options.success = function(data, textStatus, xhr){
        scanLog('$.ajax <- ' + (xhr && xhr.status) + ' ' + url + ' response=' + dataPreview(data), '#0a0');
        if(originalSuccess) return originalSuccess.apply(this, arguments);
      };
      options.error = function(xhr, textStatus, errorThrown){
        scanLog('$.ajax ERR ' + (xhr && xhr.status) + ' ' + url + ' response=' + shortText(xhr && xhr.responseText, 900), '#c33');
        if(originalError) return originalError.apply(this, arguments);
      };

      return typeof urlOrOptions === 'string'
        ? originalAjax.call(this, options.url, options)
        : originalAjax.call(this, options);
    };
    wrappedAjax._dmfScanner = true;
    wrappedAjax._dmfOriginal = originalAjax;
    jq.ajax = wrappedAjax;
  }

  function installScanner(){
    if(scanner.installed) return;
    scanner.installed = true;

    document.addEventListener('click', e => scanLog('click ' + elementLabel(e.target)), true);
    document.addEventListener('change', e => scanLog('change ' + elementLabel(e.target) + ' value=' + shortText(e.target && e.target.value, 200)), true);
    document.addEventListener('input', e => {
      const el = e.target;
      if(el && /input|textarea/i.test(el.tagName || '')){
        scanLog('input ' + elementLabel(el) + ' value=' + shortText(el.value, 200));
      }
    }, true);

    if(window.fetch && !window.fetch._dmfScanner){
      const originalFetch = window.fetch;
      const wrappedFetch = function(input, init){
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const method = (init && init.method) || 'GET';
        scanLog('fetch -> ' + method + ' ' + url + ' body=' + dataPreview(init && init.body), url.includes('/Dekanat/JurnalPopup') ? '#06c' : '#555');
        return originalFetch.apply(this, arguments).then(res => {
          scanLog('fetch <- ' + res.status + ' ' + url, res.ok ? '#0a0' : '#c33');
          return res;
        });
      };
      wrappedFetch._dmfScanner = true;
      window.fetch = wrappedFetch;
    }

    if(window.XMLHttpRequest && !window.XMLHttpRequest.prototype.open._dmfScanner){
      const originalOpen = window.XMLHttpRequest.prototype.open;
      const originalSend = window.XMLHttpRequest.prototype.send;
      window.XMLHttpRequest.prototype.open = function(method, url){
        this._dmfMethod = method;
        this._dmfUrl = url;
        return originalOpen.apply(this, arguments);
      };
      window.XMLHttpRequest.prototype.open._dmfScanner = true;
      window.XMLHttpRequest.prototype.send = function(body){
        const method = this._dmfMethod || 'GET';
        const url = this._dmfUrl || '';
        scanLog('XHR -> ' + method + ' ' + url + ' body=' + dataPreview(body), String(url).includes('/Dekanat/JurnalPopup') ? '#06c' : '#555');
        this.addEventListener('loadend', () => {
          scanLog('XHR <- ' + this.status + ' ' + url + ' response=' + shortText(this.responseText, 900), this.status >= 200 && this.status < 400 ? '#0a0' : '#c33');
        });
        return originalSend.apply(this, arguments);
      };
    }

    patchJqueryAjax();
    scanner.patchTimer = setInterval(patchJqueryAjax, 1000);
  }

  function toggleScan(){
    installScanner();
    scanner.active = !scanner.active;
    const btn = panel && panel.querySelector('#dmf-scan');
    if(btn){
      btn.textContent = scanner.active ? 'Скан: ON' : 'Скан';
      btn.style.background = scanner.active ? '#c60' : '#555';
    }
    log(scanner.active
      ? 'Скан включен. Теперь вручную поставьте оценки в нужные ячейки; сюда попадут клики и запросы.'
      : 'Скан выключен.',
      scanner.active ? '#c60' : '#555'
    );
  }

  function copyLog(){
    const text = logEl ? logEl.innerText : '';
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(() => log('Лог скопирован.', '#0a0'), () => log(text));
    }else{
      log(text);
    }
  }

  function getPageValue(name){
    const input = document.querySelector(`input[name="${name}"], input#${name}, select[name="${name}"], select#${name}`);
    if(input && input.value != null) return input.value;
    if(Object.prototype.hasOwnProperty.call(window, name)) return window[name];
    return '';
  }

  function getParamFromUrl(url, names){
    try{
      const u = new URL(url, location.origin);
      for(const name of names){
        const value = u.searchParams.get(name);
        if(value) return value;
      }
    }catch(e){}
    return '';
  }

  function getLoadId(row){
    const names = ['LoadID', 'loadID', 'loadId', 'idLoad', 'IdLoad'];
    for(const name of names){
      const value = meaningful(getPageValue(name));
      if(value) return value;
    }

    if(row){
      for(const name of names){
        const value = meaningful(row[name]);
        if(value) return value;
      }
    }

    const loadInput = [...document.querySelectorAll('input,select')]
      .find(el => /load/i.test(el.name || el.id || '') && el.value);
    if(loadInput) return meaningful(loadInput.value);

    const fromLocation = meaningful(getParamFromUrl(location.href, names));
    if(fromLocation) return fromLocation;

    const entries = performance.getEntriesByType('resource').map(e => e.name).reverse();
    for(const entry of entries){
      const value = meaningful(getParamFromUrl(entry, names));
      if(value) return value;
    }

    return '';
  }

  function getDopusks(){
    return Array.isArray(window.StudentDopusks) ? window.StudentDopusks : [];
  }

  function hasDopusk(studentId){
    const sid = Number(studentId);
    return getDopusks().some(mv => Number(mv.StudentID) === sid && Boolean(mv.dopusk));
  }

  function isLocked(row){
    const marks = Array.isArray(window.Marks) ? window.Marks : [];
    const sid = Number(row.StudentID);
    return marks.some(m => Number(m.StudentID) === sid);
  }

  function selectedModules(){
    const value = modeEl ? modeEl.value : 'both';
    if(value === '1m') return MODULES.filter(m => m.id === '1m');
    if(value === '2m') return MODULES.filter(m => m.id === '2m');
    return MODULES;
  }

  function currentConfigKey(){
    return [
      modeEl ? modeEl.value : 'both',
      overwriteEl ? String(overwriteEl.checked) : 'true'
    ].join('|');
  }

  function resolveModules(g, modules){
    return modules.map(module => {
      const testField = resolveField(g, module.test);
      const fields = module.fields.map(field => ({
        ...field,
        dataField: resolveField(g, field.title)
      }));
      return { ...module, testField, fields };
    });
  }

  function missingColumns(modules){
    const missing = [];
    modules.forEach(module => {
      if(!module.testField) missing.push(module.test);
      module.fields.forEach(field => {
        if(!field.dataField) missing.push(field.title);
      });
    });
    return missing;
  }

  function buildPlan(){
    const g = grid();
    if(!g) throw new Error('Не найден dxDataGrid #gridContainer.');

    const modules = resolveModules(g, selectedModules());
    const missing = missingColumns(modules);
    if(missing.length){
      throw new Error('Не найдены колонки: ' + missing.join(', '));
    }

    const overwrite = overwriteEl ? overwriteEl.checked : true;
    const rows = getRows(g);
    if(!rows.length) throw new Error('В гриде нет строк. Обновите страницу и попробуйте снова.');

    const rowsPlan = [];
    const skippedZero = {};
    const skippedLocked = [];
    const skippedFilled = {};
    modules.forEach(module => {
      skippedZero[module.id] = 0;
      skippedFilled[module.id] = 0;
    });

    rows.forEach((row, index) => {
      if(isLocked(row)){
        skippedLocked.push(row);
        return;
      }

      const values = {};
      const moduleLabels = [];

      modules.forEach(module => {
        const testValue = toNumber(row[module.testField]);
        if(testValue === 0){
          skippedZero[module.id]++;
          return;
        }

        let added = 0;
        module.fields.forEach(field => {
          if(!overwrite && toNumber(row[field.dataField]) !== 0){
            skippedFilled[module.id]++;
            return;
          }
          values[field.dataField] = randomInt(field.min, field.max);
          added++;
        });

        if(added) moduleLabels.push(module.label);
      });

      if(Object.keys(values).length){
        rowsPlan.push({
          index,
          name: String(row['ФИО'] || row.FIO || row.FullName || row.StudentName || '').trim(),
          row,
          values,
          modules: moduleLabels
        });
      }
    });

    return {
      g,
      modules,
      rows,
      rowsPlan,
      skippedZero,
      skippedLocked,
      skippedFilled,
      overwrite,
      configKey: currentConfigKey()
    };
  }

  function planStats(plan){
    const cells = plan.rowsPlan.reduce((sum, item) => sum + Object.keys(item.values).length, 0);
    const parts = [
      'строк всего: ' + plan.rows.length,
      'к изменению: ' + plan.rowsPlan.length,
      'ячеек: ' + cells
    ];
    plan.modules.forEach(module => {
      parts.push(module.label + ' тест=0: ' + plan.skippedZero[module.id]);
    });
    if(plan.skippedLocked.length) parts.push('закрытых строк: ' + plan.skippedLocked.length);
    return parts.join(', ');
  }

  function makeJurnalModels(items){
    const models = [];
    items.forEach(item => {
      const row = item.row;
      const loadId = getLoadId(row);
      Object.keys(item.values).forEach(title => {
        const model = {
          JurnalID: row.JurnalID,
          PoleName: title,
          StudentID: row.StudentID,
          StudentOtcenka: item.values[title],
          hasDopusk: hasDopusk(row.StudentID)
        };
        if(loadId) model.LoadID = loadId;
        models.push(model);
      });
    });
    return models;
  }

  async function postJurnals(models){
    if(window.$ && typeof window.$.ajax === 'function'){
      return new Promise((resolve, reject) => {
        window.$.ajax({
          dataType: 'json',
          type: 'POST',
          data: { json: JSON.stringify(models) },
          url: '/Dekanat/JurnalPopup',
          success: data => resolve(data),
          error: xhr => {
            reject(new Error('/Dekanat/JurnalPopup: HTTP ' + (xhr && xhr.status) + ' ' + shortText(xhr && xhr.responseText)));
          }
        });
      });
    }

    const res = await fetch('/Dekanat/JurnalPopup', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ json: JSON.stringify(models) })
    });

    const text = await res.text();
    if(!res.ok) throw new Error('/Dekanat/JurnalPopup: HTTP ' + res.status + ' ' + shortText(text));
    try{ return text ? JSON.parse(text) : {}; }
    catch(e){ return { raw: text }; }
  }

  function applyLocalValues(plan, items = plan.rowsPlan){
    items.forEach(item => {
      Object.assign(item.row, item.values);
    });
    try{
      if(typeof plan.g.refresh === 'function') plan.g.refresh();
      if(typeof plan.g.repaint === 'function') plan.g.repaint();
    }catch(e){}
  }

  function uiBusy(b){
    state.running = b;
    ['dmf-plan', 'dmf-probe', 'dmf-start', 'dmf-mode', 'dmf-overwrite'].forEach(id => {
      const el = panel && panel.querySelector('#' + id);
      if(el) el.disabled = b;
    });
    const stop = panel && panel.querySelector('#dmf-stop');
    if(stop) stop.disabled = !b;
  }

  function renderPlan(){
    logEl.innerHTML = '';
    try{
      const plan = buildPlan();
      lastPlan = plan;
      setStat(planStats(plan));
      if(!plan.rowsPlan.length){
        log('Нет строк для изменения.', '#c60');
        return;
      }
      plan.rowsPlan.slice(0, 12).forEach(item => {
        const who = item.name || ('строка ' + (item.index + 1));
        const values = Object.entries(item.values).map(([k, v]) => k + '=' + v).join(', ');
        log((item.index + 1) + '. ' + who + ': ' + values);
      });
      if(plan.rowsPlan.length > 12) log('...и еще ' + (plan.rowsPlan.length - 12) + ' строк.');
    }catch(e){
      lastPlan = null;
      setStat('Ошибка');
      log(e.message, '#c33');
    }
  }

  async function probeOneCell(){
    if(state.running) return;
    state.stop = false;
    logEl.innerHTML = '';
    uiBusy(true);

    try{
      const plan = buildPlan();
      lastPlan = plan;
      setStat(planStats(plan));
      const item = plan.rowsPlan[0];
      if(!item){
        log('Нет строки для пробы.', '#c60');
        return;
      }

      const firstField = Object.keys(item.values)[0];
      if(!firstField){
        log('Нет ячейки для пробы.', '#c60');
        return;
      }

      log('Найден LoadID: ' + (getLoadId(item.row) || '<пусто>'), getLoadId(item.row) ? '#06c' : '#c33');
      const probeItem = {
        ...item,
        values: { [firstField]: item.values[firstField] }
      };
      const models = makeJurnalModels([probeItem]);
      log('Проба 1 ячейки. JSON: ' + shortText(JSON.stringify(models), 900), '#06c');

      const result = await postJurnals(models);
      log('Ответ сервера: ' + shortText(JSON.stringify(result), 500), '#0a0');
      applyLocalValues(plan, [probeItem]);
    }catch(e){
      log('Проба не прошла: ' + e.message, '#c33');
      setStat('Ошибка пробы');
    }finally{
      uiBusy(false);
    }
  }

  async function start(){
    if(state.running) return;
    state.stop = false;
    logEl.innerHTML = '';
    uiBusy(true);

    try{
      const plan = lastPlan && lastPlan.configKey === currentConfigKey() ? lastPlan : buildPlan();
      lastPlan = plan;
      setStat(planStats(plan));
      if(!plan.rowsPlan.length){
        log('Нет строк для изменения.', '#c60');
        return;
      }

      const totalModels = makeJurnalModels(plan.rowsPlan).length;
      if(!totalModels){
        log('Нет ячеек для отправки.', '#c60');
        return;
      }

      let sentRows = 0;
      let sentCells = 0;
      log('Найден LoadID: ' + (getLoadId(plan.rowsPlan[0] && plan.rowsPlan[0].row) || '<пусто>'), getLoadId(plan.rowsPlan[0] && plan.rowsPlan[0].row) ? '#06c' : '#c33');
      for(let i = 0; i < plan.rowsPlan.length; i += ROWS_PER_POST){
        if(state.stop){
          log('Остановлено перед следующей пачкой.', '#c33');
          break;
        }

        const chunk = plan.rowsPlan.slice(i, i + ROWS_PER_POST);
        const models = makeJurnalModels(chunk);
        log('Отправляю строку ' + (i + 1) + ', ячеек: ' + models.length + '...');
        if(i === 0) log('Первый JSON: ' + shortText(JSON.stringify(models), 900), '#06c');
        const result = await postJurnals(models);
        if(result && result.messageCode === 16){
          log('Сервер ответил: нет допуска для одной или нескольких строк.', '#c33');
        }else{
          log('Пачка принята сервером.', '#0a0');
        }

        applyLocalValues(plan, chunk);
        sentRows += chunk.length;
        sentCells += models.length;
        setStat(planStats(plan) + ', отправлено: ' + sentRows + '/' + plan.rowsPlan.length);
        await sleep(150);
      }

      try{
        if(plan.g.getDataSource && plan.g.getDataSource()) await plan.g.getDataSource().reload();
      }catch(e){}
      if(sentCells === totalModels){
        log('Готово. Если общий балл не обновился сразу, нажмите F5.', '#06c');
      }else{
        log('Частично готово: отправлено ' + sentCells + '/' + totalModels + ' ячеек.', '#c60');
      }
    }catch(e){
      log('Остановлено: ' + e.message, '#c33');
      setStat('Ошибка');
    }finally{
      uiBusy(false);
    }
  }

  function buildPanel(){
    if(document.getElementById(PANEL_ID)) return;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed',
      'top:12px',
      'right:12px',
      'z-index:2147483647',
      'width:350px',
      'background:#fff',
      'border:1px solid #888',
      'border-radius:8px',
      'box-shadow:0 4px 16px rgba(0,0,0,.25)',
      'font:13px/1.4 Segoe UI,Arial,sans-serif',
      'color:#222',
      'padding:10px'
    ].join(';');

    panel.innerHTML = `
      <div style="font-weight:bold;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
        <span>Оценки 1М/2М</span>
        <button id="dmf-close" title="Закрыть" style="border:0;background:#eee;border-radius:4px;cursor:pointer;padding:2px 7px">x</button>
      </div>
      <label>Модуль<br>
        <select id="dmf-mode" style="width:100%;box-sizing:border-box">
          <option value="both">1М + 2М</option>
          <option value="1m">только 1М</option>
          <option value="2m">только 2М</option>
        </select>
      </label>
      <label style="display:block;margin:6px 0">
        <input id="dmf-overwrite" type="checkbox" checked> перезаписывать заполненные ячейки
      </label>
      <div style="font-size:12px;color:#555;margin-bottom:6px">
        Посещаемость 3-5, активность 6-10, СРС 11-15. Если тест модуля равен 0, модуль пропускается.
      </div>
      <div style="display:flex;gap:6px">
        <button id="dmf-plan" style="flex:1;padding:6px;background:#36c;color:#fff;border:0;border-radius:5px;cursor:pointer">План</button>
        <button id="dmf-probe" style="flex:1;padding:6px;background:#777;color:#fff;border:0;border-radius:5px;cursor:pointer">Проба</button>
        <button id="dmf-start" style="flex:1;padding:6px;background:#0a7;color:#fff;border:0;border-radius:5px;cursor:pointer">Старт</button>
        <button id="dmf-stop" style="flex:1;padding:6px;background:#c33;color:#fff;border:0;border-radius:5px;cursor:pointer" disabled>Стоп</button>
      </div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button id="dmf-scan" style="flex:1;padding:6px;background:#555;color:#fff;border:0;border-radius:5px;cursor:pointer">Скан</button>
        <button id="dmf-copy" style="flex:1;padding:6px;background:#555;color:#fff;border:0;border-radius:5px;cursor:pointer">Копия</button>
      </div>
      <div id="dmf-stat" style="margin:6px 0;font-weight:bold"></div>
      <div id="dmf-log" style="height:170px;overflow:auto;background:#f7f7f7;border:1px solid #ddd;border-radius:5px;padding:6px;font-size:12px"></div>`;

    document.body.appendChild(panel);
    logEl = panel.querySelector('#dmf-log');
    statEl = panel.querySelector('#dmf-stat');
    modeEl = panel.querySelector('#dmf-mode');
    overwriteEl = panel.querySelector('#dmf-overwrite');

    panel.querySelector('#dmf-close').onclick = () => panel.remove();
    panel.querySelector('#dmf-plan').onclick = renderPlan;
    panel.querySelector('#dmf-probe').onclick = probeOneCell;
    panel.querySelector('#dmf-start').onclick = start;
    panel.querySelector('#dmf-scan').onclick = toggleScan;
    panel.querySelector('#dmf-copy').onclick = copyLog;
    panel.querySelector('#dmf-stop').onclick = () => {
      state.stop = true;
      log('Остановка запрошена. Текущий запрос уже отправлен.', '#c33');
    };
    modeEl.onchange = () => renderPlan();
    overwriteEl.onchange = () => renderPlan();

    renderPlan();
  }

  (async function init(){
    document.addEventListener('keydown', e => {
      if(e.ctrlKey && e.altKey && e.code === 'KeyM'){
        e.preventDefault();
        buildPanel();
      }
    });

    try{
      await waitFor(() => hasGrid() || document.querySelector('#gridContainer'));
      buildPanel();
    }catch(e){}
  })();
})();
