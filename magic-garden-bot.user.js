// ==UserScript==
// @name         Magic Garden — auto helper + UI (Quinoa)
// @namespace    magicgarden.bot
// @version      2.5.0
// @description  Хук игрового WebSocket Magic Garden + CSP-устойчивая панель. Человеческий режим сбора, авто-продажа, MG.report() для захвата экономики. Время серверное — ускорить нельзя.
// @match        *://*/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// ==/UserScript==
(function () {
  'use strict';
  try {

  // Широкая маска (как у рабочего аудит-логгера), но активны только во фрейме игры.
  const isGame = /(^|\.)discordsays\.com$/i.test(location.hostname);
  if (!isGame) return;   // на любых других сайтах — мгновенный выход, ничего не делаем

  // unsafeWindow = реальный window страницы (а не песочница менеджера)
  const page = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const frameLabel = (() => { try { return window.top === window.self ? 'top' : 'iframe'; } catch { return 'iframe'; } })();
  const host = location.host;
  page.__MG_LOADED = true;
  console.log('%c[MG] v2.5 загружен · frame=' + frameLabel + ' · host=' + host,
              'background:#248046;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold');

  // ───────────────────────── Конфиг ─────────────────────────
  const CFG = { running:false, dryRun:true, tickMs:1000, harvest:true, slotIndex:null,
    human:true, minGapMs:1800, maxGapMs:6000,   // паузы между одиночными действиями (человеческий режим)
    autoSell:true, sellEverySec:120 };          // авто-продажа всего раз в N секунд
  const GAME = 'Quinoa', SCOPE = ['Room', GAME];

  // ───────────────────────── Состояние ─────────────────────────
  let state=null, gameWS=null, harvested=0;
  const seenCmd=new Set(), seenQ=new Set(), uiLog=[];
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==='x'?r:(r&0x3|0x8)).toString(16);}));
  function plog(msg,color){ console.log('%c[MG] '+msg,'color:'+(color||'#3ba55d'));
    uiLog.unshift({t:new Date().toLocaleTimeString(),msg,color:color||'#9aa'}); if(uiLog.length>40)uiLog.pop(); renderLog(); }

  // ───────────────────────── JSON Pointer ─────────────────────────
  function applyPatch(root,op){
    const tk=op.path.split('/').slice(1).map(t=>t.replace(/~1/g,'/').replace(/~0/g,'~'));
    let node=root;
    for(let i=0;i<tk.length-1;i++){ if(node==null)return; node=Array.isArray(node)?node[Number(tk[i])]:node[tk[i]]; }
    if(node==null)return;
    const last=tk[tk.length-1];
    if(op.op==='remove'){ Array.isArray(node)?node.splice(Number(last),1):delete node[last]; }
    else if(Array.isArray(node)&&last==='-') node.push(op.value);
    else node[Array.isArray(node)?Number(last):last]=op.value;
  }

  // ───────────────────────── WS сообщения ─────────────────────────
  function onMessage(raw){
    if(typeof raw!=='string')return; let m; try{m=JSON.parse(raw);}catch{return;}
    if(!m||typeof m!=='object')return;
    if(m.type==='Welcome'){ state=m.fullState; plog('Welcome — состояние получено'); }
    else if(m.type==='PartialState'&&state&&Array.isArray(m.patches)) m.patches.forEach(p=>{try{applyPatch(state,p);}catch{}});
  }
  function onSend(raw){
    if(typeof raw!=='string')return; let m; try{m=JSON.parse(raw);}catch{return;}
    if(!m||!m.type)return;
    if(!seenCmd.has(m.type)){ seenCmd.add(m.type); plog('новая команда: '+m.type,'#faa61a'); }
    if(m.type==='QuinoaCommand'&&m.command&&!seenQ.has(m.command.type)){
      seenQ.add(m.command.type); plog('QuinoaCommand → '+m.command.type+': '+JSON.stringify(m.command),'#faa61a'); }
  }

  // ───────────────────────── Хук page.WebSocket ─────────────────────────
  function patchWS(){
    if(!page.WebSocket||page.WebSocket.__mgWrapped)return;
    const Native=page.WebSocket;
    const Wrapped=function(url,protocols){
      const ws=(protocols==null)?new Native(url):new Native(url,protocols);
      if(typeof url==='string'&&/discordsays\.com\/.*\/connect/.test(url)){
        gameWS=ws; plog('игровой сокет перехвачен ✓');
        ws.addEventListener('message',e=>{try{onMessage(e.data);}catch{}});
        const send=ws.send.bind(ws); ws.send=function(d){try{onSend(d);}catch{} return send(d);};
      }
      return ws;
    };
    Wrapped.prototype=Native.prototype;
    ['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(k=>{Wrapped[k]=Native[k];});
    Wrapped.__mgWrapped=true; page.WebSocket=Wrapped;
  }
  patchWS();

  // ───────────────────────── Доступ к игре ─────────────────────────
  const child=()=>state&&state.child&&state.child.data;
  const now=()=>(child()&&child().currentTime)||Date.now();
  function mySlot(){ const c=child(); if(!c||!Array.isArray(c.userSlots))return null;
    if(CFG.slotIndex!=null)return c.userSlots[CFG.slotIndex];
    const real=c.userSlots.filter(s=>s&&s.type==='user'); return real.length===1?real[0]:c.userSlots[0]; }
  const garden=()=>{ const s=mySlot(); return (s&&s.data&&s.data.garden&&s.data.garden.tileObjects)||{}; };

  // ───────────────────────── Действия ─────────────────────────
  function send(obj){ if(!gameWS||gameWS.readyState!==1){plog('сокет не готов','#ed4245');return false;} gameWS.send(JSON.stringify(obj)); return true; }
  const harvest=(slot,slotsIndex)=>send({scopePath:SCOPE,type:'QuinoaCommand',requestId:uuid(),command:{type:'HarvestCrop',slot,slotsIndex}});
  const sellAll=()=>send({scopePath:SCOPE,type:'SellAllCrops'});
  function findReady(){ const out=[],g=garden(),t=now();
    for(const slot of Object.keys(g)){ const slots=g[slot]&&g[slot].slots; if(!slots)continue;
      for(const idx of Object.keys(slots)){ const s=slots[idx];
        if(s&&typeof s.endTime==='number'&&s.endTime<=t) out.push({slot:Number(slot),slotsIndex:Number(idx)}); } }
    return out; }
  const rand=(a,b)=>a+Math.random()*(b-a);
  let nextActAt=0, lastSellAt=0;
  function maybeSell(){ if(!CFG.autoSell||CFG.dryRun)return;
    const t=Date.now(); if(t-lastSellAt>=CFG.sellEverySec*1000){ if(sellAll()){lastSellAt=t;plog('💰 авто-продажа');} } }
  // разовый сбор всего (кнопка «Собрать»)
  function harvestNow(){ const r=findReady();
    if(!r.length){plog('созревших нет');return;}
    if(CFG.dryRun){plog('[dryRun] собрал бы '+r.length,'#faa61a');return;}
    r.forEach(x=>{harvest(x.slot,x.slotsIndex);harvested++;});
    plog('собрано: '+r.length+' (всего '+harvested+')'); maybeSell(); }
  // авто-цикл: человеческий режим = по одному с случайными паузами
  function tick(){
    if(!CFG.running||!state||!CFG.harvest)return;
    const r=findReady(); if(!r.length)return;
    if(CFG.human){
      const t=Date.now(); if(t<nextActAt)return;
      nextActAt=t+rand(CFG.minGapMs,CFG.maxGapMs);
      if(CFG.dryRun){plog('[dryRun] собрал бы 1 (готово '+r.length+')','#faa61a');return;}
      const one=r[Math.floor(Math.random()*Math.min(r.length,3))]; // лёгкая нерегулярность выбора
      harvest(one.slot,one.slotsIndex); harvested++;
      plog('🌾 +1 (всего '+harvested+', ждёт '+(r.length-1)+')');
    } else {
      if(CFG.dryRun){plog('[dryRun] собрал бы '+r.length,'#faa61a');return;}
      r.forEach(x=>{harvest(x.slot,x.slotsIndex);harvested++;});
      plog('🌾 собрано '+r.length+' (всего '+harvested+')');
    }
    maybeSell();
  }
  setInterval(tick,CFG.tickMs);
  function dump(){ const g=garden(),t=now(),rows=[];
    for(const slot of Object.keys(g)){ const slots=g[slot]&&g[slot].slots; if(!slots)continue;
      for(const idx of Object.keys(slots)){ const s=slots[idx]; if(!s||s.endTime==null)continue;
        rows.push({slot:Number(slot),idx:Number(idx),left_s:Math.max(0,Math.round((s.endTime-t)/1000)),ready:s.endTime<=t}); } }
    console.table(rows.sort((a,b)=>a.left_s-b.left_s)); plog('грядок с растениями: '+rows.length+' (см. console.table)'); return rows; }

  // выгрузка данных для проектирования экономики (магазин+цены, монеты, инвентарь, виденные команды)
  function report(){
    const c=child()||{}, sd=(mySlot()||{}).data||{};
    const r={ when:new Date().toISOString(), coins:sd.coinsCount, magicDust:sd.magicDustCount,
      shops:c.shops, inventory:sd.inventory, stats:sd.stats,
      gardenSample:Object.fromEntries(Object.entries(garden()).slice(0,3)),
      seenCommands:[...seenCmd], seenQuinoa:[...seenQ] };
    let json; try{ json=JSON.stringify(r,null,2); }catch{ json='[не сериализуется]'; }
    console.log('%c[MG] REPORT ↓','color:#faa61a;font-weight:bold'); console.log(json);
    try{ navigator.clipboard.writeText(json).then(()=>plog('📦 report скопирован в буфер'),()=>plog('📦 report в консоли')); }
    catch{ plog('📦 report в консоли'); }
    return r; }

  // ───────────────────────── UI (стили только через element.style — CSP-safe) ─────────────────────────
  let elLog=null, panel=null, refs={};
  const S=(el,styles)=>{ Object.assign(el.style,styles); return el; };
  function mk(tag,styles,text){ const e=document.createElement(tag); if(styles)Object.assign(e.style,styles); if(text!=null)e.textContent=text; return e; }
  function btn(label,bg){ return mk('button',{flex:'1',cursor:'pointer',border:'0',borderRadius:'5px',padding:'7px 4px',
      color:'#fff',background:bg||'#4e5058',font:'600 11px system-ui,sans-serif'},label); }

  function renderLog(){ if(!elLog)return; elLog.textContent='';
    uiLog.forEach(l=>{ const row=mk('div',{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'});
      const ts=mk('span',{color:'#72767d'},l.t+' '); const ms=mk('span',{color:l.color},l.msg);
      row.appendChild(ts); row.appendChild(ms); elLog.appendChild(row); }); }

  function buildUI(){
    if(!document.documentElement){ return setTimeout(buildUI,150); }
    if(document.getElementById('mg-panel'))return;
    panel=mk('div'); panel.id='mg-panel';
    S(panel,{position:'fixed',top:'12px',right:'12px',zIndex:'2147483647',width:'234px',
      font:'12px/1.4 system-ui,sans-serif',background:'#2b2d31',color:'#dbdee1',
      border:'1px solid #1e1f22',borderRadius:'8px',boxShadow:'0 8px 24px rgba(0,0,0,.55)',userSelect:'none'});

    const head=mk('div',{display:'flex',alignItems:'center',justifyContent:'space-between',
      padding:'8px 10px',background:'#1e1f22',borderRadius:'8px 8px 0 0',cursor:'move',fontWeight:'700'});
    head.appendChild(mk('span',null,'🌱 Magic Garden bot'));
    const minBtn=mk('span',{cursor:'pointer',padding:'0 4px'},'▁'); head.appendChild(minBtn);
    panel.appendChild(head);

    const body=mk('div',{padding:'8px 10px'});
    const row=()=>mk('div',{display:'flex',gap:'6px',margin:'5px 0'});

    const r1=row(); const bRun=btn('▶ Старт','#248046');
    const bDry=btn('🧪 dryRun: '+(CFG.dryRun?'ON':'OFF'),CFG.dryRun?'#faa61a':'#248046');
    r1.appendChild(bRun); r1.appendChild(bDry); body.appendChild(r1);
    const r2=row(); const bHarv=btn('🌾 Собрать'); const bSell=btn('💰 Продать');
    r2.appendChild(bHarv); r2.appendChild(bSell); body.appendChild(r2);
    const r3=row(); const bDump=btn('📋 Грядки'); const bRep=btn('📦 Report','#5865f2');
    r3.appendChild(bDump); r3.appendChild(bRep); body.appendChild(r3);
    const r4=row(); const bHuman=btn('🧍 Human: '+(CFG.human?'ON':'OFF'),CFG.human?'#248046':'#4e5058');
    const bASell=btn('💰 Авто: '+(CFG.autoSell?'ON':'OFF'),CFG.autoSell?'#248046':'#4e5058');
    r4.appendChild(bHuman); r4.appendChild(bASell); body.appendChild(r4);

    const stLine=(label)=>{ const d=mk('div',{fontSize:'11px',margin:'4px 0'});
      const dot=mk('span',{display:'inline-block',width:'8px',height:'8px',borderRadius:'50%',marginRight:'5px',background:'#da373c'});
      const txt=mk('span',null,label+': '); const val=mk('b',{color:'#fff'},'…');
      d.appendChild(dot); d.appendChild(txt); d.appendChild(val); return {d,dot,val}; };
    const sSock=stLine('Сокет'); const sState=stLine('Состояние'); body.appendChild(sSock.d); body.appendChild(sState.d);
    const line3=mk('div',{fontSize:'11px',margin:'4px 0'});
    line3.appendChild(mk('span',null,'Кадр: ')); const bFrame=mk('b',{color:'#fff'},frameLabel);
    line3.appendChild(bFrame); line3.appendChild(mk('span',null,' · Созрело: ')); const bReady=mk('b',{color:'#fff'},'0');
    line3.appendChild(bReady); line3.appendChild(mk('span',null,' · Собрано: ')); const bCnt=mk('b',{color:'#fff'},'0');
    line3.appendChild(bCnt); body.appendChild(line3);
    const lineMode=mk('div',{fontSize:'12px',margin:'6px 0 2px',fontWeight:'700'});
    lineMode.appendChild(mk('span',null,'Режим: ')); const bMode=mk('b',null,'—'); lineMode.appendChild(bMode); body.appendChild(lineMode);

    elLog=mk('div',{maxHeight:'120px',overflow:'auto',marginTop:'6px',paddingTop:'6px',
      borderTop:'1px solid #1e1f22',font:'10px/1.35 monospace'}); body.appendChild(elLog);
    panel.appendChild(body);
    document.documentElement.appendChild(panel);

    refs={sSock,sState,bReady,bCnt,bMode};
    bRun.onclick=()=>{ CFG.running=!CFG.running; bRun.textContent=CFG.running?'⏸ Стоп':'▶ Старт';
      S(bRun,{background:CFG.running?'#da373c':'#248046'}); plog('авто-режим: '+CFG.running); };
    bDry.onclick=()=>{ CFG.dryRun=!CFG.dryRun; bDry.textContent='🧪 dryRun: '+(CFG.dryRun?'ON':'OFF'); S(bDry,{background:CFG.dryRun?'#faa61a':'#248046'});
      plog(CFG.dryRun?'dryRun ВКЛ — только тест, не собираю':'dryRun ВЫКЛ — реально собираю', CFG.dryRun?'#faa61a':'#3ba55d'); };
    bHarv.onclick=harvestNow; bSell.onclick=()=>{ if(sellAll())plog('продано всё'); }; bDump.onclick=dump; bRep.onclick=report;
    bHuman.onclick=()=>{ CFG.human=!CFG.human; bHuman.textContent='🧍 Human: '+(CFG.human?'ON':'OFF'); S(bHuman,{background:CFG.human?'#248046':'#4e5058'}); plog('human-режим: '+CFG.human); };
    bASell.onclick=()=>{ CFG.autoSell=!CFG.autoSell; bASell.textContent='💰 Авто: '+(CFG.autoSell?'ON':'OFF'); S(bASell,{background:CFG.autoSell?'#248046':'#4e5058'}); plog('авто-продажа: '+CFG.autoSell); };
    minBtn.onclick=()=>{ body.style.display = body.style.display==='none'?'block':'none'; };

    let dx=0,dy=0,drag=false;
    head.addEventListener('mousedown',e=>{ if(e.target===minBtn)return; drag=true; dx=e.clientX-panel.offsetLeft; dy=e.clientY-panel.offsetTop; });
    document.addEventListener('mousemove',e=>{ if(!drag)return; S(panel,{left:(e.clientX-dx)+'px',top:(e.clientY-dy)+'px',right:'auto'}); });
    document.addEventListener('mouseup',()=>drag=false);
    renderLog(); plog('панель построена');
  }
  buildUI();

  // обновление статуса + авто-восстановление панели, если SPA её снесла
  setInterval(()=>{
    if(!document.getElementById('mg-panel')){ panel=null; buildUI(); }
    if(!refs.sSock)return;
    const rs=gameWS?gameWS.readyState:-1;
    refs.sSock.val.textContent={[-1]:'не пойман',0:'connecting',1:'OPEN',2:'closing',3:'closed'}[rs];
    refs.sSock.dot.style.background=rs===1?'#23a559':(rs===-1?'#da373c':'#faa61a');
    refs.sState.val.textContent=state?'загружено':(gameWS?'ждём Welcome…':'нет');
    refs.sState.dot.style.background=state?'#23a559':'#da373c';
    refs.bReady.textContent=state?findReady().length:0;
    refs.bCnt.textContent=harvested;
    refs.bMode.textContent = !CFG.running?'СТОП':(CFG.dryRun?'ТЕСТ (dryRun — не собирает)':'БОЕВОЙ — собирает');
    refs.bMode.style.color = !CFG.running?'#72767d':(CFG.dryRun?'#faa61a':'#23a559');
  },600);

  // ───────────────────────── API + меню ─────────────────────────
  const MG={ state:()=>state,child,mySlot,garden,now,ws:()=>gameWS,send,harvest,sellAll,harvestNow,findReady,dump,report,
    auto:(o=true)=>{CFG.running=o;},dry:(o=true)=>{CFG.dryRun=o;},human:(o=true)=>{CFG.human=o;},setSlot:i=>{CFG.slotIndex=i;},
    show:()=>{ const e=document.getElementById('mg-panel'); if(e)e.remove(); panel=null; buildUI(); },
    cfg:CFG,seen:()=>({commands:[...seenCmd],quinoa:[...seenQ]}) };
  page.MG=MG; window.MG=MG;
  if(typeof GM_registerMenuCommand==='function') GM_registerMenuCommand('Показать панель MG',()=>MG.show());

  } catch(err){ console.error('%c[MG] ОШИБКА ЗАГРУЗКИ:','background:#da373c;color:#fff;padding:2px 6px',err); }
})();
