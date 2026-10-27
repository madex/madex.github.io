/* WauDoku – App (UI, Spielablauf, Speicherstand) */
(function () {
  'use strict';

  const E = window.MeowEngine;
  const S = window.MeowSound;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const EMPTY = 0, X = 1, CAT = 2, ERR = 3;
  const MAX_HEARTS = 3;
  const TOOL_CAP = 9;
  const DOUBLE_TAP_MS = 340;
  const STORE_KEY = 'meowdoku.save.v1';
  // Punkte
  const PTS_DOG = 100, PTS_COMBO = 50, PTS_HEART = 200, PTS_HINT = 50;
  const fmtPts = (p) => p.toLocaleString('de-DE');

  // ---------- Spielfigur: Herr Wau ----------
  const WORDS = { nom: 'der Hund', acc: 'den Hund', indef: 'ein Hund', Indef: 'Ein Hund', negAcc: 'keinen Hund', negNom: 'kein Hund' };
  const HELPER = 'Hunde-Helfer';
  const CELL_IMG = 'assets/img/dog.webp';
  E.setWords(WORDS);

  // ---------- Speicherstand ----------
  const DEFAULT_SAVE = {
    level: 1,
    completed: {},
    tools: { hint: 3, locate: 3 },
    settings: { sound: true, music: false, vibrate: true, autoX: true, timer: true },
    daily: {},
    progress: {},
    rulesSeen: false
  };
  let save = load();
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        return Object.assign({}, DEFAULT_SAVE, s, {
          settings: Object.assign({}, DEFAULT_SAVE.settings, s.settings),
          tools: Object.assign({}, DEFAULT_SAVE.tools, s.tools)
        });
      }
    } catch (e) { /* privater Modus o. ä. */ }
    return JSON.parse(JSON.stringify(DEFAULT_SAVE));
  }
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(save)); } catch (e) { /* ignorieren */ }
  }

  // ---------- Level-Definition ----------
  /* Schwierigkeitskurve (Stufe = höchste nötige Logikstufe, siehe engine.js):
   *   1–3     die drei Einstiegslevel (fest vorgegeben, Level 1 ist das leichteste)
   *   4–10    5×5 / 6×6, nur einfachste Schritte
   *   11–45   6×6 / 7×7, bis Stufe 2
   *   46–100  7×7 / 8×8, bis Stufe 3
   *   101+    8×8 → 10×10, mindestens Stufe 3
   * Ab Level 30 ist jedes 10. Level „Schwer“ (eine Nummer größer und kniffliger). */
  const START_LEVELS = {
    1: { size: 6, seedOf: 3, opts: { maxTier: 2 } },
    2: { size: 5, seedOf: 2, opts: { maxTier: 2 } },
    3: { size: 5, seedOf: 1, opts: { maxTier: 2 } }
  };
  function levelSpec(n) {
    const fixed = START_LEVELS[n];
    if (fixed) return { key: 'L' + n, number: n, size: fixed.size, hard: false, seed: E.hashString('meowdoku-level-' + fixed.seedOf), opts: fixed.opts };
    const hard = n >= 30 && n % 10 === 0;
    let size, opts;
    if (n <= 6) { size = 5; opts = { maxTier: 1 }; }
    else if (n <= 10) { size = 6; opts = { maxTier: 1 }; }
    else if (n <= 25) { size = 6; opts = { maxTier: 2 }; }
    else if (n <= 45) { size = 7; opts = { maxTier: 2 }; }
    else if (n <= 70) { size = 7; opts = { maxTier: 3 }; }
    else if (n <= 100) { size = 8; opts = { maxTier: 3 }; }
    else if (n <= 140) { size = 8; opts = { minTier: 3 }; }
    else if (n <= 180) { size = 9; opts = { minTier: 3 }; }
    else { size = 10; opts = { minTier: 3 }; }
    if (hard) {
      size = Math.min(10, size + 1);
      opts = n <= 100 ? { minTier: 3, maxTier: 3 } : { minTier: 4 };
    }
    if (n > 10) opts.noSingles = true;
    return { key: 'L' + n, number: n, size, hard, seed: E.hashString('meowdoku-level-' + n), opts };
  }
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function dailySpec() {
    const date = todayStr();
    return { key: 'D' + date, daily: true, date, size: 7, hard: false, seed: E.hashString('meowdoku-daily-' + date), opts: { maxTier: 3, noSingles: true } };
  }
  const levelCache = new Map();
  function getLevel(spec) {
    if (!levelCache.has(spec.key)) levelCache.set(spec.key, E.generate(spec.size, spec.seed, spec.opts));
    return levelCache.get(spec.key);
  }

  // ---------- Bildschirme ----------
  let current = 'home';
  function show(name) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    current = name;
    if (name === 'home') renderHome();
    if (name === 'levels') renderLevels();
    if (name === 'game') requestAnimationFrame(layoutBoard);
    updateTimerRunning();
  }
  function navigate(name) {
    if (name !== 'home' && current === 'home') history.pushState({ screen: name }, '');
    show(name);
  }
  window.addEventListener('popstate', () => {
    const open = $$('.overlay').find((o) => !o.hidden && o.id !== 'dlg-win' && o.id !== 'dlg-fail');
    if (open) { closeDialogs(); history.pushState({ screen: current }, ''); return; }
    closeDialogs();
    show('home');
  });

  function renderHome() {
    $('#home-level-label').textContent = 'Level ' + save.level;
    const done = !!save.daily[todayStr()];
    $('#daily-check').hidden = !done;
    const count = Object.keys(save.completed).length;
    const total = Object.values(save.completed).concat(Object.values(save.daily))
      .reduce((a, v) => a + ((v && v.score) || 0), 0);
    $('#home-stats').innerHTML = count
      ? `<b>${fmtPts(total)} Punkte</b> · ${count} Level gelöst · ${Object.keys(save.daily).length} tägliche Rätsel` : '';
  }

  function renderLevels() {
    const grid = $('#level-grid');
    const max = Math.max(save.level + 10, 50);
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= max; n++) {
      const b = document.createElement('button');
      b.className = 'level-btn';
      b.textContent = n;
      if (save.completed[n]) b.classList.add('done');
      if (n === save.level) b.classList.add('current');
      if (n > save.level) b.classList.add('locked');
      if (levelSpec(n).hard) b.classList.add('hard');
      b.addEventListener('click', () => { S.play('click'); startLevel(levelSpec(n)); });
      frag.appendChild(b);
    }
    grid.replaceChildren(frag);
    const cur = grid.querySelector('.current');
    if (cur) setTimeout(() => cur.scrollIntoView({ block: 'center' }), 50);
  }

  // ---------- Dialoge ----------
  function openDialog(id) {
    $$('.overlay').forEach((o) => { if (o.id !== id) o.hidden = true; });
    $('#' + id).hidden = false;
    S.play('dialog', 0.6);
    updateTimerRunning();
  }
  function closeDialogs() {
    $$('.overlay').forEach((o) => { if (o.id !== 'dlg-win' && o.id !== 'dlg-fail') o.hidden = true; });
    updateTimerRunning();
  }
  function confirmDialog(title, text, yesLabel, onYes) {
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    const yes = $('#confirm-yes');
    yes.textContent = yesLabel;
    yes.onclick = () => { closeDialogs(); onYes(); };
    openDialog('dlg-confirm');
  }
  let toastTimer = 0;
  function toast(msg, ms = 2200) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ---------- Spielzustand ----------
  let game = null;
  const board = $('#board');

  function startLevel(spec) {
    navigate('game');
    $('#game-title').textContent = spec.daily ? 'Tägliches Rätsel' : 'Level ' + spec.number;
    board.replaceChildren();
    // Generierung kurz verzögern, damit der Bildschirmwechsel flüssig bleibt
    setTimeout(() => {
      const lvl = getLevel(spec);
      const N = lvl.size * lvl.size;
      const saved = save.progress[spec.key];
      game = {
        spec, lvl, n: lvl.size,
        solution: new Set(lvl.solution),
        cells: saved ? Int8Array.from(saved.cells) : new Int8Array(N),
        hearts: saved ? saved.hearts : MAX_HEARTS,
        time: saved ? saved.time : 0,
        mistakes: saved ? saved.mistakes : 0,
        score: saved && saved.score ? saved.score : 0,
        scored: new Set(saved && saved.scored ? saved.scored : []),
        undo: [],
        over: false,
        streak: 0,
        logic: new E.Logic(lvl.size, lvl.regions)
      };
      buildBoard();
      renderAll();
      $('#difficulty-tag').hidden = !spec.hard;
      S.play('enter', 0.7);
      if (!save.rulesSeen) { save.rulesSeen = true; persist(); openDialog('dlg-rules'); }
      updateTimerRunning();
      // nächstes Level im Leerlauf vorbereiten
      if (!spec.daily) idle(() => getLevel(levelSpec(spec.number + 1)));
    }, 30);
  }
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));

  function saveProgress() {
    if (!game) return;
    if (game.over) { delete save.progress[game.spec.key]; }
    else {
      save.progress[game.spec.key] = {
        cells: Array.from(game.cells), hearts: game.hearts, time: Math.floor(game.time),
        mistakes: game.mistakes, score: game.score, scored: Array.from(game.scored)
      };
    }
    persist();
  }

  // ---------- Brett ----------
  let cellEls = [];
  function buildBoard() {
    const { n, lvl } = game;
    board.style.setProperty('--n', n);
    board.style.setProperty('--gap', n <= 6 ? '5px' : n <= 8 ? '4px' : '3px');
    cellEls = [];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n * n; i++) {
      const el = document.createElement('div');
      el.className = 'cell';
      el.dataset.i = i;
      el.style.setProperty('--c', lvl.colors[lvl.regions[i]]);
      el.style.setProperty('--d', (i % n) + Math.floor(i / n));
      cellEls.push(el);
      frag.appendChild(el);
    }
    board.replaceChildren(frag);
    board.classList.remove('enter');
    void board.offsetWidth;
    board.classList.add('enter');
    setTimeout(() => board.classList.remove('enter'), 900);
    layoutBoard();
  }

  function layoutBoard() {
    if (!game) return;
    const area = $('#board-area');
    const w = area.clientWidth, h = area.clientHeight - (game.spec.hard ? 34 : 0) - 8;
    const size = Math.max(160, Math.floor(Math.min(w, h, 560)));
    board.style.width = size + 'px';
    const cellPx = (size - 12) / game.n;
    board.style.setProperty('--r', Math.max(3, Math.round(cellPx * 0.14)) + 'px');
  }
  window.addEventListener('resize', layoutBoard);

  function renderCell(i) {
    const el = cellEls[i], st = game.cells[i];
    el.classList.toggle('x', st === X);
    el.classList.toggle('err', st === ERR);
    const isCat = st === CAT;
    if (isCat !== el.classList.contains('cat')) {
      el.classList.toggle('cat', isCat);
      if (isCat) { const img = document.createElement('img'); img.src = CELL_IMG; img.alt = ''; el.appendChild(img); }
      else el.replaceChildren();
    }
  }
  function renderAll() {
    for (let i = 0; i < game.cells.length; i++) renderCell(i);
    renderStatus();
    renderTools();
  }
  function renderStatus() {
    const cats = game.cells.reduce((a, v) => a + (v === CAT ? 1 : 0), 0);
    $('#cats-found').textContent = cats;
    $('#cats-total').textContent = game.n;
    const hearts = $('#hearts');
    if (hearts.children.length !== MAX_HEARTS) {
      hearts.replaceChildren(...Array.from({ length: MAX_HEARTS }, () => {
        const img = document.createElement('img'); img.src = 'assets/img/heart.svg'; img.className = 'heart'; img.alt = ''; return img;
      }));
    }
    Array.from(hearts.children).forEach((h, k) => h.classList.toggle('lost', k >= game.hearts));
    $('#timer-pill').classList.toggle('hidden', !save.settings.timer);
    $('#game-score').textContent = fmtPts(game.score) + ' Punkte';
    $('#timer').textContent = fmtTime(game.time);
  }
  function renderTools() {
    setBadge('#badge-hint', save.tools.hint);
    setBadge('#badge-locate', save.tools.locate);
  }
  function setBadge(sel, v) {
    const b = $(sel);
    b.textContent = v > 0 ? v : '+';
    b.classList.toggle('empty', v <= 0);
  }
  const fmtTime = (t) => { t = Math.floor(t); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

  // ---------- Timer ----------
  let timerId = 0, lastTick = 0;
  function updateTimerRunning() {
    const dialogOpen = $$('.overlay').some((o) => !o.hidden);
    const run = game && !game.over && current === 'game' && !document.hidden && !dialogOpen;
    if (run && !timerId) {
      lastTick = performance.now();
      timerId = setInterval(() => {
        const now = performance.now();
        game.time += (now - lastTick) / 1000;
        lastTick = now;
        $('#timer').textContent = fmtTime(game.time);
      }, 500);
    } else if (!run && timerId) {
      clearInterval(timerId); timerId = 0;
      if (game) saveProgress();
    }
  }
  document.addEventListener('visibilitychange', updateTimerRunning);

  // ---------- Undo ----------
  function snapshot() {
    game.undo.push(Int8Array.from(game.cells));
    if (game.undo.length > 200) game.undo.shift();
  }
  function undo() {
    if (!game || game.over) return;
    clearHint();
    const snap = game.undo.pop();
    if (!snap) { toast('Nichts zum Rückgängigmachen'); return; }
    for (let i = 0; i < snap.length; i++) {
      // Fehler bleiben bestehen – sie haben ja schon ein Herz gekostet
      if (game.cells[i] === ERR) continue;
      game.cells[i] = snap[i] === ERR ? X : snap[i];
    }
    S.play('unx');
    renderAll();
    saveProgress();
  }

  // ---------- Eingabe ----------
  let drag = null;
  let lastTap = { i: -1, t: 0 };
  let catPlacedAt = { i: -1, t: 0 };

  function cellFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    const c = el && el.closest ? el.closest('.cell') : null;
    return c && board.contains(c) ? +c.dataset.i : -1;
  }

  board.addEventListener('pointerdown', (e) => {
    S.unlock();
    if (!game || game.over || e.button === 2) return;
    const i = cellFromPoint(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    clearHint();
    const now = performance.now();
    const st = game.cells[i];

    // Doppeltippen → Katze
    if (lastTap.i === i && now - lastTap.t < DOUBLE_TAP_MS && st !== CAT && st !== ERR) {
      // der erste Tipp hat bereits einen Undo-Schnappschuss angelegt
      lastTap = { i: -1, t: 0 };
      game.cells[i] = EMPTY;
      tryCat(i, 'tap');
      drag = null;
      return;
    }

    if (st === ERR) { lastTap = { i, t: now }; return; }
    if (st === CAT) {
      // Katze entfernen (nicht direkt nach dem Setzen durch Doppeltippen)
      if (catPlacedAt.i === i && now - catPlacedAt.t < 600) return;
      snapshot();
      game.cells[i] = EMPTY;
      S.play('unx');
      renderCell(i); renderStatus(); saveProgress();
      lastTap = { i: -1, t: 0 };
      return;
    }
    snapshot();
    const mode = st === EMPTY ? 'mark' : 'unmark';
    applyDrag(i, mode);
    drag = { mode, last: i, pointer: e.pointerId, moved: false };
    lastTap = { i, t: now };
    try { board.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
  });

  board.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const i = cellFromPoint(e.clientX, e.clientY);
    if (i < 0 || i === drag.last) return;
    drag.last = i;
    drag.moved = true;
    lastTap = { i: -1, t: 0 };
    applyDrag(i, drag.mode);
  });
  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.pointer)) return;
    drag = null;
    saveProgress();
  };
  board.addEventListener('pointerup', endDrag);
  board.addEventListener('pointercancel', endDrag);
  board.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!game || game.over) return;
    const i = cellFromPoint(e.clientX, e.clientY);
    if (i < 0) return;
    const st = game.cells[i];
    if (st === CAT || st === ERR) return;
    clearHint();
    snapshot();
    game.cells[i] = EMPTY;
    tryCat(i, 'tap');
  });

  function applyDrag(i, mode) {
    const st = game.cells[i];
    if (mode === 'mark' && st === EMPTY) { game.cells[i] = X; S.play('x', 0.7); S.vibrate(8); renderCell(i); }
    else if (mode === 'unmark' && st === X) { game.cells[i] = EMPTY; S.play('unx', 0.7); renderCell(i); }
  }

  // ---------- Katze setzen ----------
  const COMBO_WORDS = ['', 'Nice', 'Great', 'Perfect', 'Amazing', 'Excellent', 'Unbelievable'];

  function tryCat(i, source) {
    if (game.solution.has(i)) {
      game.cells[i] = CAT;
      catPlacedAt = { i, t: performance.now() };
      S.play('cat');
      S.vibrate(15);
      if (save.settings.autoX) {
        let marked = 0;
        for (const b of game.logic.blockedBy(game.cells, i)) { game.cells[b] = X; marked++; }
        if (marked) setTimeout(() => S.play('autox', 0.5), 120);
      }
      for (let k = 0; k < game.cells.length; k++) renderCell(k);
      renderStatus();
      if (source !== 'tool') {
        game.streak++;
        if (game.streak >= 2) showCombo(Math.min(6, game.streak - 1));
        // jeder Hund zählt nur einmal (auch nach Rückgängig)
        if (!game.scored.has(i)) {
          game.scored.add(i);
          addScore(PTS_DOG + PTS_COMBO * Math.min(5, game.streak - 1));
        }
      }
      checkWin();
    } else {
      game.cells[i] = ERR;
      game.hearts--;
      game.mistakes++;
      game.streak = 0;
      renderCell(i);
      renderStatus();
      const heartEl = $('#hearts').children[game.hearts];
      if (heartEl) { heartEl.classList.add('breaking'); setTimeout(() => heartEl.classList.remove('breaking'), 700); }
      S.play('wrong');
      S.vibrate([50, 40, 70]);
      board.classList.remove('shake'); void board.offsetWidth; board.classList.add('shake');
      flashRule(i);
      if (game.hearts <= 0) {
        game.over = true;
        updateTimerRunning();
        setTimeout(showFail, 700);
      }
    }
    saveProgress();
  }

  function addScore(pts) {
    game.score = Math.max(0, game.score + pts);
    renderStatus();
    const el = $('#game-score');
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  function flashRule(i) {
    const { n, lvl } = game;
    const r = Math.floor(i / n), c = i % n;
    let rule = null;
    for (let k = 0; k < game.cells.length; k++) {
      if (game.cells[k] !== CAT) continue;
      const kr = Math.floor(k / n), kc = k % n;
      if (lvl.regions[k] === lvl.regions[i]) { rule = 'region'; break; }
      if (kr === r || kc === c) { rule = 'line'; break; }
      if (Math.abs(kr - r) <= 1 && Math.abs(kc - c) <= 1) { rule = 'touch'; break; }
    }
    if (!rule) { toast(`Falsch – hier versteckt sich ${WORDS.negNom}!`); return; }
    const chip = $(`.rule-chip[data-rule="${rule}"]`);
    chip.classList.remove('flash'); void chip.offsetWidth; chip.classList.add('flash');
    setTimeout(() => chip.classList.remove('flash'), 1400);
  }

  function showCombo(level) {
    const host = $('#combo');
    const w = document.createElement('div');
    w.className = 'combo-word w' + level;
    w.textContent = COMBO_WORDS[level] + '!';
    host.appendChild(w);
    S.play('c' + level, 0.8);
    setTimeout(() => w.remove(), 1200);
  }

  // ---------- Werkzeuge ----------
  function useLocate() {
    if (!game || game.over) return;
    clearHint();
    if (save.tools.locate <= 0) { toast(`Keine ${HELPER} mehr – löse Level für Nachschub!`); return; }
    const missing = game.lvl.solution.filter((i) => game.cells[i] !== CAT);
    if (!missing.length) return;
    const i = missing[Math.floor(Math.random() * missing.length)];
    save.tools.locate--;
    snapshot();
    game.cells[i] = EMPTY;
    bumpTool('locate');
    tryCat(i, 'tool');
    cellEls[i].classList.add('located');
    setTimeout(() => cellEls[i] && cellEls[i].classList.remove('located'), 1500);
    renderTools();
    persist();
  }

  let hintTimer = 0;
  function useHint() {
    if (!game || game.over) return;
    clearHint();
    if (save.tools.hint <= 0) { toast('Keine Tipps mehr – löse Level für Nachschub!'); return; }
    const step = findHintStep();
    if (!step) return;
    save.tools.hint--;
    bumpTool('hint');
    addScore(-PTS_HINT);
    S.play('hint');
    snapshot();
    board.classList.add('hinting');
    const focus = new Set(step.focus.concat(step.cells));
    focus.forEach((i) => cellEls[i].classList.add('focus'));
    step.cells.forEach((i) => cellEls[i].classList.add('target'));
    $('#hint-text').textContent = step.text;
    $('#hint-banner').hidden = false;
    // Schritt anwenden
    if (step.kind === 'cat') {
      setTimeout(() => { if (game.cells[step.cells[0]] !== CAT) { game.cells[step.cells[0]] = EMPTY; tryCat(step.cells[0], 'tool'); } }, 700);
    } else if (step.kind === 'unx') {
      step.cells.forEach((i) => { game.cells[i] = EMPTY; renderCell(i); });
    } else {
      step.cells.forEach((i) => { if (game.cells[i] === EMPTY) { game.cells[i] = X; renderCell(i); } });
    }
    renderTools();
    persist();
    saveProgress();
    hintTimer = setTimeout(clearHint, 7000);
  }

  function findHintStep() {
    const { logic } = game;
    // 1) falsche X auf Lösungsfeldern
    const wrong = game.lvl.solution.filter((i) => game.cells[i] === X);
    if (wrong.length) {
      return { kind: 'unx', cells: [wrong[0]], focus: [], text: `Dieses X ist falsch – hier darf ${WORDS.indef} stehen. Ich habe es entfernt.` };
    }
    // 2) logischer Schritt
    const state = Array.from(game.cells, (v) => (v === ERR ? X : v));
    const step = logic.nextStep(state, 5);
    if (step) return step;
    // 3) Notlösung: eine Katze verraten
    const missing = game.lvl.solution.filter((i) => game.cells[i] !== CAT);
    if (missing.length) return { kind: 'cat', cells: [missing[0]], focus: [], text: `Hier versteckt sich ${WORDS.indef}!` };
    return null;
  }

  function clearHint() {
    clearTimeout(hintTimer);
    if (!board.classList.contains('hinting') && $('#hint-banner').hidden) return;
    board.classList.remove('hinting');
    cellEls.forEach((el) => el.classList.remove('focus', 'target'));
    $('#hint-banner').hidden = true;
  }

  function clearMarks() {
    if (!game || game.over) return;
    clearHint();
    if (!game.cells.some((v) => v === X)) { toast('Keine Markierungen zum Löschen'); return; }
    snapshot();
    game.cells.forEach((v, i) => { if (v === X) game.cells[i] = EMPTY; });
    S.play('cleared', 0.6);
    renderAll();
    saveProgress();
  }

  function bumpTool(name) {
    const t = document.querySelector(`.tool[data-action="${name}"]`);
    t.classList.remove('bump'); void t.offsetWidth; t.classList.add('bump');
  }

  // ---------- Sieg / Niederlage ----------
  function checkWin() {
    const cats = game.cells.reduce((a, v) => a + (v === CAT ? 1 : 0), 0);
    if (cats < game.n) return;
    game.over = true;
    updateTimerRunning();
    clearHint();
    // übrige Felder füllen und Katzen hüpfen lassen
    game.cells.forEach((v, i) => { if (v === EMPTY) { game.cells[i] = X; renderCell(i); } });
    game.lvl.solution.forEach((i, k) => {
      setTimeout(() => { const img = cellEls[i].querySelector('img'); if (img) img.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35) rotate(8deg)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' }); }, k * 90);
    });
    S.play('winCat', 0.8);

    const stars = Math.max(1, game.hearts);
    const spec = game.spec;
    // Bonus: übrige Herzen, Größe des Rätsels und Tempo
    const par = game.n * game.n * 3;
    const timeBonus = Math.max(0, Math.round((par - game.time) * 2));
    const bonus = game.hearts * PTS_HEART + game.n * 50 + timeBonus;
    game.score += bonus;
    renderStatus();
    let reward = [];
    let record = false;
    if (spec.daily) {
      const prevDaily = save.daily[spec.date];
      record = !prevDaily || game.score > (prevDaily.score || 0);
      save.daily[spec.date] = { score: Math.max(game.score, (prevDaily && prevDaily.score) || 0) };
      save.tools.hint = Math.min(TOOL_CAP, save.tools.hint + 1);
      save.tools.locate = Math.min(TOOL_CAP, save.tools.locate + 1);
      reward = ['+1 Tipp', '+1 ' + HELPER];
    } else {
      const prev = save.completed[spec.number];
      record = !prev || game.score > (prev.score || 0);
      save.completed[spec.number] = {
        stars: Math.max(stars, prev ? prev.stars : 0),
        time: Math.min(Math.floor(game.time), prev ? prev.time : Infinity),
        score: Math.max(game.score, (prev && prev.score) || 0)
      };
      if (!prev) {
        if (save.tools.hint < TOOL_CAP) { save.tools.hint++; reward.push('+1 Tipp'); }
        if (spec.number % 3 === 0 && save.tools.locate < TOOL_CAP) { save.tools.locate++; reward.push('+1 ' + HELPER); }
      }
      if (spec.number >= save.level) save.level = spec.number + 1;
    }
    delete save.progress[spec.key];
    persist();
    renderTools();

    setTimeout(() => {
      S.play('win');
      const words = ['Bingo!', 'Bravo!', 'Cool!', 'Wow!', 'Super!', 'Genial!', 'Meister!', 'Logisch!', 'Klasse!', 'Experte!'];
      $('#win-word').textContent = words[Math.floor(Math.random() * words.length)];
      $('#win-title').textContent = spec.daily ? 'Tagesrätsel gelöst!' : `Level ${spec.number} geschafft!`;
      $('#win-time').textContent = fmtTime(game.time);
      $('#win-hearts').textContent = `${game.hearts}/${MAX_HEARTS}`;
      const best = spec.daily ? save.daily[spec.date].score : save.completed[spec.number].score;
      $('#win-score').innerHTML = `${fmtPts(game.score)} Punkte<small>inkl. ${fmtPts(bonus)} Bonus · ` +
        (record ? '<span class="record">Neuer Rekord!</span>' : `Rekord: ${fmtPts(best)}`) + '</small>';
      $('#win-stars').replaceChildren(...[0, 1, 2].map((k) => {
        const img = document.createElement('img');
        img.src = 'assets/img/star.svg'; img.alt = '';
        img.style.animationDelay = (0.3 + k * 0.15) + 's';
        if (k >= stars) img.classList.add('dim');
        return img;
      }));
      $('#win-reward').textContent = reward.length ? reward.join(' · ') : '';
      $('[data-action="next"]').textContent = spec.daily ? 'Fertig' : 'Weiter';
      $('#dlg-win').hidden = false;
      confetti();
    }, 900);
  }

  function showFail() {
    S.play('fail');
    $('#toast').hidden = true;
    $('#dlg-fail').hidden = false;
    saveProgress();
  }

  function confetti() {
    const app = $('#app');
    const colors = ['#ff6f91', '#ffc43d', '#4cc9f0', '#7ee388', '#c58ced', '#f2962a'];
    for (let k = 0; k < 60; k++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + '%';
      c.style.background = colors[k % colors.length];
      c.style.animationDuration = 1.8 + Math.random() * 1.8 + 's';
      c.style.animationDelay = Math.random() * 0.6 + 's';
      c.style.transform = `rotate(${Math.random() * 360}deg)`;
      app.appendChild(c);
      setTimeout(() => c.remove(), 4500);
    }
  }

  function resetGame() {
    delete save.progress[game.spec.key];
    persist();
    $('#dlg-fail').hidden = true;
    $('#dlg-win').hidden = true;
    startLevel(game.spec);
  }

  // ---------- Einstellungen ----------
  function applySettings() {
    S.configure(save.settings);
    S.setVibrate(save.settings.vibrate);
    $$('[data-setting]').forEach((inp) => { inp.checked = !!save.settings[inp.dataset.setting]; });
    if (game) renderStatus();
  }
  $$('[data-setting]').forEach((inp) => inp.addEventListener('change', () => {
    save.settings[inp.dataset.setting] = inp.checked;
    persist();
    S.unlock();
    applySettings();
    S.play('click');
  }));

  // ---------- Aktionen ----------
  const actions = {
    play: () => startLevel(levelSpec(save.level)),
    daily: () => startLevel(dailySpec()),
    home: () => {
      $('#dlg-win').hidden = true; $('#dlg-fail').hidden = true; closeDialogs();
      if (game) saveProgress();
      if (history.state && history.state.screen) history.back(); else show('home');
    },
    'open-levels': () => navigate('levels'),
    'open-rules': () => openDialog('dlg-rules'),
    'open-settings': () => { $('#btn-restart').hidden = current !== 'game'; openDialog('dlg-settings'); },
    'close-dialog': () => closeDialogs(),
    undo,
    locate: useLocate,
    hint: useHint,
    clear: clearMarks,
    next: () => {
      $('#dlg-win').hidden = true;
      if (game.spec.daily) { actions.home(); return; }
      startLevel(levelSpec(game.spec.number + 1));
    },
    retry: resetGame,
    'open-privacy': () => openDialog('dlg-privacy'),
    'restart-level': () => confirmDialog('Level neu starten?', 'Dein aktueller Fortschritt in diesem Level geht verloren.', 'Neu starten', resetGame),
    'reset-progress': () => confirmDialog('Alles zurücksetzen?', 'Alle gelösten Level, Werkzeuge und Einstellungen werden gelöscht.', 'Zurücksetzen', () => {
      save = JSON.parse(JSON.stringify(DEFAULT_SAVE));
      save.rulesSeen = true;
      persist();
      applySettings();
      game = null;
      show('home');
    })
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    S.unlock();
    const fn = actions[b.dataset.action];
    if (fn) {
      if (!['undo', 'hint', 'locate', 'clear'].includes(b.dataset.action)) S.play('click', 0.6);
      fn(b);
    }
  });
  // Klick auf den abgedunkelten Hintergrund schließt einfache Dialoge
  $$('.overlay').forEach((o) => o.addEventListener('click', (e) => {
    if (e.target === o && o.id !== 'dlg-win' && o.id !== 'dlg-fail') closeDialogs();
  }));
  // Tastatur (PC): Strg/Cmd+Z = Rückgängig, H = Tipp
  document.addEventListener('keydown', (e) => {
    if (current !== 'game') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.key.toLowerCase() === 'h') useHint();
    else if (e.key === 'Escape') closeDialogs();
  });
  // iOS: Doppeltipp-Zoom verhindern
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // ---------- Start ----------
  applySettings();
  history.replaceState({ screen: null }, '');
  show('home');

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
