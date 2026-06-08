// ==UserScript==
// @name         Dekanat route scanner
// @namespace    local.dekanat.route-scanner
// @version      1.1
// @description  Records clicks, form changes, navigation, and network requests to map Dekanat group/subject workflows.
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(function(){
  'use strict';
  if(window.top !== window.self) return;

  const KEY_ACTIVE = 'drs_active_v1';
  const KEY_LOG = 'drs_log_v1';
  const PANEL_ID = 'drs-panel';
  const MAX_LOGS = 1200;
  const MAX_TEXT = 1800;

  let panel, logEl, statusEl, toggleEl;

  const now = () => new Date().toISOString().replace('T', ' ').replace('Z', '');
  const isActive = () => localStorage.getItem(KEY_ACTIVE) !== '0';
  const setActive = value => localStorage.setItem(KEY_ACTIVE, value ? '1' : '0');
  const short = (value, max = MAX_TEXT) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

  function loadLogs(){
    try{
      const logs = JSON.parse(localStorage.getItem(KEY_LOG) || '[]');
      return Array.isArray(logs) ? logs : [];
    }catch(e){
      return [];
    }
  }

  function saveLogs(logs){
    localStorage.setItem(KEY_LOG, JSON.stringify(logs.slice(-MAX_LOGS)));
  }

  function pushLog(type, message, meta){
    if(!isActive() && type !== 'system') return;
    const logs = loadLogs();
    logs.push({
      t: now(),
      page: location.href,
      type,
      message: short(message),
      meta: meta == null ? '' : short(typeof meta === 'string' ? meta : JSON.stringify(meta))
    });
    saveLogs(logs);
    renderLogs();
  }

  function formatEntry(entry){
    const meta = entry.meta ? ' ' + entry.meta : '';
    return `[${entry.t}] ${entry.type}: ${entry.message}${meta}`;
  }

  function dataPreview(data){
    try{
      if(data == null) return '';
      if(typeof data === 'string') return short(data);
      if(data instanceof URLSearchParams) return short(data.toString());
      if(data instanceof FormData){
        const pairs = [];
        data.forEach((v, k) => pairs.push(k + '=' + short(v, 220)));
        return short(pairs.join('&'));
      }
      return short(JSON.stringify(data));
    }catch(e){
      return short(String(data));
    }
  }

  function elementLabel(el){
    if(!el || el.nodeType !== 1) return '';
    const parts = [el.tagName.toLowerCase()];
    if(el.id) parts.push('#' + el.id);
    const name = el.getAttribute('name');
    if(name) parts.push(`[name="${name}"]`);
    const role = el.getAttribute('role');
    if(role) parts.push(`[role="${role}"]`);
    const href = el.getAttribute('href');
    if(href) parts.push(`[href="${short(href, 220)}"]`);
    const aria = el.getAttribute('aria-label');
    if(aria) parts.push(`[aria-label="${short(aria, 140)}"]`);
    const title = el.getAttribute('title');
    if(title) parts.push(`[title="${short(title, 140)}"]`);
    const text = short(el.innerText || el.value || '', 180);
    return parts.join('') + (text ? ` text="${text}"` : '');
  }

  function closestInteresting(el){
    if(!el || el.nodeType !== 1) return el;
    return el.closest('a,button,input,select,textarea,[role="button"],[role="gridcell"],[role="columnheader"],.dx-item,.dx-row,.dx-datagrid') || el;
  }

  function selectedOptionText(el){
    if(!el || el.tagName !== 'SELECT') return '';
    const opt = el.options[el.selectedIndex];
    return opt ? short(opt.textContent, 220) : '';
  }

  function snapshotPage(){
    const inputs = [...document.querySelectorAll('input,select,textarea')]
      .filter(el => {
        const id = `${el.name || ''} ${el.id || ''}`.toLowerCase();
        return /group|discipline|subject|predmet|load|potok|ved|exam|year|sem|plan|rules|kredit|id/i.test(id);
      })
      .slice(0, 160)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        name: el.name || '',
        value: el.value || '',
        text: selectedOptionText(el)
      }));

    let gridInfo = [];
    try{
      const jq = window.jQuery || window.$;
      if(jq && jq('#gridContainer').length && jq('#gridContainer').dxDataGrid){
        const grid = jq('#gridContainer').dxDataGrid('instance');
        const cols = grid && grid.getVisibleColumns ? grid.getVisibleColumns() : [];
        const rows = grid && grid.getVisibleRows ? grid.getVisibleRows() : [];
        gridInfo = [{
          selector: '#gridContainer',
          columns: cols.map(c => c.caption || c.dataField).filter(Boolean),
          rows: rows.length
        }];
      }
    }catch(e){}

    const links = [...document.querySelectorAll('a[href]')]
      .filter(a => /Dekanat|Journal|Jurnal|Ved|Group|Discipline|Load|Subject|Predmet|Оцен|Ведом/i.test(`${a.href} ${a.textContent}`))
      .slice(0, 80)
      .map(a => ({ text: short(a.textContent, 160), href: a.href }));

    pushLog('snapshot', 'page state', { title: document.title, inputs, gridInfo, links });
  }

  function patchFetch(){
    if(!window.fetch || window.fetch._drsScanner) return;
    const originalFetch = window.fetch;
    const wrappedFetch = function(input, init){
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = (init && init.method) || 'GET';
      pushLog('fetch->', `${method} ${url}`, dataPreview(init && init.body));
      return originalFetch.apply(this, arguments).then(res => {
        pushLog('fetch<-', `${res.status} ${url}`);
        return res;
      });
    };
    wrappedFetch._drsScanner = true;
    window.fetch = wrappedFetch;
  }

  function patchXhr(){
    if(!window.XMLHttpRequest || window.XMLHttpRequest.prototype.open._drsScanner) return;
    const originalOpen = window.XMLHttpRequest.prototype.open;
    const originalSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function(method, url){
      this._drsMethod = method;
      this._drsUrl = url;
      return originalOpen.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.open._drsScanner = true;
    window.XMLHttpRequest.prototype.send = function(body){
      const method = this._drsMethod || 'GET';
      const url = this._drsUrl || '';
      pushLog('xhr->', `${method} ${url}`, dataPreview(body));
      this.addEventListener('loadend', () => {
        pushLog('xhr<-', `${this.status} ${url}`, short(this.responseText, 900));
      });
      return originalSend.apply(this, arguments);
    };
  }

  function patchAjax(){
    const jq = window.jQuery || window.$;
    if(!jq || typeof jq.ajax !== 'function' || jq.ajax._drsScanner) return;
    const originalAjax = jq.ajax;
    const wrappedAjax = function(urlOrOptions, maybeOptions){
      const opts = typeof urlOrOptions === 'string'
        ? { ...(maybeOptions || {}), url: urlOrOptions }
        : { ...(urlOrOptions || {}) };
      const method = opts.type || opts.method || 'GET';
      const url = opts.url || '';
      pushLog('ajax->', `${method} ${url}`, dataPreview(opts.data));

      const originalSuccess = opts.success;
      const originalError = opts.error;
      opts.success = function(data, textStatus, xhr){
        pushLog('ajax<-', `${xhr && xhr.status} ${url}`, dataPreview(data));
        if(originalSuccess) return originalSuccess.apply(this, arguments);
      };
      opts.error = function(xhr){
        pushLog('ajaxERR', `${xhr && xhr.status} ${url}`, short(xhr && xhr.responseText, 900));
        if(originalError) return originalError.apply(this, arguments);
      };

      return typeof urlOrOptions === 'string'
        ? originalAjax.call(this, opts.url, opts)
        : originalAjax.call(this, opts);
    };
    wrappedAjax._drsScanner = true;
    jq.ajax = wrappedAjax;
  }

  function patchHistory(){
    if(history.pushState._drsScanner) return;
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    history.pushState = function(){
      const result = originalPush.apply(this, arguments);
      pushLog('nav', 'history.pushState', location.href);
      setTimeout(snapshotPage, 300);
      return result;
    };
    history.pushState._drsScanner = true;
    history.replaceState = function(){
      const result = originalReplace.apply(this, arguments);
      pushLog('nav', 'history.replaceState', location.href);
      setTimeout(snapshotPage, 300);
      return result;
    };
    window.addEventListener('popstate', () => {
      pushLog('nav', 'popstate', location.href);
      setTimeout(snapshotPage, 300);
    });
  }

  patchFetch();
  patchXhr();
  patchHistory();
  const ajaxTimer = setInterval(patchAjax, 500);

  document.addEventListener('click', event => {
    pushLog('click', elementLabel(closestInteresting(event.target)));
  }, true);

  document.addEventListener('change', event => {
    const el = event.target;
    pushLog('change', elementLabel(el), {
      value: el && el.value,
      optionText: selectedOptionText(el)
    });
    setTimeout(snapshotPage, 300);
  }, true);

  document.addEventListener('input', event => {
    const el = event.target;
    if(el && /input|textarea|select/i.test(el.tagName || '')){
      pushLog('input', elementLabel(el), { value: el.value });
    }
  }, true);

  document.addEventListener('submit', event => {
    const form = event.target;
    const fd = new FormData(form);
    pushLog('submit', elementLabel(form), dataPreview(fd));
  }, true);

  window.addEventListener('beforeunload', () => pushLog('nav', 'beforeunload', location.href));
  window.addEventListener('load', () => {
    pushLog('nav', 'load', location.href);
    setTimeout(snapshotPage, 700);
  });

  function renderLogs(){
    if(!logEl) return;
    const logs = loadLogs();
    logEl.textContent = logs.slice(-260).map(formatEntry).join('\n');
    logEl.scrollTop = logEl.scrollHeight;
    if(statusEl){
      statusEl.textContent = `${isActive() ? 'ON' : 'OFF'} | ${logs.length} записей | ${location.pathname}`;
    }
    if(toggleEl){
      toggleEl.textContent = isActive() ? 'Скан: ON' : 'Скан: OFF';
      toggleEl.style.background = isActive() ? '#c60' : '#555';
    }
  }

  function copyLogs(){
    const text = loadLogs().map(formatEntry).join('\n');
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(() => {
        pushLog('system', 'log copied');
      });
    }else{
      prompt('Copy log', text);
    }
  }

  function clearLogs(){
    localStorage.removeItem(KEY_LOG);
    pushLog('system', 'log cleared');
    renderLogs();
  }

  function toggle(){
    setActive(!isActive());
    pushLog('system', isActive() ? 'scanner enabled' : 'scanner disabled');
    if(isActive()) snapshotPage();
    renderLogs();
  }

  function buildPanel(){
    if(document.getElementById(PANEL_ID)) return;
    const root = document.body || document.documentElement;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed',
      'left:12px',
      'bottom:12px',
      'z-index:2147483647',
      'width:460px',
      'max-width:calc(100vw - 24px)',
      'background:#fff',
      'border:1px solid #777',
      'border-radius:8px',
      'box-shadow:0 4px 18px rgba(0,0,0,.25)',
      'font:12px/1.35 Segoe UI,Arial,sans-serif',
      'color:#222',
      'padding:10px'
    ].join(';');

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;font-weight:bold;margin-bottom:6px">
        <span>Dekanat route scanner</span>
        <button id="drs-close" style="border:0;background:#eee;border-radius:4px;padding:2px 7px;cursor:pointer">x</button>
      </div>
      <div id="drs-status" style="color:#06c;margin-bottom:6px"></div>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <button id="drs-toggle" style="flex:1;padding:6px;background:#c60;color:#fff;border:0;border-radius:5px;cursor:pointer">Скан: ON</button>
        <button id="drs-snapshot" style="flex:1;padding:6px;background:#36c;color:#fff;border:0;border-radius:5px;cursor:pointer">Снимок</button>
        <button id="drs-copy" style="flex:1;padding:6px;background:#555;color:#fff;border:0;border-radius:5px;cursor:pointer">Копия</button>
        <button id="drs-clear" style="flex:1;padding:6px;background:#c33;color:#fff;border:0;border-radius:5px;cursor:pointer">Очистить</button>
      </div>
      <div style="font-size:11px;color:#666;margin-bottom:6px">
        Включи сканер, затем вручную пройди маршрут: предмет -> группа -> ведомость. Лог сохраняется между страницами.
      </div>
      <pre id="drs-log" style="height:260px;overflow:auto;white-space:pre-wrap;background:#f7f7f7;border:1px solid #ddd;border-radius:5px;padding:6px;margin:0"></pre>`;

    root.appendChild(panel);
    logEl = panel.querySelector('#drs-log');
    statusEl = panel.querySelector('#drs-status');
    toggleEl = panel.querySelector('#drs-toggle');
    toggleEl.onclick = toggle;
    panel.querySelector('#drs-snapshot').onclick = snapshotPage;
    panel.querySelector('#drs-copy').onclick = copyLogs;
    panel.querySelector('#drs-clear').onclick = clearLogs;
    panel.querySelector('#drs-close').onclick = () => panel.remove();
    renderLogs();
  }

  function ready(fn){
    if(document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  ready(() => {
    buildPanel();
    if(isActive()){
      pushLog('nav', 'panel ready', location.href);
      setTimeout(snapshotPage, 500);
    }
  });
})();
