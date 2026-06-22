// ==UserScript==
// @name         Dekanat — Аудит незаполненных журналов → Excel
// @namespace    local.dekanat.journal-audit
// @version      4.0
// @description  Обходит всех преподавателей, проверяет журналы, сохраняет прогресс, выгружает в Excel. Нарушение = 100% студентов "н" за день. Подозрительно = "н" больше 50% (но не 100%).
// @match        https://ebilim.jaiu.edu.kg/*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// ==/UserScript==
(function () {
  'use strict';
  if (window.top !== window.self) return;

  const PANEL_ID  = 'ja-panel';
  const STORAGE_KEY = 'ja_progress';

  // Порог для категории "подозрительно": доля "н" среди ВСЕХ студентов группы
  // (включая пустые отметки) должна быть СТРОГО больше этого значения, но
  // меньше 100% (100% — это уже "нарушение", а не "подозрительно").
  // Пример: 10 студентов, 6 = "н" -> 60% > 50% -> подозрительно.
  // Дни, где у ВСЕХ студентов "н" (100%) -> нарушение (сводный список).
  // Дни, где у ВСЕХ студентов пусто (нет отметок вообще) -> игнорируются.
  const SUSPICIOUS_THRESHOLD = 0.5; // строго больше 50%

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ─── Хранилище прогресса (localStorage как fallback к GM_getValue) ─────────
  const Store = {
    get(key) {
      try { return JSON.parse(localStorage.getItem('ja_' + key) || 'null'); } catch(_) { return null; }
    },
    set(key, val) {
      try { localStorage.setItem('ja_' + key, JSON.stringify(val)); } catch(_) {}
    },
    del(key) {
      try { localStorage.removeItem('ja_' + key); } catch(_) {}
    }
  };

  // ─── Загрузка ExcelJS ───────────────────────────────────────────────────
  // ВАЖНО: SheetJS (xlsx.js) community-сборка не умеет ЗАПИСЫВАТЬ стили
  // (заливку/границы/шрифты) в .xlsx — она их только читает при импорте.
  // Поэтому для реального экспорта со стилями используем ExcelJS.
  let exceljsLoaded = false;
  async function loadExcelJS() {
    if (exceljsLoaded || window.ExcelJS) { exceljsLoaded = true; return; }
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      s.onload = () => { exceljsLoaded = true; res(); };
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  // ─── API: смена преподавателя ──────────────────────────────────────────────

  async function fetchEditTeacherForm(userProfileId) {
    const res = await fetch(`/UserProfile/EditTeacher/${userProfileId}`, { credentials: 'same-origin' });
    const html = await res.text();
    const doc  = new DOMParser().parseFromString(html, 'text/html');

    const fields = {};
    for (const inp of doc.querySelectorAll('form input[type=hidden], form input:not([type])')) {
      fields[inp.name] = inp.value;
    }
    const teachers = [];
    for (const opt of doc.querySelectorAll('select#TeacherID option')) {
      const val = opt.value;
      if (!val || val === '0') continue;
      teachers.push({ teacherID: val, name: opt.textContent.trim() });
    }
    const token = doc.querySelector('input[name="__RequestVerificationToken"]')?.value || '';
    return { fields, teachers, token };
  }

  async function switchTeacher(userProfileId, teacherID, fields, token) {
    const body = new URLSearchParams({
      ...fields,
      TeacherID: String(teacherID),
      __RequestVerificationToken: token
    });
    const res = await fetch(`/UserProfile/EditTeacher/${userProfileId}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!res.ok) throw new Error(`EditTeacher POST ${res.status}`);
    return res;
  }

  // ─── API: список предметов/групп текущего препода ─────────────────────────
  async function fetchDisciplineList() {
    const res = await fetch('/TeacherProfile/DisciplineList', { credentials: 'same-origin' });
    const html = await res.text();
    const doc  = new DOMParser().parseFromString(html, 'text/html');
    const items = [];

    const tryParse = (href) => {
      const qs = href.includes('?') ? href.split('?')[1] : '';
      if (!qs) return null;
      const p = new URLSearchParams(qs);
      const idDis   = p.get('idDis');
      const idGroup = p.get('idGroup');
      const idPlan  = p.get('idPlan');
      if (!idDis || !idGroup) return null;
      return {
        idDis, idGroup, idPlan: idPlan || '0',
        idExam:  p.get('idExam')  || '1',
        kredit:  p.get('kredit')  || '3.00',
        idVed:   p.get('idVed')   || '1',
        idSem:   p.get('idSem')   || '2',
        rules:   p.get('rules')   || '13',
        idTeacher: p.get('idTeacher') || '0',
      };
    };

    for (const a of doc.querySelectorAll('a[href*="OpenGroup"]')) {
      const parsed = tryParse(a.getAttribute('href') || '');
      if (!parsed) continue;
      const row = a.closest('tr');
      const cells = row ? [...row.querySelectorAll('td')] : [];
      items.push({
        ...parsed,
        disciplineName: cells[1]?.textContent.trim() || `Дисциплина ${parsed.idDis}`,
        groupName:      cells[2]?.textContent.trim() || `Группа ${parsed.idGroup}`,
      });
    }

    if (items.length === 0) {
      for (const el of doc.querySelectorAll('[onclick*="OpenGroup"],[data-href*="OpenGroup"]')) {
        const str = el.getAttribute('onclick') || el.getAttribute('data-href') || '';
        const m = str.match(/OpenGroup\?([^'"]+)/);
        if (!m) continue;
        const parsed = tryParse('?' + m[1]);
        if (!parsed) continue;
        const cells = el.tagName === 'TR' ? [...el.querySelectorAll('td')] : [];
        items.push({
          ...parsed,
          disciplineName: cells[1]?.textContent.trim() || `Дисциплина ${parsed.idDis}`,
          groupName:      cells[2]?.textContent.trim() || `Группа ${parsed.idGroup}`,
        });
      }
    }

    if (items.length === 0) {
      const scripts = doc.querySelectorAll('script');
      for (const s of scripts) {
        const matches = [...(s.textContent || '').matchAll(/OpenGroup\?([^'"`\s]+)/g)];
        for (const m of matches) {
          const parsed = tryParse('?' + m[1]);
          if (parsed) items.push({ ...parsed, disciplineName: `Дисциплина ${parsed.idDis}`, groupName: `Группа ${parsed.idGroup}` });
        }
      }
    }

    return items;
  }

  // ─── API: журнал посещаемости ─────────────────────────────────────────────
  async function fetchJournal(idGroup, idSem, idYear, idDis, idPlan) {
    const url = `/Jurnal/EveryDayJson2?idGroup=${idGroup}&idSem=${idSem}&idYear=${idYear}&idDis=${idDis}&idPlan=${idPlan}`;
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`EveryDayJson2 HTTP ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); }
    catch(_) {
      const m = text.match(/^["'](.+)["']$/s);
      if (m) try { return JSON.parse(m[1]); } catch(_) {}
      throw new Error('Ответ не JSON: ' + text.slice(0, 150));
    }
  }

  // ─── Классификация одной отметки ───────────────────────────────────────────
  function classifyMark(ball) {
    const b = String(ball ?? '').toLowerCase().trim();
    if (b === '' || b === 'null' || b === 'undefined') return 'blank';
    if (b === 'н') return 'n';
    return 'other';
  }

  // ─── Анализ журнала по дате ─────────────────────────────────────────────
  // Правило (по требованию декана):
  //  - "Нарушение"     — у 100% студентов группы за день стоит "н".
  //  - "Подозрительно" — доля "н" среди ВСЕХ студентов группы строго больше
  //                       SUSPICIOUS_THRESHOLD (50%), но меньше 100%.
  //  - Если у ВСЕХ студентов день вообще пуст (нет отметок) — день
  //    игнорируется полностью (не нарушение, не подозрительно).
  //  - Ровно 50% "н" — считается нормой (НЕ подозрительно).
  // База расчёта процента — все студенты группы (numStudents), включая тех,
  // у кого пусто или другая (не "н") отметка.
  function analyzeJournal(data) {
    const records = data?.StudentJurnalDay ?? [];
    if (records.length === 0) return null;

    const byDate = {};
    for (const r of records) {
      const date = (r.Date || '').split('T')[0];
      if (!date || date === '0001-01-01') continue;
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(r);
    }
    const dates = Object.keys(byDate).sort();
    if (dates.length === 0) return null;

    const studentMap = {};
    for (const r of records) {
      if (!studentMap[r.StudentID]) studentMap[r.StudentID] = r.s_fio?.trim() || String(r.StudentID);
    }
    const studentIds = Object.keys(studentMap);
    const numStudents = studentIds.length;

    // У студента может быть несколько записей за один и тот же день (напр.,
    // две пары одного предмета в один день). Считаем "эффективную" отметку
    // студента за день: реальная оценка важнее "н" — "н" учитывается только
    // если за день вообще не было настоящей оценки.
    const byDateStudent = {};
    for (const date of dates) {
      byDateStudent[date] = {};
      for (const r of byDate[date]) {
        const sid = String(r.StudentID);
        (byDateStudent[date][sid] || (byDateStudent[date][sid] = [])).push(r.Ball);
      }
    }
    function effectiveMark(date, sid) {
      const arr = byDateStudent[date]?.[sid];
      if (!arr || arr.length === 0) return '';
      let sawN = false;
      for (const ball of arr) {
        const cls = classifyMark(ball);
        if (cls === 'other') return String(ball ?? ''); // настоящая оценка приоритетнее
        if (cls === 'n') sawN = true;
      }
      return sawN ? 'н' : '';
    }

    const violationDates = [];
    const suspiciousDates = [];

    for (const date of dates) {
      let blankCount = 0, nCount = 0, otherCount = 0;
      const exceptions = []; // студенты, у которых отметка НЕ "н" (пусто или реальная оценка)
      for (const sid of studentIds) {
        const eff = effectiveMark(date, sid);
        const cls = classifyMark(eff);
        if (cls === 'blank') { blankCount++; exceptions.push({ fio: studentMap[sid], ball: '' }); }
        else if (cls === 'n') nCount++;
        else { otherCount++; exceptions.push({ fio: studentMap[sid], ball: eff }); }
      }

      if (blankCount === numStudents) continue; // день вообще не велся — игнорируем

      const percentN = numStudents > 0 ? nCount / numStudents : 0;

      if (percentN === 1) {
        // 100% студентов "н"
        violationDates.push(date);
      } else if (percentN > SUSPICIOUS_THRESHOLD) {
        // строго больше 50%, но не 100%
        suspiciousDates.push({ date, nCount, numStudents, percentN, exceptions });
      }
      // иначе — норма, пропускаем
    }

    const tableRows = studentIds.map(sid => {
      const row = { ФИО: studentMap[sid] };
      for (const d of dates) row[d] = effectiveMark(d, sid);
      return row;
    });

    return { violationDates, suspiciousDates, dates, tableRows, numStudents };
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const [, m, d] = iso.split('-');
    return `${d}.${m}`;
  }

  function fmtPercent(p) {
    return `${Math.round(p * 100)}%`;
  }

  // ─── Получить userProfileId текущего залогиненного декана ─────────────────
  async function getCurrentUserProfileId() {
    const links = [...document.querySelectorAll('a[href*="EditTeacher"]')];
    if (links.length > 0) {
      const m = links[0].href.match(/EditTeacher\/(\d+)/);
      if (m) return m[1];
    }
    const res = await fetch('/UserRoles/List', { credentials: 'same-origin' });
    const html = await res.text();
    const m = html.match(/EditTeacher\/(\d+)/);
    return m ? m[1] : null;
  }

  // ─── Стили для Excel (формат ExcelJS) ──────────────────────────────────────
  const thinBorder = { style: 'thin', color: { argb: 'FFCFCFCF' } };
  const BORDER_ALL = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

  const STYLE = {
    headerMain: {
      font: { bold: true, size: 11, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } }, // насыщенный красный — "нарушение"
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      border: BORDER_ALL,
    },
    headerSus: {
      font: { bold: true, size: 11, color: { argb: 'FF7A4B00' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC857' } }, // янтарный — "подозрительно"
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      border: BORDER_ALL,
    },
    headerTable: {
      font: { bold: true, size: 10, color: { argb: 'FF1F3864' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      border: BORDER_ALL,
    },
    headerTableViolation: {
      font: { bold: true, size: 10, color: { argb: 'FFC00000' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCC9C9' } },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      border: BORDER_ALL,
    },
    title: { font: { bold: true, size: 13, color: { argb: 'FF1F3864' } } },
    subtitle: { font: { italic: true, size: 10, color: { argb: 'FF555555' } } },
    band: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } },
    cellN: {
      font: { bold: true, color: { argb: 'FFC00000' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4E4' } },
      alignment: { horizontal: 'center' },
      border: BORDER_ALL,
    },
    cellOther: { alignment: { horizontal: 'center' }, border: BORDER_ALL },
    cellBlank: {
      alignment: { horizontal: 'center' }, border: BORDER_ALL,
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } },
    },
    fio: { font: { bold: false }, border: BORDER_ALL },
    percentHigh: { // >50% н, ближе к 100%
      font: { bold: true, color: { argb: 'FF7A4B00' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE3A3' } },
      alignment: { horizontal: 'center' },
      border: BORDER_ALL,
    },
    plain: { border: BORDER_ALL },
  };

  function markStyle(value) {
    const v = String(value ?? '').toLowerCase().trim();
    if (v === 'н') return STYLE.cellN;
    if (v === '') return STYLE.cellBlank;
    return STYLE.cellOther;
  }

  // ─── Excel (ExcelJS) ────────────────────────────────────────────────────
  async function buildExcel(violations, suspicious) {
    const wb = new ExcelJS.Workbook();

    // ── Лист 1: Сводный список (день полностью "н" — 100%) ────────────────
    const wsSummary = wb.addWorksheet('Сводный список');
    const sumHdr = ['Преподаватель', 'Предмет', 'Группа', 'Незаполненные даты (100% "н")', 'Кол-во дат'];
    wsSummary.columns = [
      { width: 32 }, { width: 38 }, { width: 18 }, { width: 50 }, { width: 11 },
    ];
    const sumHeaderRow = wsSummary.addRow(sumHdr);
    sumHeaderRow.height = 22;
    sumHeaderRow.eachCell(cell => { cell.style = STYLE.headerMain; });

    violations.forEach((v, i) => {
      const row = wsSummary.addRow([
        v.teacherName, v.disciplineName, v.groupName,
        v.emptyDates.map(fmtDate).join(', '),
        v.emptyDates.length,
      ]);
      row.eachCell((cell, colNumber) => {
        cell.style = {
          border: BORDER_ALL,
          alignment: colNumber === 4 ? { wrapText: true } : (colNumber === 5 ? { horizontal: 'center' } : {}),
          fill: (i % 2 === 0) ? STYLE.band : undefined,
        };
      });
    });
    if (violations.length > 0) {
      wsSummary.autoFilter = { from: 'A1', to: `E${violations.length + 1}` };
    }

    // ── Лист 2: Подозрительные (>50% "н", но не 100%) ──────────────────────
    const wsSus = wb.addWorksheet('Подозрительные');
    const susHdr = ['Преподаватель', 'Предмет', 'Группа', 'Дата', '% "н"', '"н" из всего', 'Не "н" (ФИО — отметка)'];
    wsSus.columns = [
      { width: 32 }, { width: 38 }, { width: 18 }, { width: 11 }, { width: 9 }, { width: 14 }, { width: 55 },
    ];
    const susHeaderRow = wsSus.addRow(susHdr);
    susHeaderRow.height = 22;
    susHeaderRow.eachCell(cell => { cell.style = STYLE.headerSus; });

    let susRowIdx = 0;
    for (const s of suspicious) {
      for (const sd of s.suspiciousDates) {
        const row = wsSus.addRow([
          s.teacherName, s.disciplineName, s.groupName, fmtDate(sd.date),
          fmtPercent(sd.percentN),
          `${sd.nCount} из ${sd.numStudents}`,
          sd.exceptions.map(e => `${e.fio} — ${e.ball || '—'}`).join('; '),
        ]);
        row.eachCell((cell, colNumber) => {
          if (colNumber === 5) { cell.style = STYLE.percentHigh; return; }
          cell.style = {
            border: BORDER_ALL,
            alignment: colNumber === 7 ? { wrapText: true } : (colNumber === 6 ? { horizontal: 'center' } : {}),
            fill: (susRowIdx % 2 === 0) ? STYLE.band : undefined,
          };
        });
        susRowIdx++;
      }
    }
    if (susRowIdx > 0) {
      wsSus.autoFilter = { from: 'A1', to: `G${susRowIdx + 1}` };
    }

    // ── Индивидуальные листы по преподавателям (только нарушения 100% "н") ─
    const byTeacher = {};
    for (const v of violations) {
      if (!byTeacher[v.teacherName]) byTeacher[v.teacherName] = [];
      byTeacher[v.teacherName].push(v);
    }

    const usedNames = new Set(['Сводный список', 'Подозрительные']);
    function uniqueSheetName(base) {
      let safe = base.replace(/[\\/:*?[\]]/g, '').trim().slice(0, 28) || 'Препод';
      let name = safe, i = 2;
      while (usedNames.has(name)) { name = (safe.slice(0, 28 - String(i).length - 1) + '_' + i); i++; }
      usedNames.add(name);
      return name;
    }

    for (const [tName, items] of Object.entries(byTeacher)) {
      const ws = wb.addWorksheet(uniqueSheetName(tName));
      ws.getColumn(1).width = 30;

      const titleRow = ws.addRow([`Преподаватель: ${tName}`]);
      titleRow.getCell(1).style = STYLE.title;
      ws.addRow([]);

      for (const item of items) {
        ws.addRow([`Предмет: ${item.disciplineName}`, '', `Группа: ${item.groupName}`]);
        ws.addRow([`Незаполненные даты (100% "н"): ${item.emptyDates.map(fmtDate).join(', ')}`]);
        ws.addRow([]);

        const violSet = new Set(item.emptyDates);
        const header = ['ФИО', ...item.dates.map(fmtDate)];
        const headerRow = ws.addRow(header);
        headerRow.eachCell((cell, colNumber) => {
          const isViolationCol = colNumber > 1 && violSet.has(item.dates[colNumber - 2]);
          cell.style = isViolationCol ? STYLE.headerTableViolation : STYLE.headerTable;
        });
        for (let c = 2; c <= header.length; c++) {
          if (ws.getColumn(c).width === undefined) ws.getColumn(c).width = 9;
        }

        for (const tRow of item.tableRows) {
          const dataRow = ws.addRow([tRow.ФИО, ...item.dates.map(d => tRow[d] || '')]);
          dataRow.eachCell((cell, colNumber) => {
            cell.style = colNumber === 1 ? STYLE.fio : markStyle(cell.value);
          });
        }
        ws.addRow([]); ws.addRow([]);
      }
    }

    return wb;
  }

  async function downloadXlsx(wb) {
    const buf  = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a    = document.createElement('a');
    const d    = new Date();
    const ds   = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    a.href     = URL.createObjectURL(blob);
    a.download = `незаполненные_журналы_${ds}.xlsx`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  }

  // ─── Основной процесс ─────────────────────────────────────────────────────
  const runState = { stop: false, running: false };

  async function runAudit(semId, yearId, resumeMode) {
    runState.running = true; runState.stop = false;

    log('⏳ Загрузка ExcelJS...', '#888');
    try { await loadExcelJS(); log('✓ ExcelJS загружен', '#0a0'); }
    catch(e) { log('✗ ExcelJS: ' + e.message, '#c33'); finish(); return; }

    log('🔍 Определяем userProfileId...', '#888');
    const userProfileId = await getCurrentUserProfileId();
    if (!userProfileId) { log('✗ Не нашли userProfileId. Убедитесь что вы декан/админ.', '#c33'); finish(); return; }
    log(`✓ userProfileId = ${userProfileId}`, '#0a0');

    log('📋 Загрузка списка преподавателей...', '#888');
    let formData;
    try {
      formData = await fetchEditTeacherForm(userProfileId);
      log(`✓ Преподавателей: ${formData.teachers.length}`, '#0a0');
    } catch(e) { log('✗ EditTeacher: ' + e.message, '#c33'); finish(); return; }

    if (formData.teachers.length === 0) { log('✗ Список преподавателей пуст', '#c33'); finish(); return; }

    let progress = Store.get('progress') || { done: {}, violations: [], suspicious: [] };

    const teachers = formData.teachers;
    const totalTeachers = teachers.length;

    if (resumeMode) {
      const doneCount = Object.keys(progress.done).length;
      log(`▶ Возобновление: уже обработано ${doneCount}/${totalTeachers} преподавателей`, '#06c');
    } else {
      progress = { done: {}, violations: [], suspicious: [] };
      Store.set('progress', progress);
    }

    let violations = progress.violations || [];
    let suspicious = progress.suspicious || [];
    let procDone   = 0;
    let procErrors = 0;

    for (const teacher of teachers) {
      if (runState.stop) break;

      const tid = teacher.teacherID;

      if (progress.done[tid] && progress.done[tid] !== 'error') {
        procDone++;
        updateStat(procDone, totalTeachers, violations.length, suspicious.length, procErrors);
        continue;
      }

      log(`\n👤 [${procDone + 1}/${totalTeachers}] ${teacher.name}`);

      try {
        await switchTeacher(userProfileId, tid, formData.fields, formData.token);
        await sleep(800);
      } catch(e) {
        log(`   ✗ Ошибка смены: ${e.message}`, '#c33');
        progress.done[tid] = 'error';
        Store.set('progress', progress);
        procErrors++; procDone++;
        updateStat(procDone, totalTeachers, violations.length, suspicious.length, procErrors);
        await sleep(500);
        continue;
      }

      let disciplines;
      try {
        disciplines = await fetchDisciplineList();
        if (disciplines.length === 0) {
          log(`   ℹ Нет предметов в журнале`, '#888');
          progress.done[tid] = 'no_data';
          Store.set('progress', progress);
          procDone++;
          updateStat(procDone, totalTeachers, violations.length, suspicious.length, procErrors);
          await sleep(400);
          continue;
        }
        log(`   Предметов/групп: ${disciplines.length}`, '#06c');
      } catch(e) {
        log(`   ✗ DisciplineList: ${e.message}`, '#c33');
        progress.done[tid] = 'error';
        Store.set('progress', progress);
        procErrors++; procDone++;
        updateStat(procDone, totalTeachers, violations.length, suspicious.length, procErrors);
        await sleep(500);
        continue;
      }

      for (const dis of disciplines) {
        if (runState.stop) break;

        const label = `${dis.disciplineName} / ${dis.groupName}`;
        try {
          const data     = await fetchJournal(dis.idGroup, semId, yearId, dis.idDis, dis.idPlan);
          const analysis = analyzeJournal(data);

          if (!analysis) {
            log(`   · ${label}: нет данных`, '#aaa');
          } else {
            const hasViolation  = analysis.violationDates.length > 0;
            const hasSuspicious = analysis.suspiciousDates.length > 0;

            if (hasViolation) {
              log(`   ⚠ ${label}: 100% "н" ${analysis.violationDates.map(fmtDate).join(', ')}`, '#c00');
              violations.push({
                teacherName: teacher.name, teacherID: tid,
                disciplineName: dis.disciplineName, groupName: dis.groupName,
                emptyDates: analysis.violationDates, dates: analysis.dates, tableRows: analysis.tableRows,
              });
            }
            if (hasSuspicious) {
              const descr = analysis.suspiciousDates
                .map(s => `${fmtDate(s.date)} (${fmtPercent(s.percentN)})`)
                .join('; ');
              log(`   ❓ ${label}: подозрительно — ${descr}`, '#a06c00');
              suspicious.push({
                teacherName: teacher.name, teacherID: tid,
                disciplineName: dis.disciplineName, groupName: dis.groupName,
                suspiciousDates: analysis.suspiciousDates,
              });
            }
            if (!hasViolation && !hasSuspicious) {
              log(`   ✓ ${label}: норма (${analysis.dates.length} дат)`, '#0a0');
            }
          }
        } catch(e) {
          log(`   ✗ ${label}: ${e.message}`, '#c33');
        }
        await sleep(400);
      }

      progress.done[tid] = 'ok';
      progress.violations = violations;
      progress.suspicious = suspicious;
      Store.set('progress', progress);

      procDone++;
      updateStat(procDone, totalTeachers, violations.length, suspicious.length, procErrors);
      await sleep(600);
    }

    log(`\n🏁 Проверено: ${procDone}/${totalTeachers} | Нарушений (100% "н"): ${violations.length} | Подозрительных (>50% "н"): ${suspicious.length} | Ошибок: ${procErrors}`, '#06c');

    if (violations.length > 0 || suspicious.length > 0) {
      log('📊 Формирование Excel...', '#06c');
      try {
        await loadExcelJS();
        const wb = await buildExcel(violations, suspicious);
        await downloadXlsx(wb);
        log('✅ Excel скачан!', '#0a0');
      } catch(e) {
        log('✗ Excel: ' + e.message, '#c33');
      }
    } else {
      log('✅ Незаполненных журналов и подозрительных дней не найдено!', '#0a0');
    }

    if (!runState.stop) Store.del('progress');

    finish();
  }

  function finish() {
    runState.running = false; setBusy(false);
  }

  // ─── UI ───────────────────────────────────────────────────────────────────
  let logEl, statEl, panel;

  function log(msg, color) {
    if (!logEl) return;
    const div = document.createElement('div');
    div.style.cssText = `margin:1px 0;white-space:pre-wrap;font:12px/1.5 monospace;${color ? 'color:' + color : ''}`;
    div.textContent = msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function updateStat(done, total, violations, suspicious, errors) {
    if (!statEl) return;
    statEl.innerHTML =
      `Проверено: <b>${done}/${total}</b> &nbsp;|&nbsp; ` +
      `Нарушений (100% "н"): <b style="color:#c00">${violations}</b> &nbsp;|&nbsp; ` +
      `Подозрительных (>50% "н"): <b style="color:#a06c00">${suspicious}</b> &nbsp;|&nbsp; ` +
      `Ошибок: <b style="color:#c33">${errors}</b>`;
  }

  function setBusy(busy) {
    if (!panel) return;
    panel.querySelector('#ja-start').disabled   =  busy;
    panel.querySelector('#ja-resume').disabled  =  busy;
    panel.querySelector('#ja-stop').disabled    = !busy;
    panel.querySelector('#ja-excel').disabled   =  busy;
  }

  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed','right:14px','bottom:14px','z-index:2147483646',
      'width:560px','max-width:calc(100vw - 28px)','max-height:90vh',
      'display:flex','flex-direction:column',
      'background:#fff','border:1px solid #999',
      'border-radius:10px','box-shadow:0 6px 28px rgba(0,0,0,.35)',
      'font:13px/1.4 Segoe UI,Arial,sans-serif','color:#222','padding:14px',
      'box-sizing:border-box'
    ].join(';');

    const hasSavedProgress = !!Store.get('progress');
    const savedProgress = hasSavedProgress ? Store.get('progress') : null;
    const savedCount = hasSavedProgress ? Object.keys(savedProgress.done || {}).length : 0;
    const savedViol  = hasSavedProgress ? (savedProgress.violations || []).length : 0;
    const savedSus   = hasSavedProgress ? (savedProgress.suspicious || []).length : 0;

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;font-weight:bold;font-size:14px;margin-bottom:10px;flex-shrink:0;color:#1f3864">
        <span>📋 Аудит незаполненных журналов</span>
        <button id="ja-close" style="border:0;background:#eee;border-radius:5px;padding:3px 9px;cursor:pointer;font-size:13px">✕</button>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:8px;font-size:11px;flex-shrink:0">
        <span style="flex:1;display:flex;align-items:center;gap:5px;background:#FCE4E4;border:1px solid #f3b3b3;border-radius:5px;padding:5px 8px;color:#7a0000">
          <b style="font-size:13px">●</b> Нарушение — 100% "н" за день
        </span>
        <span style="flex:1;display:flex;align-items:center;gap:5px;background:#FFE3A3;border:1px solid #ffcf6e;border-radius:5px;padding:5px 8px;color:#7a4b00">
          <b style="font-size:13px">●</b> Подозрительно — &gt;50% "н", но не 100%
        </span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;font-size:12px;flex-shrink:0">
        <label>Семестр:
          <select id="ja-sem" style="width:100%;margin-top:3px;padding:4px 6px;border:1px solid #ccc;border-radius:4px">
            <option value="1">1 семестр</option>
            <option value="2" selected>2 семестр</option>
          </select>
        </label>
        <label>Учебный год:
          <select id="ja-year" style="width:100%;margin-top:3px;padding:4px 6px;border:1px solid #ccc;border-radius:4px">
            <option value="25" selected>2025-2026</option>
            <option value="24">2024-2025</option>
          </select>
        </label>
      </div>

      ${hasSavedProgress ? `
      <div style="background:#fff8e1;border:1px solid #ffc107;border-radius:5px;padding:7px 10px;font-size:12px;color:#7a5800;margin-bottom:8px;flex-shrink:0">
        💾 Найден прогресс: обработано <b>${savedCount}</b> препод., нарушений <b>${savedViol}</b>, подозрительных <b>${savedSus}</b>
      </div>` : ''}

      <div id="ja-stat" style="background:#f0f4ff;border:1px solid #c0d0f0;border-radius:5px;padding:6px 10px;margin-bottom:8px;font-size:12px;color:#336;flex-shrink:0">Готов к запуску.</div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:6px;flex-shrink:0">
        <button id="ja-start"  style="padding:8px;background:#0a7;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:12px;font-weight:bold">▶ Старт</button>
        <button id="ja-resume" style="padding:8px;background:#06c;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:12px;font-weight:bold" ${!hasSavedProgress ? 'disabled' : ''}>↩ Продолжить</button>
        <button id="ja-stop"   style="padding:8px;background:#c33;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:12px" disabled>⏹ Стоп</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;flex-shrink:0">
        <button id="ja-excel"  style="padding:7px;background:#217346;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:12px">📥 Скачать Excel (сохранённое)</button>
        <button id="ja-clear"  style="padding:7px;background:#888;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:12px">🗑 Сбросить прогресс</button>
      </div>

      <div style="font-weight:bold;margin-bottom:4px;flex-shrink:0;font-size:12px;color:#1f3864">Лог:</div>
      <div id="ja-log" style="flex:1;min-height:200px;overflow:auto;background:#f7f7f7;border:1px solid #ddd;border-radius:6px;padding:8px"></div>
    `;

    document.body.appendChild(panel);
    logEl  = panel.querySelector('#ja-log');
    statEl = panel.querySelector('#ja-stat');

    panel.querySelector('#ja-close').onclick = () => panel.remove();

    panel.querySelector('#ja-stop').onclick = () => {
      runState.stop = true;
      log('⏹ Остановка после текущего препода...', '#c33');
    };

    panel.querySelector('#ja-clear').onclick = () => {
      if (runState.running) return;
      Store.del('progress');
      panel.querySelector('#ja-resume').disabled = true;
      log('🗑 Прогресс сброшен', '#888');
    };

    panel.querySelector('#ja-excel').onclick = async () => {
      const saved = Store.get('progress');
      if (!saved || (!saved.violations?.length && !saved.suspicious?.length)) { log('Нет сохранённых нарушений/подозрений', '#c80'); return; }
      log('📊 Формирование Excel из сохранённых данных...', '#06c');
      try {
        await loadExcelJS();
        const wb = await buildExcel(saved.violations || [], saved.suspicious || []);
        await downloadXlsx(wb);
        log('✅ Excel скачан!', '#0a0');
      } catch(e) { log('✗ ' + e.message, '#c33'); }
    };

    const startAudit = (resume) => {
      if (runState.running) return;
      const semId  = parseInt(panel.querySelector('#ja-sem').value);
      const yearId = parseInt(panel.querySelector('#ja-year').value);
      logEl.innerHTML = '';
      setBusy(true);
      updateStat(0, '?', 0, 0, 0);
      runAudit(semId, yearId, resume).catch(e => {
        log('💥 ' + e.message, '#c33');
        finish();
      });
    };

    panel.querySelector('#ja-start').onclick  = () => startAudit(false);
    panel.querySelector('#ja-resume').onclick = () => startAudit(true);
  }

  function ready(fn) {
    if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }
  ready(buildPanel);
})();