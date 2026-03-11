/* ═══════════════════════════════════════════════════════════
   DART DASHBOARD  –  app.js
   All game logic runs in the browser. No backend required.
   ═══════════════════════════════════════════════════════════ */

   'use strict';

   // ─────────────────────────────────────────────────────────
   //  Constants
   // ─────────────────────────────────────────────────────────
   const GAME_MODES = {
     '301':     { startScore: 301, doubleOut: true },
     '501':     { startScore: 501, doubleOut: true },
     '701':     { startScore: 701, doubleOut: true },
     'cricket': { type: 'cricket' },
   };
   
   const CRICKET_NUMS = [20, 19, 18, 17, 16, 15, 25];
   
   // ─────────────────────────────────────────────────────────
   //  Checkout Table  (computed once at startup)
   //  Covers all reachable finishes 2–170 with up to 3 darts,
   //  last dart always a double or Bull.
   // ─────────────────────────────────────────────────────────
   const CHECKOUT_TABLE = (function () {
     // All darts ordered high-to-low so greedy search prefers T20, T19 …
     const setup = [];
     for (let n = 20; n >= 1; n--) {
       setup.push({ l: `T${n}`, s: n * 3 });
     }
     setup.push({ l: 'Bull', s: 50 });
     for (let n = 20; n >= 1; n--) {
       setup.push({ l: `D${n}`, s: n * 2 });
     }
     setup.push({ l: 'Outer', s: 25 });
     for (let n = 20; n >= 1; n--) {
       setup.push({ l: `${n}`, s: n });
     }
   
     // Finishing doubles ordered: Bull(50), D20(40) … D1(2)
     const dbl = [{ l: 'Bull', s: 50 }];
     for (let n = 20; n >= 1; n--) dbl.push({ l: `D${n}`, s: n * 2 });
   
     const tbl = {};
   
     // 1-dart checkouts
     for (const d of dbl) {
       if (!tbl[d.s]) tbl[d.s] = [d.l];
     }
   
     // 2-dart checkouts
     outer2:
     for (const s1 of setup) {
       for (const d of dbl) {
         const t = s1.s + d.s;
         if (t >= 2 && t <= 170 && !tbl[t]) {
           tbl[t] = [s1.l, d.l];
           if (Object.keys(tbl).length >= 200) break outer2; // safety
         }
       }
     }
   
     // 3-dart checkouts
     outer3:
     for (const s1 of setup) {
       for (const s2 of setup) {
         for (const d of dbl) {
           const t = s1.s + s2.s + d.s;
           if (t >= 2 && t <= 170 && !tbl[t]) {
             tbl[t] = [s1.l, s2.l, d.l];
           }
         }
         // Early row-exit: once s2 alone exceeds 170 with min double, no point continuing
         if (s2.s > 168) break;
       }
       if (s1.s > 168) break;
     }
   
     return tbl;
   })();
   
   // ─────────────────────────────────────────────────────────
   //  Application State
   // ─────────────────────────────────────────────────────────
   let game      = null;
   let inputMode = 'board';
   let kMult     = 1;
   let lastTurn  = null;
   let _overlayActive = false;   // blocks throws while turn-end overlay is visible
   
   // ─────────────────────────────────────────────────────────
   //  DOM helpers
   // ─────────────────────────────────────────────────────────
   const $    = id => document.getElementById(id);
   const show = id => $(id).classList.remove('hidden');
   const hide = id => $(id).classList.add('hidden');
   
   function esc(s) {
     return String(s)
       .replace(/&/g, '&amp;')
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;');
   }
   
   // ─────────────────────────────────────────────────────────
   //  Game Logic
   // ─────────────────────────────────────────────────────────
   function createGame(mode, names) {
     const cfg     = GAME_MODES[mode] || GAME_MODES['501'];
     const players = names.map(name => {
       if (mode === 'cricket') {
         return {
           name,
           score:   0,
           marks:   Object.fromEntries(CRICKET_NUMS.map(n => [String(n), 0])),
           history: [],
         };
       }
       return { name, score: cfg.startScore, history: [] };
     });
   
     return {
       mode,
       players,
       currentPlayerIdx: 0,
       currentRound:     1,
       throwsThisTurn:   [],
       winner:           null,
       active:           true,
       lastBust:         false,
       undoStack:        [],   // [{ state, label }]  label = what throw caused this snapshot
     };
   }
   
   function fmtThrow(base, mult) {
     if (base === 0)                return 'Miss';
     if (base === 25 && mult === 2) return 'BULL';
     if (base === 25)               return 'Outer';
     return ['', 'D', 'T'][mult - 1] + base;
   }
   
   function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
   
   // Push snapshot BEFORE a throw so we can always restore to pre-throw state.
   // label = human-readable description of what is ABOUT to happen (shown in history)
   function pushSnapshot(g, label) {
     const state = deepClone({ ...g, undoStack: [] });
     g.undoStack.push({ state, label });
     // No hard cap – user can go back as far as they like in the current game
   }
   
   function advanceTurn(g) {
     const cp = g.currentPlayerIdx;
     g.players[cp].history.push({
       round:  g.currentRound,
       throws: [...g.throwsThisTurn],
     });
     g.throwsThisTurn = [];
     const n = g.players.length;
     g.currentPlayerIdx = (cp + 1) % n;
     if (g.currentPlayerIdx === 0) g.currentRound++;
   }
   
   function processX01(g, throwObj) {
     const { doubleOut } = GAME_MODES[g.mode];
     const player        = g.players[g.currentPlayerIdx];
     const newScore      = player.score - throwObj.score;
   
     let bust = newScore < 0 || (newScore === 1 && doubleOut);
     if (!bust && newScore === 0) {
       if (doubleOut && !(throwObj.multiplier === 2 || throwObj.score === 50)) bust = true;
     }
   
     if (bust) {
       g.lastBust = true;
       advanceTurn(g);
       return { bust: true, winner: null, autoNext: true };
     }
   
     player.score = newScore;
   
     if (newScore === 0) {
       g.winner = player.name;
       g.active = false;
       advanceTurn(g);
       return { bust: false, winner: player.name, autoNext: true };
     }
   
     return { bust: false, winner: null, autoNext: false };
   }
   
   function processCricket(g, throwObj) {
     const { base, multiplier: mult } = throwObj;
     if (!CRICKET_NUMS.includes(base)) return { bust: false, winner: null, autoNext: false };
   
     const cp     = g.currentPlayerIdx;
     const player = g.players[cp];
     const key    = String(base);
   
     const oldMarks    = player.marks[key];
     player.marks[key] = Math.min(3, oldMarks + mult);
     const extraHits   = (oldMarks + mult) - 3;
   
     if (extraHits > 0) {
       const othersOpen = g.players.some((p, i) => i !== cp && p.marks[key] < 3);
       if (othersOpen) player.score += extraHits * (base === 25 ? 25 : base);
     }
   
     const allClosed = CRICKET_NUMS.every(n => player.marks[String(n)] >= 3);
     if (allClosed) {
       const maxScore = Math.max(...g.players.map(p => p.score));
       if (player.score >= maxScore) {
         g.winner = player.name;
         g.active = false;
         return { bust: false, winner: player.name, autoNext: false };
       }
     }
   
     return { bust: false, winner: null, autoNext: false };
   }
   
   function applyThrow(g, base, mult) {
     if (base === 0) mult = 1;
     if (base === 25 && mult === 3) return null;
     if (![1, 2, 3].includes(mult)) mult = 1;
     if (!g.active || g.throwsThisTurn.length >= 3) return null;
   
     const label    = fmtThrow(base, mult);
     const playerName = g.players[g.currentPlayerIdx].name;
     pushSnapshot(g, `${playerName}: ${label}`);
   
     const score    = (base === 25 && mult === 2) ? 50 : base * mult;
     const throwObj = { base, multiplier: mult, score, label };
   
     g.throwsThisTurn.push(throwObj);
     g.lastBust = false;
   
     let result = g.mode === 'cricket'
       ? processCricket(g, throwObj)
       : processX01(g, throwObj);
   
     if (g.throwsThisTurn.length >= 3 && !result.winner && !result.bust) {
       advanceTurn(g);
       result.autoNext = true;
     }
   
     return { throwObj, ...result };
   }
   
   // Undo one throw – preserves the remaining stack entries
   function applyUndo(g) {
     if (!g.undoStack.length) return false;
     const remaining       = g.undoStack.slice(0, -1);            // keep everything before last
     const { state }       = g.undoStack[g.undoStack.length - 1]; // restore the last snapshot
     Object.keys(state).forEach(k => { g[k] = state[k]; });
     g.undoStack  = remaining;   // put the trimmed stack back (snapshot had undoStack:[])
     g.lastBust   = false;
     return true;
   }
   
   // Undo to a specific snapshot index – keeps everything before that index
   function applyUndoToIndex(g, idx) {
     if (idx < 0 || idx >= g.undoStack.length) return false;
     const remaining = g.undoStack.slice(0, idx);  // keep snapshots before the target
     const { state } = g.undoStack[idx];
     Object.keys(state).forEach(k => { g[k] = state[k]; });
     g.undoStack = remaining;   // restore trimmed stack
     g.lastBust  = false;
     return true;
   }
   
   function applySkipTurn(g) { advanceTurn(g); }
   
   // ─────────────────────────────────────────────────────────
   //  Setup Screen
   // ─────────────────────────────────────────────────────────
   function addPlayer() {
     const list = $('players-list');
     const cnt  = list.querySelectorAll('.player-row').length;
     if (cnt >= 4) { alert('Maximal 4 Spieler'); return; }
     const row     = document.createElement('div');
     row.className = 'player-row';
     row.innerHTML = `
       <input class="player-input" type="text"
              placeholder="Spieler ${cnt + 1}" value="Spieler ${cnt + 1}">
       <button class="btn-rm" onclick="rmPlayer(this)">✕</button>`;
     list.appendChild(row);
   }
   
   function rmPlayer(btn) {
     if (document.querySelectorAll('.player-row').length <= 1) return;
     btn.closest('.player-row').remove();
   }
   
   function startGame() {
     const mode  = (document.querySelector('input[name="mode"]:checked') || {}).value || '501';
     const names = [...document.querySelectorAll('.player-input')]
       .map(i => i.value.trim()).filter(Boolean);
     if (!names.length) names.push('Spieler 1');
   
     game     = createGame(mode, names);
     lastTurn = null;
     clearTimeout(_overlayTimer);
     _overlayActive = false;
   
     hide('last-turn-box');
     $('turn-end-overlay').classList.add('hidden');
     $('mode-badge').textContent = mode === 'cricket' ? 'Cricket' : mode;
   
     hide('screen-setup');
     show('screen-game');
     buildKeypad();
     buildBoard();
     setMode('board');
     render();
   }
   
   function goSetup() {
     hide('screen-game');
     hide('win-modal');
     show('screen-setup');
     game     = null;
     lastTurn = null;
   }
   
   // ─────────────────────────────────────────────────────────
   //  Game Actions
   // ─────────────────────────────────────────────────────────
   function doThrow(base, mult) {
     if (!game || !game.active) return;
     if (game.throwsThisTurn.length >= 3) return;
     if (_overlayActive) return;   // ← block input during turn-end display
   
     const result = applyThrow(game, base, mult);
     if (!result) return;
   
     if (result.bust || result.autoNext) {
       const prevIdx    = (game.currentPlayerIdx === 0) ? game.players.length - 1 : game.currentPlayerIdx - 1;
       const prevPlayer = game.players[prevIdx];
       const lastHist   = prevPlayer.history[prevPlayer.history.length - 1];
       if (lastHist) {
         const total = lastHist.throws.reduce((s, t) => s + t.score, 0);
         lastTurn = { playerName: prevPlayer.name, throws: lastHist.throws, total, bust: result.bust };
         showTurnEndOverlay(lastTurn);
         renderLastTurnBox(lastTurn);
       }
     }
   
     if (result.bust)   flashBust();
     if (result.winner) showWinner(result.winner);
     render();
   }
   
   function undo() {
     if (!game) return;
     if (applyUndo(game)) {
       clearTimeout(_overlayTimer);
       $('turn-end-overlay').classList.add('hidden');
       _overlayActive = false;
       hideBust();
       render();
     }
   }
   
   function undoToIndex(idx) {
     if (!game) return;
     if (applyUndoToIndex(game, idx)) { hideBust(); hide('undo-history-panel'); render(); }
   }
   
   function skipTurn() {
     if (!game) return;
     applySkipTurn(game);
     hideBust();
     render();
   }
   
   // ─────────────────────────────────────────────────────────
   //  Input Mode
   // ─────────────────────────────────────────────────────────
   function setMode(m) {
     inputMode = m;
     if (m === 'board') {
       show('board-wrap');  hide('keypad-wrap');
       $('tog-board').classList.add('is-on');
       $('tog-keypad').classList.remove('is-on');
     } else {
       hide('board-wrap');  show('keypad-wrap');
       $('tog-keypad').classList.add('is-on');
       $('tog-board').classList.remove('is-on');
     }
   }
   
   function setMult(m) {
     kMult = m;
     document.querySelectorAll('.mult-btn').forEach(b => {
       b.classList.toggle('is-on', +b.dataset.m === m);
     });
     updateKeypadStyle();
   }
   
   function updateKeypadStyle() {
     if (!game) return;
     const isCricket = game.mode === 'cricket';
     document.querySelectorAll('.n-btn[data-num]').forEach(btn => {
       const n    = +btn.dataset.num;
       const isCN = CRICKET_NUMS.includes(n);
       btn.classList.toggle('is-dim',         isCricket && !isCN);
       btn.classList.toggle('is-cricket-num', isCricket &&  isCN);
     });
   }
   
   // ─────────────────────────────────────────────────────────
   //  Render
   // ─────────────────────────────────────────────────────────
   function render() {
     if (!game) return;
     $('round-num').textContent = game.currentRound;
     renderScoreboard();
     renderTurnPanel();
     renderRoundTable();
     renderCheckout();
     renderUndoHistory();
     updateKeypadStyle();
   }
   
   function renderScoreboard() {
     $('scoreboard').innerHTML = game.mode === 'cricket' ? renderCricket() : renderX01();
   }
   
   function renderX01() {
     return game.players.map((p, i) => {
       const act = i === game.currentPlayerIdx;
       return `<div class="score-card ${act ? 'is-active' : ''}">
         <div class="sc-name">${act ? '▶ ' : ''}${esc(p.name)}</div>
         <div class="sc-val">${p.score}</div>
         <div class="sc-avg">Ø ${playerAvg(p)} / Runde</div>
       </div>`;
     }).join('');
   }
   
   function renderCricket() {
     const nums = [20, 19, 18, 17, 16, 15, 25];
     const ps   = game.players;
     let h = '<div class="cricket-tbl">';
     h += '<div class="cr-row cr-head"><div class="cr-num"></div>';
     ps.forEach((p, i) => {
       h += `<div class="cr-p ${i === game.currentPlayerIdx ? 'is-cur' : ''}">${esc(p.name)}</div>`;
     });
     h += '</div>';
     nums.forEach(n => {
       h += `<div class="cr-row"><div class="cr-num">${n === 25 ? 'Bull' : n}</div>`;
       ps.forEach(p => {
         const m = p.marks[String(n)] || 0;
         h += `<div class="cr-marks ${m >= 3 ? 'is-closed' : ''}">
           ${ ['', '∕', '✕', '⊙'][Math.min(m, 3)] }</div>`;
       });
       h += '</div>';
     });
     h += '<div class="cr-row cr-scores"><div class="cr-num">Pts</div>';
     ps.forEach((p, i) => {
       h += `<div class="cr-p ${i === game.currentPlayerIdx ? 'is-cur' : ''}">${p.score}</div>`;
     });
     h += '</div></div>';
     return h;
   }
   
   function renderTurnPanel() {
     const cp     = game.players[game.currentPlayerIdx];
     $('turn-player').textContent = cp.name;
   
     const throws = game.throwsThisTurn;
     for (let i = 0; i < 3; i++) {
       const sl = $('s' + i);
       if (i < throws.length) {
         sl.textContent = throws[i].label;
         sl.classList.add('is-filled');
       } else {
         sl.textContent = '_';
         sl.classList.remove('is-filled');
       }
     }
   
     const total = throws.reduce((s, t) => s + t.score, 0);
     $('turn-summary').textContent = game.mode !== 'cricket'
       ? `Punkte: ${total}  |  Verbleibend: ${cp.score}`
       : `Würfe diese Runde: ${throws.length} / 3`;
   
     renderHistory(cp);
   }
   
   function renderHistory(player) {
     const hist = player.history || [];
     const el   = $('hist-list');
     if (!hist.length) { el.innerHTML = '<div class="hist-none">Noch keine Runden</div>'; return; }
     el.innerHTML = hist.slice(-6).reverse().map(h => {
       const labels = h.throws.map(t => t.label).join(' · ') || '—';
       const pts    = h.throws.reduce((s, t) => s + t.score, 0);
       return `<div class="hist-entry">Rd ${h.round}: ${esc(labels)} <span class="hist-pts">(${pts})</span></div>`;
     }).join('');
   }
   
   function renderRoundTable() {
     const el      = $('round-table');
     const players = game.players;
   
     const maxRound = players.reduce((m, p) => {
       const last = p.history[p.history.length - 1];
       return last ? Math.max(m, last.round) : m;
     }, 0);
   
     if (maxRound === 0) {
       el.innerHTML = '<div class="rt-none">Noch keine Runde abgeschlossen</div>';
       return;
     }
   
     const roundTotals = {};
     players.forEach((p, pi) => {
       p.history.forEach(h => {
         if (!roundTotals[h.round]) roundTotals[h.round] = {};
         roundTotals[h.round][pi] = h.throws.reduce((s, t) => s + t.score, 0);
       });
     });
   
     const grandTotals = players.map(p =>
       p.history.reduce((s, h) => s + h.throws.reduce((a, t) => a + t.score, 0), 0)
     );
   
     let html = '<table class="round-table"><thead><tr><th class="rt-rd">RD</th>';
     players.forEach(p => { html += `<th>${esc(p.name)}</th>`; });
     html += '</tr></thead><tbody>';
   
     for (let r = 1; r <= maxRound; r++) {
       const row  = roundTotals[r] || {};
       const vals = players.map((_, pi) => row[pi] !== undefined ? row[pi] : null);
       const maxVal = Math.max(...vals.filter(v => v !== null));
       html += `<tr><td class="rt-rd">R${r}</td>`;
       players.forEach((_, pi) => {
         const v = vals[pi];
         if (v === null) { html += '<td style="color:var(--dim)">—</td>'; return; }
         const best = v === maxVal && maxVal > 0 && vals.filter(x => x === maxVal).length === 1;
         html += `<td class="${best ? 'rt-best' : ''}">${v}</td>`;
       });
       html += '</tr>';
     }
   
     const maxGrand = Math.max(...grandTotals);
     html += '<tr class="rt-total"><td class="rt-rd">∑ Gesamt</td>';
     grandTotals.forEach(t => {
       const best = t === maxGrand && grandTotals.filter(x => x === maxGrand).length === 1;
       html += `<td class="${best ? 'rt-best' : ''}">${t}</td>`;
     });
     html += '</tr></tbody></table>';
     el.innerHTML = html;
   }
   
   // ─────────────────────────────────────────────────────────
   //  Checkout Suggestions
   // ─────────────────────────────────────────────────────────
   function renderCheckout() {
     const el = $('checkout-box');
     if (!game || !game.active || game.mode === 'cricket') { hide('checkout-box'); return; }
   
     const cp            = game.players[game.currentPlayerIdx];
     const remaining     = cp.score;
     const dartsLeft     = 3 - game.throwsThisTurn.length;
     const checkout      = CHECKOUT_TABLE[remaining];
   
     if (!checkout || checkout.length > dartsLeft) { hide('checkout-box'); return; }
   
     // Build dart badges
     const badges = checkout.map(d => {
       let cls = 'co-dart';
       if (d.startsWith('T'))   cls += ' co-triple';
       else if (d.startsWith('D') || d === 'Bull') cls += ' co-double';
       return `<span class="${cls}">${esc(d)}</span>`;
     }).join('<span class="co-arrow">→</span>');
   
     el.innerHTML = `
       <div class="co-header">🎯 CHECKOUT MÖGLICH</div>
       <div class="co-darts">${badges}</div>
       <div class="co-score">${remaining} Punkte</div>`;
     show('checkout-box');
   }
   
   // ─────────────────────────────────────────────────────────
   //  Undo History Panel
   // ─────────────────────────────────────────────────────────
   function toggleUndoHistory() {
     const panel = $('undo-history-panel');
     if (panel.classList.contains('hidden')) {
       renderUndoHistory();
       show('undo-history-panel');
     } else {
       hide('undo-history-panel');
     }
   }
   
   function renderUndoHistory() {
     const el    = $('undo-history-list');
     const stack = game ? game.undoStack : [];
   
     // Update counter badge on button
     const badge = $('undo-history-badge');
     if (badge) badge.textContent = stack.length || '';
   
     if (!stack.length) {
       el.innerHTML = '<div class="uh-empty">Kein Verlauf vorhanden</div>';
       return;
     }
   
     // Show newest first (highest index = most recent)
     el.innerHTML = [...stack].reverse().map((entry, ri) => {
       const idx = stack.length - 1 - ri; // actual index in undoStack
       return `<div class="uh-entry">
         <span class="uh-label">${esc(entry.label)}</span>
         <button class="uh-btn" onclick="undoToIndex(${idx})">↩ Hierher</button>
       </div>`;
     }).join('');
   }
   
   // ─────────────────────────────────────────────────────────
   //  Bust / Winner / Overlays
   // ─────────────────────────────────────────────────────────
   function flashBust() { show('bust-box'); setTimeout(hideBust, 2200); }
   function hideBust()  { hide('bust-box'); }
   
   let _overlayTimer = null;
   
   function showTurnEndOverlay(turn) {
     clearTimeout(_overlayTimer);
     _overlayActive = true;
   
     const el     = $('turn-end-overlay');
     const labels = turn.throws.map(t => `<div class="te-throw">${esc(t.label)}</div>`).join('');
     const totalTxt = turn.bust ? 'BUST' : turn.total;
   
     // Write content first, then remove hidden — avoids any flash of empty element
     el.innerHTML = `
       <div class="turn-end-card ${turn.bust ? 'is-bust' : ''}">
         <div class="te-name">${esc(turn.playerName)}</div>
         <div class="te-throws">${labels}</div>
         <div class="te-total">${totalTxt}</div>
         <div class="te-total-label">${turn.bust ? 'PUNKTE VERFALLEN' : 'PUNKTE DIESE RUNDE'}</div>
       </div>`;
   
     // Force reflow so animation restarts cleanly if shown back-to-back
     el.classList.add('hidden');
     void el.offsetWidth;
     el.classList.remove('hidden');
   
     // Hide with class only — never clear innerHTML here (causes scrollbar flash)
     _overlayTimer = setTimeout(() => {
       el.classList.add('hidden');
       _overlayActive = false;
     }, 2900);
   }
   
   function renderLastTurnBox(turn) {
     if (!turn) { hide('last-turn-box'); return; }
     $('lt-name').textContent = turn.playerName;
     $('lt-throws').innerHTML = turn.throws.map(t => `<span class="lt-throw">${esc(t.label)}</span>`).join('');
     const totalEl = $('lt-total');
     if (turn.bust) {
       totalEl.textContent = '💥 BUST – 0 Punkte';
       totalEl.className   = 'lt-total is-bust';
     } else {
       totalEl.textContent = `Gesamt: ${turn.total} Punkte`;
       totalEl.className   = 'lt-total';
     }
     show('last-turn-box');
   }
   
   function showWinner(name) {
     $('win-name').textContent = name;
     $('win-sub').textContent  = `${game.mode.toUpperCase()} · ${game.currentRound - 1} Runden`;
     show('win-modal');
   }
   
   function playerAvg(p) {
     const h = p.history || [];
     if (!h.length) return '0.0';
     return (h.reduce((s, r) => s + r.throws.reduce((a, t) => a + t.score, 0), 0) / h.length).toFixed(1);
   }
   
   // ─────────────────────────────────────────────────────────
   //  Keypad Builder
   // ─────────────────────────────────────────────────────────
   function buildKeypad() {
     const grid = $('num-grid');
     grid.innerHTML = '';
     for (let n = 1; n <= 20; n++) {
       const b       = document.createElement('button');
       b.className   = 'n-btn';
       b.textContent = n;
       b.dataset.num = n;
       b.onclick     = () => doThrow(n, kMult);
       grid.appendChild(b);
     }
   }
   
   // ─────────────────────────────────────────────────────────
   //  Dartboard SVG
   // ─────────────────────────────────────────────────────────
   const BOARD_NUMS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
   const CX = 210, CY = 210;
   const RB = 13, ROB = 33, RTI = 88, RTO = 108, RDI = 155, RDO = 175;
   
   function ang2xy(deg, r) {
     const rad = (deg - 90) * Math.PI / 180;
     return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
   }
   
   function sectorPath(r1, r2, a1, a2) {
     const [x1, y1] = ang2xy(a1, r1), [x2, y2] = ang2xy(a2, r1);
     const [x3, y3] = ang2xy(a2, r2), [x4, y4] = ang2xy(a1, r2);
     const lg = (a2 - a1) > 180 ? 1 : 0;
     return `M${x1},${y1}A${r1},${r1},0,${lg},1,${x2},${y2}L${x3},${y3}A${r2},${r2},0,${lg},0,${x4},${y4}Z`;
   }
   
   function svgEl(parent, tag, attrs) {
     const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
     Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
     parent.appendChild(el);
     return el;
   }
   
   let _tip = null;
   function getTip() {
     if (!_tip) {
       _tip = document.createElement('div');
       _tip.style.cssText =
         'position:fixed;pointer-events:none;background:#0d1424;' +
         'border:1px solid #22d3ee;color:#22d3ee;' +
         'font-family:Orbitron,monospace;font-size:.8rem;font-weight:700;' +
         'padding:.2rem .6rem;border-radius:5px;letter-spacing:.1em;' +
         'opacity:0;transition:opacity .1s;z-index:9999;';
       document.body.appendChild(_tip);
     }
     return _tip;
   }
   
   function showTip(txt, e) {
     const t = getTip();
     t.textContent = txt;
     t.style.left  = (e.clientX + 14) + 'px';
     t.style.top   = (e.clientY - 10) + 'px';
     t.style.opacity = '1';
   }
   function hideTip() { getTip().style.opacity = '0'; }
   
   function makeSeg(svg, pathOrR, isCircle, fill, label, onClick) {
     const el = isCircle
       ? svgEl(svg, 'circle', { cx: CX, cy: CY, r: pathOrR, fill, stroke: '#111', 'stroke-width': '1.2' })
       : svgEl(svg, 'path',   { d: pathOrR, fill, stroke: '#111', 'stroke-width': '0.8' });
     el.classList.add('board-seg');
     el.addEventListener('click',      e => { e.stopPropagation(); hideTip(); onClick(); });
     el.addEventListener('mousemove',  e => showTip(label, e));
     el.addEventListener('mouseleave', hideTip);
     return el;
   }
   
   function buildBoard() {
     const svg = $('dart-svg');
     svg.innerHTML = '';
     const BLK = '#1a1510', CRM = '#d4c498', RED = '#c0392b', GRN = '#27ae60';
   
     svgEl(svg, 'circle', { cx: CX, cy: CY, r: 207, fill: '#0d0d10', stroke: '#333', 'stroke-width': '3' });
   
     BOARD_NUMS.forEach((num, i) => {
       const a1 = i * 18 - 9, a2 = a1 + 18;
       const light = i % 2 !== 0, sing = light ? CRM : BLK, ring = light ? GRN : RED;
       makeSeg(svg, sectorPath(ROB, RTI, a1, a2), false, sing, `${num}`,               () => doThrow(num, 1));
       makeSeg(svg, sectorPath(RTI, RTO, a1, a2), false, ring, `T${num} = ${num * 3}`, () => doThrow(num, 3));
       makeSeg(svg, sectorPath(RTO, RDI, a1, a2), false, sing, `${num}`,               () => doThrow(num, 1));
       makeSeg(svg, sectorPath(RDI, RDO, a1, a2), false, ring, `D${num} = ${num * 2}`, () => doThrow(num, 2));
     });
   
     makeSeg(svg, ROB, true, GRN, 'Outer Bull (25)', () => doThrow(25, 1));
     makeSeg(svg, RB,  true, RED, '🎯 BULL (50)',    () => doThrow(25, 2));
   
     BOARD_NUMS.forEach((_, i) => {
       const a = i * 18 - 9;
       const [x1, y1] = ang2xy(a, ROB), [x2, y2] = ang2xy(a, RDO + 1);
       const l = svgEl(svg, 'line', { x1, y1, x2, y2, stroke: '#555', 'stroke-width': '1.3' });
       l.style.pointerEvents = 'none';
     });
   
     [RTI, RTO, RDI, RDO, ROB].forEach(r => {
       const heavy = r === RTO || r === RDO;
       const c = svgEl(svg, 'circle', {
         cx: CX, cy: CY, r, fill: 'none',
         stroke: heavy ? '#666' : '#444',
         'stroke-width': heavy ? '1.5' : '0.8',
       });
       c.style.pointerEvents = 'none';
     });
   
     BOARD_NUMS.forEach((num, i) => {
       const [x, y] = ang2xy(i * 18, RDO + 16);
       const t = svgEl(svg, 'text', {
         x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
         fill: '#fff', 'font-size': '13', 'font-family': 'Orbitron,monospace',
         'font-weight': '900', 'pointer-events': 'none',
       });
       t.textContent = num;
     });
   }