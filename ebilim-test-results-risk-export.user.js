// ==UserScript==
// @name         EBilim test results suspicious IP/device Excel export
// @namespace    local.ebilim.testresults.risk-export
// @version      1.0.0
// @description  Collect TestResults rows by date range, flag unusual IPs or non-Windows devices, and download an Excel workbook.
// @match        *://ebilim.jaiu.edu.kg:90/TestResults/Results2*
// @match        *://ebilim.jaiu.edu.kg:90/TestResults/Results*
// @run-at       document-idle
// @require      https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js
// @require      https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js
// @grant        none
// ==/UserScript==
(function(){
  'use strict';
  if(window.top !== window.self) return;

  const PATH_OK = /^\/TestResults\/Results2?\/?$/i.test(location.pathname);
  if(!PATH_OK) return;

  const PANEL_ID = 'tr-risk-panel';
  const STYLE_ID = 'tr-risk-style';
  const STORAGE_KEY = 'tr_risk_export_state_v1';
  const ENDPOINT = '/TestResults/GetResults';
  const DEFAULT_PAGE_SIZE = 200;
  const DEFAULT_MAX_ROWS = 30000;
  const DEFAULT_OLD_PAGE_LIMIT = 5;

  const runState = { running: false, stop: false };
  const state = loadState();
  let panel, logEl, statEl;

  function loadState(){
    const today = formatRuDate(new Date());
    const base = {
      panelPosition: null,
      dateFrom: today,
      dateTo: today,
      pageSize: DEFAULT_PAGE_SIZE,
      maxRows: DEFAULT_MAX_ROWS,
      oldPageLimit: DEFAULT_OLD_PAGE_LIMIT,
      useServerFilter: true,
      autoMainIp: true,
      extraNormalIps: '',
      rows: [],
      suspiciousRows: [],
      suspiciousIpRows: [],
      deviceProblemRows: [],
      summary: null
    };
    try{
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        ...base,
        ...parsed,
        rows: [],
        suspiciousRows: [],
        suspiciousIpRows: [],
        deviceProblemRows: []
      };
    }catch(e){
      return base;
    }
  }

  function saveState(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        panelPosition: state.panelPosition,
        dateFrom: state.dateFrom,
        dateTo: state.dateTo,
        pageSize: state.pageSize,
        maxRows: state.maxRows,
        oldPageLimit: state.oldPageLimit,
        useServerFilter: state.useServerFilter,
        autoMainIp: state.autoMainIp,
        extraNormalIps: state.extraNormalIps,
        rows: [],
        suspiciousRows: [],
        suspiciousIpRows: [],
        deviceProblemRows: [],
        summary: state.summary
      }));
    }catch(e){
      // LocalStorage can overflow on very large runs; the freshly collected data still remains in memory.
      try{
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          panelPosition: state.panelPosition,
          dateFrom: state.dateFrom,
          dateTo: state.dateTo,
          pageSize: state.pageSize,
          maxRows: state.maxRows,
          oldPageLimit: state.oldPageLimit,
          useServerFilter: state.useServerFilter,
          autoMainIp: state.autoMainIp,
          extraNormalIps: state.extraNormalIps,
          rows: [],
          suspiciousRows: [],
          suspiciousIpRows: [],
          deviceProblemRows: [],
          summary: state.summary
        }));
      }catch(ignore){}
    }
  }

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function clean(value){
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function short(value, max = 220){
    const text = clean(value);
    return text.length > max ? text.slice(0, max - 1) + '...' : text;
  }

  function norm(value){
    return clean(value).toLowerCase();
  }

  function pad2(value){
    return String(value).padStart(2, '0');
  }

  function formatRuDate(date){
    return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
  }

  function formatInputDate(date){
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function parseUserDate(value){
    const text = clean(value);
    if(!text) return null;

    let m = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if(m){
      const date = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      return validDateParts(date, Number(m[3]), Number(m[2]), Number(m[1])) ? date : null;
    }

    m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if(m){
      const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return validDateParts(date, Number(m[1]), Number(m[2]), Number(m[3])) ? date : null;
    }

    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function validDateParts(date, year, month, day){
    return date instanceof Date
      && !Number.isNaN(date.getTime())
      && date.getFullYear() === year
      && date.getMonth() === month - 1
      && date.getDate() === day;
  }

  function addDays(date, days){
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + days);
    return next;
  }

  function dateKey(date){
    return formatInputDate(date);
  }

  function parseResultDate(row){
    const fromCreated = row && (row.createddate || row.createdDate || row.CreatedDate);
    if(fromCreated){
      const date = new Date(fromCreated);
      if(!Number.isNaN(date.getTime())) return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }
    const fromTestDate = row && (row.testdate || row.testDate || row.TestDate);
    const parsed = parseUserDate(fromTestDate);
    return parsed || null;
  }

  function rowDateKey(row){
    const date = parseResultDate(row);
    return date ? dateKey(date) : '';
  }

  function dateInRange(row, fromDate, toDate){
    const date = parseResultDate(row);
    if(!date) return false;
    return date >= fromDate && date <= toDate;
  }

  function setToday(){
    const value = formatRuDate(new Date());
    state.dateFrom = value;
    state.dateTo = value;
    saveState();
    renderInputs();
    updateStat();
  }

  function log(message, color){
    if(!logEl) return;
    const row = document.createElement('div');
    row.textContent = message;
    if(color) row.style.color = color;
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function clearLog(){
    if(logEl) logEl.textContent = '';
  }

  function setStat(message){
    if(statEl) statEl.textContent = message;
  }

  function updateStat(){
    const summary = state.summary || {};
    const parts = [
      `строк: ${state.rows.length || 0}`,
      `к проверке: ${state.suspiciousRows.length || 0}`,
      `IP: ${state.suspiciousIpRows.length || 0}`,
      `устройства: ${state.deviceProblemRows.length || 0}`
    ];
    if(summary.mainIp) parts.push(`главный IP: ${summary.mainIp} (${summary.mainIpCount || 0})`);
    if(summary.normalIps && summary.normalIps.length) parts.push(`нормальные IP: ${summary.normalIps.join(', ')}`);
    setStat(parts.join(' | '));
  }

  function readInputs(){
    state.dateFrom = clean(panel.querySelector('#tr-date-from').value);
    state.dateTo = clean(panel.querySelector('#tr-date-to').value);
    state.pageSize = clampNumber(panel.querySelector('#tr-page-size').value, 20, 1000, DEFAULT_PAGE_SIZE);
    state.maxRows = clampNumber(panel.querySelector('#tr-max-rows').value, 100, 200000, DEFAULT_MAX_ROWS);
    state.oldPageLimit = clampNumber(panel.querySelector('#tr-old-pages').value, 1, 50, DEFAULT_OLD_PAGE_LIMIT);
    state.useServerFilter = !!panel.querySelector('#tr-server-filter').checked;
    state.autoMainIp = !!panel.querySelector('#tr-auto-ip').checked;
    state.extraNormalIps = panel.querySelector('#tr-normal-ips').value;
    saveState();
  }

  function renderInputs(){
    if(!panel) return;
    panel.querySelector('#tr-date-from').value = state.dateFrom || '';
    panel.querySelector('#tr-date-to').value = state.dateTo || '';
    panel.querySelector('#tr-page-size').value = state.pageSize || DEFAULT_PAGE_SIZE;
    panel.querySelector('#tr-max-rows').value = state.maxRows || DEFAULT_MAX_ROWS;
    panel.querySelector('#tr-old-pages').value = state.oldPageLimit || DEFAULT_OLD_PAGE_LIMIT;
    panel.querySelector('#tr-server-filter').checked = !!state.useServerFilter;
    panel.querySelector('#tr-auto-ip').checked = !!state.autoMainIp;
    panel.querySelector('#tr-normal-ips').value = state.extraNormalIps || '';
  }

  function clampNumber(value, min, max, fallback){
    const number = parseInt(value, 10);
    if(!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function readDateRange(){
    const fromDate = parseUserDate(state.dateFrom);
    const toDate = parseUserDate(state.dateTo);
    if(!fromDate || !toDate) throw new Error('Введите даты в формате 16.05.2026 или 2026-05-16.');
    if(fromDate > toDate) throw new Error('Дата начала больше даты конца.');
    return { fromDate, toDate };
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

  function makeUrl(skip, take, range, options = {}){
    const url = new URL(ENDPOINT, location.origin);
    const sortSelector = options.sortByCreated ? 'createddate' : 'id';
    const sort = [{ selector: sortSelector, desc: true }];
    if(sortSelector !== 'id') sort.push({ selector: 'id', desc: true });

    url.searchParams.set('requireTotalCount', 'true');
    url.searchParams.set('searchOperation', '"contains"');
    url.searchParams.set('sort', JSON.stringify(sort));
    url.searchParams.set('skip', String(skip));
    url.searchParams.set('take', String(take));
    url.searchParams.set('userData', '{}');
    url.searchParams.set('_', String(Date.now()));

    if(options.useServerFilter && range){
      const filter = [
        ['createddate', '>=', `${dateKey(range.fromDate)}T00:00:00`],
        'and',
        ['createddate', '<', `${dateKey(addDays(range.toDate, 1))}T00:00:00`]
      ];
      url.searchParams.set('filter', JSON.stringify(filter));
    }

    return url.href;
  }

  async function fetchResultsPage(skip, take, range, options){
    const res = await fetch(makeUrl(skip, take, range, options), {
      credentials: 'same-origin',
      redirect: 'follow',
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    const text = await res.text();
    if(!res.ok) throw new Error(`HTTP ${res.status}: ${short(text, 300)}`);
    return parseFlexibleJson(text);
  }

  function resultRows(payload){
    if(Array.isArray(payload)) return payload;
    if(!payload || typeof payload !== 'object') return [];
    const rows = payload.data || payload.Data || payload.items || payload.Items || payload.result || payload.Result || [];
    return Array.isArray(rows) ? rows : [];
  }

  function resultTotal(payload){
    if(!payload || typeof payload !== 'object' || Array.isArray(payload)) return 0;
    const value = payload.totalCount ?? payload.TotalCount ?? payload.total ?? payload.Total ?? payload.count ?? payload.Count;
    return Number(value) > 0 ? Number(value) : 0;
  }

  function normalizeRow(row){
    const id = row.id ?? row.Id ?? row.resultid ?? row.ResultId ?? '';
    const device = parseDeviceInfo(row.deviceinfo || row.deviceInfo || row.Deviceinfo || row.DeviceInfo || '');
    const rawTestType = row.testtype ?? row.TestType ?? row.testType ?? row.Testtype ?? '';
    const normalized = {
      id,
      fullname: clean(row.fullname ?? row.FullName ?? row.student ?? row.Student ?? ''),
      group: clean(row.group ?? row.Group ?? ''),
      testtitle: clean(row.testtitle ?? row.TestTitle ?? row.title ?? row.Title ?? ''),
      testdate: clean(row.testdate ?? row.TestDate ?? ''),
      testtime: clean(row.testtime ?? row.TestTime ?? ''),
      ball: row.ball ?? row.Ball ?? '',
      attempt: row.attempt ?? row.Attempt ?? '',
      ipaddress: clean(row.ipaddress ?? row.Ipaddress ?? row.ipAddress ?? row.IPAddress ?? ''),
      deviceinfo: clean(row.deviceinfo ?? row.Deviceinfo ?? row.deviceInfo ?? row.DeviceInfo ?? ''),
      deviceType: device.deviceType,
      deviceOs: device.os,
      deviceName: device.device,
      createddate: row.createddate ?? row.CreatedDate ?? '',
      modifieddate: row.modifieddate ?? row.ModifiedDate ?? '',
      statustext: clean(row.statustext ?? row.StatusText ?? ''),
      facultyName: clean(row.facultyName ?? row.FacultyName ?? ''),
      faculty: row.faculty ?? row.Faculty ?? '',
      testtype: testTypeTextFromRow(row, rawTestType),
      testtypeRaw: rawTestType,
      status: row.status ?? row.Status ?? '',
      iscanceled: boolText(row.iscanceled ?? row.isCanceled ?? row.IsCanceled),
      isAppealed: boolText(row.isAppealed ?? row.IsAppealed),
      isViolated: boolText(row.isViolated ?? row.IsViolated),
      userid: row.userid ?? row.userId ?? row.UserId ?? '',
      testid: row.testid ?? row.testId ?? row.TestId ?? '',
      assignedtestid: row.assignedtestid ?? row.assignedTestId ?? row.AssignedTestId ?? '',
      dbselector: row.dbselector ?? row.dbSelector ?? row.DbSelector ?? '',
      showresults: row.showresults ?? row.showResults ?? row.ShowResults ?? '',
      appealCount: row.appealCount ?? row.AppealCount ?? '',
      appealsCount: row.appealsCount ?? row.AppealsCount ?? '',
      cancellationreason: clean(row.cancellationreason ?? row.cancellationReason ?? row.CancellationReason ?? ''),
      comment: clean(row.comment ?? row.Comment ?? '')
    };
    normalized.dateKey = rowDateKey(normalized);
    normalized.testViewUrl = normalized.id ? `${location.origin}/TestResults/TestView/${normalized.id}` : '';
    normalized.reportProtocolUrl = normalized.id ? `${location.origin}/TestResults/ReportProtocol/${normalized.id}` : '';
    normalized.studentProtocolUrl = normalized.id ? `${location.origin}/report/ProtokolStudent/${normalized.id}` : '';
    return normalized;
  }

  function boolText(value){
    if(value === true) return 'yes';
    if(value === false) return 'no';
    return value == null ? '' : String(value);
  }

  function parseDeviceInfo(value){
    const text = clean(value);
    return {
      deviceType: extractDevicePart(text, /DeviceType:\s*([^,]+)/i),
      os: extractDevicePart(text, /OS:\s*([^,]+)/i),
      device: extractDevicePart(text, /Device:\s*([^,]+)/i)
    };
  }

  function extractDevicePart(text, regex){
    const match = text.match(regex);
    return match ? clean(match[1]) : '';
  }

  function testTypeTextFromRow(row, rawTestType){
    const text = clean(
      row.testtypetext
      ?? row.testTypeText
      ?? row.TestTypeText
      ?? row.testtypename
      ?? row.testTypeName
      ?? row.TestTypeName
      ?? row.typeText
      ?? row.TypeText
      ?? ''
    );
    if(text) return text;

    const raw = clean(rawTestType);
    if(raw === '2') return 'Пробный';
    if(raw === '1') return 'Аттестация';
    return raw;
  }

  function isTrialTest(row){
    const text = norm([
      row.testtype,
      row.testtypeRaw,
      row.testtypetext,
      row.testTypeText,
      row.TestTypeText,
      row.testTypeName,
      row.TestTypeName
    ].join(' '));
    return text.includes('пробн') || clean(row.testtypeRaw) === '2';
  }

  function ipListFromText(value){
    return clean(value)
      .split(/[,\s;]+/)
      .map(clean)
      .filter(Boolean);
  }

  function countBy(rows, key){
    const map = new Map();
    rows.forEach(row => {
      const value = clean(row[key]) || '(empty)';
      map.set(value, (map.get(value) || 0) + 1);
    });
    return [...map.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }

  function countDeviceOs(rows){
    const map = new Map();
    rows.forEach(row => {
      const label = clean(row.deviceOs || row.deviceinfo) || '(empty)';
      map.set(label, (map.get(label) || 0) + 1);
    });
    return [...map.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }

  function analyzeRows(rows){
    const ipCounts = countBy(rows, 'ipaddress');
    const mainIp = ipCounts.find(item => item.value !== '(empty)') || ipCounts[0] || { value: '', count: 0 };
    const normalIps = new Set(ipListFromText(state.extraNormalIps));
    if(state.autoMainIp && mainIp.value && mainIp.value !== '(empty)') normalIps.add(mainIp.value);

    rows.forEach(row => {
      const trial = isTrialTest(row);
      row.isTrialTest = trial ? 'yes' : '';
      row.exemptReason = trial ? 'Пробный тест' : '';
      if(trial){
        row.riskType = '';
        row.ipReason = '';
        row.deviceReason = '';
        row.reason = '';
        row.flag = '';
        return;
      }

      const ipReasons = [];
      const deviceReasons = [];
      const ip = clean(row.ipaddress);
      if(!ip) ipReasons.push('нет IP');
      else if(normalIps.size && !normalIps.has(ip)) ipReasons.push('странный IP');
      else if(!normalIps.size) ipReasons.push('нормальный IP не задан');

      const deviceInfo = clean(row.deviceinfo);
      const deviceType = clean(row.deviceType);
      const deviceOs = clean(row.deviceOs);
      const deviceText = clean([deviceInfo, deviceType, deviceOs].join(' '));
      if(!deviceInfo && !deviceType && !deviceOs){
        if(ipReasons.length) deviceReasons.push('пустое устройство');
      }else{
        if(!deviceType && ipReasons.length) deviceReasons.push('пустой DeviceType');
        if(!/\bWindows\b/i.test(deviceText)) deviceReasons.push('устройство не Windows');
      }

      const reasons = [...ipReasons, ...deviceReasons];
      row.riskType = [
        ipReasons.length ? 'IP' : '',
        deviceReasons.length ? 'Устройство' : ''
      ].filter(Boolean).join(' + ');
      row.ipReason = ipReasons.join('; ');
      row.deviceReason = deviceReasons.join('; ');
      row.reason = reasons.join('; ');
      row.flag = reasons.length ? 'Проверить' : '';
    });

    const suspiciousRows = rows.filter(row => row.reason);
    const suspiciousIpRows = rows.filter(row => row.ipReason);
    const deviceProblemRows = rows.filter(row => row.deviceReason);
    const trialRows = rows.filter(row => row.isTrialTest);
    const studentRows = buildStudentRows(rows);
    const riskyStudentCount = studentRows.filter(row => row.risk === 'yes').length;
    return {
      ipCounts,
      deviceCounts: countDeviceOs(rows),
      mainIp: mainIp.value === '(empty)' ? '' : mainIp.value,
      mainIpCount: mainIp.count || 0,
      normalIps: [...normalIps],
      suspiciousRows,
      suspiciousIpRows,
      deviceProblemRows,
      trialRows,
      studentRows,
      riskyStudentCount
    };
  }

  function buildStudentRows(rows){
    const map = new Map();
    rows.forEach(row => {
      const key = clean(row.userid) || `${row.fullname}|${row.group}`;
      if(!map.has(key)){
        map.set(key, {
          userid: row.userid,
          fullname: row.fullname,
          group: row.group,
          total: 0,
          suspicious: 0,
          ips: new Set(),
          devices: new Set(),
          tests: new Set(),
          reasons: new Set(),
          firstDate: row.dateKey || '',
          lastDate: row.dateKey || ''
        });
      }
      const item = map.get(key);
      item.total += 1;
      if(row.reason) item.suspicious += 1;
      if(row.ipaddress) item.ips.add(row.ipaddress);
      if(row.deviceinfo) item.devices.add(row.deviceinfo);
      if(row.testtitle) item.tests.add(row.testtitle);
      if(row.reason) row.reason.split(';').map(clean).filter(Boolean).forEach(reason => item.reasons.add(reason));
      if(row.dateKey){
        if(!item.firstDate || row.dateKey < item.firstDate) item.firstDate = row.dateKey;
        if(!item.lastDate || row.dateKey > item.lastDate) item.lastDate = row.dateKey;
      }
    });

    return [...map.values()].map(item => ({
      risk: item.suspicious ? 'yes' : 'no',
      userid: item.userid,
      fullname: item.fullname,
      group: item.group,
      total: item.total,
      suspicious: item.suspicious,
      ips: [...item.ips].join(', '),
      ipCount: item.ips.size,
      devices: [...item.devices].join(' | '),
      tests: [...item.tests].join(' | '),
      reasons: [...item.reasons].join('; '),
      firstDate: item.firstDate,
      lastDate: item.lastDate
    })).sort((a, b) => {
      const risk = (b.suspicious > 0) - (a.suspicious > 0);
      return risk || b.suspicious - a.suspicious || a.fullname.localeCompare(b.fullname);
    });
  }

  async function collectRows(){
    if(runState.running) return;
    readInputs();
    const range = readDateRange();
    clearLog();
    state.rows = [];
    state.suspiciousRows = [];
    state.suspiciousIpRows = [];
    state.deviceProblemRows = [];
    state.summary = null;
    updateStat();

    runState.running = true;
    runState.stop = false;
    uiBusy(true);

    try{
      const pageSize = state.pageSize || DEFAULT_PAGE_SIZE;
      const maxRows = state.maxRows || DEFAULT_MAX_ROWS;
      let useServerFilter = !!state.useServerFilter;
      let sortByCreated = true;
      let skip = 0;
      let fetchedRaw = 0;
      let total = 0;
      let oldPages = 0;
      let pageNo = 0;
      const byId = new Map();

      log(`Сбор: ${formatRuDate(range.fromDate)} - ${formatRuDate(range.toDate)}.`);
      while(!runState.stop && fetchedRaw < maxRows){
        let payload;
        try{
          payload = await fetchResultsPage(skip, pageSize, range, { useServerFilter, sortByCreated });
        }catch(e){
          if(useServerFilter){
            useServerFilter = false;
            log('Серверный фильтр по дате не принялся, продолжаю без него и фильтрую даты в скрипте.', '#b45309');
            continue;
          }
          if(sortByCreated){
            sortByCreated = false;
            log('Сортировка по createddate не принялась, пробую сортировку по id.', '#b45309');
            continue;
          }
          throw e;
        }

        const rawRows = resultRows(payload);
        total = Math.max(total, resultTotal(payload));
        pageNo += 1;
        if(!rawRows.length){
          log(`Страница ${pageNo}: пусто, остановка.`);
          break;
        }

        const normalized = rawRows.map(normalizeRow);
        const before = byId.size;
        normalized.forEach(row => {
          const key = clean(row.id) || `${row.userid}|${row.fullname}|${row.testtitle}|${row.testdate}|${row.testtime}`;
          if(!byId.has(key)) byId.set(key, row);
        });

        const inRange = normalized.filter(row => dateInRange(row, range.fromDate, range.toDate)).length;
        const pageDates = normalized.map(rowDateKey).filter(Boolean).sort();
        const firstDate = pageDates[0] || '?';
        const lastDate = pageDates[pageDates.length - 1] || '?';
        const added = byId.size - before;
        fetchedRaw += rawRows.length;

        log(`Страница ${pageNo}: ${rawRows.length} строк, новых ${added}, в периоде ${inRange}, даты ${firstDate}..${lastDate}.`);
        if(added === 0){
          log('Новые строки не появляются. Останавливаю, чтобы не крутиться по одним и тем же данным.', '#b45309');
          break;
        }

        if(!useServerFilter){
          const allOlder = pageDates.length && pageDates[pageDates.length - 1] < dateKey(range.fromDate);
          oldPages = allOlder && !inRange ? oldPages + 1 : 0;
          if(oldPages >= state.oldPageLimit){
            log(`Уже ${oldPages} страниц старше даты начала. Остановка.`, '#555');
            break;
          }
        }

        skip += rawRows.length;
        if(total && skip >= total){
          log(`Достигнут конец выдачи: ${skip}/${total}.`);
          break;
        }
        await sleep(80);
      }

      const rows = [...byId.values()]
        .filter(row => dateInRange(row, range.fromDate, range.toDate))
        .sort(compareRowsForExport);
      const summary = analyzeRows(rows);
      state.rows = rows;
      state.suspiciousRows = summary.suspiciousRows.slice().sort(compareRowsForExport);
      state.suspiciousIpRows = summary.suspiciousIpRows.slice().sort(compareRowsForExport);
      state.deviceProblemRows = summary.deviceProblemRows.slice().sort(compareRowsForExport);
      state.summary = {
        from: formatRuDate(range.fromDate),
        to: formatRuDate(range.toDate),
        totalRows: rows.length,
        suspiciousRows: state.suspiciousRows.length,
        suspiciousIpRows: state.suspiciousIpRows.length,
        deviceProblemRows: state.deviceProblemRows.length,
        trialRows: summary.trialRows.length,
        studentCount: summary.studentRows.length,
        riskyStudentCount: summary.riskyStudentCount,
        mainIp: summary.mainIp,
        mainIpCount: summary.mainIpCount,
        normalIps: summary.normalIps,
        ipCounts: summary.ipCounts,
        deviceCounts: summary.deviceCounts,
        studentRows: summary.studentRows
      };
      saveState();
      updateStat();
      log(`Готово: строк в периоде ${rows.length}, к проверке ${state.suspiciousRows.length}, студентов с риском ${summary.riskyStudentCount}.`, '#08775b');
      return state.rows;
    }catch(e){
      log('Ошибка: ' + e.message, '#c33');
      throw e;
    }finally{
      runState.running = false;
      uiBusy(false);
    }
  }

  function compareRowsForExport(a, b){
    return clean(a.ipaddress).localeCompare(clean(b.ipaddress))
      || clean(a.fullname).localeCompare(clean(b.fullname))
      || clean(a.group).localeCompare(clean(b.group))
      || clean(a.dateKey).localeCompare(clean(b.dateKey))
      || clean(a.testtime).localeCompare(clean(b.testtime))
      || Number(a.id || 0) - Number(b.id || 0);
  }

  function sleep(ms){
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function resultColumns(){
    return [
      ['flag', 'Флаг'],
      ['riskType', 'Тип риска'],
      ['reason', 'Причина'],
      ['ipReason', 'Причина IP'],
      ['deviceReason', 'Причина устройства'],
      ['isTrialTest', 'Пробный'],
      ['exemptReason', 'Не проверяли'],
      ['id', 'ID результата'],
      ['fullname', 'Студент'],
      ['group', 'Группа'],
      ['testtitle', 'Тест'],
      ['testdate', 'Дата теста'],
      ['testtime', 'Время'],
      ['ball', 'Балл'],
      ['attempt', 'Попытка'],
      ['ipaddress', 'IP'],
      ['deviceType', 'DeviceType'],
      ['deviceOs', 'OS'],
      ['deviceName', 'Device'],
      ['deviceinfo', 'Deviceinfo'],
      ['statustext', 'Статус текст'],
      ['facultyName', 'Факультет'],
      ['testtype', 'Тип теста'],
      ['testtypeRaw', 'Тип теста raw'],
      ['status', 'Статус'],
      ['iscanceled', 'Отменен'],
      ['isAppealed', 'Апелляция'],
      ['isViolated', 'Нарушение'],
      ['createddate', 'Created date'],
      ['modifieddate', 'Modified date'],
      ['userid', 'User ID'],
      ['testid', 'Test ID'],
      ['assignedtestid', 'Assigned Test ID'],
      ['dbselector', 'DB selector'],
      ['showresults', 'Show results'],
      ['appealCount', 'Appeal count'],
      ['appealsCount', 'Appeals count'],
      ['cancellationreason', 'Причина отмены'],
      ['comment', 'Комментарий'],
      ['testViewUrl', 'TestView'],
      ['reportProtocolUrl', 'ReportProtocol'],
      ['studentProtocolUrl', 'ProtokolStudent']
    ];
  }

  function matrixFromRows(rows){
    const columns = resultColumns();
    return [
      columns.map(col => col[1]),
      ...rows.map(row => columns.map(col => row[col[0]] ?? ''))
    ];
  }

  function summaryMatrix(){
    const summary = state.summary || {};
    return [
      ['Параметр', 'Значение'],
      ['Период', `${summary.from || state.dateFrom} - ${summary.to || state.dateTo}`],
      ['Всего строк в периоде', summary.totalRows || state.rows.length || 0],
      ['Всего строк к проверке', summary.suspiciousRows || state.suspiciousRows.length || 0],
      ['Из них странный IP', summary.suspiciousIpRows || state.suspiciousIpRows.length || 0],
      ['Из них проблемы устройства', summary.deviceProblemRows || state.deviceProblemRows.length || 0],
      ['Пробных строк не проверяли', summary.trialRows || 0],
      ['Студентов в периоде', summary.studentCount || 0],
      ['Студентов с риском', summary.riskyStudentCount || 0],
      ['Главный IP', summary.mainIp ? `${summary.mainIp} (${summary.mainIpCount || 0})` : ''],
      ['Нормальные IP', (summary.normalIps || []).join(', ')],
      ['Правило IP', 'подозрительно, если IP не входит в нормальные IP'],
      ['Правило устройства', 'подозрительно, если Deviceinfo/DeviceType пустой или OS не содержит Windows'],
      ['Исключение', 'тип теста Пробный не считается подозрительным'],
      ['Сайт', location.origin + location.pathname],
      ['Создано', new Date().toLocaleString()]
    ];
  }

  function studentMatrix(){
    const rows = (state.summary && state.summary.studentRows) || [];
    const headers = ['Риск', 'User ID', 'Студент', 'Группа', 'Всего тестов', 'Подозрительных', 'IP', 'Кол-во IP', 'Устройства', 'Тесты', 'Причины', 'Первая дата', 'Последняя дата'];
    return [
      headers,
      ...rows.map(row => [
        row.risk,
        row.userid,
        row.fullname,
        row.group,
        row.total,
        row.suspicious,
        row.ips,
        row.ipCount,
        row.devices,
        row.tests,
        row.reasons,
        row.firstDate,
        row.lastDate
      ])
    ];
  }

  function countMatrix(title, rows){
    return [
      [title, 'Кол-во'],
      ...rows.map(row => [row.value, row.count])
    ];
  }

  function recomputeCurrentRows(range){
    const rows = state.rows
      .filter(row => dateInRange(row, range.fromDate, range.toDate))
      .sort(compareRowsForExport);
    const summary = analyzeRows(rows);
    state.rows = rows;
    state.suspiciousRows = summary.suspiciousRows.slice().sort(compareRowsForExport);
    state.suspiciousIpRows = summary.suspiciousIpRows.slice().sort(compareRowsForExport);
    state.deviceProblemRows = summary.deviceProblemRows.slice().sort(compareRowsForExport);
    state.summary = {
      from: formatRuDate(range.fromDate),
      to: formatRuDate(range.toDate),
      totalRows: rows.length,
      suspiciousRows: state.suspiciousRows.length,
      suspiciousIpRows: state.suspiciousIpRows.length,
      deviceProblemRows: state.deviceProblemRows.length,
      trialRows: summary.trialRows.length,
      studentCount: summary.studentRows.length,
      riskyStudentCount: summary.riskyStudentCount,
      mainIp: summary.mainIp,
      mainIpCount: summary.mainIpCount,
      normalIps: summary.normalIps,
      ipCounts: summary.ipCounts,
      deviceCounts: summary.deviceCounts,
      studentRows: summary.studentRows
    };
    saveState();
    updateStat();
  }

  async function exportExcel(){
    readInputs();
    const range = readDateRange();
    const expectedFrom = formatRuDate(range.fromDate);
    const expectedTo = formatRuDate(range.toDate);
    if(!state.rows.length || !state.summary || state.summary.from !== expectedFrom || state.summary.to !== expectedTo){
      log('Сначала собираю строки, потом сразу сделаю Excel.');
      await collectRows();
    }else{
      recomputeCurrentRows(range);
    }
    if(!state.rows.length){
      log('В выбранном периоде нет строк для Excel.', '#b45309');
      return;
    }

    const excelJs = window.ExcelJS || globalThis.ExcelJS;
    if(excelJs){
      await exportStyledExcel(excelJs);
      return;
    }

    if(exportPlainExcel()){
      log('Excel скачан в простом режиме, потому что ExcelJS не загрузился.', '#b45309');
      return;
    }

    log('Библиотеки Excel не загрузились. Проверьте @require в Tampermonkey.', '#c33');
  }

  async function exportStyledExcel(ExcelJS){
    const wb = new ExcelJS.Workbook();
    wb.creator = 'EBilim TestResults risk exporter';
    wb.created = new Date();
    wb.modified = new Date();
    wb.views = [{ x: 0, y: 0, width: 16000, height: 9000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];

    const summary = wb.addWorksheet('Итог');
    summary.addRows(summaryMatrix());
    styleSummarySheet(summary);

    const suspicious = wb.addWorksheet('Подозрительные');
    suspicious.addRows(matrixFromRows(state.suspiciousRows));
    styleResultSheet(suspicious, true);

    const suspiciousIp = wb.addWorksheet('Странные IP');
    suspiciousIp.addRows(matrixFromRows(state.suspiciousIpRows));
    styleResultSheet(suspiciousIp, true);

    const deviceProblems = wb.addWorksheet('Проблемы устройств');
    deviceProblems.addRows(matrixFromRows(state.deviceProblemRows));
    styleResultSheet(deviceProblems, true);

    const all = wb.addWorksheet('Все тесты');
    all.addRows(matrixFromRows(state.rows));
    styleResultSheet(all, false);

    const students = wb.addWorksheet('Студенты');
    students.addRows(studentMatrix());
    styleStudentsSheet(students);

    const ipSheet = wb.addWorksheet('IP сводка');
    ipSheet.addRows(countMatrix('IP', (state.summary && state.summary.ipCounts) || []));
    styleCountSheet(ipSheet);

    const deviceSheet = wb.addWorksheet('Устройства');
    deviceSheet.addRows(countMatrix('OS / устройство', (state.summary && state.summary.deviceCounts) || []));
    styleCountSheet(deviceSheet);

    const buffer = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }), workbookFileName());
    log('Excel скачан: Подозрительные, Странные IP, Проблемы устройств, Все тесты, Студенты, IP сводка, Устройства.', '#08775b');
  }

  function exportPlainExcel(){
    const xlsx = window.XLSX || globalThis.XLSX;
    if(!xlsx) return false;
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(summaryMatrix()), 'Итог');
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(matrixFromRows(state.suspiciousRows)), 'Подозрительные');
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(matrixFromRows(state.suspiciousIpRows)), 'Странные IP');
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(matrixFromRows(state.deviceProblemRows)), 'Проблемы устройств');
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(matrixFromRows(state.rows)), 'Все тесты');
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(studentMatrix()), 'Студенты');
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(countMatrix('IP', (state.summary && state.summary.ipCounts) || [])), 'IP сводка');
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(countMatrix('OS / устройство', (state.summary && state.summary.deviceCounts) || [])), 'Устройства');
    xlsx.writeFile(wb, workbookFileName());
    return true;
  }

  function workbookFileName(){
    const from = parseUserDate(state.dateFrom);
    const to = parseUserDate(state.dateTo);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `test-results-risk-${from ? dateKey(from) : 'from'}_${to ? dateKey(to) : 'to'}-${stamp}.xlsx`;
  }

  function downloadBlob(blob, fileName){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function styleSummarySheet(ws){
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.properties.defaultRowHeight = 18;
    ws.getRow(1).height = 24;
    ws.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.eachRow((row, rowNumber) => {
      row.eachCell({ includeEmpty: true }, cell => {
        cell.border = thinBorder();
        cell.alignment = { vertical: 'top', wrapText: true };
        if(rowNumber > 1 && rowNumber % 2 === 0){
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
      });
    });
    ws.getColumn(1).width = 28;
    ws.getColumn(2).width = 68;
  }

  function styleResultSheet(ws, suspiciousSheet){
    const colCount = Math.max(1, ws.columnCount || resultColumns().length);
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colCount } };
    ws.properties.defaultRowHeight = 18;
    ws.getRow(1).height = 32;
    ws.getRow(1).eachCell({ includeEmpty: true }, cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: suspiciousSheet ? 'FF9C4221' : 'FF1F4E78' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = thinBorder('FFB7C9D6');
    });

    const riskTypeCol = 2;
    const reasonCol = 3;
    const ipReasonCol = 4;
    const deviceReasonCol = 5;
    const ipCol = 16;
    const deviceCol = 20;
    for(let rowNumber = 2; rowNumber <= ws.rowCount; rowNumber++){
      const row = ws.getRow(rowNumber);
      const hasReason = !!clean(row.getCell(reasonCol).value);
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.border = thinBorder();
        cell.alignment = { vertical: 'top', wrapText: true };
        if(hasReason){
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: suspiciousSheet ? 'FFFFF2CC' : 'FFFFFBEB' } };
        }else if(rowNumber % 2 === 0){
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
        if(hasReason && (colNumber === riskTypeCol || colNumber === reasonCol || colNumber === ipReasonCol || colNumber === deviceReasonCol || colNumber === ipCol || colNumber === deviceCol)){
          cell.font = { bold: true, color: { argb: 'FF9C0006' } };
        }
      });
    }
    setColumnWidths(ws, [14, 18, 28, 24, 28, 10, 18, 13, 26, 14, 42, 13, 9, 10, 9, 18, 15, 22, 16, 48, 14, 16, 14, 12, 10, 10, 10, 11, 24, 24, 12, 12, 17, 11, 12, 13, 13, 28, 26, 42, 44, 44]);
  }

  function styleStudentsSheet(ws){
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount || 13 } };
    styleHeaderRow(ws.getRow(1), 'FF305496');
    for(let rowNumber = 2; rowNumber <= ws.rowCount; rowNumber++){
      const row = ws.getRow(rowNumber);
      const risky = clean(row.getCell(1).value).toLowerCase() === 'yes';
      row.eachCell({ includeEmpty: true }, cell => {
        cell.border = thinBorder();
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: risky ? 'FFFFF2CC' : (rowNumber % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF') } };
      });
    }
    setColumnWidths(ws, [9, 10, 28, 16, 12, 16, 32, 10, 48, 54, 28, 13, 13]);
  }

  function styleCountSheet(ws){
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 2 } };
    styleHeaderRow(ws.getRow(1), 'FF305496');
    ws.eachRow((row, rowNumber) => {
      if(rowNumber === 1) return;
      row.eachCell({ includeEmpty: true }, cell => {
        cell.border = thinBorder();
        cell.alignment = { vertical: 'top', wrapText: true };
        if(rowNumber % 2 === 0){
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        }
      });
    });
    setColumnWidths(ws, [42, 12]);
  }

  function styleHeaderRow(row, argb){
    row.height = 28;
    row.eachCell({ includeEmpty: true }, cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = thinBorder('FFB7C9D6');
    });
  }

  function setColumnWidths(ws, widths){
    widths.forEach((width, index) => {
      ws.getColumn(index + 1).width = width;
    });
  }

  function thinBorder(color = 'FFD9E2F3'){
    return {
      top: { style: 'thin', color: { argb: color } },
      left: { style: 'thin', color: { argb: color } },
      bottom: { style: 'thin', color: { argb: color } },
      right: { style: 'thin', color: { argb: color } }
    };
  }

  function uiBusy(busy){
    if(!panel) return;
    panel.querySelectorAll('button,input,textarea').forEach(el => {
      if(el.id === 'tr-stop') el.disabled = !busy;
      else el.disabled = busy;
    });
  }

  function installStyles(){
    if(document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID}{position:fixed;right:12px;top:12px;z-index:2147483646;width:560px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;background:#fff;border:1px solid #64748b;border-radius:8px;box-shadow:0 10px 30px rgba(15,23,42,.28);font:13px/1.35 Segoe UI,Arial,sans-serif;color:#1f2937;padding:10px}
      #${PANEL_ID} *{box-sizing:border-box}
      #${PANEL_ID} button,#${PANEL_ID} input,#${PANEL_ID} textarea{font:inherit}
      #${PANEL_ID} button{cursor:pointer;border:0;border-radius:5px;padding:7px 9px;background:#e5e7eb;color:#111827}
      #${PANEL_ID} button.tr-primary{background:#08775b;color:#fff}
      #${PANEL_ID} button.tr-blue{background:#2563eb;color:#fff}
      #${PANEL_ID} button.tr-red{background:#b91c1c;color:#fff}
      #${PANEL_ID} button:disabled,#${PANEL_ID} input:disabled,#${PANEL_ID} textarea:disabled{opacity:.62;cursor:not-allowed}
      #${PANEL_ID} input,#${PANEL_ID} textarea{width:100%;border:1px solid #cbd5e1;border-radius:5px;padding:6px;background:#fff;color:#111827}
      #${PANEL_ID} input[type="checkbox"]{width:auto;padding:0}
      #${PANEL_ID} label{display:block}
      #${PANEL_ID} .tr-header{display:flex;justify-content:space-between;align-items:center;font-weight:700;margin-bottom:8px}
      #${PANEL_ID} .tr-header button{padding:2px 8px}
      #${PANEL_ID} .tr-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      #${PANEL_ID} .tr-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
      #${PANEL_ID} .tr-row{display:flex;gap:6px;align-items:center;margin:7px 0;flex-wrap:wrap}
      #${PANEL_ID} .tr-row button{flex:1}
      #${PANEL_ID} .tr-section{border-top:1px solid #e5e7eb;padding-top:8px;margin-top:8px}
      #${PANEL_ID} .tr-section-title{font-weight:700;margin-bottom:5px}
      #${PANEL_ID} .tr-muted{color:#6b7280;font-size:12px}
      #${PANEL_ID} .tr-check{display:flex;gap:6px;align-items:center;margin:6px 0}
      #${PANEL_ID} .tr-log{height:170px;overflow:auto;background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;padding:6px;white-space:pre-wrap}
      #${PANEL_ID} small{display:block;color:#6b7280;font-size:11px;margin-top:2px}
    `;
    document.head.appendChild(style);
  }

  function buildPanel(){
    if(document.getElementById(PANEL_ID)) return;
    installStyles();
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="tr-header">
        <span>TestResults IP/device Excel</span>
        <button id="tr-close" type="button" title="Закрыть">x</button>
      </div>
      <div id="tr-stat" class="tr-muted"></div>

      <div class="tr-section">
        <div class="tr-section-title">Период</div>
        <div class="tr-grid">
          <label>Начало<input id="tr-date-from" type="text" placeholder="16.05.2026"></label>
          <label>Конец<input id="tr-date-to" type="text" placeholder="17.06.2026"></label>
        </div>
        <div class="tr-row">
          <button id="tr-today" type="button">Сегодня</button>
          <button id="tr-clear-cache" type="button">Очистить результат</button>
        </div>
      </div>

      <div class="tr-section">
        <div class="tr-section-title">Правила проверки</div>
        <small>Тип теста «Пробный» не считается подозрительным и не попадает в риск-листы.</small>
        <label class="tr-check"><input id="tr-auto-ip" type="checkbox"> Авто: нормальный IP = самый частый IP в периоде</label>
        <label>Доп. нормальные IP через запятую
          <textarea id="tr-normal-ips" rows="2" placeholder="213.145.158.66, 10.0.0.5"></textarea>
          <small>Пустой DeviceType при нормальном IP не считается риском. Если IP неизвестный, строка попадет в «Странные IP» и общий лист «Подозрительные».</small>
        </label>
      </div>

      <div class="tr-section">
        <div class="tr-section-title">Сбор данных</div>
        <label class="tr-check"><input id="tr-server-filter" type="checkbox"> Пробовать серверный фильтр по дате</label>
        <small>Если сайт принимает фильтр, сбор быстрее. Если нет, скрипт сам отфильтрует даты после загрузки.</small>
        <div class="tr-grid-3">
          <label>Строк за запрос<input id="tr-page-size" type="number" min="20" max="1000" step="20"><small>Обычно 200. Сколько строк брать с сайта за один запрос.</small></label>
          <label>Лимит сбора<input id="tr-max-rows" type="number" min="100" max="200000" step="100"><small>Защита от бесконечного сбора. Обычно не трогать.</small></label>
          <label>Стоп после старых страниц<input id="tr-old-pages" type="number" min="1" max="50"><small>Если сайт не фильтрует дату, остановиться после N страниц старше начала.</small></label>
        </div>
        <div class="tr-row">
          <button id="tr-collect" class="tr-blue" type="button">Собрать</button>
          <button id="tr-export" class="tr-primary" type="button">Скачать Excel</button>
          <button id="tr-stop" class="tr-red" type="button" disabled>Стоп</button>
        </div>
        <div id="tr-log" class="tr-log"></div>
      </div>`;

    document.body.appendChild(panel);
    logEl = panel.querySelector('#tr-log');
    statEl = panel.querySelector('#tr-stat');
    renderInputs();
    wireEvents();
    makeDraggable();
    applyPanelPosition();
    updateStat();
  }

  function wireEvents(){
    panel.querySelector('#tr-close').onclick = () => panel.remove();
    panel.querySelector('#tr-today').onclick = setToday;
    panel.querySelector('#tr-clear-cache').onclick = () => {
      state.rows = [];
      state.suspiciousRows = [];
      state.suspiciousIpRows = [];
      state.deviceProblemRows = [];
      state.summary = null;
      saveState();
      clearLog();
      updateStat();
      log('Результат очищен.');
    };
    panel.querySelector('#tr-collect').onclick = () => {
      collectRows().catch(() => {});
    };
    panel.querySelector('#tr-export').onclick = () => {
      exportExcel().catch(e => log('Excel ошибка: ' + e.message, '#c33'));
    };
    panel.querySelector('#tr-stop').onclick = () => {
      runState.stop = true;
      log('Остановка запрошена.', '#b91c1c');
    };

    ['tr-date-from', 'tr-date-to', 'tr-page-size', 'tr-max-rows', 'tr-old-pages', 'tr-normal-ips'].forEach(id => {
      panel.querySelector('#' + id).addEventListener('input', () => {
        readInputs();
        updateStat();
      });
    });
    ['tr-server-filter', 'tr-auto-ip'].forEach(id => {
      panel.querySelector('#' + id).addEventListener('change', () => {
        readInputs();
        updateStat();
      });
    });
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
    const header = panel.querySelector('.tr-header');
    let drag = null;
    header.addEventListener('pointerdown', event => {
      if(event.target.closest('button,input,textarea')) return;
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

  function ready(fn){
    if(document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  ready(buildPanel);
})();
