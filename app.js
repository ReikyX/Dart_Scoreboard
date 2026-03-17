/* ═══════════════════════════════════════════════════
   DART DASHBOARD  –  app.js  (v6)
   ═══════════════════════════════════════════════════ */
'use strict';

/* ─────────────────────────────────────────────────
   KONSTANTEN
───────────────────────────────────────────────── */
const GAME_MODES = {
  '301': { startScore:301 }, '501': { startScore:501 },
  '701': { startScore:701 }, 'cricket': { type:'cricket' },
};

const CRICKET_NUMS = [20,19,18,17,16,15,25];
// Dartboard order – used for both Keypad and SVG
const BOARD_NUMS   = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];

/* ─────────────────────────────────────────────────
   CHECKOUT-TABELLEN
   Computed once at startup; lazy would be slower
   than this ~60ms one-time cost.
───────────────────────────────────────────────── */
const CHECKOUT_TABLE = (() => {
  // Full dart list: T20..T1, Bull, D20..D1, Outer, 20..1
  const all = [];
  for (let n=20;n>=1;n--) all.push({l:`T${n}`,s:n*3});
  all.push({l:'Bull',s:50});
  for (let n=20;n>=1;n--) all.push({l:`D${n}`,s:n*2});
  all.push({l:'Outer',s:25});
  for (let n=20;n>=1;n--) all.push({l:`${n}`,s:n});

  // Double-Out finishes only
  const dbl = [{l:'Bull',s:50}];
  for (let n=20;n>=1;n--) dbl.push({l:`D${n}`,s:n*2});

  const doTbl = {};
  for (const d of dbl) if (!doTbl[d.s]) doTbl[d.s]=[d.l];
  for (const a of all) for (const d of dbl) { const t=a.s+d.s; if(t>=2&&t<=170&&!doTbl[t]) doTbl[t]=[a.l,d.l]; }
  for (const a of all) for (const b of all) for (const d of dbl) { const t=a.s+b.s+d.s; if(t>=2&&t<=170&&!doTbl[t]) doTbl[t]=[a.l,b.l,d.l]; }

  // Straight-Out: reuse `all`, fewest darts first (already sorted T>D>S by score desc)
  const soTbl = {};
  for (const f of all) if (!soTbl[f.s]&&f.s>=1) soTbl[f.s]=[f.l];
  for (const a of all) for (const f of all) { const t=a.s+f.s; if(t>=1&&t<=170&&!soTbl[t]) soTbl[t]=[a.l,f.l]; }
  for (const a of all) for (const b of all) for (const f of all) { const t=a.s+b.s+f.s; if(t>=1&&t<=170&&!soTbl[t]) soTbl[t]=[a.l,b.l,f.l]; }

  return { do:doTbl, so:soTbl };
})();

/* ─────────────────────────────────────────────────
   ZUSTAND
───────────────────────────────────────────────── */
let game           = null;
let outType        = 'straight';
let inputMode      = 'board';
let kMult          = 1;
let lastTurn       = null;
let _overlayActive = false;
let _overlayTimer  = null;
let histTabIdx     = 0;
let practiceMode   = false;
let botSpeed       = 900;
let _botTimer      = null;
let _pendingRestore= null;
let mobTab         = 'input';
let _mobBustTimer  = null;
let _muted = (() => { try { return localStorage.getItem('dartdash_muted')==='1'; } catch(e){return false;} })();

/* ─────────────────────────────────────────────────
   DOM-HELPERS
───────────────────────────────────────────────── */
const $    = id => document.getElementById(id);
const show = id => $(id) && $(id).classList.remove('hidden');
const hide = id => $(id) && $(id).classList.add('hidden');
const esc  = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/* ─────────────────────────────────────────────────
   HAPTIK
───────────────────────────────────────────────── */
function haptic(type='throw') {
  if (!navigator.vibrate) return;
  if (type==='throw') navigator.vibrate(28);
  else if (type==='bust') navigator.vibrate([30,40,90]);
  else if (type==='win')  navigator.vibrate([60,40,60,40,180]);
  else if (type==='undo') navigator.vibrate([20,30,20]);
}

/* ─────────────────────────────────────────────────
   TÖNE
───────────────────────────────────────────────── */
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) try { _audioCtx=new(window.AudioContext||window.webkitAudioContext)(); } catch(e){}
  if (_audioCtx && _audioCtx.state==='suspended') _audioCtx.resume().catch(()=>{});
  return _audioCtx;
}
// Pre-warm on first tap
document.addEventListener('pointerdown',()=>{
  if(!_audioCtx) try{_audioCtx=new(window.AudioContext||window.webkitAudioContext)();}catch(e){}
},{once:true});

function playTone(freq, dur, type='sine', gain=0.18) {
  if (_muted) return; // _muted is always declared before this is called
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const osc=ctx.createOscillator(), gn=ctx.createGain();
    osc.type=type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gn.gain.setValueAtTime(gain, ctx.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+dur);
    osc.connect(gn); gn.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime+dur);
  } catch(e) {}
}

function soundThrow() { playTone(440,0.08,'square',0.12); }
function soundMiss()  { playTone(180,0.12,'sawtooth',0.08); }
function soundBust()  { playTone(120,0.05,'sawtooth',0.15); setTimeout(()=>playTone(100,0.2,'sawtooth',0.12),60); }
function soundTurn()  { playTone(660,0.06,'sine',0.10); }
function soundWin()   { [523,659,784,1047].forEach((f,i)=>setTimeout(()=>playTone(f,0.22,'sine',0.18),i*120)); }
function sound180()   { [[660,.15],[880,.18],[1100,.22]].forEach(([f,g],i)=>setTimeout(()=>playTone(f,0.2,'square',g),i*85)); }
function soundUndo()  { playTone(330,0.07,'sine',0.1); setTimeout(()=>playTone(260,0.12,'sine',0.08),80); }

/* ─────────────────────────────────────────────────
   STUMM-MODUS
───────────────────────────────────────────────── */
function toggleMute() {
  _muted = !_muted;
  try { localStorage.setItem('dartdash_muted',_muted?'1':'0'); } catch(e){}
  updateMuteButtons();
}
function updateMuteButtons() {
  const icon = _muted ? '🔇' : '🔊';
  ['btn-mute','hdr-mute'].forEach(id=>{ const el=$(id); if(el) el.textContent=icon; });
}

/* ─────────────────────────────────────────────────
   SPIELLOGIK
───────────────────────────────────────────────── */
function createGame(mode, names) {
  const cfg = GAME_MODES[mode]||GAME_MODES['501'];
  const doubleOut = mode!=='cricket' && outType==='double';
  const players = names.map(name => mode==='cricket'
    ? { name, score:0, marks:Object.fromEntries(CRICKET_NUMS.map(n=>[String(n),0])), history:[], busts:0 }
    : { name, score:cfg.startScore, history:[], busts:0 }
  );
  return { mode, doubleOut, players, currentPlayerIdx:0, currentRound:1,
           throwsThisTurn:[], winner:null, active:true, undoStack:[], gameId:Date.now() };
}

function fmtThrow(base,mult) {
  if (base===0) return 'Miss';
  if (base===25&&mult===2) return 'BULL';
  if (base===25) return 'Outer';
  return ['','D','T'][mult-1]+base;
}

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function pushSnapshot(g, label) {
  g.undoStack.push({ state:deepClone({...g,undoStack:[]}), label });
}

function advanceTurn(g) {
  const cp=g.currentPlayerIdx;
  g.players[cp].history.push({round:g.currentRound, throws:[...g.throwsThisTurn]});
  g.throwsThisTurn=[];
  g.currentPlayerIdx=(cp+1)%g.players.length;
  if (g.currentPlayerIdx===0) g.currentRound++;
}

function processX01(g, throwObj) {
  const player=g.players[g.currentPlayerIdx];
  const newScore=player.score-throwObj.score;
  const dbl=g.doubleOut;

  let bust=newScore<0||(newScore===1&&dbl);
  if (!bust&&newScore===0&&dbl&&!(throwObj.multiplier===2||throwObj.score===50)) bust=true;

  if (bust) {
    player.score += g.throwsThisTurn.slice(0,-1).reduce((s,t)=>s+t.score,0);
    player.busts=(player.busts||0)+1;
    advanceTurn(g);
    return {bust:true,winner:null,autoNext:true};
  }
  player.score=newScore;
  if (newScore===0) { g.winner=player.name; g.active=false; advanceTurn(g); return {bust:false,winner:player.name,autoNext:true}; }
  return {bust:false,winner:null,autoNext:false};
}

function processCricket(g, throwObj) {
  const {base,multiplier:mult}=throwObj;
  if (!CRICKET_NUMS.includes(base)) return {bust:false,winner:null,autoNext:false};
  const cp=g.currentPlayerIdx, player=g.players[cp], key=String(base);
  const oldMarks=player.marks[key];
  player.marks[key]=Math.min(3,oldMarks+mult);
  const bonusHits=Math.max(0,oldMarks+mult-3);
  if (bonusHits>0 && g.players.some((p,i)=>i!==cp&&p.marks[key]<3))
    player.score+=bonusHits*(base===25?25:base);
  const allClosed=CRICKET_NUMS.every(n=>player.marks[String(n)]>=3);
  if (allClosed&&player.score>=Math.max(...g.players.map(p=>p.score))) {
    g.winner=player.name; g.active=false;
    return {bust:false,winner:player.name,autoNext:false};
  }
  return {bust:false,winner:null,autoNext:false};
}

function applyThrow(g, base, mult) {
  if (base===0) mult=1;
  if (base===25&&mult===3) return null;
  if (![1,2,3].includes(mult)) mult=1;
  if (!g.active||g.throwsThisTurn.length>=3) return null;
  pushSnapshot(g,`${g.players[g.currentPlayerIdx].name}: ${fmtThrow(base,mult)}`);
  const score=(base===25&&mult===2)?50:base*mult;
  const throwObj={base,multiplier:mult,score,label:fmtThrow(base,mult)};
  g.throwsThisTurn.push(throwObj);
  let result=g.mode==='cricket'?processCricket(g,throwObj):processX01(g,throwObj);
  if (g.throwsThisTurn.length>=3&&!result.winner&&!result.bust) { advanceTurn(g); result.autoNext=true; }
  return {throwObj,...result};
}

function applyUndo(g) {
  if (!g.undoStack.length) return false;
  const remaining=g.undoStack.slice(0,-1);
  const {state}=g.undoStack[g.undoStack.length-1];
  Object.keys(state).forEach(k=>{ g[k]=state[k]; });
  g.undoStack=remaining;
  return true;
}

function applyUndoToIndex(g,idx) {
  if (idx<0||idx>=g.undoStack.length) return false;
  const remaining=g.undoStack.slice(0,idx);
  const {state}=g.undoStack[idx];
  Object.keys(state).forEach(k=>{ g[k]=state[k]; });
  g.undoStack=remaining;
  return true;
}

/* ─────────────────────────────────────────────────
   PERSISTENZ
───────────────────────────────────────────────── */
const SAVE_KEY         = 'dartdash_game_v2';
const PLAYER_STATS_KEY = 'dartdash_pstats_v1';

function saveGameState() {
  if (!game) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(
      { game:deepClone({...game,undoStack:game.undoStack.slice(-20)}), outType, lastTurn, histTabIdx, inputMode, practiceMode }
    ));
  } catch(e) {
    if (e.name==='QuotaExceededError') console.warn('Speicher voll – Spielstand nicht gesichert.');
  }
}

function clearGameState() { try { localStorage.removeItem(SAVE_KEY); } catch(e){} }

function loadPlayerStats() {
  try { return JSON.parse(localStorage.getItem(PLAYER_STATS_KEY))||{}; } catch(e){ return {}; }
}

function savePlayerStats(name,stats) {
  try {
    const all=loadPlayerStats();
    const prev=all[name]||{games:0,wins:0,totalAvg:0,best180:0,totalBusts:0};
    all[name]={
      games: prev.games+1,
      wins:  prev.wins+(stats.isWinner?1:0),
      totalAvg: +((prev.totalAvg*prev.games+parseFloat(stats.avg3dart))/(prev.games+1)).toFixed(2),
      best180: prev.best180+(stats.has180?1:0),
      totalBusts: prev.totalBusts+stats.busts,
    };
    localStorage.setItem(PLAYER_STATS_KEY,JSON.stringify(all));
  } catch(e){}
}

/* ─────────────────────────────────────────────────
   SETUP
───────────────────────────────────────────────── */
function addPlayer() {
  const list=$('players-list');
  const cnt=list.querySelectorAll('.player-row').length;
  if (cnt>=4) {
    const msg=$('players-max-msg');
    if (msg) { msg.style.display='block'; setTimeout(()=>msg.style.display='none',2500); }
    return;
  }
  const row=document.createElement('div');
  row.className='player-row';
  row.innerHTML=`<input class="player-input" type="text" placeholder="Spieler ${cnt+1}" value="Spieler ${cnt+1}">
    <button class="btn-rm" onclick="rmPlayer(this)">✕</button>`;
  list.appendChild(row);
}

function rmPlayer(btn) {
  if (document.querySelectorAll('.player-row').length<=1) return;
  btn.closest('.player-row').remove();
}

function setOutType(type) {
  outType=type;
  const dBtn=$('out-btn-do'), sBtn=$('out-btn-so');
  if (dBtn) dBtn.classList.toggle('is-on',type==='double');
  if (sBtn) sBtn.classList.toggle('is-on',type==='straight');
}

document.addEventListener('change',e=>{
  if (e.target.name==='mode') {
    const wrap=$('out-toggle-wrap');
    if (wrap) wrap.style.display=e.target.value==='cricket'?'none':'';
  }
});
function togglePracticeMode() {
  // First click: show speed options. Second click on same button: start bot game.
  const wrap=$('bot-speed-wrap'), btn=$('btn-practice');
  if (!wrap) return;
  if (wrap.classList.contains('hidden')) {
    // Show options panel — wait for explicit start
    wrap.classList.remove('hidden');
    if (btn) btn.textContent='🤖 Jetzt starten →';
    if (btn) btn.classList.add('is-practice-active');
    if (btn) btn.onclick = () => startGame(true);
  } else {
    // Already open: close panel, restore button
    wrap.classList.add('hidden');
    if (btn) btn.textContent='🤖 Gegen Bot üben';
    if (btn) btn.classList.remove('is-practice-active');
    if (btn) btn.onclick = togglePracticeMode;
  }
}

function setBotSpeed(el) {
  botSpeed=parseInt(el.dataset.speed,10)||900;
  document.querySelectorAll('[data-speed]').forEach(b=>b.classList.toggle('is-on',b===el));
}

function startGame(withBot) {
  const mode=(document.querySelector('input[name="mode"]:checked')||{}).value||'501';
  const names=[...document.querySelectorAll('.player-input')].map(i=>i.value.trim()).filter(Boolean);
  if (!names.length) names.push('Spieler 1');
  practiceMode=!!withBot;
  if (practiceMode&&!names.includes('Bot 🤖')) names.push('Bot 🤖');

  game=createGame(mode,names);
  lastTurn=null; histTabIdx=0; _overlayActive=false;
  clearTimeout(_overlayTimer);
  kMult=1;
  inputMode='board';

  hide('last-turn-box');
  $('turn-end-overlay').classList.add('hidden');
  const badge=$('mode-badge');
  badge.textContent=mode!=='cricket'?mode+(outType==='double'?' DO':' SO'):'Cricket';
  badge.classList.remove('is-new'); void badge.offsetWidth; badge.classList.add('is-new');

  hide('screen-setup'); show('screen-game');
  buildKeypad(); buildBoard(); setMode('board');
  updateMuteButtons();
  render(); saveGameState();
  if (isMobile()) { const nav=$('mob-nav'); if(nav) nav.classList.remove('hidden'); setMobTab('input'); }
}

function goSetup() {
  clearTimeout(_botTimer);
  clearGameState();
  hide('screen-game'); hide('win-modal'); hide('mob-nav');
  show('screen-setup');
  game=null; lastTurn=null; practiceMode=false;
  _overlayActive=false; kMult=1; histTabIdx=0; inputMode='board';
  // reset practice button UI
  const wrap=$('bot-speed-wrap'), btn=$('btn-practice');
  if (wrap) wrap.classList.add('hidden');
  if (btn) { btn.textContent='🤖 Gegen Bot üben'; btn.classList.remove('is-practice-active'); btn.onclick=togglePracticeMode; }
}

/* ─────────────────────────────────────────────────
   SPIELAKTIONEN
───────────────────────────────────────────────── */
function doThrow(base,mult) {
  if (!game||!game.active||_overlayActive) return;
  if (game.throwsThisTurn.length>=3) return;

  const result=applyThrow(game,base,mult);
  if (!result) return;

  // Sound + haptic
  if (base===0) { soundMiss(); haptic('throw'); }
  else {
    const roundTotal=game.throwsThisTurn.reduce((s,t)=>s+t.score,0);
    if (roundTotal===180&&game.throwsThisTurn.length===3) { sound180(); haptic('throw'); }
    else { soundThrow(); haptic('throw'); }
  }
  // Visual hit on SVG segment + BULL flash
  _flashBoardHit(base, mult);

  // Turn-end overlay + last turn box
  if (result.bust||result.autoNext||result.winner) {
    const prevIdx=(result.autoNext||result.bust)
      ?(game.currentPlayerIdx===0?game.players.length-1:game.currentPlayerIdx-1)
      :game.currentPlayerIdx;
    const prevPlayer=game.players[prevIdx];
    const histEntry=prevPlayer.history[prevPlayer.history.length-1]
                  ||{throws:game.mode==='cricket'?[...game.throwsThisTurn]:[]};
    const total=histEntry.throws.reduce((s,t)=>s+t.score,0);
    lastTurn={playerName:prevPlayer.name, throws:histEntry.throws, total, bust:result.bust};
    showTurnEndOverlay(lastTurn);
    renderLastTurnBox(lastTurn);
    histTabIdx=prevIdx;
    if (!result.bust) soundTurn();
    kMult=1; setMult(1);
  }

  if (result.bust)   { soundBust(); haptic('bust'); flashBust(); flashMobBust(); if (_muted) flashScreen('bust'); }
  if (result.winner) { soundWin();  haptic('win');  if (_muted) flashScreen('win'); showWinner(result.winner); }

  // Dart hit ring visual on board
  if (base !== 0 && inputMode === 'board') spawnDartHitRing();

  render(); saveGameState();
  if (result.throwObj && game.mode !== 'cricket') {
    const aidx = (result.bust||result.autoNext)
      ? (game.currentPlayerIdx===0 ? game.players.length-1 : game.currentPlayerIdx-1)
      : game.currentPlayerIdx;
    setTimeout(()=>animateScoreChange(aidx), 60);
  }
  if (practiceMode&&game.active&&!result.winner) scheduleBotThrow();
}

function undo() {
  if (!game) return;
  if (applyUndo(game)) {
    clearTimeout(_overlayTimer);
    $('turn-end-overlay').classList.add('hidden');
    _overlayActive=false;
    lastTurn=null;
    hide('last-turn-box');
    hideBust(); clearMobBust();
    soundUndo(); haptic('undo');
    playUndoAnimation();
    render(); saveGameState();
  }
}

function playUndoAnimation() {
  // 1. Horizontal timeline sweep across top of game area
  const tl = document.createElement('div');
  tl.className = 'undo-timeline';
  document.body.appendChild(tl);
  setTimeout(() => tl.remove(), 550);

  // 2. All throw slots simultaneously shrink inward
  for (let i = 0; i < 3; i++) {
    const sl = $('s' + i);
    if (!sl) continue;
    sl.classList.add('undo-shrink');
    setTimeout(() => sl.classList.remove('undo-shrink'), 380);
  }

  // 4. Active score value springs upward (points returned)
  const activeCard = document.querySelector('.score-card.is-active');
  if (activeCard) {
    const val = activeCard.querySelector('.sc-val');
    if (val) {
      val.classList.add('undo-score-up');
      setTimeout(() => val.classList.remove('undo-score-up'), 480);
    }
  }

  // 5. Particle burst from undo button
  const undoBtn = document.querySelector('.hdr-undo');
  if (undoBtn) {
    const rect = undoBtn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    const colors = ['var(--gold)', 'var(--accent)', '#fff', 'var(--gold)'];
    for (let i = 0; i < 8; i++) {
      const p = document.createElement('div');
      p.className = 'undo-particle';
      const angle = (i / 8) * Math.PI * 2;
      const dist  = 28 + Math.random() * 18;
      p.style.cssText = `
        left:${cx}px; top:${cy}px;
        background:${colors[i % colors.length]};
        --tx:${Math.cos(angle) * dist}px;
        --ty:${Math.sin(angle) * dist}px;
        --dur:${.3 + Math.random() * .15}s;
      `;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 500);
    }
  }
}

function undoToIndex(idx) {
  if (!game) return;
  if (applyUndoToIndex(game,idx)) {
    clearTimeout(_overlayTimer);
    $('turn-end-overlay').classList.add('hidden');
    _overlayActive=false;
    hideBust(); clearMobBust();
    hide('undo-history-panel');
    soundUndo(); haptic('undo');
    render(); saveGameState();
  }
}

function confirmSkip() {
  if (!game) return;
  const cp=game.players[game.currentPlayerIdx];
  showConfirmModal(`Zug von ${esc(cp.name)} überspringen?`, ()=>{
    pushSnapshot(game,`${cp.name}: Überspringen`);
    advanceTurn(game);
    render(); saveGameState();
  });
}

/* ─────────────────────────────────────────────────
   CONFIRM MODAL (kein native confirm/alert/prompt)
───────────────────────────────────────────────── */
function showConfirmModal(message, onConfirm, title) {
  let modal=$('confirm-modal');
  if (!modal) {
    modal=document.createElement('div');
    modal.id='confirm-modal'; modal.className='confirm-modal-bg hidden';
    modal.innerHTML=`<div class="confirm-card">
      <div class="confirm-title hidden" id="confirm-title"></div>
      <div class="confirm-msg" id="confirm-msg"></div>
      <input class="confirm-input hidden" id="confirm-input" type="text">
      <div class="confirm-btns">
        <button class="confirm-btn-yes" id="confirm-yes">Ja</button>
        <button class="confirm-btn-no" onclick="closeConfirmModal()">Abbrechen</button>
      </div>
    </div>`;
    modal.addEventListener('click',e=>{ if(e.target===modal) closeConfirmModal(); });
    document.body.appendChild(modal);
  }
  const isInput=message.startsWith('__input__:');
  const titleEl=$('confirm-title'), msgEl=$('confirm-msg'), inpEl=$('confirm-input'), yesBtn=$('confirm-yes');
  if (title) { titleEl.textContent=title; titleEl.classList.remove('hidden'); } else titleEl.classList.add('hidden');
  if (isInput) {
    msgEl.classList.add('hidden'); inpEl.value=message.slice(10); inpEl.classList.remove('hidden');
    yesBtn.textContent='Speichern';
    yesBtn.onclick=()=>{ const v=inpEl.value.trim(); closeConfirmModal(); if(v) onConfirm(v); };
    inpEl.onkeydown=e=>{ if(e.key==='Enter') yesBtn.click(); };
    setTimeout(()=>{ inpEl.focus(); inpEl.select(); },80);
  } else {
    msgEl.textContent=message; msgEl.classList.remove('hidden'); inpEl.classList.add('hidden');
    yesBtn.textContent='Ja';
    yesBtn.onclick=()=>{ closeConfirmModal(); onConfirm(); };
  }
  modal.classList.remove('hidden'); void modal.offsetWidth; modal.classList.add('is-open');
}
function closeConfirmModal() {
  const m=$('confirm-modal');
  if (m) { m.classList.remove('is-open'); setTimeout(()=>m.classList.add('hidden'),200); }
}

/* ─────────────────────────────────────────────────
   BOT
───────────────────────────────────────────────── */
function scheduleBotThrow() {
  if (!game||!game.active||!practiceMode||_overlayActive) return;
  const bi=game.players.findIndex(p=>p.name==='Bot 🤖');
  if (bi<0||game.currentPlayerIdx!==bi) return;
  clearTimeout(_botTimer);
  const gid=game.gameId;
  _botTimer=setTimeout(()=>{ if(game&&game.gameId===gid) doBotThrow(); }, botSpeed);
}

function doBotThrow() {
  if (!game||!game.active||_overlayActive||!practiceMode) return;
  const bi=game.players.findIndex(p=>p.name==='Bot 🤖');
  if (bi<0||game.currentPlayerIdx!==bi) return;
  const score=game.players[bi].score;
  if (game.mode==='cricket') {
    const priority=[20,19,18,17,16,15,25];
    const open=priority.filter(n=>game.players[bi].marks[String(n)]<3);
    const bonus=priority.filter(n=>game.players[bi].marks[String(n)]>=3&&game.players.some((p,i)=>i!==bi&&p.marks[String(n)]<3));
    const target=open.length?open[0]:(bonus.length?bonus[0]:priority[0]);
    const mult=Math.random()<0.4?3:Math.random()<0.6?2:1;
    doThrow(target,Math.min(mult,target===25?2:3));
  } else {
    const tbl=game.doubleOut?CHECKOUT_TABLE.do:CHECKOUT_TABLE.so;
    const co=tbl[score];
    if (co&&co.length<=3-game.throwsThisTurn.length) {
      const [m,b]=parseDartLabel(co[game.throwsThisTurn.length]);
      if (b) { doThrow(b,m); return; }
    }
    const r=Math.random();
    if (r<0.45) doThrow(20,3);
    else if (r<0.7) doThrow(19,3);
    else if (r<0.82) doThrow(Math.ceil(Math.random()*20),1);
    else doThrow(0,1);
  }
}

function parseDartLabel(l) {
  if (!l||l==='Miss')  return [1,0];
  if (l==='Bull')      return [2,25];
  if (l==='Outer')     return [1,25];
  if (l.startsWith('T')) return [3,parseInt(l.slice(1))];
  if (l.startsWith('D')) return [2,parseInt(l.slice(1))];
  return [1,parseInt(l)];
}

/* ─────────────────────────────────────────────────
   INPUT-MODUS / TASTATUR
───────────────────────────────────────────────── */
function setMode(m) {
  inputMode=m;
  if (m==='board') { show('board-wrap'); hide('keypad-wrap'); $('tog-board').classList.add('is-on'); $('tog-keypad').classList.remove('is-on'); }
  else             { hide('board-wrap'); show('keypad-wrap'); $('tog-keypad').classList.add('is-on'); $('tog-board').classList.remove('is-on'); }
}

function setMult(m) {
  kMult=m;
  document.querySelectorAll('.mult-btn').forEach(b=>b.classList.toggle('is-on',+b.dataset.m===m));
  updateKeypadStyle();
}

function updateKeypadStyle() {
  if (!game) return;
  const isCricket=game.mode==='cricket';
  document.querySelectorAll('.n-btn[data-num]').forEach(btn=>{
    const n=+btn.dataset.num, isCN=CRICKET_NUMS.includes(n);
    btn.classList.toggle('is-dim',isCricket&&!isCN);
    btn.classList.toggle('is-cricket-num',isCricket&&isCN);
    btn.classList.remove('mult-double','mult-triple');
    if (!isCricket||isCN) { if(kMult===2) btn.classList.add('mult-double'); if(kMult===3) btn.classList.add('mult-triple'); }
  });
}

(function initKeyboard() {
  let buf='', timer=null;
  document.addEventListener('keydown',e=>{
    // Setup screen: Enter starts game
    if ($('screen-setup')&&!$('screen-setup').classList.contains('hidden')) {
      if (e.key==='Enter'&&e.target.tagName!=='BUTTON') { e.preventDefault(); startGame(false); return; }
    }
    if (!game||!game.active||_overlayActive) return;
    if (e.target.tagName==='INPUT') return;
    const k=e.key.toLowerCase();
    if (k==='d') { setMult(2); return; }
    if (k==='t') { setMult(3); return; }
    if (k==='s') { setMult(1); return; }
    if (k==='b') { doThrow(25,2); return; }
    if (k==='o') { doThrow(25,1); return; }
    if (k==='m') { doThrow(0,1); return; }
    if (k==='z') { undo(); return; }
    if (k==='escape') { setMult(1); buf=''; return; }
    if (/^[0-9]$/.test(e.key)) {
      buf+=e.key; clearTimeout(timer);
      const n=parseInt(buf,10);
      if (n>=10) { if(n<=20) doThrow(n,kMult); buf=''; return; }
      timer=setTimeout(()=>{ const num=parseInt(buf,10); if(num>=1&&num<=20) doThrow(num,kMult); buf=''; },400);
    }
  });
})();


/* ─────────────────────────────────────────────────
   RIPPLE EFFECT on buttons
───────────────────────────────────────────────── */
document.addEventListener('pointerdown', e => {
  const btn = e.target.closest('button, .sp-item, .mode-card');
  if (!btn) return;
  const computed = window.getComputedStyle(btn);
  // Only proceed if button has a proper stacking context (position not static)
  // Force relative if currently static so ripple positions correctly
  if (computed.position === 'static') btn.style.position = 'relative';
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.4;
  const x = e.clientX - rect.left - size / 2;
  const y = e.clientY - rect.top  - size / 2;
  const r = document.createElement('span');
  r.className = 'btn-ripple';
  r.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px;position:absolute;pointer-events:none;z-index:99;overflow:visible`;
  // Clip to button bounds via overflow:hidden on the button
  const prevOverflow = btn.style.overflow;
  btn.style.overflow = 'hidden';
  btn.appendChild(r);
  setTimeout(() => {
    r.remove();
    if (!prevOverflow) btn.style.overflow = '';
  }, 520);
});

function animateScoreChange(idx) {
  const el = document.getElementById('sc-val-'+idx);
  if (!el) return;
  el.classList.remove('is-changed');
  void el.offsetWidth;
  el.classList.add('is-changed');
  setTimeout(() => el.classList.remove('is-changed'), 400);
}

let _lastHeaderName = '';
function animateHeaderName(newName) {
  const el = $('hdr-active-name');
  if (!el) return;
  if (newName === _lastHeaderName) { el.textContent = newName; return; }
  _lastHeaderName = newName;
  el.classList.add('is-changing');
  setTimeout(() => { el.textContent = newName; el.classList.remove('is-changing'); }, 180);
}

/* ─────────────────────────────────────────────────
   RENDER
───────────────────────────────────────────────── */
function render() {
  if (!game) return;
  const rnEl = $('round-num');
  const prevRound = rnEl ? rnEl.textContent : null;
  if (rnEl) {
    rnEl.textContent = game.currentRound;
    if (prevRound && String(game.currentRound) !== prevRound) {
      rnEl.classList.remove('round-num-bump');
      void rnEl.offsetWidth;
      rnEl.classList.add('round-num-bump');
      setTimeout(() => rnEl.classList.remove('round-num-bump'), 500);
    }
  }
  renderHeader();
  renderScoreboard();
  renderTurnPanel();
  renderRoundTable();
  renderCheckout();
  renderUndoHistory();
  renderHistTabs();
  updateKeypadStyle();
  renderMobScoreStrip();
  renderMobThrowRow();
}

function renderHeader() {
  const cp=game.players[game.currentPlayerIdx];
  animateHeaderName(cp.name);
  const scoreEl=$('hdr-active-score');
  let newVal;
  if (game.mode==='cricket') {
    const closed=Object.values(cp.marks).filter(m=>m>=3).length;
    newVal=`${closed}/7 ✕`;
  } else {
    newVal=String(cp.score);
  }
  if (scoreEl.textContent !== newVal) {
    scoreEl.textContent=newVal;
    scoreEl.classList.remove('is-updated'); void scoreEl.offsetWidth; scoreEl.classList.add('is-updated');
    setTimeout(()=>scoreEl.classList.remove('is-updated'),350);
  }
}

function renderScoreboard() {
  $('scoreboard').innerHTML=game.mode==='cricket'?renderCricket():renderX01();
}

function renderX01() {
  return game.players.map((p,i)=>{
    const act=i===game.currentPlayerIdx;
    return `<div class="score-card ${act?'is-active':''}">
      <div class="sc-name" ondblclick="editPlayerName(${i})" title="Doppelklick zum Bearbeiten">${act?'▶ ':''}${esc(p.name)}</div>
      <div class="sc-val" id="sc-val-${i}">${p.score}</div>
      <div class="sc-avg">Ø ${p.history.length?(p.history.reduce((s,r)=>s+r.throws.reduce((a,t)=>a+t.score,0),0)/p.history.length).toFixed(1):'0.0'} / Runde</div>
    </div>`;
  }).join('');
}

function renderCricket() {
  const nums=[20,19,18,17,16,15,25],ps=game.players,cp=game.currentPlayerIdx;
  let h='<div class="cricket-tbl">';
  h+='<div class="cr-row cr-head"><div class="cr-num"></div>';
  ps.forEach((p,i)=>{ h+=`<div class="cr-p ${i===cp?'is-cur':''}" ondblclick="editPlayerName(${i})">${esc(p.name)}</div>`; });
  h+='</div>';
  nums.forEach(n=>{
    const curMarks=ps[cp].marks[String(n)]||0, isClosed=curMarks>=3;
    const bonusOpp=isClosed&&ps.some((p,i)=>i!==cp&&(p.marks[String(n)]||0)<3);
    const numCls=!isClosed?'cr-open':bonusOpp?'cr-bonus':'';
    h+=`<div class="cr-row"><div class="cr-num ${numCls}">${n===25?'Bull':n}</div>`;
    ps.forEach(p=>{ const m=p.marks[String(n)]||0; h+=`<div class="cr-marks ${m>=3?'is-closed':''}">${['','∕','✕','⊙'][Math.min(m,3)]}</div>`; });
    h+='</div>';
  });
  h+='<div class="cr-row cr-scores"><div class="cr-num">Pts</div>';
  ps.forEach((p,i)=>{ h+=`<div class="cr-p ${i===cp?'is-cur':''}">${p.score}</div>`; });
  h+='</div></div>';
  return h;
}

function editPlayerName(idx) {
  if (!game) return;
  const cur=game.players[idx].name;
  showConfirmModal('__input__:'+cur, newName=>{
    if (!newName||newName===cur) return;
    game.undoStack.forEach(e=>{ if(e.label.startsWith(cur+':')) e.label=e.label.replace(cur+':',newName+':'); });
    game.players[idx].name=newName;
    render(); saveGameState();
  },'Spielername ändern');
}

function renderTurnPanel() {
  const cp=game.players[game.currentPlayerIdx];
  $('turn-player').textContent=cp.name;
  const throws=game.throwsThisTurn;
  for (let i=0;i<3;i++) {
    const sl=$('s'+i);
    if (i<throws.length) { sl.textContent=throws[i].label; sl.classList.remove('is-empty'); sl.classList.add('is-filled'); }
    else { sl.textContent=''; sl.classList.add('is-empty'); sl.classList.remove('is-filled'); }
  }
  const total=throws.reduce((s,t)=>s+t.score,0);
  $('turn-summary').textContent=game.mode!=='cricket'?`Punkte: ${total}  |  Verbleibend: ${cp.score}`:`Würfe: ${throws.length} / 3`;
}

function renderHistTabs() {
  if (!game) return;
  if (histTabIdx>=game.players.length) histTabIdx=0;
  $('hist-tabs').innerHTML=game.players.map((p,i)=>
    `<button class="hist-tab ${i===histTabIdx?'is-active':''}" onclick="setHistTab(${i})">${esc(p.name)}</button>`
  ).join('');
  renderHistList();
}
function setHistTab(idx) { histTabIdx=idx; renderHistTabs(); }

function renderHistList() {
  const el=$('hist-list');
  const player=game.players[histTabIdx]||game.players[0];
  const hist=player.history||[];
  const showAll=el.dataset.showAll==='1';
  if (!hist.length) { el.innerHTML='<div class="hist-none">Noch keine Runden</div>'; return; }
  // Use spread to avoid mutating the original history array
  const slice=[...(showAll?hist:hist.slice(-10))].reverse();
  let html=slice.map(h=>{
    const labels=h.throws.map(t=>t.label).join(' · ')||'—';
    const pts=h.throws.reduce((s,t)=>s+t.score,0);
    const missAll=h.throws.length>0&&h.throws.every(t=>t.base===0);
    const extra=missAll?' hist-all-miss':(pts===0&&h.throws.length>0?' hist-bust':'');
    const badge=pts===180?' <span class="hist-badge-180">180!</span>':'';
    return `<div class="hist-entry${extra}">Rd ${h.round}: ${esc(labels)}${badge} <span class="hist-pts">(${pts})</span></div>`;
  }).join('');
  if (hist.length>10) {
    html+=`<button class="hist-showall" onclick="toggleHistAll()">${showAll?'↑ Weniger':'↓ Alle ('+hist.length+')'}</button>`;
  }
  el.innerHTML=html;
}
function toggleHistAll() {
  const el=$('hist-list');
  el.dataset.showAll=el.dataset.showAll==='1'?'0':'1';
  renderHistList();
}

function renderRoundTable() {
  const el=$('round-table'), players=game.players;
  const maxRound=players.reduce((m,p)=>{const l=p.history[p.history.length-1];return l?Math.max(m,l.round):m;},0);
  if (!maxRound) { el.innerHTML='<div class="rt-none">Noch keine Runde abgeschlossen</div>'; return; }
  const roundTotals={};
  players.forEach((p,pi)=>p.history.forEach(h=>{
    if(!roundTotals[h.round]) roundTotals[h.round]={};
    roundTotals[h.round][pi]=h.throws.reduce((s,t)=>s+t.score,0);
  }));
  const grandTotals=players.map(p=>p.history.reduce((s,h)=>s+h.throws.reduce((a,t)=>a+t.score,0),0));
  let html='<table class="round-table"><thead><tr><th class="rt-rd">RD</th>';
  players.forEach(p=>{html+=`<th>${esc(p.name)}</th>`;});
  html+='</tr></thead><tbody>';
  for (let r=1;r<=maxRound;r++) {
    const row=roundTotals[r]||{}, vals=players.map((_,pi)=>row[pi]!==undefined?row[pi]:null);
    const filtered=vals.filter(v=>v!==null), maxVal=filtered.length?Math.max(...filtered):-1;
    html+=`<tr><td class="rt-rd">R${r}</td>`;
    players.forEach((_,pi)=>{
      const v=vals[pi];
      if(v===null){html+='<td style="color:var(--dim)">—</td>';return;}
      html+=`<td class="${v===maxVal&&maxVal>0&&filtered.filter(x=>x===maxVal).length===1?'rt-best':''}">${v}</td>`;
    });
    html+='</tr>';
  }
  const maxGrand=grandTotals.length?Math.max(...grandTotals):0;
  html+='<tr class="rt-total"><td class="rt-rd">∑</td>';
  grandTotals.forEach(t=>{html+=`<td class="${t===maxGrand&&grandTotals.filter(x=>x===maxGrand).length===1?'rt-best':''}">${t}</td>`;});
  html+='</tr></tbody></table>';
  el.innerHTML=html;
}

function renderCheckout() {
  const el=$('checkout-box');
  if (!game||!game.active||game.mode==='cricket') { hide('checkout-box'); return; }
  const cp=game.players[game.currentPlayerIdx];
  const remaining=cp.score, dartsLeft=3-game.throwsThisTurn.length;
  if (remaining<(game.doubleOut?2:1)) { hide('checkout-box'); return; }
  const tbl=game.doubleOut?CHECKOUT_TABLE.do:CHECKOUT_TABLE.so;
  const co=tbl[remaining];
  if (!co||co.length>dartsLeft) { hide('checkout-box'); return; }
  const badges=co.map(d=>{
    let cls='co-dart';
    if(d.startsWith('T')) cls+=' co-triple';
    else if(d.startsWith('D')||d==='Bull') cls+=' co-double';
    return `<span class="${cls}">${esc(d)}</span>`;
  }).join('<span class="co-arrow">→</span>');
  el.innerHTML=`<div class="co-header">🎯 CHECKOUT MÖGLICH</div><div class="co-darts">${badges}</div><div class="co-score">${remaining} Punkte · ${dartsLeft} Dart${dartsLeft!==1?'s':''} übrig</div>`;
  show('checkout-box');
}

function renderUndoHistory() {
  const el=$('undo-history-list'), stack=game?game.undoStack:[];
  const badge=$('undo-history-badge');
  if (badge) badge.textContent=stack.length||'';
  if (!stack.length) { el.innerHTML='<div class="uh-empty">Kein Verlauf vorhanden</div>'; return; }
  el.innerHTML=[...stack].reverse().map((entry,ri)=>{
    const idx=stack.length-1-ri;
    return `<div class="uh-entry"><span class="uh-label">${esc(entry.label)}</span><button class="uh-btn" onclick="undoToIndex(${idx})">↩ Hierher</button></div>`;
  }).join('');
}
function toggleUndoHistory() {
  const p=$('undo-history-panel');
  if(p.classList.contains('hidden')){renderUndoHistory();show('undo-history-panel');}else hide('undo-history-panel');
}

/* ─────────────────────────────────────────────────
   BUST / OVERLAYS
───────────────────────────────────────────────── */

function _flashBoardHit(base, mult) {
  // Bull flash overlay
  if (base === 25) {
    const f = document.createElement('div');
    f.className = 'bull-flash';
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 550);
    return;
  }
  // Highlight matching SVG path (board segment)
  if (base === 0) return; // miss — no highlight
  const svg = $('dart-svg');
  if (!svg) return;
  // Find segments by tooltip label
  const label = mult === 3 ? `T${base}=` : mult === 2 ? `D${base}=` : `${base}`;
  const segs = svg.querySelectorAll('.board-seg');
  segs.forEach(seg => {
    const tip = seg.getAttribute('data-label') || '';
    // We rely on the mousemove listener's label; instead match by brute force
    // Use a brief brightness flash on segments near the throw
  });
  // Simpler: flash the entire board briefly
  svg.style.transition = 'filter .05s';
  svg.style.filter = 'drop-shadow(0 0 16px rgba(0,0,0,.95)) drop-shadow(0 6px 14px rgba(0,0,0,.8)) brightness(1.35)';
  setTimeout(() => {
    svg.style.filter = '';
    svg.style.transition = '';
  }, 140);
}

function flashBust() { show('bust-box'); setTimeout(hideBust,2200); }
function hideBust()  { hide('bust-box'); }

// Visual screen-flash for important events when muted
function flashScreen(type) {
  const el = document.createElement('div');
  el.className = 'screen-flash screen-flash-' + type;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.classList.add('is-active');
    setTimeout(() => { el.classList.remove('is-active'); setTimeout(() => el.remove(), 400); }, 120);
  });
}

function showTurnEndOverlay(turn) {
  clearTimeout(_overlayTimer); _overlayActive=true;
  const el=$('turn-end-overlay');
  const nextLine=turn._nextPlayer?`<div class="te-next">Weiter: ${esc(turn._nextPlayer)}</div>`:'';
  el.innerHTML=`<div class="turn-end-card ${turn.bust?'is-bust':''}">
    <div class="te-name">${esc(turn.playerName)}</div>
    <div class="te-throws">${turn.throws.map(t=>`<div class="te-throw">${esc(t.label)}</div>`).join('')}</div>
    <div class="te-total">${turn.bust?'BUST':turn.total}</div>
    <div class="te-total-label">${turn.bust?'PUNKTE VERFALLEN':'PUNKTE DIESE RUNDE'}</div>
    ${nextLine}
  </div>`;
  el.classList.add('hidden'); void el.offsetWidth; el.classList.remove('hidden');
  _overlayTimer=setTimeout(()=>{
    el.classList.add('hidden'); _overlayActive=false;
    if (practiceMode&&game&&game.active) scheduleBotThrow();
  },2900);
}

function renderLastTurnBox(turn) {
  if (!turn) { hide('last-turn-box'); return; }
  $('lt-name').textContent=turn.playerName;
  $('lt-throws').innerHTML=turn.throws.map(t=>`<span class="lt-throw">${esc(t.label)}</span>`).join('');
  const totalEl=$('lt-total');
  if (turn.bust) { totalEl.textContent='💥 BUST – 0 Punkte'; totalEl.className='lt-total is-bust'; }
  else { totalEl.textContent=`Gesamt: ${turn.total} Punkte`; totalEl.className='lt-total'; }
  show('last-turn-box');
}

/* ─────────────────────────────────────────────────
   GEWINNER
   QR-Fix: only encode short text, no URL in data
───────────────────────────────────────────────── */
function calcStats(g) {
  const stats={};
  g.players.forEach(p=>{
    const allThrows=p.history.flatMap(h=>h.throws);
    const rounds=p.history.length, total=allThrows.reduce((s,t)=>s+t.score,0);
    stats[p.name]={
      avg3dart: rounds>0?(total/rounds).toFixed(1):'0.0',
      best: p.history.reduce((m,h)=>{ const pts=h.throws.reduce((s,t)=>s+t.score,0); return pts>m?pts:m; },0),
      busts: p.busts||0,
      misses: allThrows.filter(t=>t.base===0).length, rounds,
    };
  });
  return stats;
}

function showWinner(name) {
  const mLabel=game.mode!=='cricket'?game.mode+(game.doubleOut?' Double Out':' Straight Out'):'Cricket';
  $('win-name').textContent=name;
  $('win-sub').textContent=`${mLabel} · Runde ${game.currentRound-1}`;

  const stats=calcStats(game);
  const statsEl=$('win-stats');
  if (statsEl) statsEl.innerHTML=game.players.map(p=>{
    const s=stats[p.name], isW=p.name===name;
    return `<div class="ws-row ${isW?'ws-winner':''}">
      <div class="ws-name">${esc(p.name)}</div>
      <div class="ws-stat"><span>Ø</span>${s.avg3dart}</div>
      <div class="ws-stat"><span>Best</span>${s.best}</div>
      <div class="ws-stat"><span>Bust</span>${s.busts}</div>
      <div class="ws-stat"><span>Miss</span>${s.misses}</div>
    </div>`;
  }).join('');

  // Punt QR-Fix: encode ONLY the short result text — no URL, no emoji
  try {
    const qrEl=$('win-qr');
    if (qrEl) {
      const text=`${name} gewinnt! ${mLabel} Runde ${game.currentRound-1}`;
      const qrUrl=`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(text)}&format=png&margin=4`;
      const img=document.createElement('img');
      img.src=qrUrl; img.alt='QR';
      img.style.cssText='width:100px;height:100px;border-radius:6px;display:block;';
      img.onerror=()=>{ qrEl.style.display='none'; };
      const lbl=document.createElement('div');
      lbl.style.cssText='font-size:.52rem;color:var(--dim);margin-top:.35rem;letter-spacing:.08em;text-align:center;';
      lbl.textContent='ERGEBNIS TEILEN';
      qrEl.innerHTML=''; qrEl.appendChild(img); qrEl.appendChild(lbl);
    }
  } catch(e){}

  // Persistent stats (excluding bot)
  game.players.forEach(p=>{
    if (p.name==='Bot 🤖') return;
    const s=stats[p.name];
    const has180=p.history.some(h=>h.throws.reduce((a,t)=>a+t.score,0)===180);
    savePlayerStats(p.name,{...s, isWinner:p.name===name, has180});
  });

  clearGameState();
  show('win-modal');
  spawnWinConfetti();
  _launchConfetti();
}

function _launchConfetti() {
  const symbols = ['🎯','⭐','✨','🏆','🎉','💥','★','✦'];
  for (let i = 0; i < 22; i++) {
    const el = document.createElement('div');
    el.className = 'win-confetti-star';
    el.textContent = symbols[i % symbols.length];
    el.style.cssText = `
      left: ${10 + Math.random()*80}%;
      --dur: ${1.4 + Math.random()*1.2}s;
      --delay: ${Math.random()*.8}s;
      font-size: ${.8+Math.random()*.8}rem;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
}
function startRematch() {
  if (!game) return;
  // Show brief confirmation countdown on button
  const btn = document.querySelector('.btn-rematch');
  if (btn && !btn.dataset.confirmed) {
    btn.dataset.confirmed = '1';
    btn.textContent = '↺ Sicher? (3)';
    let t = 3;
    const iv = setInterval(() => {
      t--;
      if (t <= 0) {
        clearInterval(iv);
        btn.dataset.confirmed = '';
        btn.textContent = '↺ Revanche';
        executeRematch();
      } else {
        btn.textContent = '↺ Sicher? (' + t + ')';
      }
    }, 1000);
    setTimeout(() => {
      if (btn.dataset.confirmed) {
        clearInterval(iv);
        btn.dataset.confirmed = '';
        btn.textContent = '↺ Revanche';
      }
    }, 4000);
    return;
  }
  executeRematch();
}

function executeRematch() {
  if (!game) return;
  const mode=game.mode, names=game.players.map(p=>p.name);
  const wasDoubleOut=game.doubleOut;
  outType=wasDoubleOut?'double':'straight';
  game=createGame(mode,names);
  lastTurn=null; histTabIdx=0; _overlayActive=false;
  clearTimeout(_overlayTimer);
  kMult=1; inputMode='board';
  // Build everything BEFORE showing (avoids blank-board flash)
  $('mode-badge').textContent=mode!=='cricket'?mode+(wasDoubleOut?' DO':' SO'):'Cricket';
  buildKeypad(); buildBoard(); setMode('board');
  hide('last-turn-box'); $('turn-end-overlay').classList.add('hidden');
  hide('win-modal');
  render(); saveGameState();
  if (practiceMode) scheduleBotThrow();
}

/* ─────────────────────────────────────────────────
   BESTENLISTE
───────────────────────────────────────────────── */
function openPlayerStats() {
  const all=loadPlayerStats(), keys=Object.keys(all);
  let modal=$('pstats-modal');
  if (!modal) {
    modal=document.createElement('div'); modal.id='pstats-modal'; modal.className='style-picker-bg hidden';
    modal.innerHTML=`<div class="style-picker-card"><div class="sp-header"><span class="sp-title">📈 BESTENLISTE</span><button class="sp-close" onclick="closePlayerStats()">✕</button></div><div id="pstats-body"></div></div>`;
    modal.addEventListener('click',e=>{ if(e.target===modal) closePlayerStats(); });
    document.body.appendChild(modal);
  }
  const body=modal.querySelector('#pstats-body');
  if (!keys.length) {
    body.innerHTML='<div style="color:var(--dim);font-size:.75rem;text-align:center;padding:1.5rem">Noch keine Spiele gespeichert.</div>';
  } else {
    const sorted=keys.sort((a,b)=>(all[b].wins||0)-(all[a].wins||0));
    body.innerHTML=`<table class="round-table" style="width:100%">
      <thead><tr><th class="rt-rd">Spieler</th><th>Spiele</th><th>Siege</th><th>Win%</th><th>Ø</th><th>Busts</th></tr></thead>
      <tbody>${sorted.map(n=>{ const s=all[n],pct=s.games?Math.round(s.wins/s.games*100):0;
        return `<tr><td class="rt-rd">${esc(n)}</td><td>${s.games}</td><td>${s.wins}</td><td class="${pct>=50?'rt-best':''}">${pct}%</td><td>${s.totalAvg.toFixed(1)}</td><td>${s.totalBusts||0}</td></tr>`;
      }).join('')}</tbody></table>
    <div style="text-align:right;margin-top:.75rem">
      <button class="uh-btn" onclick="showConfirmModal('Alle Statistiken löschen?',()=>{try{localStorage.removeItem(PLAYER_STATS_KEY);}catch(e){}closePlayerStats();})">Zurücksetzen</button>
    </div>`;
  }
  modal.classList.remove('hidden'); void modal.offsetWidth; modal.classList.add('is-open');
}
function closePlayerStats() { const m=$('pstats-modal'); if(m){m.classList.remove('is-open');setTimeout(()=>m.classList.add('hidden'),250);} }

/* ─────────────────────────────────────────────────
   KEYPAD
───────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────
   ANIMATION HELPERS
───────────────────────────────────────────────── */
function spawnDartHitRing() {
  const wrap = $('board-wrap');
  if (!wrap) return;
  const svg  = $('dart-svg');
  if (!svg)  return;
  const ring = document.createElement('div');
  ring.className = 'dart-hit-ring';
  const svgR = svg.getBoundingClientRect();
  const wrapR = wrap.getBoundingClientRect();
  // Place at center of board
  ring.style.left = (svgR.left - wrapR.left + svgR.width / 2) + 'px';
  ring.style.top  = (svgR.top  - wrapR.top  + svgR.height / 2) + 'px';
  ring.style.setProperty('--accent', getComputedStyle(document.body).getPropertyValue('--accent').trim());
  wrap.appendChild(ring);
  setTimeout(() => ring.remove(), 600);
}

function spawnWinConfetti() {
  const modal = $('win-modal');
  if (!modal) return;
  const card  = modal.querySelector('.modal-card');
  if (!card)  return;
  const colors = ['var(--accent)','var(--gold)','var(--red)','var(--green)','#fff'];
  for (let i = 0; i < 24; i++) {
    const el = document.createElement('div');
    el.className = 'win-confetti';
    el.style.cssText = `
      left: ${10 + Math.random() * 80}%;
      top:  ${-5 + Math.random() * 15}%;
      background: ${colors[Math.floor(Math.random()*colors.length)]};
      --dur: ${1.2 + Math.random() * .8}s;
      --delay: ${Math.random() * .6}s;
      --spin: ${180 + Math.floor(Math.random()*360)}deg;
      width: ${6 + Math.random() * 6}px;
      height: ${6 + Math.random() * 6}px;
      border-radius: ${Math.random() > .5 ? '50%' : '2px'};
    `;
    card.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }
}

function buildKeypad() {
  const grid=$('num-grid'); grid.innerHTML='';
  // Sequential 1–20 for intuitive keypad layout
  Array.from({length:20},(_,i)=>i+1).forEach(n=>{
    const b=document.createElement('button');
    b.className='n-btn'; b.textContent=n; b.dataset.num=n;
    b.onclick=()=>doThrow(n,kMult);
    grid.appendChild(b);
  });
}

/* ─────────────────────────────────────────────────
   DARTBOARD SVG
───────────────────────────────────────────────── */
const CX=230,CY=230,RB=21,ROB=52,RTI=52,RTO=99,RDI=157,RDO=181,RNUM=218,RRIM=229;

const BOARD_STYLES={
  // ── Original 10 ───────────────────────────────────────────────────────────
  classic: {name:'Classic', desc:'Traditionell',      dark:'#100e08',light:'#e8d49c',ring:['#1a6b30','#b01818'],bullG:'#1a6b30',bullR:'#b01818',rim:'#0a0806',wire:'#d4b84a',num:'#f5e070',glow:'rgba(245,224,112,.2)'},
  obsidian:{name:'Obsidian',desc:'Tiefblau & Edel',   dark:'#080a10',light:'#131820',ring:['#1a3d6e','#4a1040'],bullG:'#1a3d6e',bullR:'#4a1040',rim:'#050608',wire:'#4070b0',num:'#80b8f0',glow:'rgba(128,184,240,.2)'},
  ember:   {name:'Ember',   desc:'Glut & Wärme',      dark:'#0c0804',light:'#1c1208',ring:['#7a3000','#4a1800'],bullG:'#903808',bullR:'#c04010',rim:'#080503',wire:'#b87030',num:'#ffaa50',glow:'rgba(255,150,60,.2)'},
  glacier: {name:'Glacier', desc:'Arktisches Eis',    dark:'#060e0c',light:'#0c1a16',ring:['#0a4a3a','#103448'],bullG:'#0a5040',bullR:'#0c3858',rim:'#040a08',wire:'#38a890',num:'#58d4b4',glow:'rgba(88,212,180,.2)'},
  void:    {name:'Void',    desc:'Ultraminimal',       dark:'#070707',light:'#131313',ring:['#222222','#1a1a1a'],bullG:'#2a2a2a',bullR:'#1e1e1e',rim:'#040404',wire:'#303030',num:'#e8e8e8',glow:'rgba(232,232,232,.15)'},
  aurora:  {name:'Aurora',  desc:'Nordlicht',          dark:'#050810',light:'#080e18',ring:['#0e5030','#28106e'],bullG:'#145838',bullR:'#341278',rim:'#030508',wire:'#38a060',num:'#60e0a0',glow:'rgba(96,224,160,.2)'},
  royal:   {name:'Royal',   desc:'Gold & Schwarz',     dark:'#0a0800',light:'#181200',ring:['#7a5c0a','#4a0808'],bullG:'#8a6410',bullR:'#600000',rim:'#070500',wire:'#c89818',num:'#ffd020',glow:'rgba(255,208,32,.22)'},
  velvet:  {name:'Velvet',  desc:'Dunkelrot & Rosen',  dark:'#0c0608',light:'#1c0c14',ring:['#6e1030','#8a2818'],bullG:'#7a1038',bullR:'#a02810',rim:'#080406',wire:'#c06080',num:'#f0a0b8',glow:'rgba(240,160,184,.2)'},
  carbon:  {name:'Carbon',  desc:'Industrial',         dark:'#0a0c0e',light:'#141820',ring:['#2a3848','#1e2c38'],bullG:'#304050',bullR:'#384858',rim:'#060808',wire:'#485868',num:'#90a8c0',glow:'rgba(144,168,192,.18)'},
  neon:    {name:'Neon',    desc:'Electro',             dark:'#060808',light:'#0a100c',ring:['#006840','#680030'],bullG:'#008850',bullR:'#880020',rim:'#030505',wire:'#00c8a0',num:'#00f0c0',glow:'rgba(0,240,192,.25)'},

  // ── Neue 10 ───────────────────────────────────────────────────────────────

  // Sahara: warmes sandgelb auf tiefem wüstenbraun, kupferfarbene Drähte
  sahara:  {name:'Sahara',  desc:'Wüste & Kupfer',     dark:'#0e0a04',light:'#c8a060',ring:['#7a5010','#5a2808'],bullG:'#8a6018',bullR:'#a03810',rim:'#080600',wire:'#c07828',num:'#f0c060',glow:'rgba(240,192,96,.22)'},

  // Midnight: mitternachtsblau mit silbern-weißen Drähten, eiskalte Zahlen
  midnight:{name:'Midnight',desc:'Mitternacht & Silber',dark:'#04060e',light:'#080c18',ring:['#0c1840','#180c34'],bullG:'#0a1848',bullR:'#1c0a40',rim:'#020408',wire:'#8090b8',num:'#c8d8f0',glow:'rgba(200,216,240,.2)'},

  // Sakura: zarte Kirschblüten-Töne, rosa-weiße Segmente auf dunklem Ebenholz
  sakura:  {name:'Sakura',  desc:'Kirschblüte',         dark:'#0c0808',light:'#2a1420',ring:['#7a2850','#5a1830'],bullG:'#8a3060',bullR:'#6a1840',rim:'#070506',wire:'#e890b0',num:'#ffc8d8',glow:'rgba(255,200,216,.22)'},

  // Jungle: dichtes dschunkelgrün, giftige Akzente, moosig-dunkel
  jungle:  {name:'Jungle',  desc:'Dschungel & Gift',    dark:'#040c04',light:'#0a180a',ring:['#1a5a10','#284010'],bullG:'#206015',bullR:'#386020',rim:'#020802',wire:'#50c030',num:'#90f040',glow:'rgba(144,240,64,.22)'},

  // Lava: glutrot trifft auf anthrazit-schwarz, orange leuchtende Risse
  lava:    {name:'Lava',    desc:'Vulkan & Glut',        dark:'#0e0400',light:'#200800',ring:['#900800','#600400'],bullG:'#a01000',bullR:'#e03000',rim:'#080200',wire:'#f06020',num:'#ff8040',glow:'rgba(255,128,64,.25)'},

  // Arctic: fast-weiß, tiefes eisblau, kristallklare Zahlen
  arctic:  {name:'Arctic',  desc:'Polarnacht & Eis',     dark:'#04080e',light:'#0c1828',ring:['#103060','#0a2050'],bullG:'#0c3070',bullR:'#082058',rim:'#020508',wire:'#a0c8e8',num:'#e0f4ff',glow:'rgba(224,244,255,.22)'},

  // Stealth: tintenschwarz mit ultraviolett-schimmernden Drähten
  stealth: {name:'Stealth', desc:'Schwarz & Ultraviolett',dark:'#050408',light:'#0c0814',ring:['#200840','#180630'],bullG:'#240a48',bullR:'#1a0638',rim:'#030206',wire:'#8040c0',num:'#c080ff',glow:'rgba(192,128,255,.25)'},

  // Copper: warmes kupferbraun auf fast-schwarzem Hintergrund, bronzene Töne
  copper:  {name:'Copper',  desc:'Kupfer & Bronze',      dark:'#080502',light:'#180c04',ring:['#703010','#502008'],bullG:'#804018',bullR:'#602810',rim:'#050301',wire:'#d08840',num:'#f0b060',glow:'rgba(240,176,96,.2)'},

  // Ocean: tiefes meeresblau, türkis-korallen-Kontrast, Phosphoreszenz
  ocean:   {name:'Ocean',   desc:'Tiefsee & Leuchten',   dark:'#020810',light:'#040e1e',ring:['#0c3060','#163050'],bullG:'#0a3868',bullR:'#0e2858',rim:'#010508',wire:'#20a0c0',num:'#40d0e8',glow:'rgba(64,208,232,.22)'},

  // Inferno: flammenrot-orange-gelb Verlauf über dunkelgrau, wie ein Feuersturm
  inferno: {name:'Inferno', desc:'Feuersturm',            dark:'#0a0400',light:'#1a0800',ring:['#c02000','#800800'],bullG:'#d02800',bullR:'#f04800',rim:'#060200',wire:'#ff6020',num:'#ffcc00',glow:'rgba(255,204,0,.28)'},
};

let activeBoardStyle=(()=>{ try{return localStorage.getItem('boardStyle')||'classic';}catch(e){return 'classic';} })();

function ang2xy(deg,r){const rad=(deg-90)*Math.PI/180;return[CX+r*Math.cos(rad),CY+r*Math.sin(rad)];}
function sectorPath(r1,r2,a1,a2){const[x1,y1]=ang2xy(a1,r1),[x2,y2]=ang2xy(a2,r1),[x3,y3]=ang2xy(a2,r2),[x4,y4]=ang2xy(a1,r2),lg=(a2-a1)>180?1:0;return `M${x1},${y1}A${r1},${r1},0,${lg},1,${x2},${y2}L${x3},${y3}A${r2},${r2},0,${lg},0,${x4},${y4}Z`;}
function svgEl(parent,tag,attrs){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));parent.appendChild(el);return el;}
function lighten(hex,amt){const n=parseInt(hex.replace('#',''),16);return '#'+[Math.min(255,(n>>16)+amt),Math.min(255,((n>>8)&0xff)+amt),Math.min(255,(n&0xff)+amt)].map(x=>x.toString(16).padStart(2,'0')).join('');}

let _tip=null;
function getTip(){
  if (isMobile()) return null; // no hover tooltips on touch
  if(!_tip){_tip=document.createElement('div');_tip.style.cssText='position:fixed;pointer-events:none;background:#0d1424;border:1px solid #22d3ee;color:#22d3ee;font-family:Orbitron,monospace;font-size:.8rem;font-weight:700;padding:.2rem .6rem;border-radius:5px;letter-spacing:.1em;opacity:0;transition:opacity .1s;z-index:9999;';document.body.appendChild(_tip);}return _tip;}
function showTip(txt,e){const t=getTip();if(!t)return;t.textContent=txt;t.style.left=(e.clientX+14)+'px';t.style.top=(e.clientY-10)+'px';t.style.opacity='1';}
function hideTip(){const t=getTip();if(t)t.style.opacity='0';}

function makeSeg(svg,pathOrR,isCircle,fill,label,onClick){
  const el=isCircle?svgEl(svg,'circle',{cx:CX,cy:CY,r:pathOrR,fill,stroke:'rgba(0,0,0,.4)','stroke-width':'1'}):svgEl(svg,'path',{d:pathOrR,fill,stroke:'rgba(0,0,0,.3)','stroke-width':'0.6'});
  el.classList.add('board-seg');
  if(onClick){el.addEventListener('click',e=>{e.stopPropagation();hideTip();onClick();});el.addEventListener('mousemove',e=>showTip(label,e));el.addEventListener('mouseleave',hideTip);}
  return el;
}

function drawBoardInto(svg,pal,interactive){
  const uid='bd'+Math.random().toString(36).slice(2,7);
  const defs=svgEl(svg,'defs',{});
  const rgId=uid+'_rim';
  const rg=svgEl(defs,'radialGradient',{id:rgId,cx:'50%',cy:'50%',r:'50%'});
  svgEl(rg,'stop',{'offset':'72%','stop-color':pal.rim});
  svgEl(rg,'stop',{'offset':'88%','stop-color':lighten(pal.rim,18)});
  svgEl(rg,'stop',{'offset':'100%','stop-color':pal.rim});
  svgEl(svg,'circle',{cx:CX,cy:CY,r:RRIM,fill:`url(#${rgId})`});
  svgEl(svg,'circle',{cx:CX,cy:CY,r:RNUM,fill:pal.rim});
  svgEl(svg,'circle',{cx:CX,cy:CY,r:RDO, fill:pal.dark});
  BOARD_NUMS.forEach((num,i)=>{
    const a1=i*18-9,a2=a1+18,light=i%2!==0;
    makeSeg(svg,sectorPath(RTI,RTO,a1,a2),false,light?pal.ring[0]:pal.ring[1],`T${num}=${num*3}`,interactive?()=>doThrow(num,3):null);
    makeSeg(svg,sectorPath(RTO,RDI,a1,a2),false,light?pal.light:pal.dark,`${num}`,interactive?()=>doThrow(num,1):null);
    makeSeg(svg,sectorPath(RDI,RDO,a1,a2),false,light?pal.ring[0]:pal.ring[1],`D${num}=${num*2}`,interactive?()=>doThrow(num,2):null);
  });
  makeSeg(svg,ROB,true,pal.bullG,'Outer Bull 25',interactive?()=>doThrow(25,1):null);
  makeSeg(svg,RB, true,pal.bullR,'BULL 50',       interactive?()=>doThrow(25,2):null);
  const dot=svgEl(svg,'circle',{cx:CX,cy:CY,r:5,fill:'rgba(255,255,255,.22)'});dot.style.pointerEvents='none';
  BOARD_NUMS.forEach((_,i)=>{const a=i*18-9,[x1,y1]=ang2xy(a,ROB-1),[x2,y2]=ang2xy(a,RNUM);const l=svgEl(svg,'line',{x1,y1,x2,y2,stroke:pal.wire,'stroke-width':interactive?'1.8':'1.2','stroke-opacity':'0.75'});l.style.pointerEvents='none';});
  [ROB,RTO,RDI,RDO].forEach(r=>{const w=(r===RDI||r===RDO)?(interactive?'2.8':'2.0'):(interactive?'1.8':'1.3');const c=svgEl(svg,'circle',{cx:CX,cy:CY,r,fill:'none',stroke:pal.wire,'stroke-width':w,'stroke-opacity':'0.75'});c.style.pointerEvents='none';});
  const sep=svgEl(svg,'circle',{cx:CX,cy:CY,r:RDO,fill:'none',stroke:'rgba(0,0,0,.7)','stroke-width':'3'});sep.style.pointerEvents='none';
  const og=svgEl(svg,'circle',{cx:CX,cy:CY,r:RRIM-(interactive?2:1),fill:'none',stroke:pal.wire,'stroke-width':interactive?'3.5':'2','stroke-opacity':'0.55'});og.style.pointerEvents='none';
  const ir=svgEl(svg,'circle',{cx:CX,cy:CY,r:RDO+1+(interactive?2:1),fill:'none',stroke:pal.wire,'stroke-width':interactive?'2.5':'1.8','stroke-opacity':'0.5'});ir.style.pointerEvents='none';
  const sr=svgEl(svg,'circle',{cx:CX,cy:CY,r:RRIM,fill:'none',stroke:'rgba(0,0,0,.85)','stroke-width':interactive?'4':'3'});sr.style.pointerEvents='none';
  const hlId=uid+'_hl';const hlG=svgEl(defs,'linearGradient',{id:hlId,x1:'0%',y1:'0%',x2:'100%',y2:'100%'});
  svgEl(hlG,'stop',{'offset':'0%','stop-color':'rgba(255,255,255,.18)'});svgEl(hlG,'stop',{'offset':'40%','stop-color':'rgba(255,255,255,.04)'});svgEl(hlG,'stop',{'offset':'100%','stop-color':'rgba(0,0,0,0)'});
  const hl=svgEl(svg,'circle',{cx:CX,cy:CY,r:RRIM-(interactive?1:.5),fill:'none',stroke:`url(#${hlId})`,'stroke-width':interactive?'3':'2'});hl.style.pointerEvents='none';
  const rNum=(RDO+RNUM)/2,fSize=interactive?'19':'13';
  BOARD_NUMS.forEach((num,i)=>{
    const[x,y]=ang2xy(i*18,rNum);
    const bg=svgEl(svg,'text',{x,y,'text-anchor':'middle','dominant-baseline':'middle',fill:pal.num,'font-size':String(parseInt(fSize)+5),'font-family':'Orbitron,monospace','font-weight':'900','pointer-events':'none',filter:`blur(${interactive?5:3}px)`,opacity:'0.45'});bg.textContent=num;
    const t=svgEl(svg,'text',{x,y,'text-anchor':'middle','dominant-baseline':'middle',fill:pal.num,'font-size':fSize,'font-family':'Orbitron,monospace','font-weight':'900','pointer-events':'none'});t.textContent=num;
  });
}

function buildBoard(){
  const svg=$('dart-svg');
  svg.innerHTML='';
  drawBoardInto(svg,BOARD_STYLES[activeBoardStyle],true);
  svg.classList.remove('is-loading');
  void svg.offsetWidth;
  svg.classList.add('is-loading');
  setTimeout(()=>svg.classList.remove('is-loading'),650);
}

/* ─────────────────────────────────────────────────
   STYLE PICKER
───────────────────────────────────────────────── */
function openStylePicker(){
  let modal=$('style-picker-modal');
  if(!modal){modal=document.createElement('div');modal.id='style-picker-modal';modal.className='style-picker-bg hidden';modal.innerHTML=`<div class="style-picker-card"><div class="sp-header"><span class="sp-title">🎨 BOARD STYLE</span><button class="sp-close" onclick="closeStylePicker()">✕</button></div><div class="sp-grid" id="sp-grid"></div></div>`;modal.addEventListener('click',e=>{if(e.target===modal)closeStylePicker();});document.body.appendChild(modal);}
  const grid=modal.querySelector('#sp-grid');grid.innerHTML='';
  Object.entries(BOARD_STYLES).forEach(([key,pal])=>{
    const item=document.createElement('div');item.className='sp-item'+(key===activeBoardStyle?' is-active':'');item.onclick=()=>selectBoardStyle(key);
    const ns='http://www.w3.org/2000/svg',preview=document.createElementNS(ns,'svg');preview.setAttribute('viewBox','0 0 460 460');preview.setAttribute('class','sp-preview');drawBoardInto(preview,pal,false);item.appendChild(preview);
    const lbl=document.createElement('div');lbl.className='sp-label';lbl.innerHTML=`<strong>${esc(pal.name)}</strong><span>${esc(pal.desc)}</span>`;item.appendChild(lbl);grid.appendChild(item);
  });
  modal.classList.remove('hidden');void modal.offsetWidth;modal.classList.add('is-open');
}
function closeStylePicker(){const m=$('style-picker-modal');if(m){m.classList.remove('is-open');setTimeout(()=>m.classList.add('hidden'),250);}}
function selectBoardStyle(key){
  activeBoardStyle=key;
  try{localStorage.setItem('boardStyle',key);}catch(e){}
  buildBoard();
  // Refresh hero board on setup screen
  const hsvg=document.getElementById('setup-hero-svg');
  if(hsvg){hsvg.innerHTML='';if(BOARD_STYLES[key])drawBoardInto(hsvg,BOARD_STYLES[key],false);}
  // Refresh bg board on setup screen  
  const bsvg=document.getElementById('setup-board-svg');
  if(bsvg){bsvg.innerHTML='';drawSetupBgBoard();}
  // Update style button label + dot
  updateSetupBoardBtn();const grid=document.querySelector('#sp-grid');if(grid){grid.querySelectorAll('.sp-item').forEach((el,i)=>el.classList.toggle('is-active',Object.keys(BOARD_STYLES)[i]===key));}closeStylePicker();}

/* ─────────────────────────────────────────────────
   MOBILE NAV
───────────────────────────────────────────────── */
function isMobile(){return window.innerWidth<=768;}

function setMobTab(tab){
  mobTab=tab;
  const layout=$('game-layout');if(layout)layout.dataset.mobTab=tab;
  document.querySelectorAll('.mob-tab').forEach(btn=>btn.classList.toggle('is-active',btn.dataset.tab===tab));
  hide('undo-history-panel');
}

function renderMobScoreStrip(){
  if(!game||!isMobile())return;
  const el=$('mob-score-strip');if(!el)return;
  el.classList.remove('hidden');
  el.innerHTML=game.players.map((p,i)=>{
    const act=i===game.currentPlayerIdx;
    const val=game.mode==='cricket'?`${p.score}<div class="msp-marks">${Object.values(p.marks).filter(m=>m>=3).length}/7 ✕</div>`:p.score;
    return `<div class="mob-score-pill ${act?'is-active':''}"><div class="msp-name">${esc(p.name)}</div><div class="msp-val">${val}</div></div>`;
  }).join('');
}

function renderMobThrowRow(){
  if(!game||!isMobile())return;
  const el=$('mob-throw-row');if(el)el.classList.remove('hidden');
  const throws=game.throwsThisTurn;
  for(let i=0;i<3;i++){const sl=$('ms'+i);if(!sl)continue;
    if(i<throws.length){sl.textContent=throws[i].label;sl.classList.remove('is-empty');sl.classList.add('is-filled');}
    else{sl.textContent='';sl.classList.add('is-empty');sl.classList.remove('is-filled');}}
}

function clearMobBust(){clearTimeout(_mobBustTimer);const el=$('mob-bust');if(el){el.classList.remove('is-visible');el.classList.add('hidden');}const badge=$('mob-tab-badge');if(badge)badge.classList.add('hidden');}

function flashMobBust(){
  if(!isMobile())return;const el=$('mob-bust');if(!el)return;
  clearTimeout(_mobBustTimer);el.classList.remove('hidden');el.classList.add('is-visible');
  _mobBustTimer=setTimeout(()=>{el.classList.remove('is-visible');el.classList.add('hidden');},2200);
  const badge=$('mob-tab-badge');if(badge){badge.classList.remove('hidden');setTimeout(()=>badge.classList.add('hidden'),2500);}
}
(function initTouch(){
  let startX=0,startY=0;
  const ORDER=['score','input','turn'];
  document.addEventListener('touchstart',e=>{startX=e.touches[0].clientX;startY=e.touches[0].clientY;},{passive:true});
  document.addEventListener('touchend',e=>{
    // Double-tap prevention on buttons
    if(e.target.tagName==='BUTTON'||e.target.closest('button')){e.preventDefault();}
    // Swipe tab navigation
    if(!game||!isMobile())return;
    const dx=e.changedTouches[0].clientX-startX,dy=e.changedTouches[0].clientY-startY;
    if(Math.abs(dy)>Math.abs(dx)*.8||Math.abs(dx)<40)return;
    const cur=ORDER.indexOf(mobTab);
    if(dx<0&&cur<ORDER.length-1)setMobTab(ORDER[cur+1]);
    if(dx>0&&cur>0)setMobTab(ORDER[cur-1]);
  },{passive:false}); // passive:false needed for preventDefault
})();

window.addEventListener('resize',()=>{if(game&&isMobile()){const nav=$('mob-nav');if(nav)nav.classList.remove('hidden');setMobTab(mobTab||'input');render();}});

/* ─────────────────────────────────────────────────
   VOLLBILD
───────────────────────────────────────────────── */
function toggleFullscreen(){
  if(!document.fullscreenElement){document.documentElement.requestFullscreen().catch(()=>{});}
  else{document.exitFullscreen().catch(()=>{});}
}
document.addEventListener('fullscreenchange',()=>{const btn=$('btn-fullscreen');if(btn)btn.textContent=document.fullscreenElement?'⛶':'⛶';});

/* ─────────────────────────────────────────────────
   SPIELSTAND-WIEDERHERSTELLUNG
───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded',()=>{
  updateMuteButtons();
  try {
    const raw=localStorage.getItem(SAVE_KEY);
    if(raw){
      const snap=JSON.parse(raw);
      if(snap&&snap.game&&snap.game.active&&!snap.game.winner){
        _pendingRestore=snap;
        const g=snap.game;
        const mLbl=g.mode!=='cricket'?g.mode+(g.doubleOut?' DO':' SO'):'Cricket';
        const nms=g.players.map(p=>p.name).join(' vs ');
        const banner=document.createElement('div');banner.className='restore-banner';
        banner.innerHTML=`<span class="rb-info">🎯 ${mLbl} · ${nms} · Rd ${g.currentRound}</span>
          <button onclick="resumeGame()">Weiterspielen</button>
          <button class="rb-dismiss" onclick="dismissRestore()">✕</button>`;
        document.body.appendChild(banner);
        setTimeout(()=>banner.classList.add('is-visible'),80);
      }
    }
  } catch(e){}
});

function resumeGame(){
  if(!_pendingRestore)return;
  const snap=_pendingRestore; _pendingRestore=null;
  game=snap.game; outType=snap.outType||'double'; lastTurn=snap.lastTurn||null;
  histTabIdx=snap.histTabIdx||0; inputMode=snap.inputMode||'board'; practiceMode=snap.practiceMode||false;
  dismissRestore();
  $('mode-badge').textContent=game.mode!=='cricket'?game.mode+(game.doubleOut?' DO':' SO'):'Cricket';
  show('screen-game'); hide('screen-setup');
  buildKeypad(); buildBoard(); setMode(inputMode||'board'); updateMuteButtons();
  if(isMobile()){const nav=$('mob-nav');if(nav)nav.classList.remove('hidden');setMobTab('input');}
  render();
  if(lastTurn) renderLastTurnBox(lastTurn);
}

function dismissRestore(){
  const b=document.querySelector('.restore-banner');
  if(b){b.classList.remove('is-visible');setTimeout(()=>b.remove(),300);}
  clearGameState(); _pendingRestore=null;
}

/* ════════════════════════════════════════════════════════
   UI THEME SYSTEM
   ════════════════════════════════════════════════════════ */

const UI_THEMES = [
  { key:'cyber',   name:'Cyber',    desc:'Neonblau · Standard',
    accent:'#22d3ee', bg:'#070810', surface:'#0c1120', surface2:'#111828', surface3:'#162034', border:'#1e2d4a',
    tags:['Cyan','Sci-Fi'] },
  { key:'nacht',   name:'Nacht',    desc:'Violett · Nebula-Glow',
    accent:'#b060ff', bg:'#06040d', surface:'#0d0920', surface2:'#130c2a', surface3:'#1a1238', border:'#2a1a50',
    tags:['Violett','Nebula','✦ Glow'] },
  { key:'inferno', name:'Inferno',  desc:'Feuerrot · Glut-Effekt',
    accent:'#ff5a00', bg:'#0d0400', surface:'#180800', surface2:'#220c00', surface3:'#2e1000', border:'#4a1800',
    tags:['Rot','Feuer','🔥 Flicker'] },
  { key:'forest',  name:'Forest',   desc:'Waldgrün · Natur',
    accent:'#4ae040', bg:'#030a03', surface:'#060e06', surface2:'#0a140a', surface3:'#101a10', border:'#1a3018',
    tags:['Grün','Natur'] },
  { key:'arctic',  name:'Arctic',   desc:'Eisblau · Polarlicht',
    accent:'#a0e4ff', bg:'#03060e', surface:'#07101e', surface2:'#0c1828', surface3:'#112034', border:'#1e3050',
    tags:['Eisblau','Frost','❄ Blur'] },
  { key:'retro',   name:'Retro',    desc:'Bernstein · CRT-Monitor',
    accent:'#ffb000', bg:'#0c0800', surface:'#180e00', surface2:'#201400', surface3:'#2a1c00', border:'#4a3000',
    tags:['Amber','CRT','📺 Scanlines'] },
  { key:'luxe',    name:'Luxe',     desc:'Gold · Edles Finish',
    accent:'#d4a820', bg:'#060502', surface:'#0e0c06', surface2:'#16120a', surface3:'#201a0e', border:'#3a2e10',
    tags:['Gold','Luxus','✦ Glanz'] },
  { key:'sakura',  name:'Sakura',   desc:'Rosa · Kirschblüte',
    accent:'#ff80b0', bg:'#080508', surface:'#100910', surface2:'#180e18', surface3:'#201420', border:'#3a1838',
    tags:['Rosa','Sakura','🌸 Bloom'] },
  { key:'matrix',  name:'Matrix',   desc:'Grün · Code-Regen',
    accent:'#00ff41', bg:'#000800', surface:'#001200', surface2:'#001a00', surface3:'#002400', border:'#003800',
    tags:['Grün','Code','🟩 Rain'] },
  { key:'sunset',  name:'Sunset',   desc:'Magenta · Dämmerung',
    accent:'#e040ff', bg:'#080510', surface:'#100818', surface2:'#180c24', surface3:'#201030', border:'#3a1850',
    tags:['Magenta','Gradient','🌅'] },
];

let _activeUiTheme = (() => {
  try { return localStorage.getItem('dartdash_ui_theme') || 'cyber'; } catch(e) { return 'cyber'; }
})();

let _matrixRaf = null;

function applyUiTheme(key) {
  _activeUiTheme = key;
  document.body.dataset.uiTheme = key;
  try { localStorage.setItem('dartdash_ui_theme', key); } catch(e) {}

  // Update label
  const t = UI_THEMES.find(t => t.key === key);
  const lbl = $('ui-theme-label');
  if (lbl && t) lbl.textContent = t.name;

  // Matrix rain canvas
  if (key === 'matrix') {
    startMatrixRain();
  } else {
    stopMatrixRain();
  }
}

function startMatrixRain() {
  stopMatrixRain();
  let canvas = document.getElementById('matrix-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'matrix-canvas';
    document.body.insertBefore(canvas, document.body.firstChild);
  }
  const ctx = canvas.getContext('2d');
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  const cols = Math.floor(canvas.width / 14);
  const drops = Array(cols).fill(1);
  const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノ';

  function draw() {
    ctx.fillStyle = 'rgba(0,8,0,.06)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00ff41';
    ctx.font = '13px Share Tech Mono, monospace';
    drops.forEach((y, i) => {
      const ch = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillText(ch, i * 14, y * 14);
      if (y * 14 > canvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    });
    _matrixRaf = requestAnimationFrame(draw);
  }
  draw();
}

function stopMatrixRain() {
  if (_matrixRaf) { cancelAnimationFrame(_matrixRaf); _matrixRaf = null; }
  const canvas = document.getElementById('matrix-canvas');
  if (canvas) canvas.remove();
}

/* ════════════════════════════════════════════════════════
   THEME PICKER  —  Immersive Fullscreen v2
   ════════════════════════════════════════════════════════ */

let _tpHoveredKey   = null;
let _tpParticleRaf  = null;
let _tpMatrixRaf    = null;

function openUiThemePicker() {
  // Remove old modal if present
  const old = $('ui-theme-modal');
  if (old) old.remove();

  // Build overlay
  const ov = document.createElement('div');
  ov.id = 'tp-overlay';
  ov.className = 'hidden';

  ov.innerHTML = `
  <!-- LEFT: list -->
  <div id="tp-list">
    <div id="tp-list-header">
      <span id="tp-list-title">🎭 DESIGN WÄHLEN</span>
      <button id="tp-close" onclick="closeUiThemePicker()">✕</button>
    </div>
    <div id="tp-items"></div>
  </div>

  <!-- RIGHT: live preview -->
  <div id="tp-preview">
    <div id="tp-preview-label">
      <div id="tp-preview-name"></div>
      <div id="tp-preview-desc"></div>
    </div>
    <canvas id="tp-particles-canvas"></canvas>
    <div id="tp-scanlines"></div>
    <div id="tp-matrix-overlay"><canvas id="tp-matrix-canvas2"></canvas></div>
    <div id="tp-mock">
      <div id="tp-mock-hdr">
        <div id="tp-mock-badge1" class="tp-mock-badge">501 SO</div>
        <div class="tp-mock-dots">
          <div id="tp-mock-dot1" class="tp-mock-dot"></div>
          <div id="tp-mock-dot2" class="tp-mock-dot"></div>
          <div id="tp-mock-dot3" class="tp-mock-dot"></div>
        </div>
      </div>
      <div id="tp-mock-body">
        <div id="tp-mock-lpanel" class="tp-mock-panel">
          <div id="tp-mock-card1" class="tp-mock-card is-active"></div>
          <div id="tp-mock-card2" class="tp-mock-card"></div>
          <div id="tp-mock-card3" class="tp-mock-card"></div>
        </div>
        <div id="tp-mock-center" class="tp-mock-center">
          <div id="tp-mock-board"></div>
          <div id="tp-mock-startbtn" class="tp-mock-btn"></div>
        </div>
        <div id="tp-mock-rpanel" class="tp-mock-panel tp-mock-panel-r">
          <div id="tp-mock-card4" class="tp-mock-card"></div>
          <div id="tp-mock-card5" class="tp-mock-card"></div>
        </div>
      </div>
    </div>
    <button id="tp-apply-btn" onclick="tpApply()">ANWENDEN</button>
  </div>`;

  ov.addEventListener('click', e => { if (e.target === ov) closeUiThemePicker(); });
  document.body.appendChild(ov);

  // Build list items
  const items = ov.querySelector('#tp-items');
  UI_THEMES.forEach(t => {
    const el = document.createElement('div');
    el.className = 'tp-item' + (t.key === _activeUiTheme ? ' is-active' : '');
    el.dataset.key = t.key;
    el.innerHTML = `
      <div class="tp-dot" style="background:radial-gradient(circle at 35% 35%,${t.accent}cc,${t.bg});box-shadow:0 0 10px ${t.accent}55">
        <div class="tp-dot-ring"></div>
      </div>
      <div class="tp-text">
        <div class="tp-name" style="color:${t.accent}">${esc(t.name)}</div>
        <div class="tp-desc">${esc(t.desc)}</div>
      </div>
      <div class="tp-fx">${t.tags.map(x=>`<span class="tp-fx-tag">${x}</span>`).join('')}</div>
      <div class="tp-check">✓</div>`;
    el.addEventListener('mouseenter', () => tpPreview(t.key));
    el.addEventListener('click',      () => { tpApply(t.key); });
    items.appendChild(el);
  });

  // Show
  ov.classList.remove('hidden');
  void ov.offsetWidth;
  ov.classList.add('is-open');

  // Initial preview
  tpPreview(_activeUiTheme);

  // Start particle canvas
  _tpStartParticles();
}

function tpPreview(key) {
  _tpHoveredKey = key;
  const t = UI_THEMES.find(x => x.key === key);
  if (!t) return;

  // Label
  const nameEl = $('tp-preview-name');
  const descEl = $('tp-preview-desc');
  if (nameEl) { nameEl.textContent = t.name; nameEl.style.color = t.accent; }
  if (descEl) { descEl.textContent = t.desc; descEl.style.color = t.accent + '99'; }

  // Apply button styling
  const btn = $('tp-apply-btn');
  if (btn) {
    btn.style.background = t.accent;
    btn.style.color = _tpIsLight(t.accent) ? '#000' : '#fff';
    btn.style.boxShadow = `0 8px 30px ${t.accent}55`;
    btn.classList.toggle('is-applied', key === _activeUiTheme);
    btn.textContent = key === _activeUiTheme ? '✓ AKTIV' : 'ANWENDEN';
  }

  // Mock UI colors
  _tpUpdateMock(t);

  // Effects
  const scanlines = $('tp-scanlines');
  if (scanlines) scanlines.classList.toggle('visible', key === 'retro');

  const matrixOv = $('tp-matrix-overlay');
  if (matrixOv) {
    if (key === 'matrix') {
      matrixOv.classList.add('visible');
      _tpStartMatrix();
    } else {
      matrixOv.classList.remove('visible');
      _tpStopMatrix();
    }
  }

  // Highlight active item in list
  document.querySelectorAll('.tp-item').forEach(el => {
    el.classList.toggle('is-hovered', el.dataset.key === key);
  });
}

function _tpUpdateMock(t) {
  const set = (id, prop, val) => { const el=$(id); if(el) el.style[prop]=val; };

  // Mock header
  set('tp-mock-hdr',        'background', t.surface || t.bg);
  set('tp-mock-hdr',        'borderBottomColor', t.border + '40' || 'rgba(255,255,255,.06)');
  set('tp-mock-badge1',     'background', t.accent + '22');
  set('tp-mock-badge1',     'color',      t.accent);
  set('tp-mock-badge1',     'border',     `1px solid ${t.accent}44`);
  ['tp-mock-dot1','tp-mock-dot2','tp-mock-dot3'].forEach((id,i) => {
    set(id, 'background', i===0 ? t.surface3||'#1a2040' : t.surface2||'#111828');
    set(id, 'border', `1px solid ${t.border||'#1e2d4a'}`);
  });

  // Body
  set('tp-mock-body',       'background', t.bg);
  set('tp-mock-lpanel',     'background', t.surface||'#0c1120');
  set('tp-mock-rpanel',     'background', t.surface||'#0c1120');
  set('tp-mock-center',     'background', t.bg);

  // Cards
  set('tp-mock-card1',      'background',   t.accent + '15');
  set('tp-mock-card1',      'borderColor',  t.accent + '80');
  set('tp-mock-card2',      'background',   t.surface2||'#111828');
  set('tp-mock-card3',      'background',   t.surface2||'#111828');
  set('tp-mock-card4',      'background',   t.surface2||'#111828');
  set('tp-mock-card5',      'background',   t.surface2||'#111828');

  // Board circle
  const board = $('tp-mock-board');
  if (board) {
    board.style.background = `conic-gradient(${t.accent}55 0deg, ${t.accent}22 45deg, ${t.bg} 90deg, ${t.accent}33 180deg, ${t.bg} 270deg, ${t.accent}44 360deg)`;
    board.style.boxShadow  = `0 0 20px ${t.accent}44, 0 0 0 2px ${t.accent}33`;
  }

  // Start button
  set('tp-mock-startbtn',   'background', t.accent);
  set('tp-mock-startbtn',   'boxShadow',  `0 4px 16px ${t.accent}55`);
}

function _tpIsLight(hex) {
  const n = parseInt(hex.replace('#',''), 16);
  const r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  return (r*299+g*587+b*114)/1000 > 128;
}

function tpApply(key) {
  const k = key || _tpHoveredKey || _activeUiTheme;
  applyUiTheme(k);
  // Update list active states
  document.querySelectorAll('.tp-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.key === k);
  });
  // Update apply button
  const btn = $('tp-apply-btn');
  if (btn) { btn.textContent = '✓ AKTIV'; btn.classList.add('is-applied'); }
  // Brief flash then close
  setTimeout(closeUiThemePicker, 600);
}

function _tpStartParticles() {
  const canvas = $('tp-particles-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const mock = $('tp-mock');

  function resize() {
    if (!mock) return;
    const r = mock.getBoundingClientRect();
    canvas.width  = r.width  || 300;
    canvas.height = r.height || 300;
  }
  resize();

  const pts = Array.from({length:28}, () => ({
    x: Math.random()*canvas.width,
    y: Math.random()*canvas.height,
    vx: (Math.random()-.5)*.4,
    vy: (Math.random()-.5)*.4,
    r: Math.random()*1.5+.5,
    a: Math.random()*.4+.1,
  }));

  function draw() {
    if (!$('tp-overlay') || $('tp-overlay').classList.contains('hidden')) {
      _tpParticleRaf = null; return;
    }
    const t = UI_THEMES.find(x => x.key === _tpHoveredKey);
    const col = t ? t.accent : '#22d3ee';
    ctx.clearRect(0,0,canvas.width,canvas.height);
    pts.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > canvas.width)  p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = col + Math.round(p.a*255).toString(16).padStart(2,'0');
      ctx.fill();
    });
    for (let i=0;i<pts.length;i++) for (let j=i+1;j<pts.length;j++) {
      const dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y, d=Math.sqrt(dx*dx+dy*dy);
      if (d<60) {
        ctx.beginPath();
        ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[j].x,pts[j].y);
        ctx.strokeStyle = col + Math.round(.05*(1-d/60)*255).toString(16).padStart(2,'0');
        ctx.lineWidth = .6;
        ctx.stroke();
      }
    }
    _tpParticleRaf = requestAnimationFrame(draw);
  }
  draw();
}

function _tpStartMatrix() {
  if (_tpMatrixRaf) return;
  const canvas = $('tp-matrix-canvas2');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const parent = $('tp-matrix-overlay');
  if (parent) { canvas.width=parent.offsetWidth||300; canvas.height=parent.offsetHeight||300; }
  const cols = Math.floor(canvas.width/12);
  const drops = Array(cols).fill(1);
  const chars = '01アイウエオカサシスセソタチツテト';
  function draw() {
    if (!$('tp-matrix-overlay') || !$('tp-matrix-overlay').classList.contains('visible')) { _tpMatrixRaf=null; return; }
    ctx.fillStyle='rgba(0,8,0,.08)';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#00ff41';
    ctx.font='11px Share Tech Mono,monospace';
    drops.forEach((y,i) => {
      ctx.fillText(chars[Math.floor(Math.random()*chars.length)], i*12, y*12);
      if (y*12>canvas.height && Math.random()>.975) drops[i]=0;
      drops[i]++;
    });
    _tpMatrixRaf = requestAnimationFrame(draw);
  }
  draw();
}

function _tpStopMatrix() {
  if (_tpMatrixRaf) { cancelAnimationFrame(_tpMatrixRaf); _tpMatrixRaf=null; }
}

function closeUiThemePicker() {
  const ov = $('tp-overlay');
  if (!ov) return;
  _tpStopMatrix();
  if (_tpParticleRaf) { cancelAnimationFrame(_tpParticleRaf); _tpParticleRaf=null; }
  ov.classList.remove('is-open');
  setTimeout(() => { ov.remove(); }, 350);
}

function updateUiThemeGrid() {} // kept for compatibility

// Apply saved theme on load
document.addEventListener('DOMContentLoaded', () => {
  applyUiTheme(_activeUiTheme);
});


/* ════════════════════════════════════════════════════════
   SETUP BOARD STYLE BUTTON
   ════════════════════════════════════════════════════════ */

function updateSetupBoardBtn() {
  const pal = BOARD_STYLES[activeBoardStyle];
  if (!pal) return;
  // Name label
  const nameEl = document.getElementById('sbsb-name');
  if (nameEl) nameEl.textContent = pal.name;
  // Color dot  
  const dot = document.getElementById('sbsb-dot');
  if (dot) {
    dot.style.background = pal.wire || pal.num || '#22d3ee';
    dot.style.boxShadow  = `0 0 6px ${pal.wire || pal.num || '#22d3ee'}`;
  }
}

function openStylePickerFromSetup() {
  openStylePicker();
  // Ensure picker knows we're on setup screen — no change needed,
  // selectBoardStyle already refreshes the hero board.
}

function drawSetupBgBoard() {
  const svg = document.getElementById('setup-board-svg');
  if (!svg) return;
  const pal = {
    dark:'#000000', light:'#060608',
    ring:['#0a1020','#0c0c18'],
    bullG:'#0a1020', bullR:'#0c0c18',
    rim:'#000000', wire: (BOARD_STYLES[activeBoardStyle]||{}).wire || '#22d3ee',
    num: (BOARD_STYLES[activeBoardStyle]||{}).wire || '#22d3ee',
    glow:'rgba(34,211,238,.3)',
  };
  svg.innerHTML = '';
  drawBoardInto(svg, pal, false);
}

/* ════════════════════════════════════════════════════════
   SETUP SCREEN ANIMATIONS
   ════════════════════════════════════════════════════════ */

(function initSetupAnimations() {

  // ── Particle canvas ─────────────────────────────────
  function initSetupCanvas() {
    const canvas = document.getElementById('setup-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, particles = [], raf;

    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Spawn initial particles
    for (let i = 0; i < 70; i++) particles.push(makeParticle(true));

    function makeParticle(anywhere) {
      const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#22d3ee';
      return {
        x: anywhere ? Math.random()*W : (Math.random() < .5 ? -10 : W+10),
        y: Math.random()*H,
        vx: (Math.random()-.5)*.35,
        vy: (Math.random()-.5)*.35,
        r: Math.random()*1.6+.4,
        alpha: Math.random()*.65+.2,
        color: accent,
        life: Math.random()*200+100,
        age: anywhere ? Math.random()*200 : 0,
      };
    }

    function drawFrame() {
      ctx.clearRect(0,0,W,H);
      particles.forEach((p,i) => {
        p.age++;
        p.x += p.vx; p.y += p.vy;
        // Soft boundary: wrap edges
        if (p.x < -20) p.x = W+20;
        if (p.x > W+20) p.x = -20;
        if (p.y < -20) p.y = H+20;
        if (p.y > H+20) p.y = -20;

        const progress = p.age / p.life;
        const alpha = p.alpha * (progress < .2 ? progress/.2 : progress > .8 ? (1-progress)/.2 : 1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
        ctx.fillStyle = p.color + Math.round(alpha*255).toString(16).padStart(2,'0');
        ctx.fill();

        if (p.age > p.life) particles[i] = makeParticle(false);
      });
      // Connect nearby particles
      for (let a = 0; a < particles.length; a++) {
        for (let b = a+1; b < particles.length; b++) {
          const dx = particles[a].x-particles[b].x, dy = particles[a].y-particles[b].y;
          const dist = Math.sqrt(dx*dx+dy*dy);
          if (dist < 100) {
            ctx.beginPath();
            ctx.moveTo(particles[a].x, particles[a].y);
            ctx.lineTo(particles[b].x, particles[b].y);
            const accent = particles[a].color;
            const a2 = .10*(1-dist/100);
            ctx.strokeStyle = accent + Math.round(a2*255).toString(16).padStart(2,'0');
            ctx.lineWidth = .5;
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(drawFrame);
    }

    drawFrame();

    // Stop canvas when game starts
    document.addEventListener('gameStarted', () => {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    });
    // Restart if returning to setup
    document.addEventListener('setupShown', () => {
      if (!raf) drawFrame();
    });
  }

  // ── Background board (large, rotating, decorative) ──
  function initBgBoard() {
    if (typeof drawSetupBgBoard === 'function') drawSetupBgBoard();
  }

  // ── Hero board (small, non-interactive preview) ──
  function initHeroBoard() {
    const svg = document.getElementById('setup-hero-svg');
    if (!svg || typeof drawBoardInto !== 'function') return;
    const style = typeof activeBoardStyle !== 'undefined' && typeof BOARD_STYLES !== 'undefined'
      ? BOARD_STYLES[activeBoardStyle] : null;
    if (style) { svg.innerHTML = ''; drawBoardInto(svg, style, false); }
  }

  // ── Score ticker animation ───────────────────────────
  const SCORES = [180, 140, 121, 167, 100, 170, 155, 160, 143, 132, 174, 180];
  let _scoreIdx = 0, _scoreTicker = null;

  function tickScore() {
    const el = document.getElementById('sst-val');
    if (!el) return;
    _scoreIdx = (_scoreIdx + 1) % SCORES.length;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.textContent = SCORES[_scoreIdx];
    el.style.animation = 'scoreFlip .4s cubic-bezier(.34,1.56,.64,1) both';
    _scoreTicker = setTimeout(tickScore, 2200 + Math.random()*1200);
  }

  // ── Dart throw streaks (decorative) ─────────────────
  function fireDartStreak() {
    if ($('screen-setup') && $('screen-setup').classList.contains('hidden')) return;
    const streak = document.createElement('div');
    streak.className = 'dart-streak';
    const fromLeft = Math.random() < .5;
    const y = 15 + Math.random() * 70; // % height
    const dur = .4 + Math.random() * .4;
    streak.style.cssText = `
      top: ${y}%;
      ${fromLeft ? 'left' : 'right'}: ${10 + Math.random()*20}%;
      --dur: ${dur}s;
      transform: ${fromLeft ? 'rotate(0deg)' : 'rotate(180deg) scaleX(-1)'};
    `;
    document.getElementById('screen-setup').appendChild(streak);
    setTimeout(() => streak.remove(), dur * 1000 + 100);

    // Schedule next
    setTimeout(fireDartStreak, 1500 + Math.random() * 3000);
  }

  // ── Boot sequence ────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // Small delay so drawBoardInto is available
    setTimeout(() => {
      initSetupCanvas();
      initBgBoard();
      initHeroBoard();
      updateSetupBoardBtn();
      setTimeout(tickScore, 1500);
      setTimeout(fireDartStreak, 2000);
    }, 60);
  });

  // Refresh hero board when style changes
  const _origSelect = window.selectBoardStyle;
  if (typeof selectBoardStyle !== 'undefined') {
    // Called after style change
    const origBuild = window.buildBoard || null;
    // We patch after DOM ready
    document.addEventListener('DOMContentLoaded', () => {
      // Observe body attr changes to refresh hero board
      const obs = new MutationObserver(() => {
        const svg = document.getElementById('setup-hero-svg');
        if (svg && typeof BOARD_STYLES !== 'undefined' && typeof activeBoardStyle !== 'undefined') {
          svg.innerHTML = '';
          drawBoardInto(svg, BOARD_STYLES[activeBoardStyle], false);
        }
      });
      obs.observe(document.body, { attributes: true, attributeFilter: ['data-ui-theme'] });
    });
  }

})();