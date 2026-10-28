/* BusFieber – App (Oberfläche, Spielablauf, Zeichnen, Speicherstand) */
(function () {
  'use strict';

  const E = window.BusEngine;
  const S = window.BusSound;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const STORE_KEY = 'busfieber.save.v1';
  const BOOSTER_CAP = 9;
  const BAY_H = 2.4;      // Höhe der Haltebuchten (in Feldern)
  const ARM_H = 2.6;      // wie weit die beiden Zuläufe über dem Rundweg beginnen
  const EXIT_GAP = 0.4;   // Weg vom Rundweg-Ausgang bis zu den Buchten
  const DRIVE_SPEED = 13; // Felder pro Sekunde
  const LOOP_SPEED = 2.3; // Rundweg, Felder pro Sekunde
  const ARM_SP = 0.62;    // Abstand der Wartenden in den Zuläufen
  const PERSON = 1.35;    // Größe der Fahrgäste
  const WALK_TIME = 0.35;

  // ---------- Speicherstand ----------
  const DEFAULT_SAVE = {
    level: 1,
    boosters: { bay: 2, crane: 2, sort: 2 },
    settings: { sound: true, music: false, vibrate: true },
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
          boosters: Object.assign({}, DEFAULT_SAVE.boosters, s.boosters)
        });
      }
    } catch (e) { /* privater Modus o. ä. */ }
    return JSON.parse(JSON.stringify(DEFAULT_SAVE));
  }
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(save)); } catch (e) { /* ignorieren */ }
  }

  // ---------- Level-Definition ----------
  /* Level 1–3 führen ein, danach wird es schnell anspruchsvoller.
   *   park   = wie viele Buchten die Musterlösung gleichzeitig braucht (von 4)
   *   mix    = wie stark die Farben in der Schlange durcheinander sind
   *   lifo   = Schlange bedient bevorzugt die zuletzt freigeräumten Fahrzeuge (engine.js)
   *   loop   = Plätze im Rundweg (weniger = weniger Puffer)
   *   target = Gewinnquote eines Spielers, der nicht vorausplant (siehe engine.js)
   * Normale Level sind mit Vorausschauen immer schaffbar (greedy: true).
   * Jedes 10. Level ist „Schwer“: kleiner Rundweg, nur mit Planen (oder Boostern) lösbar. */
  function levelSpec(n) {
    let spec;
    if (n === 1) spec = { cols: 5, rows: 6, colors: 2, count: 5, types: { car: 1 }, park: 2, mix: 0, loop: 14 };
    else if (n === 2) spec = { cols: 6, rows: 7, colors: 3, count: 8, types: { car: 3, van: 1 }, park: 2, mix: 0.2, loop: 13 };
    else if (n === 3) spec = { cols: 6, rows: 7, colors: 3, count: 10, types: { car: 3, van: 1 }, park: 3, mix: 0.3, loop: 12, target: 0.85 };
    else {
      const t = Math.min(1, (n - 4) / 30);
      const cols = n < 6 ? 6 : n < 16 ? 7 : n < 35 ? 8 : 9;
      const rows = n < 6 ? 8 : n < 16 ? 9 : n < 35 ? 10 : 11;
      const types = n < 5 ? { car: 3, van: 1 } : { car: 4, van: 2, bus: 1 };
      const avgLen = n < 5 ? 2.25 : 2.43;
      spec = {
        cols, rows, types,
        colors: Math.min(8, 4 + Math.floor((n - 4) / 5)),
        count: Math.round(cols * rows * (0.58 + 0.17 * t) / avgLen),
        park: n < 5 ? 3 : 4,
        mix: 0.45 + 0.4 * t,
        lifo: 0.4 + 0.6 * t,
        parkRate: 0.6 + 0.3 * t,
        loop: Math.round(11 - 4 * t),
        target: 0.75 - 0.55 * t
      };
    }
    spec.bays = 4;
    spec.greedy = true;
    spec.hard = n >= 10 && n % 10 === 0;
    if (spec.hard) { spec.park = 4; spec.loop = Math.max(6, spec.loop - 2); spec.mix = 0.9; spec.lifo = 1; spec.parkRate = 0.9; spec.target = 0.03; spec.greedy = undefined; }
    spec.number = n;
    spec.seed = E.hashString('busfieber-level-' + n);
    return spec;
  }

  // ---------- Bildschirme & Dialoge ----------
  let current = 'home';
  function show(name) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    current = name;
    if (name === 'home') renderHome();
    if (name === 'game') requestAnimationFrame(resize);
  }
  function navigate(name) {
    if (name !== 'home' && current === 'home') history.pushState({ screen: name }, '');
    show(name);
  }
  window.addEventListener('popstate', () => {
    const open = $$('.overlay').find((o) => !o.hidden && !o.classList.contains('sticky'));
    if (open) { closeDialogs(); history.pushState({ screen: current }, ''); return; }
    hideSticky();
    show('home');
  });
  function renderHome() {
    $('#home-level-label').textContent = 'Level ' + save.level;
  }
  function openDialog(id) {
    $$('.overlay').forEach((o) => { if (o.id !== id) o.hidden = true; });
    $('#' + id).hidden = false;
    S.play('dialog', 0.6);
  }
  function closeDialogs() {
    $$('.overlay').forEach((o) => { if (!o.classList.contains('sticky')) o.hidden = true; });
  }
  function hideSticky() { $$('.overlay.sticky').forEach((o) => { o.hidden = true; }); }
  let toastTimer = 0;
  function toast(msg, ms = 2000) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ---------- Spielzustand ----------
  let G = null;

  function startLevel(n) {
    navigate('game');
    hideSticky();
    const spec = levelSpec(n);
    const lvl = E.generate(spec, spec.seed);
    G = {
      spec, lvl, cols: lvl.cols, rows: lvl.rows,
      grid: new Int16Array(lvl.cols * lvl.rows).fill(-1),
      vehicles: lvl.vehicles.map((v) => Object.assign({}, v, {
        state: 'lot', seats: 0, reserved: 0, bay: -1, arrived: 0, ang: v.dir * Math.PI / 2,
        scale: 1, alpha: 1, bump: null, shake: 0, path: null
      })),
      bays: Array.from({ length: lvl.bays }, () => ({ vid: -1 })),
      extraUsed: false,
      // Zuläufe: abwechselnd links/rechts, damit die Reihenfolge der Schlange erhalten bleibt
      arms: [lvl.queue.filter((_, i) => i % 2 === 0), lvl.queue.filter((_, i) => i % 2 === 1)],
      armShift: [0, 0], nextArm: 0,
      loop: E.loopShape(lvl.loop), slots: null, phase: 0,
      walkers: [],
      time: 0, stuck: 0,
      over: false, crane: false, bayFlash: 0
    };
    G.slots = new Array(G.loop.n).fill(-1);
    for (const v of G.vehicles) {
      for (const c of E.cellsOf(v)) G.grid[c.y * G.cols + c.x] = v.id;
      const p = lotCenter(v);
      v.px = p.x; v.py = p.y;
    }
    $('#game-title').textContent = 'Level ' + n;
    $('#difficulty-tag').hidden = !spec.hard;
    setCrane(false);
    renderStatus();
    renderBoosters();
    resize();
    S.play('go', 0.6);
    if (!save.rulesSeen) { save.rulesSeen = true; persist(); openDialog('dlg-rules'); }
  }

  function lotCenter(v) {
    const d = E.DIRS[v.dir], back = (v.len - 1) / 2;
    return { x: v.x + 0.5 - d.dx * back, y: v.y + 0.5 - d.dy * back };
  }
  const nBaysShown = () => G.lvl.bays + 1;
  const bayW = () => (G.cols + 2) / nBaysShown();
  const bayCenter = (i) => ({ x: -1 + bayW() * (i + 0.5), y: -1 - BAY_H / 2 });
  // Rundweg über den Buchten: Ausgang unten in der Mitte, Zuläufe links und rechts
  const loopCenter = () => ({ x: G.cols / 2, y: -1 - BAY_H - EXIT_GAP - G.loop.b });
  /** Punkt auf dem Rundweg; s = 0 ist der Ausgang unten, dann im Uhrzeigersinn. */
  function loopPoint(s) {
    const { a, b, P } = G.loop, c = loopCenter(), h = a - b;
    s = ((s % P) + P) % P;
    if (s < h) return { x: c.x - s, y: c.y + b };
    s -= h;
    if (s < Math.PI * b) { const t = Math.PI / 2 + s / b; return { x: c.x - h + Math.cos(t) * b, y: c.y + Math.sin(t) * b }; }
    s -= Math.PI * b;
    if (s < 2 * h) return { x: c.x - h + s, y: c.y - b };
    s -= 2 * h;
    if (s < Math.PI * b) { const t = -Math.PI / 2 + s / b; return { x: c.x + h + Math.cos(t) * b, y: c.y + Math.sin(t) * b }; }
    s -= Math.PI * b;
    return { x: c.x + h - s, y: c.y + b };
  }
  const mergeS = (side) => { const { a, b } = G.loop, h = a - b; return side === 0 ? h + Math.PI * b / 2 : 3 * h + 1.5 * Math.PI * b; };
  /** Zulauf als Linienzug vom Einmündungspunkt nach außen/oben. */
  function armPath(side) {
    const m = loopPoint(mergeS(side)), top = loopCenter().y - G.loop.b - ARM_H;
    const x = side === 0 ? -0.55 : G.cols + 0.55;
    return [m, { x, y: m.y }, { x, y: top }];
  }
  function alongPath(pts, d) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= len || i === pts.length - 1) { const t = Math.min(1, d / len); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
      d -= len;
    }
    return pts[pts.length - 1];
  }
  const passengersLeft = () => G.arms[0].length + G.arms[1].length + G.slots.filter((c) => c >= 0).length + G.walkers.length;
  const parkScale = (v) => Math.min(1, (BAY_H - 0.35) / v.len, (bayW() - 0.12) / 0.8);

  function renderStatus() {
    $('#passengers-left').textContent = passengersLeft();
  }
  function renderBoosters() {
    for (const k of ['bay', 'crane', 'sort']) {
      const b = $('#badge-' + k), v = save.boosters[k];
      b.textContent = v;
      b.classList.toggle('empty', v <= 0);
    }
    $('[data-action="bay"]').classList.toggle('disabled', !G || G.extraUsed || save.boosters.bay <= 0);
  }

  // ---------- Fahrzeuge bewegen ----------
  function firstBlocker(v) {
    const ray = E.rayOf(v, G.cols, G.rows);
    for (let k = 0; k < ray.length; k++) {
      const id = G.grid[ray[k].y * G.cols + ray[k].x];
      if (id >= 0) return { dist: k, id };
    }
    return null;
  }
  function freeBay() { return G.bays.findIndex((b) => b.vid < 0); }
  function liftFromLot(v) {
    for (const c of E.cellsOf(v)) G.grid[c.y * G.cols + c.x] = -1;
  }

  function tapVehicle(v) {
    if (v.state !== 'lot' || v.bump) return;
    if (G.crane) { craneLift(v); return; }
    const block = firstBlocker(v);
    if (block) {
      v.bump = { t: 0, dist: block.dist + 0.14 };
      const other = G.vehicles[block.id];
      setTimeout(() => { other.shake = 0.35; }, (block.dist / 10) * 1000);
      S.play('blocked', 0.7);
      S.vibrate(25);
      return;
    }
    const bay = freeBay();
    if (bay < 0) { noBay(); return; }
    G.bays[bay].vid = v.id;
    v.bay = bay;
    liftFromLot(v);
    v.state = 'drive';
    v.path = exitPath(v, bay);
    v.pathIdx = 0;
    S.play('go', 0.7);
    S.vibrate(12);
  }

  function noBay() {
    G.bayFlash = 0.8;
    S.play('nobay');
    toast('Alle Haltebuchten sind belegt!');
  }

  function exitPath(v, bay) {
    const c = lotCenter(v), b = bayCenter(bay);
    const top = -0.5, bottom = G.rows + 0.5, left = -0.5, right = G.cols + 0.5;
    const pts = [];
    if (v.dir === 0) pts.push({ x: c.x, y: top });
    else if (v.dir === 2) {
      const side = c.x < G.cols / 2 ? left : right;
      pts.push({ x: c.x, y: bottom }, { x: side, y: bottom }, { x: side, y: top });
    } else {
      const side = v.dir === 3 ? left : right;
      pts.push({ x: side, y: c.y }, { x: side, y: top });
    }
    pts.push({ x: b.x, y: top }, { x: b.x, y: b.y });
    return pts;
  }

  function craneLift(v) {
    const bay = freeBay();
    if (bay < 0) { noBay(); return; }
    save.boosters.crane--;
    persist();
    setCrane(false);
    renderBoosters();
    G.bays[bay].vid = v.id;
    v.bay = bay;
    liftFromLot(v);
    v.state = 'drive';
    v.fly = true;
    const b = bayCenter(bay);
    v.path = [{ x: b.x, y: b.y }];
    v.pathIdx = 0;
    S.play('booster');
  }

  function departPath(v) {
    const b = bayCenter(v.bay);
    return [{ x: b.x, y: -0.5 }, { x: G.cols + 3, y: -0.5 }];
  }

  // ---------- Booster ----------
  function setCrane(on) {
    if (G) G.crane = on;
    $('#crane-banner').hidden = !on;
    $('[data-action="crane"]').classList.toggle('active', on);
  }
  function useBay() {
    if (!G || G.extraUsed) { toast('Die Extra-Bucht ist schon offen'); return false; }
    if (save.boosters.bay <= 0) { toast('Keine Extra-Buchten mehr – löse Level für Nachschub!'); return false; }
    save.boosters.bay--;
    G.extraUsed = true;
    G.bays.push({ vid: -1 });
    persist();
    renderBoosters();
    S.play('booster');
    return true;
  }
  function useCrane() {
    if (!G || G.over) return;
    if (G.crane) { setCrane(false); return; }
    if (save.boosters.crane <= 0) { toast('Kein Kran mehr – löse Level für Nachschub!'); return; }
    if (freeBay() < 0) { noBay(); return; }
    setCrane(true);
    S.play('click');
  }
  /** Fahrgäste, die in die geparkten Fahrzeuge passen, nach vorne holen. */
  /** Wartende in Einstiegsreihenfolge (abwechselnd aus beiden Zuläufen). */
  function armOrder() {
    const out = [], a = G.arms;
    for (let k = 0; k < Math.max(a[0].length, a[1].length); k++) {
      const first = a[G.nextArm][k], second = a[1 - G.nextArm][k];
      if (first !== undefined) out.push(first);
      if (second !== undefined) out.push(second);
    }
    return out;
  }
  /** Belegte Rundweg-Plätze, die als Nächstes am Ausgang vorbeikommen, zuerst. */
  function slotsByExit() {
    const { P, sp } = G.loop;
    return G.slots.map((c, k) => k).filter((k) => G.slots[k] >= 0)
      .sort((x, y) => (P - (G.phase + x * sp) % P) % P - (P - (G.phase + y * sp) % P) % P);
  }
  /** Alle Wartenden (Rundweg ab Ausgang, dann Zuläufe) aufgeteilt in „passt gerade“ und den Rest. */
  function sortGain() {
    const need = {};
    for (const v of G.vehicles) if (v.bay >= 0 && (v.state === 'parked' || v.state === 'drive')) need[v.color] = (need[v.color] || 0) + v.cap - v.reserved;
    const all = slotsByExit().map((k) => G.slots[k]).concat(armOrder());
    const front = [], rest = [];
    for (const c of all) { if (need[c] > 0) { need[c]--; front.push(c); } else rest.push(c); }
    return { all, front, rest };
  }
  function useSort() {
    if (!G || G.over && $('#dlg-fail').hidden) return false;
    if (save.boosters.sort <= 0) { toast('Kein Sortieren mehr – löse Level für Nachschub!'); return false; }
    const { all, front, rest } = sortGain();
    const after = front.concat(rest);
    if (!front.length || after.every((c, k) => c === all[k])) { toast('Sortieren bringt gerade nichts'); return false; }
    // in die Rundweg-Plätze (nächste am Ausgang zuerst), der Rest abwechselnd in die Zuläufe
    const order = slotsByExit();
    order.forEach((k, j) => { G.slots[k] = after[j]; });
    const arms = [[], []];
    after.slice(order.length).forEach((c, j) => arms[j % 2 === 0 ? G.nextArm : 1 - G.nextArm].push(c));
    G.arms = arms;
    save.boosters.sort--;
    persist();
    renderBoosters();
    S.play('booster');
    return true;
  }

  // ---------- Spielschleife ----------
  let lastT = 0;
  function frame(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;
    if (G && current === 'game') { update(dt); draw(); }
    requestAnimationFrame(frame);
  }

  function update(dt) {
    G.time += dt;
    G.bayFlash = Math.max(0, G.bayFlash - dt);
    for (const v of G.vehicles) {
      if (v.shake > 0) v.shake = Math.max(0, v.shake - dt);
      if (v.bump) {
        const b = v.bump, t1 = b.dist / 10;
        b.t += dt;
        b.off = b.t < t1 ? b.t * 10 : Math.max(0, b.dist - (b.t - t1) * 5);
        if (b.t > t1 && b.off <= 0) v.bump = null;
      }
      if ((v.state === 'drive' || v.state === 'leave') && v.path) followPath(v, dt);
      if (v.state === 'leave') {
        v.scale = Math.min(1, v.scale + dt * 2);
        if (v.px > G.cols + 0.5) v.alpha = Math.max(0, v.alpha - dt * 4);
        if (v.pathIdx >= v.path.length) v.alpha = 0;
        if (v.alpha <= 0) { v.state = 'gone'; v.path = null; }
      }
    }
    // Rundweg dreht sich; an den Zuläufen steigen Wartende zu, am Ausgang aus
    if (!G.over) {
      const { P, sp } = G.loop, adv = LOOP_SPEED * dt;
      const prev = G.phase;
      G.phase = (G.phase + adv) % P;
      const crossed = (point, k) => ((point - (prev + k * sp)) % P + 2 * P) % P < adv;
      for (let k = 0; k < G.slots.length; k++) {
        const c = G.slots[k];
        if (c >= 0 && crossed(0, k)) {
          let target = null;
          for (const v of G.vehicles) {
            if (v.state === 'parked' && v.color === c && v.reserved < v.cap && (!target || v.arrived < target.arrived)) target = v;
          }
          if (target) {
            target.reserved++;
            G.slots[k] = -1;
            G.walkers.push({ color: c, from: loopPoint(0), vid: target.id, t: 0 });
          }
        } else if (c < 0) {
          for (const side of [0, 1]) {
            if (!crossed(mergeS(side), k) || !G.arms[side].length) continue;
            if (side !== G.nextArm && G.arms[G.nextArm].length) continue;
            G.slots[k] = G.arms[side].shift();
            G.armShift[side] = ARM_SP;
            G.nextArm = 1 - side;
            break;
          }
        }
      }
    }
    for (const side of [0, 1]) G.armShift[side] = Math.max(0, G.armShift[side] - dt * 2.2);
    for (const w of G.walkers) {
      w.t += dt / WALK_TIME;
      if (w.t >= 1 && !w.done) {
        w.done = true;
        const v = G.vehicles[w.vid];
        v.seats++;
        S.play('board', 0.35);
        if (v.seats >= v.cap) depart(v);
      }
    }
    G.walkers = G.walkers.filter((w) => !w.done);
    renderStatus();

    // Sieg / festgefahren
    if (G.over) return;
    const busy = G.walkers.length || G.vehicles.some((v) => v.state === 'drive' || v.bump);
    if (!passengersLeft() && G.vehicles.every((v) => v.state === 'gone')) {
      G.over = true;
      setTimeout(showWin, 250);
      return;
    }
    const canBoard = G.slots.some((c) => c >= 0 && G.vehicles.some((v) => v.state === 'parked' && v.color === c && v.reserved < v.cap));
    const canEnter = G.slots.includes(-1) && (G.arms[0].length || G.arms[1].length);
    if (!busy && !canBoard && !canEnter && freeBay() < 0 && passengersLeft()) {
      G.stuck += dt;
      if (G.stuck > 0.6) { G.over = true; showFail(); }
    } else G.stuck = 0;
  }

  function depart(v) {
    v.state = 'leave';
    G.bays[v.bay].vid = -1;
    v.path = departPath(v);
    v.pathIdx = 0;
    S.play('depart', 0.6);
    S.vibrate(15);
  }

  function followPath(v, dt) {
    let dist = DRIVE_SPEED * dt * (v.fly ? 0.8 : 1);
    while (dist > 0 && v.pathIdx < v.path.length) {
      const p = v.path[v.pathIdx];
      const dx = p.x - v.px, dy = p.y - v.py, len = Math.hypot(dx, dy);
      if (len > 1e-4 && !v.fly) turnTo(v, Math.atan2(dx, -dy), dt);
      if (len <= dist) { v.px = p.x; v.py = p.y; dist -= len; v.pathIdx++; }
      else { v.px += dx / len * dist; v.py += dy / len * dist; dist = 0; }
    }
    if (v.state === 'drive') {
      // in der Bucht kleiner werden und nach oben ausrichten
      const b = bayCenter(v.bay);
      const near = Math.max(0, 1 - Math.abs(v.py - b.y) / 1.6);
      v.scale = 1 + (parkScale(v) - 1) * (v.fly ? Math.max(-0.3, 1 - Math.hypot(v.px - b.x, v.py - b.y) / 6) : near);
      if (v.fly) turnTo(v, 0, dt);
      if (v.pathIdx >= v.path.length) {
        v.state = 'parked'; v.path = null; v.fly = false; v.ang = 0; v.scale = parkScale(v);
        v.arrived = G.time;
      }
    }
  }
  function turnTo(v, target, dt) {
    let diff = target - v.ang;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const step = 14 * dt;
    v.ang += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
  }

  // ---------- Sieg / Niederlage ----------
  function showWin() {
    const n = G.spec.number;
    const kinds = ['bay', 'crane', 'sort'];
    const kind = kinds[n % 3];
    const names = { bay: 'Extra-Bucht', crane: 'Kran', sort: 'Sortieren' };
    let reward = '';
    if (n >= save.level) {
      save.level = n + 1;
      if (save.boosters[kind] < BOOSTER_CAP) { save.boosters[kind]++; reward = '+1 ' + names[kind]; }
    }
    persist();
    renderBoosters();
    S.play('win');
    $('#win-title').textContent = `Level ${n} geschafft!`;
    $('#win-reward').textContent = reward;
    $('#dlg-win').hidden = false;
    confetti();
  }
  function showFail() {
    S.play('fail');
    $('#toast').hidden = true;
    const canBay = !G.extraUsed && save.boosters.bay > 0;
    const sortHelps = save.boosters.sort > 0 && sortGain().front.length > 0;
    $('#fail-bay').hidden = !canBay;
    $('#fail-sort').hidden = !sortHelps;
    $('#fail-bay-count').textContent = save.boosters.bay;
    $('#fail-sort-count').textContent = save.boosters.sort;
    $('#dlg-fail').hidden = false;
  }
  function resume() {
    $('#dlg-fail').hidden = true;
    G.over = false;
    G.stuck = 0;
  }

  function confetti() {
    const app = $('#app');
    const colors = ['#ef4444', '#3b82f6', '#facc15', '#22c55e', '#a855f7', '#f97316'];
    for (let k = 0; k < 60; k++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + '%';
      c.style.background = colors[k % colors.length];
      c.style.animationDuration = 1.8 + Math.random() * 1.8 + 's';
      c.style.animationDelay = Math.random() * 0.6 + 's';
      app.appendChild(c);
      setTimeout(() => c.remove(), 4500);
    }
  }

  // ---------- Zeichnen ----------
  const canvas = $('#stage');
  const ctx = canvas.getContext('2d');
  let view = { s: 40, ox: 0, oy: 0, dpr: 1 };
  const dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  const PAL_LIGHT = { walk: '#eadfce', walkEdge: '#cdb99f', road: '#5d6472', lane: 'rgba(255,255,255,.55)', lot: '#717a8a', lotLine: 'rgba(255,255,255,.13)', bay: '#666e7d', bayLine: 'rgba(255,255,255,.75)', grass: '#9fd18b' };
  const PAL_DARK = { walk: '#4a3f38', walkEdge: '#2c2521', road: '#2c313a', lane: 'rgba(255,255,255,.35)', lot: '#3c4250', lotLine: 'rgba(255,255,255,.08)', bay: '#353b47', bayLine: 'rgba(255,255,255,.5)', grass: '#3d5a36' };
  const pal = () => (dark.matches ? PAL_DARK : PAL_LIGHT);

  function worldBounds() {
    return { x0: -1, x1: G.cols + 1, y0: loopCenter().y - G.loop.b - ARM_H - 0.2, y1: G.rows + 1 };
  }
  function resize() {
    if (!G) return;
    const box = $('#stage-wrap').getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    canvas.style.width = box.width + 'px';
    canvas.style.height = box.height + 'px';
    const b = worldBounds();
    const s = Math.min(box.width / (b.x1 - b.x0), box.height / (b.y1 - b.y0));
    view = { s, dpr, ox: (box.width - (b.x1 - b.x0) * s) / 2 - b.x0 * s, oy: (box.height - (b.y1 - b.y0) * s) / 2 - b.y0 * s };
  }
  window.addEventListener('resize', resize);

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p);
    return `rgb(${r},${g},${b})`;
  }

  function draw() {
    const { s, ox, oy, dpr } = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(s * dpr, 0, 0, s * dpr, ox * dpr, oy * dpr);
    const P = pal(), cols = G.cols, rows = G.rows;
    const b = worldBounds();

    // Gehwege: zwei Zuläufe, Rundweg, Ausgang zu den Buchten
    const c0 = loopCenter(), lp = G.loop;
    const walkway = (w, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const side of [0, 1]) { const pts = armPath(side); ctx.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y)); }
      ctx.moveTo(c0.x, c0.y + lp.b); ctx.lineTo(c0.x, -1 - BAY_H + 0.1);
      ctx.stroke();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(c0.x - lp.a, c0.y - lp.b, lp.a * 2, lp.b * 2, lp.b); else ctx.rect(c0.x - lp.a, c0.y - lp.b, lp.a * 2, lp.b * 2);
      ctx.stroke();
    };
    walkway(0.86, P.walkEdge);
    walkway(0.74, P.walk);

    // Haltebuchten
    const bayTop = -1 - BAY_H, bw = bayW();
    ctx.fillStyle = P.bay;
    ctx.fillRect(-1, bayTop, cols + 2, BAY_H);
    for (let i = 0; i < nBaysShown(); i++) {
      const x = -1 + i * bw;
      const locked = i >= G.bays.length;
      if (locked) {
        ctx.fillStyle = 'rgba(0,0,0,.18)';
        ctx.fillRect(x, bayTop, bw, BAY_H);
        drawPlusBay(x + bw / 2, bayTop + BAY_H / 2);
      }
      if (G.bayFlash > 0 && !locked) {
        ctx.fillStyle = `rgba(239,68,68,${0.35 * Math.abs(Math.sin(G.bayFlash * 10))})`;
        ctx.fillRect(x, bayTop, bw, BAY_H);
      }
      if (i > 0) {
        ctx.fillStyle = P.bayLine;
        ctx.fillRect(x - 0.03, bayTop + 0.15, 0.06, BAY_H - 0.3);
      }
    }

    // Straße rund um den Parkplatz
    ctx.fillStyle = P.road;
    ctx.fillRect(-1, -1, cols + 2, rows + 2);
    ctx.strokeStyle = P.lane;
    ctx.lineWidth = 0.05;
    ctx.setLineDash([0.3, 0.3]);
    ctx.strokeRect(-0.5, -0.5, cols + 1, rows + 1);
    ctx.setLineDash([]);
    // Parkplatz
    ctx.fillStyle = P.lot;
    rr(0, 0, cols, rows, 0.15); ctx.fill();
    ctx.strokeStyle = P.lotLine;
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    for (let x = 1; x < cols; x++) { ctx.moveTo(x, 0.1); ctx.lineTo(x, rows - 0.1); }
    for (let y = 1; y < rows; y++) { ctx.moveTo(0.1, y); ctx.lineTo(cols - 0.1, y); }
    ctx.stroke();

    // Fahrzeuge: erst Parkplatz und Buchten, dann fahrende obendrauf
    for (const v of G.vehicles) if (v.state === 'lot') drawLotVehicle(v);
    for (const v of G.vehicles) if (v.state === 'parked') drawVehicle(v, v.px, v.py, v.ang, v.scale, 1);
    for (const v of G.vehicles) if (v.state === 'drive' || v.state === 'leave') drawVehicle(v, v.px, v.py, v.ang, v.scale * (v.fly ? 1.12 : 1), v.alpha);

    // Wartende in den Zuläufen (hinterste zuerst, damit die vorderen oben liegen)
    for (const side of [0, 1]) {
      const pts = armPath(side), arm = G.arms[side];
      const total = pts.reduce((acc, p, i) => acc + (i ? Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
      const show = Math.min(arm.length, Math.floor((total - 0.2) / ARM_SP) + 1);
      for (let k = show - 1; k >= 0; k--) {
        const p = alongPath(pts, 0.3 + k * ARM_SP + G.armShift[side]);
        drawPerson(p.x, p.y, G.lvl.colors[arm[k]], PERSON);
      }
      if (arm.length > show) {
        const p = pts[pts.length - 1];
        drawBubble(p.x, p.y + 0.05, '+' + (arm.length - show));
      }
    }
    // Rundweg
    for (let k = 0; k < G.slots.length; k++) {
      if (G.slots[k] < 0) continue;
      const p = loopPoint(G.phase + k * G.loop.sp);
      drawPerson(p.x, p.y, G.lvl.colors[G.slots[k]], PERSON);
    }
    for (const w of G.walkers) {
      const v = G.vehicles[w.vid], t = Math.min(1, w.t);
      const e = t * t * (3 - 2 * t);
      const x = w.from.x + (v.px - w.from.x) * e, y = w.from.y + (v.py - w.from.y) * e - Math.sin(t * Math.PI) * 0.3;
      drawPerson(x, y, G.lvl.colors[w.color], PERSON * (1 - t * 0.45));
    }
  }

  function drawBubble(x, y, text) {
    ctx.font = '900 0.34px Nunito, sans-serif';
    const w = ctx.measureText(text).width + 0.24;
    ctx.fillStyle = 'rgba(30,41,59,.85)';
    rr(x - w / 2, y - 0.22, w, 0.44, 0.22); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.01);
  }

  function drawPlusBay(x, y) {
    ctx.strokeStyle = 'rgba(255,255,255,.6)';
    ctx.lineWidth = 0.06;
    ctx.setLineDash([0.12, 0.1]);
    rr(x - 0.4, y - 0.6, 0.8, 1.2, 0.15); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 0.1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 0.17, y); ctx.lineTo(x + 0.17, y); ctx.moveTo(x, y - 0.17); ctx.lineTo(x, y + 0.17); ctx.stroke();
  }

  function drawLotVehicle(v) {
    const d = E.DIRS[v.dir];
    let x = v.px, y = v.py;
    if (v.bump) { x += d.dx * v.bump.off; y += d.dy * v.bump.off; }
    if (v.shake > 0) { const a = Math.sin(v.shake * 60) * 0.05 * (v.shake / 0.35); x += d.dy * a; y += d.dx * a; }
    drawVehicle(v, x, y, v.ang, 1, 1);
    if (G.crane) {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 0.07;
      ctx.save(); ctx.translate(x, y); ctx.rotate(v.ang);
      rr(-0.44, -v.len / 2 + 0.03, 0.88, v.len - 0.06, 0.2); ctx.stroke();
      ctx.restore();
    }
  }

  function drawVehicle(v, cx, cy, ang, scale, alpha) {
    const color = G.lvl.colors[v.color];
    const L = v.len - 0.14, W = 0.78, r = v.type === 'car' ? 0.2 : 0.14;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.scale(scale, scale);
    // Schatten
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    rr(-W / 2 + 0.04, -L / 2 + 0.08, W, L, r); ctx.fill();
    // Karosserie
    ctx.fillStyle = color;
    rr(-W / 2, -L / 2, W, L, r); ctx.fill();
    ctx.strokeStyle = shade(color, -0.3);
    ctx.lineWidth = 0.045;
    ctx.stroke();
    // Dach
    const roofTop = -L / 2 + 0.4, roofBottom = L / 2 - (v.type === 'car' ? 0.34 : 0.12);
    ctx.fillStyle = shade(color, 0.22);
    rr(-W / 2 + 0.1, roofTop, W - 0.2, roofBottom - roofTop, 0.1); ctx.fill();
    // Scheiben: vorne groß, hinten klein (zeigt die Fahrtrichtung)
    ctx.fillStyle = 'rgba(30,41,59,.85)';
    rr(-W / 2 + 0.09, -L / 2 + 0.14, W - 0.18, 0.22, 0.07); ctx.fill();
    if (v.type === 'car') { rr(-W / 2 + 0.13, L / 2 - 0.3, W - 0.26, 0.15, 0.05); ctx.fill(); }
    else {
      ctx.fillStyle = 'rgba(30,41,59,.55)';
      for (let y = roofTop + 0.12; y < roofBottom - 0.25; y += 0.42) {
        ctx.fillRect(-W / 2 + 0.02, y, 0.07, 0.28);
        ctx.fillRect(W / 2 - 0.09, y, 0.07, 0.28);
      }
    }
    // Scheinwerfer
    ctx.fillStyle = '#fff7c2';
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * W * 0.3, -L / 2 + 0.06, 0.055, 0, Math.PI * 2); ctx.fill(); }
    if (v.state === 'lot') {
      // großer Pfeil in Fahrtrichtung
      const my = (roofTop + roofBottom) / 2, al = Math.min(0.95, roofBottom - roofTop + 0.1);
      const tip = my - al / 2, base = tip + 0.3, tail = my + al / 2;
      ctx.beginPath();
      ctx.moveTo(0, tip); ctx.lineTo(0.27, base); ctx.lineTo(0.1, base); ctx.lineTo(0.1, tail);
      ctx.lineTo(-0.1, tail); ctx.lineTo(-0.1, base); ctx.lineTo(-0.27, base); ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 0.07; ctx.strokeStyle = 'rgba(15,23,42,.75)'; ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.fill();
    } else {
      // Sitzplätze
      const rowsN = v.cap / 2, top = roofTop + 0.16, bottom = roofBottom - 0.16;
      const step = rowsN > 1 ? (bottom - top) / (rowsN - 1) : 0;
      for (let k = 0; k < v.cap; k++) {
        const sx = (k % 2 ? 1 : -1) * 0.16, sy = top + Math.floor(k / 2) * step;
        ctx.beginPath(); ctx.arc(sx, sy, 0.105, 0, Math.PI * 2);
        if (k < v.seats) { ctx.fillStyle = '#ffd9b3'; ctx.fill(); ctx.strokeStyle = shade(color, -0.45); ctx.lineWidth = 0.035; ctx.stroke(); }
        else { ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fill(); }
      }
    }
    ctx.restore();
  }

  /** Fahrgast leicht von oben/vorne: Schatten, glänzender Körper, Kopf mit Haaren. */
  function drawPerson(x, y, color, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(0, 0.2, 0.19, 0.07, 0, 0, Math.PI * 2); ctx.fill();
    // Körper
    let g = ctx.createRadialGradient(-0.07, -0.02, 0.02, 0, 0.06, 0.24);
    g.addColorStop(0, shade(color, 0.45)); g.addColorStop(0.55, color); g.addColorStop(1, shade(color, -0.3));
    ctx.fillStyle = g;
    rr(-0.16, -0.06, 0.32, 0.29, [0.15, 0.15, 0.1, 0.1]); ctx.fill();
    ctx.strokeStyle = shade(color, -0.45); ctx.lineWidth = 0.025; ctx.stroke();
    // Kopf
    g = ctx.createRadialGradient(-0.045, -0.2, 0.01, 0, -0.15, 0.15);
    g.addColorStop(0, '#ffeedd'); g.addColorStop(0.6, '#ffd2a8'); g.addColorStop(1, '#e0a77c');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, -0.15, 0.13, 0, Math.PI * 2); ctx.fill();
    // Haare
    ctx.fillStyle = '#5a3a2a';
    ctx.beginPath(); ctx.arc(0, -0.16, 0.135, Math.PI * 1.05, Math.PI * 1.95); ctx.quadraticCurveTo(0, -0.2, -0.13, -0.18); ctx.fill();
    // Augen
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath(); ctx.arc(-0.045, -0.13, 0.018, 0, Math.PI * 2); ctx.arc(0.045, -0.13, 0.018, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---------- Eingabe ----------
  canvas.addEventListener('pointerdown', (e) => {
    S.unlock();
    if (!G || G.over) return;
    const r = canvas.getBoundingClientRect();
    const wx = (e.clientX - r.left - view.ox) / view.s, wy = (e.clientY - r.top - view.oy) / view.s;
    let cx = Math.floor(wx), cy = Math.floor(wy);
    // etwas Toleranz am Rand
    if (wx < 0 && wx > -0.3) cx = 0;
    if (wy < 0 && wy > -0.3) cy = 0;
    if (cx < 0 || cy < 0 || cx >= G.cols || cy >= G.rows) {
      if (wy < -1 && wy > -1 - BAY_H) {
        const i = Math.floor((wx + 1) / bayW());
        if (i >= G.bays.length && i < nBaysShown()) useBay();
      }
      return;
    }
    const id = G.grid[cy * G.cols + cx];
    if (id >= 0) tapVehicle(G.vehicles[id]);
  });

  // ---------- Einstellungen ----------
  function applySettings() {
    S.configure(save.settings);
    S.setVibrate(save.settings.vibrate);
    $$('[data-setting]').forEach((inp) => { inp.checked = !!save.settings[inp.dataset.setting]; });
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
    play: () => startLevel(save.level),
    home: () => {
      hideSticky(); closeDialogs();
      if (history.state && history.state.screen) history.back(); else show('home');
    },
    'open-rules': () => openDialog('dlg-rules'),
    'open-privacy': () => openDialog('dlg-privacy'),
    'open-settings': () => { $('#btn-restart').hidden = current !== 'game'; openDialog('dlg-settings'); },
    'close-dialog': () => closeDialogs(),
    next: () => { hideSticky(); startLevel(G.spec.number + 1); },
    retry: () => { hideSticky(); startLevel(G.spec.number); },
    'restart-level': () => { closeDialogs(); startLevel(G.spec.number); },
    bay: () => { if (G && !G.over) useBay(); },
    crane: useCrane,
    sort: useSort,
    'fail-bay': () => { if (useBay()) resume(); },
    'fail-sort': () => { if (useSort()) resume(); },
    'reset-progress': () => {
      if (!confirm('Alle Level und Booster zurücksetzen?')) return;
      save = JSON.parse(JSON.stringify(DEFAULT_SAVE));
      save.rulesSeen = true;
      persist();
      applySettings();
      closeDialogs();
      G = null;
      show('home');
    }
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    S.unlock();
    const fn = actions[b.dataset.action];
    if (fn) {
      if (!['bay', 'crane', 'sort'].includes(b.dataset.action)) S.play('click', 0.6);
      fn(b);
    }
  });
  $$('.overlay').forEach((o) => o.addEventListener('click', (e) => {
    if (e.target === o && !o.classList.contains('sticky')) closeDialogs();
  }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (G && G.crane) setCrane(false); closeDialogs(); }
  });
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // ---------- Start ----------
  applySettings();
  history.replaceState({ screen: null }, '');
  show('home');
  requestAnimationFrame(frame);

  // für Tests
  window.__bus = {
    get G() { return G; }, levelSpec, startLevel,
    toScreen(x, y) { const r = canvas.getBoundingClientRect(); return [r.left + view.ox + x * view.s, r.top + view.oy + y * view.s]; }
  };

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
