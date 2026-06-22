// ==UserScript==
// @name         EBilim TeachersRating grant teacher upload access
// @namespace    local.ebilim.teachers-rating.access
// @version      1.0.0
// @description  Mini tool: only enables "Дать доступ преподавателям к загрузке" (IsVisible=true) for TeachersRating criteria.
// @match        https://ebilim.jaiu.edu.kg/TeachersRating/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function(){
  'use strict';
  if(window.top !== window.self) return;

  const PANEL_ID = 'tr-access-granter-panel';
  const LIST_URL = '/TeachersRating/Subparagraphs';
  const EDIT_TOKEN = 'AddOrEditSubpar';
  const POST_URL = '/TeachersRating/AddOrEditSubparagraphs';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  let panel, logEl, statEl, reportEl;
  const runState = { running: false, stop: false };

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }
  function norm(value){
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function noCacheUrl(url){
    const u = new URL(url, location.origin);
    u.searchParams.set('_trag', String(Date.now()));
    return u.pathname + u.search;
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

  async function fetchText(url, options = {}){
    const method = String(options.method || 'GET').toUpperCase();
    const target = method === 'GET' ? noCacheUrl(url) : url;
    const res = await fetch(target, { credentials: 'same-origin', redirect: 'follow', ...options });
    const text = await res.text();
    if(!res.ok) throw new Error(url + ': HTTP ' + res.status + ' ' + text.slice(0, 180));
    return text;
  }
  async function fetchForm(url){
    const html = await fetchText(url);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = [...doc.querySelectorAll('form')]
      .find(f => f.querySelector('[name="SubparagraphsID"]'))
      || doc.querySelector('form');
    if(!form) throw new Error(url + ': форма критерия не найдена');
    return { html, doc, form };
  }
  function formBody(fd){
    const body = new URLSearchParams();
    for(const [key, value] of fd.entries()){
      if(value instanceof File) continue;
      body.append(key, value);
    }
    return body;
  }
  function absUrl(action, baseUrl){
    try{
      const url = new URL(action || '', new URL(baseUrl || location.pathname, location.origin));
      return url.pathname + url.search;
    }catch(e){
      return action || '';
    }
  }
  async function postForm(form, baseUrl, fd){
    const actions = [];
    const formAction = absUrl(form.getAttribute('action') || '', baseUrl);
    if(formAction) actions.push(formAction);
    if(!actions.includes(POST_URL)) actions.push(POST_URL);
    let last = null;
    for(const action of actions){
      const res = await fetch(action, {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'follow',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: formBody(fd)
      });
      const text = await res.text();
      last = { ok: res.ok, status: res.status, text };
      if(res.ok) return text;
      log('  POST ' + action + ' -> HTTP ' + res.status, '#c60');
    }
    throw new Error('POST не прошел (HTTP ' + (last ? last.status : '?') + ')');
  }

  function extractEditUrls(source){
    const direct = source.match(new RegExp('(/TeachersRating/' + EDIT_TOKEN + '/\\d+)', 'g')) || [];
    const query = source.match(new RegExp('(/TeachersRating/' + EDIT_TOKEN + "\\?[^\\s\"'<>]+)", 'g')) || [];
    const urls = [...direct];
    query.forEach(url => {
      if(/[?&](id|ID)=\d+/.test(url)) urls.push(url);
    });
    return [...new Set(urls)].sort((a, b) => {
      const ai = Number((a.match(/\d+/g) || ['0']).pop());
      const bi = Number((b.match(/\d+/g) || ['0']).pop());
      return ai - bi;
    });
  }
  async function loadCriterionUrls(){
    const listHtml = await fetchText(LIST_URL);
    let urls = extractEditUrls(listHtml);
    if(!urls.length) urls = extractEditUrls(document.documentElement.outerHTML);
    if(!urls.length) throw new Error('Не нашел ссылки редактирования критериев на странице');
    return urls;
  }

  function valuesFromForm(form){
    const values = {};
    form.querySelectorAll('input,select,textarea').forEach(el => {
      const name = el.getAttribute('name');
      if(!name || el.disabled) return;
      const type = (el.type || '').toLowerCase();
      if(type === 'file') return;
      if(type === 'checkbox' || type === 'radio'){
        if(el.checked || el.hasAttribute('checked')) values[name] = el.getAttribute('value') || 'true';
        return;
      }
      if(type === 'hidden' && Object.prototype.hasOwnProperty.call(values, name)) return;
      if(el.tagName === 'SELECT'){
        const option = el.querySelector('option[selected]') || el.options[el.selectedIndex] || el.options[0];
        values[name] = option ? option.value : '';
        return;
      }
      values[name] = el.value != null ? el.value : (el.getAttribute('value') || '');
    });
    return values;
  }
  function criterionSummary(form, url){
    const values = valuesFromForm(form);
    const id = values.SubparagraphsID || (url.match(/\/(\d+)(?:\?|$)/) || [])[1] || '';
    let ru = values['LocalizationText[0].Text'] || values.Text || values.Title || '';
    Object.keys(values).forEach(key => {
      const cultureMatch = key.match(/^LocalizationText\[(\d+)\]\.CultureID$/);
      if(cultureMatch && String(values[key]) === '1049'){
        ru = values[`LocalizationText[${cultureMatch[1]}].Text`] || ru;
      }
    });
    const visibleRaw = String(values.IsVisible ?? '').toLowerCase();
    return {
      id,
      title: norm(ru).slice(0, 130),
      visible: visibleRaw === 'true' || visibleRaw === '1' || visibleRaw === 'on'
    };
  }
  async function setVisibleTrue(url){
    const { form } = await fetchForm(url);
    const before = criterionSummary(form, url);
    if(before.visible) return { status: 'skipped', before };

    const fd = new FormData(form);
    if(before.id) fd.set('SubparagraphsID', String(before.id));
    fd.delete('IsVisible');
    fd.append('IsVisible', 'true');
    await postForm(form, url, fd);
    await sleep(160);

    const { form: afterForm } = await fetchForm(url);
    const after = criterionSummary(afterForm, url);
    if(!after.visible) throw new Error('сервер не подтвердил IsVisible=true для #' + before.id);
    return { status: 'updated', before, after };
  }

  async function auditAccess(){
    if(runState.running) return;
    runState.running = true;
    runState.stop = false;
    uiBusy(true);
    logEl.innerHTML = '';
    const report = [];
    let enabled = 0, disabled = 0, errors = 0;
    try{
      setStat('Читаю список критериев...');
      const urls = await loadCriterionUrls();
      log('Найдено критериев/форм: ' + urls.length, '#06c');
      for(let i = 0; i < urls.length; i++){
        if(runState.stop) break;
        const url = urls[i];
        try{
          setStat('Проверка доступа ' + (i + 1) + '/' + urls.length);
          const { form } = await fetchForm(url);
          const item = criterionSummary(form, url);
          if(item.visible) enabled++;
          else{
            disabled++;
            report.push('НЕТ ДОСТУПА #' + item.id + ': ' + item.title);
            log('НЕТ ДОСТУПА #' + item.id + ': ' + item.title.slice(0, 90), '#c60');
          }
        }catch(e){
          errors++;
          report.push('ОШИБКА ' + url + ': ' + e.message);
          log('ОШИБКА ' + url + ': ' + e.message, '#c33');
        }
        await sleep(60);
      }
      const summary = 'Проверка доступа: включено ' + enabled + ', выключено ' + disabled + ', ошибок ' + errors;
      report.push('');
      report.push(summary);
      log(summary, errors || disabled ? '#c60' : '#0a0');
      setReport(report);
      setStat(runState.stop ? 'Остановлено' : 'Проверка готова');
    }catch(e){
      log('ОШИБКА проверки: ' + e.message, '#c33');
      setStat('Ошибка проверки');
    }finally{
      runState.running = false;
      uiBusy(false);
    }
  }

  async function grantAccess(){
    if(runState.running) return;
    if(!confirm('Мини-программа включит IsVisible=true для всех найденных критериев TeachersRating. Она не меняет категории, подкатегории, тексты, баллы и документы. Продолжить?')) return;
    runState.running = true;
    runState.stop = false;
    uiBusy(true);
    logEl.innerHTML = '';
    const report = [];
    let updated = 0, skipped = 0, errors = 0;
    try{
      setStat('Читаю список критериев...');
      const urls = await loadCriterionUrls();
      log('Найдено критериев/форм: ' + urls.length, '#06c');
      for(let i = 0; i < urls.length; i++){
        if(runState.stop) break;
        const url = urls[i];
        try{
          setStat('Включаю доступ ' + (i + 1) + '/' + urls.length);
          const result = await setVisibleTrue(url);
          const item = result.after || result.before;
          if(result.status === 'updated'){
            updated++;
            log('ВКЛЮЧЕНО #' + item.id + ': ' + item.title.slice(0, 90), '#0a0');
          }else{
            skipped++;
          }
        }catch(e){
          errors++;
          report.push('ОШИБКА ' + url + ': ' + e.message);
          log('ОШИБКА ' + url + ': ' + e.message, '#c33');
        }
        await sleep(120);
      }
      const summary = 'Доступ преподавателям: включено ' + updated + ', уже было включено ' + skipped + ', ошибок ' + errors;
      report.push('');
      report.push(summary);
      log(summary, errors ? '#c60' : '#0a0');
      setReport(report);
      setStat(runState.stop ? 'Остановлено' : 'Готово');
    }catch(e){
      log('ОШИБКА включения доступа: ' + e.message, '#c33');
      setStat('Ошибка включения доступа');
    }finally{
      runState.running = false;
      uiBusy(false);
    }
  }

  function uiBusy(busy){
    ['trag-audit', 'trag-grant'].forEach(id => {
      const el = panel && panel.querySelector('#' + id);
      if(el) el.disabled = busy;
    });
    const stop = panel && panel.querySelector('#trag-stop');
    if(stop) stop.disabled = !busy;
  }
  function buildPanel(){
    if(document.getElementById(PANEL_ID)) return;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed', 'top:12px', 'left:12px', 'z-index:2147483647', 'width:420px',
      'background:#fff', 'border:1px solid #666', 'border-radius:8px',
      'box-shadow:0 4px 16px rgba(0,0,0,.22)', 'font:13px/1.4 Segoe UI,Arial,sans-serif',
      'color:#222', 'padding:10px'
    ].join(';');
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;font-weight:bold;margin-bottom:6px">
        <span>TeachersRating access mini v1.0.0</span>
        <button id="trag-close" title="Закрыть" style="border:0;background:#eee;border-radius:4px;padding:2px 7px;cursor:pointer">x</button>
      </div>
      <div style="font-size:12px;color:#555;margin-bottom:8px">
        Меняет только поле IsVisible: «Дать доступ преподавателям к загрузке».
      </div>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <button id="trag-audit" style="flex:1;padding:7px;background:#36c;color:#fff;border:0;border-radius:5px;cursor:pointer">Проверить доступ</button>
        <button id="trag-grant" style="flex:1;padding:7px;background:#0a7;color:#fff;border:0;border-radius:5px;cursor:pointer">Включить всем</button>
        <button id="trag-stop" style="flex:1;padding:7px;background:#c33;color:#fff;border:0;border-radius:5px;cursor:pointer" disabled>Стоп</button>
      </div>
      <div id="trag-stat" style="font-weight:bold;margin:6px 0"></div>
      <div id="trag-log" style="height:220px;overflow:auto;background:#f7f7f7;border:1px solid #ddd;border-radius:5px;padding:6px;font-size:12px"></div>
      <div style="font-size:11px;color:#777;margin:6px 0 2px">Отчет:</div>
      <textarea id="trag-report" style="width:100%;height:76px;font:11px/1.35 Consolas,monospace;border:1px solid #ddd;border-radius:5px;padding:5px" readonly></textarea>`;
    document.body.appendChild(panel);
    logEl = panel.querySelector('#trag-log');
    statEl = panel.querySelector('#trag-stat');
    reportEl = panel.querySelector('#trag-report');
    panel.querySelector('#trag-close').onclick = () => panel.remove();
    panel.querySelector('#trag-audit').onclick = auditAccess;
    panel.querySelector('#trag-grant').onclick = grantAccess;
    panel.querySelector('#trag-stop').onclick = () => {
      runState.stop = true;
      log('Остановка после текущего запроса...', '#c33');
    };
    setStat('Готово. Сначала можно нажать «Проверить доступ».');
  }

  buildPanel();
})();
