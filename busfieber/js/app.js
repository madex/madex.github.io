/* BusFieber – App (Oberfläche, Spielablauf, Zeichnen, Speicherstand) */
(function () {
  'use strict';

  const E = window.BusEngine;
  const S = window.BusSound;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const STORE_KEY = 'busfieber.save.v1';
  const BOOSTER_CAP = 9;
  const BAY_H = 2.7;      // Höhe der Haltebuchten samt Platz-Anzeige
  const ARM_H = 3.6;      // wie weit die Zuläufe über dem Rundweg beginnen (mal Maßstab)
  const EXIT_GAP = 0.35;  // Weg vom Rundweg-Ausgang bis zu den Buchten
  const DRIVE_SPEED = 13; // Einheiten pro Sekunde
  const LOOP_SPEED = 2.6; // Rundweg (mal Maßstab der Fahrgastzone)
  const LANES = 3;        // Fahrgäste nebeneinander in den Zuläufen
  const LOOP_LANES = 2;   // … und auf dem Rundweg
  const LANE_W = 0.34;    // Abstand der Spuren (mal Maßstab)
  const ARM_SP = 0.4;     // Abstand der Reihen in den Zuläufen (mal Maßstab)
  const PERSON = 0.62;    // Größe der Fahrgäste (mal Maßstab)
  const WALK_TIME = 0.32;
  const EXTRA_BAYS = 3;   // gesperrte Buchten, die man mit „Bucht +1“ öffnet

  // ---------- Speicherstand ----------
  const DEFAULT_SAVE = {
    level: 1,
    boosters: { bay: 2, vip: 2, sort: 2 },
    settings: { sound: true, music: false, vibrate: true },
    rulesSeen: false
  };
  let save = load();
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        const boosters = Object.assign({}, DEFAULT_SAVE.boosters, s.boosters);
        // früher hieß der VIP-Booster „Kran“
        if (s.boosters && s.boosters.crane !== undefined && s.boosters.vip === undefined) boosters.vip = s.boosters.crane;
        delete boosters.crane;
        return Object.assign({}, DEFAULT_SAVE, s, {
          settings: Object.assign({}, DEFAULT_SAVE.settings, s.settings),
          boosters
        });
      }
    } catch (e) { /* privater Modus o. ä. */ }
    return JSON.parse(JSON.stringify(DEFAULT_SAVE));
  }
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(save)); } catch (e) { /* ignorieren */ }
  }

  // ---------- Level-Definition ----------
  /* Level 1–3 führen ein (ein Zulauf), danach zwei Zuläufe und Figuren aus Fahrzeugen.
   *   shape  = Figur des Parkplatzes, angles = wie die Fahrzeuge gedreht sind, sym = spiegelsymmetrisch
   *   park   = wie viele Buchten die Musterlösung gleichzeitig braucht (von 4)
   *   mix    = wie stark die Farben in der Schlange durcheinander sind
   *   lifo   = Schlange bedient bevorzugt die zuletzt freigeräumten Fahrzeuge (engine.js)
   *   loop   = Plätze im Rundweg in Vierergruppen (weniger = weniger Puffer)
   *   target = Gewinnquote eines Spielers, der nicht vorausplant (siehe engine.js)
   * Normale Level sind mit Vorausschauen immer schaffbar (greedy: true).
   * Jedes 10. Level ist „Schwer“, jedes Level x5 eine Verschnaufpause. */
  function levelSpec(n) {
    let spec;
    const SHAPE_ORDER = ['rect', 'cross', 'heart', 'diamond', 'columns', 'circle', 'hourglass', 'ring', 'flower', 'arch'];
    const ANGLES = ['grid', 'free', 'mixed', 'tilt'];
    if (n === 1) spec = { w: 6, h: 5, colors: 2, count: 5, types: { car: 1 }, shape: 'rect', angles: 'grid', arms: 1, park: 2, mix: 0, loop: 10 };
    else if (n === 2) spec = { w: 7, h: 6, colors: 3, count: 10, types: { car: 3, van: 1 }, shape: 'circle', angles: 'grid', arms: 1, park: 2, mix: 0.2, loop: 10 };
    else if (n === 3) spec = { w: 9, h: 9, colors: 3, count: 22, types: { car: 3, van: 2 }, shape: 'cross', angles: 'grid', sym: true, arms: 1, park: 3, mix: 0.3, loop: 9, target: 0.85 };
    else {
      const t = Math.min(1, (n - 4) / 30);
      const w = n < 8 ? 10 : n < 20 ? 11 : 12, h = n < 8 ? 10 : n < 20 ? 11 : 12;
      spec = {
        w, h, types: { car: 4, van: 3, bus: 1 },
        shape: SHAPE_ORDER[(n - 4) % SHAPE_ORDER.length],
        angles: ANGLES[n % ANGLES.length],
        sym: n % 3 === 0,
        count: Math.round(34 + 26 * t),
        colors: Math.min(8, 4 + Math.floor((n - 4) / 5)),
        arms: 2,
        park: n < 5 ? 3 : 4,
        mix: 0.45 + 0.4 * t,
        lifo: 0.4 + 0.6 * t,
        parkRate: 0.6 + 0.3 * t,
        loop: Math.round(9 - 4 * t),
        target: 0.75 - 0.55 * t
      };
      // Verschnaufpause nach dem Sprung: wenige Fahrzeuge, wie im Original
      if (n % 10 === 5) { spec.count = Math.round(spec.count * 0.4); spec.target = 0.9; spec.shape = 'rect'; spec.angles = 'free'; }
    }
    spec.bays = 4;
    spec.greedy = true;
    spec.hard = n >= 10 && n % 10 === 0;
    if (spec.hard) { spec.park = 4; spec.loop = Math.max(4, spec.loop - 2); spec.mix = 0.9; spec.lifo = 1; spec.parkRate = 0.9; spec.target = 0.03; spec.greedy = undefined; }
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
    const unit = Math.max(1, (lvl.w + 2) / 9);
    const rows = Math.ceil(lvl.loop * E.GROUP / LOOP_LANES);
    const { arms, seq } = splitArms(lvl.queue, lvl.arms);
    G = {
      spec, lvl, w: lvl.w, h: lvl.h, unit,
      vehicles: lvl.vehicles.map((v) => Object.assign({}, v, {
        state: 'lot', seats: 0, reserved: 0, bay: -1, arrived: 0, px: v.x, py: v.y,
        scale: 1, alpha: 1, bump: null, shake: 0, leg: null
      })),
      // Bucht 0 = VIP (nur per Booster), dann 4 normale, dann gesperrte
      bays: [{ kind: 'vip', vid: -1 }]
        .concat(Array.from({ length: lvl.bays }, () => ({ kind: 'normal', vid: -1 })))
        .concat(Array.from({ length: EXTRA_BAYS }, () => ({ kind: 'locked', vid: -1 }))),
      arms, seq, seqIdx: 0, takeCount: 0, armTaken: [0, 0], armSmooth: [0, 0],
      loop: E.loopShape(rows, unit), slots: new Array(rows * LOOP_LANES).fill(-1), phase: 0,
      walkers: [],
      time: 0, stuck: 0, mood: 0,
      over: false, vip: false, bayFlash: 0
    };
    $('#game-title').textContent = 'Level ' + n;
    $('#difficulty-tag').hidden = !spec.hard;
    setVip(false);
    spriteCache.clear();
    renderStatus();
    renderBoosters();
    resize();
    S.play('go', 0.6);
    if (!save.rulesSeen) { save.rulesSeen = true; persist(); openDialog('dlg-rules'); }
  }

  /*
   * Gruppen in Personen auflösen. Bei zwei Zuläufen wechselt der Zulauf mit jeder neuen
   * Farbe, so bleiben Farbblöcke zusammen; seq merkt sich für jede Gruppe ihren Zulauf,
   * damit die Fahrgäste genau in Reihenfolge der Schlange auf den Rundweg kommen.
   */
  function splitArms(groups, nArms) {
    const arms = [[], []], seq = [];
    let side = 1;
    groups.forEach((c, g) => {
      if (nArms === 2 && g > 0 && c !== groups[g - 1]) side = 1 - side;
      seq.push(side);
      for (let k = 0; k < E.GROUP; k++) arms[side].push(c);
    });
    return { arms, seq };
  }

  const bayW = () => (G.w + 2) / G.bays.length;
  const bayTop = () => -1 - BAY_H;
  const bayCenter = (i) => ({ x: -1 + bayW() * (i + 0.5), y: bayTop() + (BAY_H - 0.55) / 2 + 0.05 });
  // Rundweg über den Buchten: Ausgang unten in der Mitte, Zuläufe links und rechts
  const loopCenter = () => ({ x: G.w / 2, y: bayTop() - EXIT_GAP * G.unit - G.loop.b - LANE_W * G.unit });
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
  /** Platz einer Spur: seitlich versetzt (Spur 0 innen, LANES-1 außen). */
  function lanePoint(s, lane) {
    const p = loopPoint(s), q = loopPoint(s + 0.05), tx = q.x - p.x, ty = q.y - p.y, l = Math.hypot(tx, ty) || 1;
    const off = (lane - (LOOP_LANES - 1) / 2) * LANE_W * G.unit;
    // im Uhrzeigersinn zeigt (-ty, tx) nach außen
    return { x: p.x - ty / l * off, y: p.y + tx / l * off };
  }
  const mergeS = (side) => { const { a, b } = G.loop, h = a - b; return side === 0 ? h + Math.PI * b / 2 : 3 * h + 1.5 * Math.PI * b; };
  const usedArms = () => (G.lvl.arms === 1 ? [1] : [0, 1]);
  /** Zulauf als geschwungene Linie vom Einmündungspunkt nach außen und oben. */
  function armPath(side) {
    if (G['arm' + side]) return G['arm' + side];
    const u = G.unit, m = loopPoint(mergeS(side));
    const top = loopCenter().y - G.loop.b - ARM_H * u;
    const sgn = side === 0 ? -1 : 1;
    const ex = side === 0 ? -1 + 0.8 * u : G.w + 1 - 0.8 * u;
    const P0 = { x: m.x + sgn * LANE_W * u, y: m.y }, P1 = { x: ex, y: m.y + 0.2 * u }, P2 = { x: ex, y: m.y - 1.8 * u }, P3 = { x: ex - sgn * 1.1 * u, y: top + 0.6 * u };
    const pts = [];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3;
      pts.push({ x: a * P0.x + b * P1.x + c * P2.x + d * P3.x, y: a * P0.y + b * P1.y + c * P2.y + d * P3.y });
    }
    pts.push({ x: P3.x, y: top });
    G['arm' + side] = pts;
    return pts;
  }
  /** Punkt in Abstand d entlang des Linienzugs, seitlich um off versetzt. */
  function alongPath(pts, d, off = 0) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= len || i === pts.length - 1) {
        const t = Math.min(1, d / len), nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
        return { x: a.x + (b.x - a.x) * t + nx * off, y: a.y + (b.y - a.y) * t + ny * off };
      }
      d -= len;
    }
    return pts[pts.length - 1];
  }
  const pathLen = (pts) => pts.reduce((acc, p, i) => acc + (i ? Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
  const passengersLeft = () => G.arms[0].length + G.arms[1].length + G.slots.filter((c) => c >= 0).length + G.walkers.length;
  const parkScale = (v) => Math.min(1, (BAY_H - 0.85) / v.len, (bayW() - 0.18) / v.width);

  function renderStatus() {
    $('#passengers-left').textContent = passengersLeft();
  }
  function renderBoosters() {
    for (const k of ['bay', 'vip', 'sort']) {
      const b = $('#badge-' + k), v = save.boosters[k];
      b.textContent = v;
      b.classList.toggle('empty', v <= 0);
    }
    $('[data-action="bay"]').classList.toggle('disabled', !G || lockedBay() < 0 || save.boosters.bay <= 0);
  }

  // ---------- Fahrzeuge bewegen ----------
  const inLot = (v) => v.state === 'lot';
  function firstBlocker(v) {
    let best = null;
    for (const id of G.lvl.blockers[v.id]) {
      const o = G.vehicles[id];
      if (!inLot(o)) continue;
      const gap = E.gapTo(v, o);
      if (!best || gap < best.dist) best = { id, dist: gap };
    }
    return best;
  }
  const freeBay = () => G.bays.findIndex((b) => b.kind === 'normal' && b.vid < 0);
  const lockedBay = () => G.bays.findIndex((b) => b.kind === 'locked');

  function tapVehicle(v) {
    if (!inLot(v) || v.bump) return;
    if (G.vip) { vipLift(v); return; }
    const block = firstBlocker(v);
    if (block) {
      v.bump = { t: 0, dist: block.dist + 0.12 };
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
    v.state = 'drive';
    v.leg = 'out';
    S.play('go', 0.7);
    S.vibrate(12);
  }

  function noBay() {
    G.bayFlash = 0.8;
    S.play('nobay');
    toast('Keine Bucht frei!');
  }

  function vipLift(v) {
    if (G.bays[0].vid >= 0) { toast('Die VIP-Bucht ist besetzt'); setVip(false); return; }
    save.boosters.vip--;
    persist();
    setVip(false);
    renderBoosters();
    G.bays[0].vid = v.id;
    v.bay = 0;
    v.state = 'drive';
    v.leg = 'fly';
    S.play('booster');
  }

  // ---------- Booster ----------
  function setVip(on) {
    if (G) G.vip = on;
    $('#vip-banner').hidden = !on;
    $('[data-action="vip"]').classList.toggle('active', on);
  }
  function useBay() {
    const i = G ? lockedBay() : -1;
    if (i < 0) { toast('Alle Extra-Buchten sind schon offen'); return false; }
    if (save.boosters.bay <= 0) { toast('Keine Extra-Buchten mehr – löse Level für Nachschub!'); return false; }
    save.boosters.bay--;
    G.bays[i].kind = 'normal';
    persist();
    renderBoosters();
    S.play('booster');
    return true;
  }
  function useVip() {
    if (!G || G.over) return;
    if (G.vip) { setVip(false); return; }
    if (save.boosters.vip <= 0) { toast('Kein VIP mehr – löse Level für Nachschub!'); return; }
    if (G.bays[0].vid >= 0) { toast('Die VIP-Bucht ist besetzt'); return; }
    setVip(true);
    S.play('click');
  }
  /** Wartende in Einstiegsreihenfolge (nach seq aus beiden Zuläufen). */
  function armOrder() {
    const out = [], a = [G.arms[0].slice(), G.arms[1].slice()];
    let take = G.takeCount;
    for (let g = G.seqIdx; g < G.seq.length; g++) {
      for (let k = take; k < E.GROUP && a[G.seq[g]].length; k++) out.push(a[G.seq[g]].shift());
      take = 0;
    }
    return out;
  }
  /** Belegte Rundweg-Plätze, die als Nächstes am Ausgang vorbeikommen, zuerst. */
  function slotsByExit() {
    const { P, sp } = G.loop;
    const dist = (k) => (P - (G.phase + Math.floor(k / LOOP_LANES) * sp) % P) % P;
    return G.slots.map((c, k) => k).filter((k) => G.slots[k] >= 0).sort((x, y) => dist(x) - dist(y));
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
    // in die Rundweg-Plätze (nächste am Ausgang zuerst), der Rest gruppenweise in die Zuläufe
    const order = slotsByExit();
    order.forEach((k, j) => { G.slots[k] = after[j]; });
    // Rest wieder in Vierergruppen (die letzte darf kleiner sein)
    const rest4 = after.slice(order.length), groups = [];
    for (let j = 0; j < rest4.length; j += E.GROUP) groups.push(rest4[j]);
    const split = splitArms(groups, G.lvl.arms);
    split.arms = [[], []];
    groups.forEach((_, g) => { for (const c of rest4.slice(g * E.GROUP, g * E.GROUP + E.GROUP)) split.arms[split.seq[g]].push(c); });
    G.arms = split.arms; G.seq = split.seq; G.seqIdx = 0; G.takeCount = 0;
    save.boosters.sort--;
    persist();
    renderBoosters();
    S.play('booster');
    return true;
  }

  // ---------- Spielschleife ----------
  let lastT = 0;
  let speed = 1; // nur für Tests schneller
  function frame(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;
    if (G && current === 'game') { for (let k = 0; k < speed; k++) update(dt); draw(); }
    requestAnimationFrame(frame);
  }

  const canBoardColor = (c) => G.vehicles.some((v) => v.state === 'parked' && v.color === c && v.reserved < v.cap);

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
      if (v.state === 'drive') moveDrive(v, dt);
      else if (v.state === 'leave') moveLeave(v, dt);
    }
    // Rundweg dreht sich; an den Zuläufen steigen Wartende zu, am Ausgang aus
    if (!G.over) {
      const { P, sp } = G.loop, adv = LOOP_SPEED * G.unit * dt;
      const prev = G.phase;
      G.phase = (G.phase + adv) % P;
      const crossed = (point, row) => ((point - (prev + row * sp)) % P + 2 * P) % P < adv;
      for (let k = 0; k < G.slots.length; k++) {
        const c = G.slots[k], row = Math.floor(k / LOOP_LANES);
        if (c >= 0 && crossed(0, row)) {
          let target = null;
          for (const v of G.vehicles) {
            if (v.state === 'parked' && v.color === c && v.reserved < v.cap && (!target || v.arrived < target.arrived)) target = v;
          }
          if (target) {
            target.reserved++;
            G.slots[k] = -1;
            G.walkers.push({ color: c, from: lanePoint(0, k % LOOP_LANES), vid: target.id, t: -(k % LOOP_LANES) * 0.08 });
          }
        } else if (c < 0) {
          const side = G.seq[G.seqIdx];
          if (side !== undefined && G.arms[side].length && crossed(mergeS(side), row)) {
            G.slots[k] = G.arms[side].shift();
            G.armTaken[side]++;
            if (++G.takeCount >= E.GROUP || !G.arms[side].length) { G.takeCount = 0; G.seqIdx++; }
          }
        }
      }
    }
    for (const side of [0, 1]) {
      const diff = G.armTaken[side] - G.armSmooth[side];
      G.armSmooth[side] += diff * Math.min(1, dt * 6);
    }
    for (const w of G.walkers) {
      w.t += dt / WALK_TIME;
      if (w.t >= 1 && !w.done) {
        w.done = true;
        const v = G.vehicles[w.vid];
        v.seats++;
        if (v.seats % 2 === 0) S.play('board', 0.25);
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
    const canBoard = G.slots.some((c) => c >= 0 && canBoardColor(c));
    const canEnter = G.slots.includes(-1) && (G.arms[0].length || G.arms[1].length);
    // Gesichter über der Menge, wenn es stockt
    const blocked = !canBoard && freeBay() < 0 && G.slots.some((c) => c >= 0);
    G.mood = Math.max(0, Math.min(1, G.mood + (blocked ? dt * 2 : -dt * 3)));
    if (!busy && !canBoard && !canEnter && freeBay() < 0 && passengersLeft()) {
      G.stuck += dt;
      if (G.stuck > 1.5) { G.over = true; showFail(); }
    } else G.stuck = 0;
  }

  function depart(v) {
    v.state = 'leave';
    G.bays[v.bay].vid = -1;
    v.leg = 'down';
    S.play('depart', 0.6);
    S.vibrate(15);
  }

  /** Ausparken: geradeaus vom Parkplatz, dann von unten in die Bucht (oder per VIP direkt hinüber). */
  function moveDrive(v, dt) {
    const b = bayCenter(v.bay);
    if (v.leg === 'out') {
      const d = E.dirOf(v.ang), step = DRIVE_SPEED * dt;
      v.px += d.x * step; v.py += d.y * step;
      const out = Math.max(-0.2 - v.px, v.px - G.w - 0.2, -0.2 - v.py, v.py - G.h - 0.2);
      if (out > 0) v.alpha = Math.max(0, 1 - out / 1.2);
      if (v.alpha <= 0) {
        v.leg = 'in';
        v.ang = 0; v.scale = parkScale(v);
        v.px = b.x; v.py = b.y + 1.1;
      }
      return;
    }
    if (v.leg === 'fly') {
      turnTo(v, 0, dt);
      const dx = b.x - v.px, dy = b.y - v.py, len = Math.hypot(dx, dy), step = DRIVE_SPEED * 0.8 * dt;
      v.scale = parkScale(v) + (1.15 - parkScale(v)) * Math.min(1, len / 4);
      if (len <= step) arrive(v); else { v.px += dx / len * step; v.py += dy / len * step; }
      return;
    }
    // 'in': einblenden und hochfahren
    v.alpha = Math.min(1, v.alpha + dt * 6);
    v.py -= DRIVE_SPEED * 0.5 * dt;
    if (v.py <= b.y) arrive(v);
  }
  function arrive(v) {
    const b = bayCenter(v.bay);
    v.state = 'parked'; v.leg = null; v.ang = 0; v.alpha = 1;
    v.px = b.x; v.py = b.y; v.scale = parkScale(v);
    v.arrived = G.time;
  }
  /** Abfahrt: aus der Bucht nach unten, dann nach rechts aus dem Bild. */
  function moveLeave(v, dt) {
    const step = DRIVE_SPEED * 0.8 * dt, laneY = -0.5;
    v.scale = Math.min(1, v.scale + dt * 2);
    if (v.leg === 'down') {
      turnTo(v, Math.PI, dt);
      v.py += step;
      if (v.py >= laneY) { v.py = laneY; v.leg = 'right'; }
    } else {
      turnTo(v, Math.PI / 2, dt);
      v.px += step * 1.3;
      if (v.px > G.w + 0.5) v.alpha = Math.max(0, v.alpha - dt * 4);
      if (v.alpha <= 0) v.state = 'gone';
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
    const kinds = ['bay', 'vip', 'sort'];
    const kind = kinds[n % 3];
    const names = { bay: 'Extra-Bucht', vip: 'VIP', sort: 'Sortieren' };
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
    const canBay = lockedBay() >= 0 && save.boosters.bay > 0;
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
  const PAL_LIGHT = { walk: '#eadfce', walkEdge: '#cdb99f', road: '#5d6472', lane: 'rgba(255,255,255,.55)', lot: '#c9ced8', lotEdge: '#b3b9c5', bay: '#666e7d', bayLine: 'rgba(255,255,255,.75)', grass: '#9fd18b' };
  const PAL_DARK = { walk: '#4a3f38', walkEdge: '#2c2521', road: '#2c313a', lane: 'rgba(255,255,255,.35)', lot: '#3a404d', lotEdge: '#30353f', bay: '#353b47', bayLine: 'rgba(255,255,255,.5)', grass: '#3d5a36' };
  const pal = () => (dark.matches ? PAL_DARK : PAL_LIGHT);

  function worldBounds() {
    const tops = usedArms().map((s) => armPath(s)[armPath(s).length - 1].y);
    return { x0: -1, x1: G.w + 1, y0: Math.min(...tops) - 0.2 * G.unit, y1: G.h + 0.5 };
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
    spriteCache.clear();
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
    const P = pal(), w = G.w, h = G.h, u = G.unit;

    // Gehwege: Zuläufe, Rundweg, Ausgang zu den Buchten
    const c0 = loopCenter(), lp = G.loop, band = (LANES * LANE_W + 0.3) * u, loopBand = (LOOP_LANES * LANE_W + 0.36) * u;
    const walkway = (extra, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = band + extra; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const side of usedArms()) { const pts = armPath(side); ctx.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y)); }
      ctx.stroke();
      ctx.lineWidth = loopBand + extra;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(c0.x - lp.a, c0.y - lp.b, lp.a * 2, lp.b * 2, lp.b); else ctx.rect(c0.x - lp.a, c0.y - lp.b, lp.a * 2, lp.b * 2);
      ctx.stroke();
      ctx.lineWidth = 0.7 * u + extra;
      ctx.beginPath(); ctx.moveTo(c0.x, c0.y + lp.b); ctx.lineTo(c0.x, bayTop() + 0.1); ctx.stroke();
    };
    walkway(0.12 * u, P.walkEdge);
    walkway(0, P.walk);

    // Haltebuchten
    const top = bayTop(), bw = bayW();
    ctx.fillStyle = P.bay;
    ctx.fillRect(-1, top, w + 2, BAY_H + 1);
    G.bays.forEach((bay, i) => {
      const x = -1 + i * bw, cx = x + bw / 2, cy = bayCenter(i).y;
      if (bay.kind === 'locked') {
        ctx.fillStyle = 'rgba(0,0,0,.18)';
        ctx.fillRect(x, top, bw, BAY_H);
        drawPlusBay(cx, cy, bw);
      } else if (bay.kind === 'vip') {
        ctx.strokeStyle = '#facc15'; ctx.lineWidth = 0.07;
        rr(x + 0.1, top + 0.12, bw - 0.2, BAY_H - 0.24, 0.12); ctx.stroke();
        if (bay.vid < 0) {
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(-Math.PI / 2);
          ctx.fillStyle = '#facc15'; ctx.font = `900 ${Math.min(0.5, bw * 0.42)}px Nunito, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('VIP', 0, 0);
          ctx.restore();
        }
      } else {
        if (G.bayFlash > 0) {
          ctx.fillStyle = `rgba(239,68,68,${0.35 * Math.abs(Math.sin(G.bayFlash * 10))})`;
          ctx.fillRect(x, top, bw, BAY_H);
        }
        ctx.strokeStyle = P.bayLine; ctx.lineWidth = 0.05;
        rr(x + 0.1, top + 0.12, bw - 0.2, BAY_H - 0.7, 0.1); ctx.stroke();
      }
    });

    // Straße für die Abfahrt und Parkplatz
    ctx.fillStyle = P.road;
    ctx.fillRect(-1, -1, w + 2, h + 1.5);
    ctx.fillStyle = P.lotEdge;
    rr(-0.35, -0.25, w + 0.7, h + 0.6, 0.5); ctx.fill();
    ctx.fillStyle = P.lot;
    rr(-0.25, -0.15, w + 0.5, h + 0.4, 0.45); ctx.fill();

    // Fahrzeuge: erst Parkplatz und Buchten, dann fahrende obendrauf
    for (const v of G.vehicles) if (v.state === 'lot') drawLotVehicle(v);
    for (const v of G.vehicles) if (v.state === 'parked') { drawVehicle(v, v.px, v.py, v.ang, v.scale, 1); drawSeatsLeft(v); }
    for (const v of G.vehicles) if (v.state === 'drive' || v.state === 'leave') drawVehicle(v, v.px, v.py, v.ang, v.scale * (v.leg === 'fly' ? 1.1 : 1), v.alpha);

    // Wartende in den Zuläufen (hinterste zuerst, damit die vorderen oben liegen)
    const ps = PERSON * u;
    for (const side of usedArms()) {
      const pts = armPath(side), arm = G.arms[side], len = pathLen(pts);
      const lag = G.armTaken[side] - G.armSmooth[side];
      const maxRows = Math.floor((len - 0.3 * u) / (ARM_SP * u));
      const show = Math.min(arm.length, Math.max(0, Math.floor(maxRows * LANES - lag)));
      for (let k = show - 1; k >= 0; k--) {
        const gi = G.armTaken[side] + k, row = (k + lag) / LANES;
        const lane = gi % LANES;
        const p = alongPath(pts, (0.3 + row * ARM_SP) * u, (lane - (LANES - 1) / 2) * LANE_W * u);
        drawPerson(p.x, p.y, arm[k], ps);
      }
      if (arm.length > show) {
        const p = pts[pts.length - 1];
        drawBubble(p.x, p.y + 0.3 * u, '+' + (arm.length - show), u);
      }
    }
    // Rundweg (nach Höhe sortiert für Tiefe)
    const crowd = [];
    for (let k = 0; k < G.slots.length; k++) {
      if (G.slots[k] < 0) continue;
      const p = lanePoint(G.phase + Math.floor(k / LOOP_LANES) * G.loop.sp, k % LOOP_LANES);
      crowd.push([p.y, p.x, G.slots[k]]);
    }
    crowd.sort((a, b) => a[0] - b[0]);
    for (const [y, x, c] of crowd) drawPerson(x, y, c, ps);
    for (const wk of G.walkers) {
      if (wk.t < 0) { drawPerson(wk.from.x, wk.from.y, wk.color, ps); continue; }
      const v = G.vehicles[wk.vid], t = Math.min(1, wk.t);
      const e = t * t * (3 - 2 * t);
      const x = wk.from.x + (v.px - wk.from.x) * e, y = wk.from.y + (v.py - wk.from.y) * e - Math.sin(t * Math.PI) * 0.3;
      drawPerson(x, y, wk.color, ps * (1 - t * 0.4));
    }
    if (G.mood > 0.05) drawFace(c0.x, c0.y + lp.b - 0.9 * u, u, G.mood);
  }

  function drawBubble(x, y, text, u) {
    ctx.font = `900 ${0.36 * u}px Nunito, sans-serif`;
    const w = ctx.measureText(text).width + 0.26 * u;
    ctx.fillStyle = 'rgba(30,41,59,.85)';
    rr(x - w / 2, y - 0.23 * u, w, 0.46 * u, 0.23 * u); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.01);
  }
  /** Besorgtes Gesicht über der Menge, wenn niemand einsteigen kann. */
  function drawFace(x, y, u, a) {
    const r = 0.32 * u * (0.8 + 0.2 * a), bob = Math.sin(G.time * 6) * 0.05 * u;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(x, y + bob);
    ctx.fillStyle = '#ffd34d'; ctx.strokeStyle = '#d99a1e'; ctx.lineWidth = 0.05 * u;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5b3a12';
    ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.15, r * 0.12, 0, Math.PI * 2); ctx.arc(r * 0.35, -r * 0.15, r * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5b3a12'; ctx.lineWidth = r * 0.12; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, r * 0.55, r * 0.3, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.restore();
  }

  function drawPlusBay(x, y, bw) {
    ctx.strokeStyle = 'rgba(255,255,255,.6)';
    ctx.lineWidth = 0.06;
    ctx.setLineDash([0.12, 0.1]);
    const wd = Math.min(0.8, bw - 0.3);
    rr(x - wd / 2, y - 0.65, wd, 1.3, 0.15); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 0.1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 0.17, y); ctx.lineTo(x + 0.17, y); ctx.moveTo(x, y - 0.17); ctx.lineTo(x, y + 0.17); ctx.stroke();
  }

  /** Anzeige der freien Plätze unter einem geparkten Fahrzeug. */
  function drawSeatsLeft(v) {
    const color = G.lvl.colors[v.color], b = bayCenter(v.bay);
    const y = bayTop() + BAY_H - 0.32, text = String(v.cap - v.seats);
    ctx.font = '900 0.34px Nunito, sans-serif';
    const wd = Math.max(0.5, ctx.measureText(text).width + 0.22);
    ctx.fillStyle = color;
    rr(b.x - wd / 2, y - 0.2, wd, 0.4, 0.12); ctx.fill();
    ctx.strokeStyle = shade(color, -0.35); ctx.lineWidth = 0.03; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, b.x, y + 0.01);
  }

  function drawLotVehicle(v) {
    const d = E.dirOf(v.ang);
    let x = v.px, y = v.py;
    if (v.bump) { x += d.x * v.bump.off; y += d.y * v.bump.off; }
    if (v.shake > 0) { const a = Math.sin(v.shake * 60) * 0.05 * (v.shake / 0.35); x -= d.y * a; y += d.x * a; }
    drawVehicle(v, x, y, v.ang, 1, 1);
    if (G.vip) {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 0.07;
      ctx.save(); ctx.translate(x, y); ctx.rotate(v.ang);
      rr(-v.width / 2 - 0.05, -v.len / 2 - 0.05, v.width + 0.1, v.len + 0.1, 0.2); ctx.stroke();
      ctx.restore();
    }
  }

  function drawVehicle(v, cx, cy, ang, scale, alpha) {
    const color = G.lvl.colors[v.color];
    const L = v.len - 0.06, W = v.width - 0.04, r = v.type === 'car' ? 0.2 : 0.14;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.scale(scale, scale);
    // Schatten (fällt immer nach unten rechts)
    ctx.save();
    ctx.rotate(-ang);
    ctx.translate(0.05, 0.09);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    rr(-W / 2, -L / 2, W, L, r); ctx.fill();
    ctx.restore();
    // Karosserie
    ctx.fillStyle = color;
    rr(-W / 2, -L / 2, W, L, r); ctx.fill();
    ctx.strokeStyle = shade(color, -0.3);
    ctx.lineWidth = 0.045;
    ctx.stroke();
    // Dach
    const roofTop = -L / 2 + 0.36, roofBottom = L / 2 - (v.type === 'car' ? 0.3 : 0.12);
    ctx.fillStyle = shade(color, 0.22);
    rr(-W / 2 + 0.1, roofTop, W - 0.2, roofBottom - roofTop, 0.1); ctx.fill();
    // Scheiben: vorne groß, hinten klein (zeigt die Fahrtrichtung)
    ctx.fillStyle = 'rgba(30,41,59,.85)';
    rr(-W / 2 + 0.09, -L / 2 + 0.12, W - 0.18, 0.2, 0.07); ctx.fill();
    if (v.type === 'car') { rr(-W / 2 + 0.13, L / 2 - 0.26, W - 0.26, 0.13, 0.05); ctx.fill(); }
    else {
      ctx.fillStyle = 'rgba(30,41,59,.55)';
      for (let y = roofTop + 0.1; y < roofBottom - 0.22; y += 0.36) {
        ctx.fillRect(-W / 2 + 0.02, y, 0.07, 0.24);
        ctx.fillRect(W / 2 - 0.09, y, 0.07, 0.24);
      }
    }
    // Scheinwerfer
    ctx.fillStyle = '#fff7c2';
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * W * 0.3, -L / 2 + 0.05, 0.05, 0, Math.PI * 2); ctx.fill(); }
    if (v.state === 'lot' || (v.state === 'drive' && v.leg === 'out')) {
      // großer Pfeil in Fahrtrichtung
      const my = (roofTop + roofBottom) / 2, al = Math.min(0.9, roofBottom - roofTop + 0.1);
      const tip = my - al / 2, base = tip + 0.28, tail = my + al / 2;
      ctx.beginPath();
      ctx.moveTo(0, tip); ctx.lineTo(0.26, base); ctx.lineTo(0.09, base); ctx.lineTo(0.09, tail);
      ctx.lineTo(-0.09, tail); ctx.lineTo(-0.09, base); ctx.lineTo(-0.26, base); ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 0.07; ctx.strokeStyle = 'rgba(15,23,42,.75)'; ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.fill();
    } else if (v.seats > 0) {
      // Füllstand: Köpfe auf dem Dach
      const n = Math.min(v.seats, 12), cols = 2, rowsN = Math.ceil(12 / cols);
      const stepY = (roofBottom - roofTop - 0.2) / Math.max(1, rowsN - 1);
      for (let k = 0; k < Math.ceil(n * 12 / v.cap) && k < 12; k++) {
        const sx = (k % 2 ? 1 : -1) * 0.15, sy = roofBottom - 0.1 - Math.floor(k / 2) * stepY;
        ctx.fillStyle = '#ffd9b3'; ctx.beginPath(); ctx.arc(sx, sy, 0.085, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  /*
   * Fahrgäste als vorgerenderte Bildchen je Farbe (viele hundert pro Bild):
   * Schatten, glänzender Körper, Kopf mit Haaren – leicht von oben/vorne.
   */
  const spriteCache = new Map();
  function personSprite(color, size) {
    const px = Math.max(8, Math.round(size * view.s * view.dpr));
    const key = color + px;
    let img = spriteCache.get(key);
    if (img) return img;
    img = document.createElement('canvas');
    img.width = img.height = px;
    const g2 = img.getContext('2d');
    g2.translate(px / 2, px * 0.55);
    g2.scale(px / 0.6, px / 0.6);
    g2.fillStyle = 'rgba(0,0,0,.28)';
    g2.beginPath(); g2.ellipse(0, 0.2, 0.19, 0.07, 0, 0, Math.PI * 2); g2.fill();
    let g = g2.createRadialGradient(-0.07, -0.02, 0.02, 0, 0.06, 0.24);
    g.addColorStop(0, shade(color, 0.45)); g.addColorStop(0.55, color); g.addColorStop(1, shade(color, -0.3));
    g2.fillStyle = g;
    g2.beginPath();
    if (g2.roundRect) g2.roundRect(-0.16, -0.06, 0.32, 0.29, [0.15, 0.15, 0.1, 0.1]); else g2.rect(-0.16, -0.06, 0.32, 0.29);
    g2.fill();
    g2.strokeStyle = shade(color, -0.45); g2.lineWidth = 0.025; g2.stroke();
    g = g2.createRadialGradient(-0.045, -0.2, 0.01, 0, -0.15, 0.15);
    g.addColorStop(0, '#ffeedd'); g.addColorStop(0.6, '#ffd2a8'); g.addColorStop(1, '#e0a77c');
    g2.fillStyle = g;
    g2.beginPath(); g2.arc(0, -0.15, 0.13, 0, Math.PI * 2); g2.fill();
    g2.fillStyle = '#5a3a2a';
    g2.beginPath(); g2.arc(0, -0.16, 0.135, Math.PI * 1.05, Math.PI * 1.95); g2.quadraticCurveTo(0, -0.2, -0.13, -0.18); g2.fill();
    g2.fillStyle = '#2b2b33';
    g2.beginPath(); g2.arc(-0.045, -0.13, 0.018, 0, Math.PI * 2); g2.arc(0.045, -0.13, 0.018, 0, Math.PI * 2); g2.fill();
    spriteCache.set(key, img);
    return img;
  }
  function drawPerson(x, y, c, size) {
    const color = typeof c === 'number' ? G.lvl.colors[c] : c;
    ctx.drawImage(personSprite(color, size), x - size / 2, y - size * 0.55, size, size);
  }

  // ---------- Eingabe ----------
  canvas.addEventListener('pointerdown', (e) => {
    S.unlock();
    if (!G || G.over) return;
    const r = canvas.getBoundingClientRect();
    const wx = (e.clientX - r.left - view.ox) / view.s, wy = (e.clientY - r.top - view.oy) / view.s;
    if (wy < -1 && wy > bayTop()) {
      const i = Math.floor((wx + 1) / bayW()), bay = G.bays[i];
      if (bay && bay.kind === 'locked') useBay();
      else if (bay && bay.kind === 'vip' && bay.vid < 0) useVip();
      return;
    }
    // das getroffene Fahrzeug, bei mehreren das mit der nächsten Mitte
    let best = null, bestD = Infinity;
    for (const v of G.vehicles) {
      if (!inLot(v) || !E.pointIn(v, wx, wy, 0.12)) continue;
      const d = Math.hypot(v.x - wx, v.y - wy);
      if (d < bestD) { bestD = d; best = v; }
    }
    if (best) tapVehicle(best);
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
    vip: useVip,
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
      if (!['bay', 'vip', 'sort'].includes(b.dataset.action)) S.play('click', 0.6);
      fn(b);
    }
  });
  $$('.overlay').forEach((o) => o.addEventListener('click', (e) => {
    if (e.target === o && !o.classList.contains('sticky')) closeDialogs();
  }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (G && G.vip) setVip(false); closeDialogs(); }
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
    get G() { return G; }, levelSpec, startLevel, setSpeed(n) { speed = n; }, freeBay: () => freeBay(), armOrder: () => armOrder(),
    toScreen(x, y) { const r = canvas.getBoundingClientRect(); return [r.left + view.ox + x * view.s, r.top + view.oy + y * view.s]; }
  };

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
