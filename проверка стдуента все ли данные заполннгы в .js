// ==UserScript==
// @name         EBilim OpenEmis group sender + Excel export
// @namespace    local.ebilim.openemis.grouplist.batch
// @version      1.6.0
// @description  Walk OpenEmis groups, send groups without statuses, then export each group table to one XLSX workbook.
// @match        https://ebilim.jaiu.edu.kg/OpenEmis/grouplist*
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @grant        none
// ==/UserScript==
(function(){
  'use strict';
  if(window.top !== window.self) return;

  const PANEL_ID = 'openemis-batch-panel';
  const LIST_PATH = '/OpenEmis/grouplist';
  const SEND_PATH = '/OpenEmis/send';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  let panel, logEl, statEl, reportEl;
  const runState = { running: false, stop: false };
  const state = {
    yearId: '',
    yearText: '',
    classId: '',
    classText: '',
    groups: [],
    results: []
  };

  function clean(value){
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }
  function log(message, color){
    if(!logEl) return;
    const row = document.createElement('div');
    row.textContent = message;
    if(color) row.style.color = color;
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function setStat(message){ if(statEl) statEl.textContent = message; }
  function setReport(lines){ if(reportEl) reportEl.value = lines.join('\n'); }

  function selectedOption(select){
    const option = select && (select.selectedOptions[0] || select.querySelector('option[selected]'));
    return option ? { value: option.value, text: clean(option.textContent) } : { value: '', text: '' };
  }
  function readCurrentFilters(){
    const year = selectedOption(document.querySelector('#AYearID[name="AYearID"]'));
    const cls = selectedOption(document.querySelector('#ClassID[name="ClassID"]'));
    state.yearId = year.value;
    state.yearText = year.text;
    state.classId = cls.value;
    state.classText = cls.text;
  }
  function collectGroupsFromDoc(doc){
    const select = doc.querySelector('#GroupID[name="GroupID"]');
    const seen = new Set();
    return [...(select ? select.options : [])]
      .filter(option => option.value)
      .map(option => ({ id: option.value, name: clean(option.textContent) }))
      .filter(group => {
        const key = group.id + '|' + group.name;
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }
  function collectGroupsFromPage(){
    readCurrentFilters();
    state.groups = collectGroupsFromDoc(document);
    updateSummary();
  }
  function collectClassesFromPage(){
    const select = document.querySelector('#ClassID[name="ClassID"]');
    const seen = new Set();
    return [...(select ? select.options : [])]
      .filter(option => option.value)
      .map(option => ({ id: option.value, name: clean(option.textContent) }))
      .filter(cls => {
        if(seen.has(cls.id)) return false;
        seen.add(cls.id);
        return true;
      });
  }
  function setCurrentClass(cls){
    state.classId = cls.id;
    state.classText = cls.name;
  }
  async function postFilterClass(cls){
    const filterForm = [...document.querySelectorAll('form')]
      .find(form => /\/OpenEmis\/grouplist/i.test(form.getAttribute('action') || '')) || null;
    const fd = filterForm ? new FormData(filterForm) : new FormData();
    fd.set('AYearID', state.yearId);
    fd.set('ClassID', cls.id);
    fd.set('GroupID', '');
    return fetchText(LIST_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: formBody(fd)
    });
  }
  async function collectGroupsForClass(cls){
    setCurrentClass(cls);
    const html = await postFilterClass(cls);
    const groups = collectGroupsFromDoc(parseHtml(html));
    const seen = new Set();
    return groups.filter(group => {
      const key = group.id + '|' + group.name;
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function updateSummary(){
    setStat('Год: ' + (state.yearText || state.yearId || '-')
      + ' | курс: ' + (state.classText || state.classId || '-')
      + ' | групп: ' + state.groups.length
      + ' | собрано листов: ' + state.results.length);
  }

  function groupUrl(group){
    const url = new URL(LIST_PATH, location.origin);
    url.searchParams.set('idGroup', group.id);
    url.searchParams.set('idClass', state.classId);
    url.searchParams.set('idYear', state.yearId);
    url.searchParams.set('_oebatch', String(Date.now()));
    return url.pathname + url.search;
  }
  async function fetchText(url, options = {}){
    const res = await fetch(url, { credentials: 'same-origin', redirect: 'follow', ...options });
    const text = await res.text();
    if(!res.ok){
      const error = new Error(url + ': HTTP ' + res.status + ' ' + clean(text).slice(0, 220));
      error.status = res.status;
      error.url = url;
      error.body = text;
      throw error;
    }
    return text;
  }
  function filterFormData(group){
    const filterForm = [...document.querySelectorAll('form')]
      .find(form => /\/OpenEmis\/grouplist/i.test(form.getAttribute('action') || '')) || null;
    const fd = filterForm ? new FormData(filterForm) : new FormData();
    fd.set('AYearID', state.yearId);
    fd.set('ClassID', state.classId);
    fd.set('GroupID', group.id);
    return fd;
  }
  async function postFilterGroup(group){
    return fetchText(LIST_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: formBody(filterFormData(group))
    });
  }
  async function fetchGroupHtml(group){
    try{
      return await postFilterGroup(group);
    }catch(e){
      if(e.status) e.message = 'POST фильтр группы ' + group.name + ': ' + e.message;
      throw e;
    }
  }
  function parseHtml(html){
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function findMainTable(doc){
    const tables = [...doc.querySelectorAll('table')];
    return tables.find(table => {
      const headers = [...table.querySelectorAll('thead th')].map(th => clean(th.textContent).toLowerCase());
      return headers.some(text => text.includes('ошибка') || text === 'error')
        || headers.some(text => text.includes('email'))
        || headers.some(text => text.includes('common_passport'));
    }) || tables.find(table => table.querySelectorAll('tbody tr').length) || null;
  }
  function rowCells(row){
    return [...row.querySelectorAll('th,td')].map(cell => clean(cell.innerText || cell.textContent));
  }
  function tableMatrix(table){
    if(!table) return [];
    const rows = [];
    const headRows = [...table.querySelectorAll('thead tr')];
    const bodyRows = [...table.querySelectorAll('tbody tr')];
    (headRows.length ? headRows : [...table.querySelectorAll('tr')].slice(0, 1)).forEach(row => {
      const values = rowCells(row);
      if(values.some(Boolean)) rows.push(values);
    });
    bodyRows.forEach(row => {
      const values = rowCells(row);
      if(values.some(Boolean)) rows.push(values);
    });
    return rows;
  }
  function statusColumnIndex(matrix){
    const headers = matrix[0] || [];
    const index = headers.findIndex(text => {
      const value = clean(text).toLowerCase();
      return value.includes('ошибка') || value === 'error';
    });
    return index >= 0 ? index : Math.max(0, headers.length - 1);
  }
  function tableStatus(matrix){
    const body = matrix.slice(1).filter(row => row.some(Boolean));
    if(!body.length) return { rows: 0, statusIndex: -1, withStatus: 0, complete: false };
    const statusIndex = statusColumnIndex(matrix);
    const withStatus = body.filter(row => clean(row[statusIndex]).length > 0).length;
    return { rows: body.length, statusIndex, withStatus, complete: withStatus === body.length };
  }
  function readPage(html){
    const doc = parseHtml(html);
    const table = findMainTable(doc);
    const matrix = tableMatrix(table);
    const status = tableStatus(matrix);
    const sendForm = [...doc.querySelectorAll('form')]
      .find(form => /\/OpenEmis\/send/i.test(form.getAttribute('action') || '')) || null;
    return { doc, table, matrix, status, sendForm };
  }

  function formBody(fd){
    const body = new URLSearchParams();
    for(const [key, value] of fd.entries()){
      if(value instanceof File) continue;
      body.append(key, value);
    }
    return body;
  }
  function sendFormData(sendForm, group){
    const fd = sendForm ? new FormData(sendForm) : new FormData();
    fd.set('AYearID', state.yearId);
    fd.set('GroupID', group.id);
    fd.set('ClassID', state.classId);
    if(![...fd.keys()].includes('__Invariant')){
      fd.append('__Invariant', 'AYearID');
      fd.append('__Invariant', 'GroupID');
      fd.append('__Invariant', 'ClassID');
    }
    return fd;
  }
  async function sendGroup(group, sendForm){
    const fd = sendFormData(sendForm, group);
    await fetchText(SEND_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: formBody(fd)
    });
  }
  async function waitForStatus(group, attempts){
    let last = null;
    for(let attempt = 1; attempt <= attempts; attempt++){
      const html = await fetchGroupHtml(group);
      const page = readPage(html);
      last = page;
      if(page.status.complete) return page;
      await sleep(800);
    }
    return last;
  }

  function makeErrorResult(group, error){
    const message = clean(error && error.message ? error.message : error);
    return {
      group,
      action: 'error',
      rows: 0,
      withStatus: 0,
      complete: false,
      error: message,
      matrix: [
        ['Группа', 'GroupID', 'Год', 'Курс', 'Ошибка', 'Что сделать'],
        [
          group.name,
          group.id,
          state.yearText || state.yearId,
          state.classText || state.classId,
          message,
          'Сервер не отдал таблицу этой группы. Проверьте ИНН/персональные данные студентов группы, исправьте запись и запустите скрипт снова.'
        ]
      ]
    };
  }

  async function processOneGroup(group, options){
    const html = await fetchGroupHtml(group);
    let page = readPage(html);
    if(!page.matrix.length) throw new Error('таблица не найдена');

    let action = 'skip';
    if(page.status.rows === 0){
      action = 'empty';
    }
    if(page.status.rows > 0 && !page.status.complete){
      if(options.sendIncomplete !== false){
        action = 'send';
        log('  статусы ' + page.status.withStatus + '/' + page.status.rows + ', отправляю...', '#c60');
        await sendGroup(group, page.sendForm);
        page = await waitForStatus(group, options.retryCount);
      }else{
        action = 'incomplete';
      }
    }

    return {
      group,
      action,
      rows: page.status.rows,
      withStatus: page.status.withStatus,
      complete: page.status.complete,
      matrix: page.matrix
    };
  }

  function safeSheetName(name, used){
    let base = clean(name).replace(/[:\\/?*\[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'group';
    base = base.slice(0, 31);
    let sheet = base;
    let index = 2;
    while(used.has(sheet)){
      const suffix = ' ' + index++;
      sheet = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(sheet);
    return sheet;
  }

  function workbookFileName(){
    const date = new Date().toISOString().replace(/[:.]/g, '-');
    return 'openemis-groups-' + (state.yearText || state.yearId || 'year').replace(/[^\wа-яА-Я-]+/g, '_')
      + '-class-' + (state.classId || 'x') + '-' + date + '.xlsx';
  }
  function downloadBlob(blob, fileName){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }
  function fitExcelColumns(ws, matrix){
    const headers = matrix[0] || [];
    headers.forEach((_, colIndex) => {
      const max = Math.min(48, Math.max(8, ...matrix.map(row => clean(row[colIndex]).length).slice(0, 300)));
      ws.getColumn(colIndex + 1).width = max + 2;
    });
  }
  function styleWorksheet(ws, result){
    const matrix = result.matrix || [];
    const headers = matrix[0] || [];
    const statusIndex = statusColumnIndex(matrix);
    const statusCol = statusIndex + 1;
    const colCount = Math.max(1, headers.length);

    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: colCount }
    };
    ws.properties.defaultRowHeight = 18;

    const header = ws.getRow(1);
    header.height = 26;
    header.eachCell({ includeEmpty: true }, cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFB7C9D6' } },
        left: { style: 'thin', color: { argb: 'FFB7C9D6' } },
        bottom: { style: 'thin', color: { argb: 'FFB7C9D6' } },
        right: { style: 'thin', color: { argb: 'FFB7C9D6' } }
      };
    });

    for(let rowNumber = 2; rowNumber <= ws.rowCount; rowNumber++){
      const row = ws.getRow(rowNumber);
      const status = clean(row.getCell(statusCol).value).toLowerCase();
      let rowFill = null;
      let statusFill = null;
      let statusFont = null;
      if(!status){
        rowFill = 'FFFFF2CC';
        statusFill = 'FFFFC000';
        statusFont = 'FF7F6000';
      }else if(status === 'success'){
        statusFill = 'FFE2F0D9';
        statusFont = 'FF375623';
      }else{
        rowFill = 'FFFCE4D6';
        statusFill = 'FFF4B183';
        statusFont = 'FF9C0006';
      }

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          left: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          bottom: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          right: { style: 'thin', color: { argb: 'FFD9E2F3' } }
        };
        if(rowFill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowFill } };
        if(colNumber === statusCol){
          cell.font = { bold: true, color: { argb: statusFont || 'FF000000' } };
          if(statusFill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusFill } };
        }
      });
    }

    fitExcelColumns(ws, matrix);
    if(statusCol > 0) ws.getColumn(statusCol).width = Math.max(ws.getColumn(statusCol).width || 12, 24);
  }
  function styleSummaryWorksheet(ws){
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };
    ws.getRow(1).height = 24;
    ws.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF305496' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    for(let rowNumber = 2; rowNumber <= ws.rowCount; rowNumber++){
      const row = ws.getRow(rowNumber);
      const complete = clean(row.getCell(6).value).toLowerCase();
      const fill = complete === 'yes' ? 'FFE2F0D9' : 'FFFCE4D6';
      row.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          left: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          bottom: { style: 'thin', color: { argb: 'FFD9E2F3' } },
          right: { style: 'thin', color: { argb: 'FFD9E2F3' } }
        };
      });
    }
    [8, 24, 10, 14, 14, 12, 16].forEach((width, index) => {
      ws.getColumn(index + 1).width = width;
    });
  }
  async function downloadStyledWorkbook(){
    const excelJs = window.ExcelJS || globalThis.ExcelJS;
    if(!excelJs) return false;

    const wb = new excelJs.Workbook();
    wb.creator = 'OpenEmis batch userscript';
    wb.created = new Date();
    wb.modified = new Date();
    wb.views = [{ x: 0, y: 0, width: 16000, height: 9000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];

    const summaryRows = [
      ['#', 'Группа', 'Строк', 'Статусов', 'Действие', 'Полностью', 'Ошибок/пустых']
    ];
    state.results.forEach((result, index) => {
      summaryRows.push([
        index + 1,
        result.group.name,
        result.rows,
        result.withStatus + '/' + result.rows,
        result.action,
        result.complete ? 'yes' : 'no',
        result.error ? 1 : Math.max(0, result.rows - result.withStatus)
      ]);
    });
    const summary = wb.addWorksheet('Итог');
    summary.addRows(summaryRows);
    styleSummaryWorksheet(summary);

    const used = new Set(['Итог']);
    state.results.forEach(result => {
      const sheetName = safeSheetName(result.group.name, used);
      const ws = wb.addWorksheet(sheetName);
      ws.addRows(result.matrix);
      styleWorksheet(ws, result);
    });

    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }), workbookFileName());
    return true;
  }
  function downloadPlainWorkbook(){
    const xlsx = window.XLSX || globalThis.XLSX;
    if(!xlsx) return false;

    const wb = xlsx.utils.book_new();
    const used = new Set();
    const summary = [
      ['#', 'Группа', 'Строк', 'Статусов', 'Действие', 'Полностью', 'Ошибок/пустых'],
      ...state.results.map((result, index) => [
        index + 1,
        result.group.name,
        result.rows,
        result.withStatus + '/' + result.rows,
        result.action,
        result.complete ? 'yes' : 'no',
        result.error ? 1 : Math.max(0, result.rows - result.withStatus)
      ])
    ];
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(summary), 'Итог');
    used.add('Итог');
    state.results.forEach(result => {
      const sheetName = safeSheetName(result.group.name, used);
      const ws = xlsx.utils.aoa_to_sheet(result.matrix);
      ws['!freeze'] = { xSplit: 0, ySplit: 1 };
      ws['!cols'] = (result.matrix[0] || []).map((_, col) => {
        const max = Math.min(45, Math.max(8, ...result.matrix.map(row => clean(row[col]).length).slice(0, 200)));
        return { wch: max + 2 };
      });
      xlsx.utils.book_append_sheet(wb, ws, sheetName);
    });
    xlsx.writeFile(wb, workbookFileName());
    return true;
  }
  async function downloadWorkbook(){
    if(!state.results.length){
      log('Нет собранных таблиц для Excel.', '#c60');
      return;
    }
    const styled = await downloadStyledWorkbook();
    if(styled){
      log('Красивый Excel скачан: шапка, фильтры, автоширина, подсветка статусов.', '#0a0');
      return;
    }
    const plain = downloadPlainWorkbook();
    if(plain){
      log('Excel скачан в простом режиме: ExcelJS не загрузился, стили недоступны.', '#c60');
      return;
    }
    log('Библиотеки Excel не загрузились. Проверь @require ExcelJS/SheetJS в Tampermonkey.', '#c33');
  }

  async function startBatch(){
    if(runState.running) return;
    collectGroupsFromPage();
    if(!state.yearId || !state.classId) {
      log('Выбери год и курс на странице.', '#c33');
      return;
    }
    if(!state.groups.length){
      log('Группы не найдены в селекте GroupID.', '#c33');
      return;
    }
    if(!confirm('Обойти ' + state.groups.length + ' групп. Если у группы не все строки имеют статус в колонке «Ошибка», выполнить /OpenEmis/send. Потом скачать Excel. Продолжить?')) return;

    runState.running = true;
    runState.stop = false;
    uiBusy(true);
    logEl.innerHTML = '';
    state.results = [];
    const report = [];
    let skipped = 0, sent = 0, incomplete = 0, empty = 0, errors = 0;
    const options = {
      sendIncomplete: true,
      retryCount: Math.max(1, parseInt(panel.querySelector('#oeb-retry').value, 10) || 4),
      delay: Math.max(0, parseInt(panel.querySelector('#oeb-delay').value, 10) || 250)
    };

    try{
      for(let index = 0; index < state.groups.length; index++){
        if(runState.stop) break;
        const group = state.groups[index];
        setStat('Группа ' + (index + 1) + '/' + state.groups.length + ': ' + group.name);
        log('[' + (index + 1) + '/' + state.groups.length + '] ' + group.name, '#06c');
        try{
          const result = await processOneGroup(group, options);
          state.results.push(result);
          if(result.action === 'send') sent++;
          else if(result.action === 'skip') skipped++;
          else if(result.action === 'empty') empty++;
          else incomplete++;

          const line = group.name + ': rows=' + result.rows
            + ', status=' + result.withStatus + '/' + result.rows
            + ', action=' + result.action
            + ', complete=' + result.complete;
          report.push(line);
          log('  ' + line, result.complete ? '#0a0' : '#c60');
        }catch(e){
          errors++;
          state.results.push(makeErrorResult(group, e));
          const line = group.name + ': ОШИБКА: ' + e.message;
          report.push(line);
          log('  ' + line, '#c33');
        }
        updateSummary();
        if(options.delay) await sleep(options.delay);
      }

      const summary = 'ИТОГ: листов ' + state.results.length
        + ', уже были статусы ' + skipped
        + ', отправлено ' + sent
        + ', пустых групп ' + empty
        + ', неполных после отправки ' + incomplete
        + ', ошибок ' + errors;
      report.push('');
      report.push(summary);
      setReport(report);
      log(summary, errors || incomplete ? '#c60' : '#0a0');
      if(state.results.length) await downloadWorkbook();
      setStat(runState.stop ? 'Остановлено' : 'Готово');
    }catch(e){
      log('СТОП: ' + e.message, '#c33');
      setStat('Ошибка');
    }finally{
      runState.running = false;
      uiBusy(false);
      updateSummary();
    }
  }

  async function startAllClassesBatch(){
    if(runState.running) return;
    readCurrentFilters();
    const classes = collectClassesFromPage();
    if(!state.yearId){
      log('Выбери год на странице.', '#c33');
      return;
    }
    if(!classes.length){
      log('Курсы не найдены в селекте ClassID.', '#c33');
      return;
    }
    if(!confirm('Обойти все курсы: ' + classes.map(cls => cls.name).join(', ') + '. Для каждого курса будет отдельный Excel. Группы без статусов будут отправлены. Продолжить?')) return;

    runState.running = true;
    runState.stop = false;
    uiBusy(true);
    logEl.innerHTML = '';
    state.results = [];
    const allReport = [];
    const options = {
      sendIncomplete: true,
      retryCount: Math.max(1, parseInt(panel.querySelector('#oeb-retry').value, 10) || 4),
      delay: Math.max(0, parseInt(panel.querySelector('#oeb-delay').value, 10) || 250)
    };

    try{
      for(let classIndex = 0; classIndex < classes.length; classIndex++){
        if(runState.stop) break;
        const cls = classes[classIndex];
        setCurrentClass(cls);
        state.groups = [];
        state.results = [];
        updateSummary();
        log('=== Курс ' + (classIndex + 1) + '/' + classes.length + ': ' + cls.name + ' ===', '#06c');
        setStat('Курс ' + (classIndex + 1) + '/' + classes.length + ': ' + cls.name + ', читаю группы...');

        let skipped = 0, sent = 0, incomplete = 0, empty = 0, errors = 0;
        try{
          state.groups = await collectGroupsForClass(cls);
        }catch(e){
          errors++;
          const group = { id: 'class-' + cls.id, name: cls.name };
          state.results.push(makeErrorResult(group, e));
          log('  Не удалось получить список групп курса: ' + e.message, '#c33');
        }
        updateSummary();
        allReport.push('=== ' + cls.name + ' ===');
        allReport.push('Групп: ' + state.groups.length);

        for(let index = 0; index < state.groups.length; index++){
          if(runState.stop) break;
          const group = state.groups[index];
          setStat('Курс ' + cls.name + ' | группа ' + (index + 1) + '/' + state.groups.length + ': ' + group.name);
          log('[' + cls.name + ' ' + (index + 1) + '/' + state.groups.length + '] ' + group.name, '#06c');
          try{
            const result = await processOneGroup(group, options);
            state.results.push(result);
            if(result.action === 'send') sent++;
            else if(result.action === 'skip') skipped++;
            else if(result.action === 'empty') empty++;
            else incomplete++;

            const line = group.name + ': rows=' + result.rows
              + ', status=' + result.withStatus + '/' + result.rows
              + ', action=' + result.action
              + ', complete=' + result.complete;
            allReport.push(line);
            log('  ' + line, result.complete ? '#0a0' : '#c60');
          }catch(e){
            errors++;
            state.results.push(makeErrorResult(group, e));
            const line = group.name + ': ОШИБКА: ' + e.message;
            allReport.push(line);
            log('  ' + line, '#c33');
          }
          updateSummary();
          if(options.delay) await sleep(options.delay);
        }

        const summary = 'ИТОГ ' + cls.name + ': листов ' + state.results.length
          + ', уже были статусы ' + skipped
          + ', отправлено ' + sent
          + ', пустых групп ' + empty
          + ', неполных после отправки ' + incomplete
          + ', ошибок ' + errors;
        allReport.push(summary);
        allReport.push('');
        log(summary, errors || incomplete ? '#c60' : '#0a0');
        setReport(allReport);
        if(state.results.length) await downloadWorkbook();
        if(runState.stop) break;
        await sleep(900);
      }
      setStat(runState.stop ? 'Остановлено' : 'Все курсы готовы');
    }catch(e){
      log('СТОП: ' + e.message, '#c33');
      setStat('Ошибка');
    }finally{
      runState.running = false;
      uiBusy(false);
      updateSummary();
    }
  }

  async function collectOnly(){
    if(runState.running) return;
    collectGroupsFromPage();
    runState.running = true;
    runState.stop = false;
    uiBusy(true);
    logEl.innerHTML = '';
    state.results = [];
    let errors = 0;
    try{
      for(let index = 0; index < state.groups.length; index++){
        if(runState.stop) break;
        const group = state.groups[index];
        setStat('Сбор таблиц ' + (index + 1) + '/' + state.groups.length + ': ' + group.name);
        try{
          const html = await fetchGroupHtml(group);
          const page = readPage(html);
          state.results.push({
            group,
            action: 'collect',
            rows: page.status.rows,
            withStatus: page.status.withStatus,
            complete: page.status.complete,
            matrix: page.matrix
          });
          log(group.name + ': status=' + page.status.withStatus + '/' + page.status.rows, page.status.complete ? '#0a0' : '#c60');
        }catch(e){
          errors++;
          state.results.push(makeErrorResult(group, e));
          log(group.name + ': ' + e.message, '#c33');
        }
        await sleep(120);
      }
      log('Сбор готов: листов ' + state.results.length + ', ошибок ' + errors, errors ? '#c60' : '#0a0');
      await downloadWorkbook();
    }finally{
      runState.running = false;
      uiBusy(false);
      updateSummary();
    }
  }

  function uiBusy(busy){
    if(!panel) return;
    panel.querySelectorAll('button,input').forEach(el => {
      if(el.id === 'oeb-stop') el.disabled = !busy;
      else if(el.id !== 'oeb-close') el.disabled = busy;
    });
  }
  function buildPanel(){
    if(document.getElementById(PANEL_ID)) return;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647', 'width:520px',
      'background:#fff', 'border:1px solid #666', 'border-radius:8px',
      'box-shadow:0 4px 16px rgba(0,0,0,.22)', 'font:13px/1.4 Segoe UI,Arial,sans-serif',
      'color:#222', 'padding:10px'
    ].join(';');
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;font-weight:bold;margin-bottom:6px">
        <span>OpenEmis groups send + styled Excel v1.6.0</span>
        <button id="oeb-close" title="Закрыть" style="border:0;background:#eee;border-radius:4px;padding:2px 7px;cursor:pointer">x</button>
      </div>
      <div style="font-size:12px;color:#555;margin-bottom:8px">
        Обходит группы из текущего фильтра. «Все курсы + Excel» делает отдельный файл для каждого курса.
      </div>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <button id="oeb-scan" style="flex:1;padding:7px;background:#555;color:#fff;border:0;border-radius:5px;cursor:pointer">Считать группы</button>
        <button id="oeb-start" style="flex:1.2;padding:7px;background:#0a7;color:#fff;border:0;border-radius:5px;cursor:pointer">Обойти + Excel</button>
        <button id="oeb-collect" style="flex:1;padding:7px;background:#36c;color:#fff;border:0;border-radius:5px;cursor:pointer">Только Excel</button>
        <button id="oeb-stop" style="flex:.7;padding:7px;background:#c33;color:#fff;border:0;border-radius:5px;cursor:pointer" disabled>Стоп</button>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <button id="oeb-all-classes" style="flex:1;padding:8px;background:#7a3db8;color:#fff;border:0;border-radius:5px;cursor:pointer">Все курсы + Excel</button>
      </div>
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">
        <label style="width:82px">повторы<br><input id="oeb-retry" type="number" value="5" min="1" style="width:100%"></label>
        <label style="width:90px">пауза мс<br><input id="oeb-delay" type="number" value="250" min="0" style="width:100%"></label>
      </div>
      <div id="oeb-stat" style="font-weight:bold;margin:6px 0"></div>
      <div id="oeb-log" style="height:250px;overflow:auto;background:#f7f7f7;border:1px solid #ddd;border-radius:5px;padding:6px;font-size:12px"></div>
      <div style="font-size:11px;color:#777;margin:6px 0 2px">Отчет:</div>
      <textarea id="oeb-report" style="width:100%;height:88px;font:11px/1.35 Consolas,monospace;border:1px solid #ddd;border-radius:5px;padding:5px" readonly></textarea>`;
    document.body.appendChild(panel);
    logEl = panel.querySelector('#oeb-log');
    statEl = panel.querySelector('#oeb-stat');
    reportEl = panel.querySelector('#oeb-report');
    panel.querySelector('#oeb-close').onclick = () => panel.remove();
    panel.querySelector('#oeb-scan').onclick = () => {
      collectGroupsFromPage();
      log('Найдено групп: ' + state.groups.length, '#06c');
      setReport(state.groups.map(group => group.id + '\t' + group.name));
    };
    panel.querySelector('#oeb-start').onclick = startBatch;
    panel.querySelector('#oeb-all-classes').onclick = startAllClassesBatch;
    panel.querySelector('#oeb-collect').onclick = collectOnly;
    panel.querySelector('#oeb-stop').onclick = () => {
      runState.stop = true;
      log('Остановка после текущего запроса...', '#c33');
    };
    collectGroupsFromPage();
  }

  buildPanel();
})();
