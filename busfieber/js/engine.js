/* BusFieber – Level-Generator und Spielregeln (ohne Darstellung) */
(function (global) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // Fahrgäste kommen in Gruppen gleicher Farbe; alle Kapazitäten sind Vielfache davon
  const GROUP = 4;
  // Fahrzeuge frei auf dem Parkplatz: Mitte (x, y), Winkel ang (0 = nach oben, im Uhrzeigersinn)
  const TYPES = {
    car: { len: 1.4, width: 0.8, cap: 8 },
    van: { len: 1.85, width: 0.84, cap: 12 },
    bus: { len: 2.4, width: 0.88, cap: 20 }
  };
  const COLORS = [
    { name: 'Rot', hex: '#ef4444' },
    { name: 'Blau', hex: '#3b82f6' },
    { name: 'Gelb', hex: '#facc15' },
    { name: 'Grün', hex: '#22c55e' },
    { name: 'Lila', hex: '#a855f7' },
    { name: 'Orange', hex: '#f97316' },
    { name: 'Rosa', hex: '#f472b6' },
    { name: 'Türkis', hex: '#14b8a6' }
  ];

  // ---------- Geometrie ----------
  const dirOf = (ang) => ({ x: Math.sin(ang), y: -Math.cos(ang) });

  /** Rechteck eines Fahrzeugs; front verlängert es nach vorne (für die Fahrspur). */
  function boxOf(v, front = 0, margin = 0, shrink = 0) {
    const d = dirOf(v.ang), r = { x: -d.y, y: d.x };
    const hl = v.len / 2 + margin, hw = v.width / 2 + margin - shrink;
    const f = hl + front;
    const pts = [[f, hw], [f, -hw], [-hl, -hw], [-hl, hw]].map(([a, b]) => ({ x: v.x + d.x * a + r.x * b, y: v.y + d.y * a + r.y * b }));
    return { pts, axes: [d, r] };
  }
  function overlaps(A, B) {
    for (const ax of A.axes.concat(B.axes)) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const p of A.pts) { const t = p.x * ax.x + p.y * ax.y; if (t < a0) a0 = t; if (t > a1) a1 = t; }
      for (const p of B.pts) { const t = p.x * ax.x + p.y * ax.y; if (t < b0) b0 = t; if (t > b1) b1 = t; }
      if (a1 <= b0 || b1 <= a0) return false;
    }
    return true;
  }
  const RAY = 80;
  /** Liegt b in der Fahrspur von a (a fährt geradeaus in Pfeilrichtung los)? */
  function blocks(b, a) {
    const reach = a.len / 2 + RAY + b.len;
    if (Math.hypot(b.x - a.x, b.y - a.y) > reach) return false;
    return overlaps(boxOf(a, RAY, 0, 0.04), boxOf(b));
  }
  /** Wie weit a fahren kann, bis es b berührt. */
  function gapTo(a, b) {
    const B = boxOf(b);
    let lo = 0, hi = RAY;
    if (!overlaps(boxOf(a, hi, 0, 0.04), B)) return Infinity;
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      if (overlaps(boxOf(a, mid, 0, 0.04), B)) hi = mid; else lo = mid;
    }
    return lo;
  }
  function pointIn(v, x, y, margin = 0) {
    const d = dirOf(v.ang), dx = x - v.x, dy = y - v.y;
    const along = dx * d.x + dy * d.y, side = -dx * d.y + dy * d.x;
    return Math.abs(along) <= v.len / 2 + margin && Math.abs(side) <= v.width / 2 + margin;
  }

  function pickWeighted(rng, weights) {
    const keys = Object.keys(weights);
    let sum = 0;
    for (const k of keys) sum += weights[k];
    let r = rng() * sum;
    for (const k of keys) { r -= weights[k]; if (r < 0) return k; }
    return keys[keys.length - 1];
  }

  // ---------- Figuren des Parkplatzes (u, v von −1 bis 1) ----------
  const SHAPES = {
    rect: () => true,
    circle: (u, v) => u * u + v * v <= 1,
    diamond: (u, v) => Math.abs(u) + Math.abs(v) <= 1.08,
    cross: (u, v) => Math.abs(u) < 0.4 || Math.abs(v) < 0.4,
    heart: (u, v) => {
      const x = u * 1.18, y = -v * 1.2 + 0.18, a = x * x + y * y - 1;
      return a * a * a - x * x * y * y * y <= 0;
    },
    ring: (u, v) => { const r = Math.hypot(u, v); return r <= 1 && r >= 0.42; },
    columns: (u, v) => Math.abs(u) < 0.26 || Math.abs(u) > 0.58 || v > 0.62,
    hourglass: (u, v) => Math.abs(u) <= Math.abs(v) * 0.85 + 0.28,
    flower: (u, v) => { const r = Math.hypot(u, v), t = Math.atan2(v, u); return r <= 0.62 + 0.38 * Math.abs(Math.cos(2 * t)); },
    arch: (u, v) => { const r = Math.hypot(u, v * 0.9 - 0.35); return v > 0.35 ? Math.abs(u) > 0.35 : r <= 1.05 && r >= 0.4; }
  };

  function angleFor(mode, rng) {
    const q = Math.PI / 2;
    if (mode === 'grid') return Math.floor(rng() * 4) * q;
    if (mode === 'tilt') return Math.floor(rng() * 8) * q / 2;
    if (mode === 'free') return Math.floor(rng() * 12) * Math.PI / 6;
    return rng() < 0.5 ? Math.floor(rng() * 4) * q : Math.floor(rng() * 12) * Math.PI / 6;
  }

  /*
   * Setzt Fahrzeuge dicht in eine Figur (nur ohne Überlappung). Danach werden Fahrzeuge,
   * die sich gegenseitig festhalten, so lange gedreht, bis alles ausräumbar ist; was
   * dann noch klemmt, fliegt raus. Weil Wegfahren nie etwas blockiert, schafft man das
   * Level in jeder Reihenfolge, die nicht hängt.
   */
  function place(spec, rng) {
    const { w, h } = spec;
    const shape = SHAPES[spec.shape] || SHAPES.rect;
    const inside = (v) => boxOf(v).pts.every((p) => p.x > 0.05 && p.y > 0.05 && p.x < w - 0.05 && p.y < h - 0.05 &&
      shape((p.x - w / 2) / (w / 2), (p.y - h / 2) / (h / 2)));
    const vs = [];
    const free = (v, skip) => {
      if (!inside(v)) return false;
      const b = boxOf(v, 0, 0.05);
      for (const o of vs) if (o !== skip && o !== v && Math.hypot(o.x - v.x, o.y - v.y) < (o.len + v.len) / 2 + 0.2 && overlaps(b, boxOf(o, 0, 0.05))) return false;
      return true;
    };
    const snap = (val, step) => Math.round(val / step) * step;
    const angles = () => {
      const out = [];
      for (let k = 0; k < 6; k++) out.push(angleFor(spec.angles, rng));
      return out;
    };
    const mirror = (v) => Object.assign({}, v, { x: w - v.x, ang: -v.ang });
    for (let tries = 0; tries < 6000 && vs.length < spec.count; tries++) {
      const type = pickWeighted(rng, spec.types), t = TYPES[type];
      const x0 = rng() * w, y0 = rng() * h;
      for (const ang of angles()) {
        const v = { type, len: t.len, width: t.width, cap: t.cap, ang, x: x0, y: y0 };
        if (spec.angles === 'grid') {
          if (Math.abs(Math.sin(ang)) < 0.5) { v.x = snap(x0 - w / 2, 0.92) + w / 2; v.y = snap(y0, 0.25); }
          else { v.y = snap(y0 - h / 2, 0.92) + h / 2; v.x = snap(x0, 0.25); }
        }
        if (spec.sym && Math.abs(v.x - w / 2) < 0.75) { v.x = w / 2; v.ang = rng() < 0.5 ? 0 : Math.PI; }
        if (!free(v)) continue;
        if (spec.sym && v.x !== w / 2) {
          const m = mirror(v);
          vs.push(v);
          if (!free(m)) { vs.pop(); continue; }
          v.twin = m; m.twin = v;
          vs.push(m);
        } else vs.push(v);
        break;
      }
    }
    vs.forEach((v, i) => { v.id = i; });

    // Verklemmte Fahrzeuge drehen, bis möglichst alle herauskommen
    const blockers = blockerLists(vs);
    // nach dem Drehen von v: seine eigene Liste und seine Einträge bei den anderen neu
    const refresh = (v) => {
      blockers[v.id] = vs.filter((b) => b !== v && blocks(b, v)).map((b) => b.id);
      for (const a of vs) {
        if (a === v) continue;
        const list = blockers[a.id], k = list.indexOf(v.id), hit = blocks(v, a);
        if (hit && k < 0) list.push(v.id); else if (!hit && k >= 0) list.splice(k, 1);
      }
    };
    const removable = () => peel(vs.length, blockers, () => 0).length;
    let best = removable();
    for (let it = 0; it < 160 && best < vs.length; it++) {
      const order = peel(vs.length, blockers, () => 0), out = new Set(order);
      const stuck = vs.filter((v) => !out.has(v.id));
      const v = stuck[Math.floor(rng() * stuck.length)];
      const old = { ang: v.ang, x: v.x, y: v.y };
      const tw = v.twin, oldT = tw && { ang: tw.ang };
      let improved = false;
      for (const ang of angles().concat([v.ang + Math.PI])) {
        v.ang = ang;
        if (spec.sym && v.x === w / 2) v.ang = Math.round(ang / Math.PI) % 2 ? Math.PI : 0;
        if (tw) tw.ang = -v.ang;
        if (!free(v) || (tw && !free(tw))) continue;
        refresh(v); if (tw) refresh(tw);
        const n = removable();
        if (n > best) { best = n; improved = true; break; }
      }
      if (!improved) { v.ang = old.ang; refresh(v); if (tw) { tw.ang = oldT.ang; refresh(tw); } }
    }
    // Rest entfernen (Zwillinge mit, damit die Figur symmetrisch bleibt)
    const keep = new Set(peel(vs.length, blockers, () => 0));
    let kept = vs.filter((v) => keep.has(v.id) && (!v.twin || keep.has(v.twin.id)));
    kept.forEach((v, i) => { v.id = i; });
    kept = kept.map((v) => ({ id: v.id, type: v.type, len: v.len, width: v.width, cap: v.cap, ang: v.ang, x: v.x, y: v.y }));
    return kept;
  }

  /** blockers[i] = Fahrzeuge, die i im Weg stehen (ändert sich nie, sie fahren nur weg). */
  function blockerLists(vs) {
    return vs.map((a) => vs.filter((b) => b !== a && blocks(b, a)).map((b) => b.id));
  }

  /** Räumt den Parkplatz probehalber in zufälliger Reihenfolge leer. */
  function peel(n, blockers, rng) {
    const gone = new Array(n).fill(false), order = [];
    while (order.length < n) {
      const free = [];
      for (let i = 0; i < n; i++) if (!gone[i] && blockers[i].every((j) => gone[j])) free.push(i);
      if (!free.length) break;
      const i = free[Math.floor(rng() * free.length)];
      gone[i] = true; order.push(i);
    }
    return order;
  }

  /*
   * Erzeugt ein lösbares Level.
   * spec: { w, h, shape, angles, sym, count, types, colors, arms, bays, park, mix, lifo, parkRate, loop, target, greedy }
   *   park  = wie viele Buchten die Musterlösung höchstens gleichzeitig nutzt (kleiner = leichter)
   *   loop  = Plätze im Rundweg, in Gruppen
   * Viele Varianten werden gebaut; genommen wird die, deren Schwierigkeit am besten passt:
   * spec.target = Gewinnquote eines Spielers ohne Vorausplanen (0..1),
   * spec.greedy = true verlangt zusätzlich, dass man es mit Vorausschauen sicher schafft.
   */
  function generate(spec, seed) {
    let best = null, bestScore = Infinity;
    for (let p = 0; p < 4; p++) {
      const rng = mulberry32(seed + p * 104729);
      const vs = place(spec, rng);
      vs.forEach((v, i) => { v.id = i; });
      const blockers = blockerLists(vs);
      for (let variant = 0; variant < 30; variant++) {
        const lvl = build(spec, vs, blockers, mulberry32(seed + p * 104729 + variant * 7919 + 1));
        if (spec.greedy !== undefined && greedyWins(lvl) !== spec.greedy) continue;
        if (spec.target === undefined) return lvl;
        const score = Math.abs(casualWinRate(lvl, mulberry32(seed ^ 0x5bd1e995), 30) - spec.target);
        if (score < bestScore) { best = lvl; bestScore = score; }
        if (score <= 0.05) return best;
      }
    }
    if (best) return best;
    const vs = place(spec, mulberry32(seed));
    vs.forEach((v, i) => { v.id = i; });
    return build(spec, vs, blockerLists(vs), mulberry32(seed));
  }

  function build(spec, placed, blockers, rng) {
    const order = peel(placed.length, blockers, rng);

    // Farben: jede Farbe mindestens einmal, Rest zufällig
    const k = Math.min(spec.colors, placed.length);
    const colorList = [];
    for (let i = 0; i < placed.length; i++) colorList.push(i < k ? i : Math.floor(rng() * k));
    for (let i = colorList.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [colorList[i], colorList[j]] = [colorList[j], colorList[i]];
    }
    const vehicles = placed.map((v, i) => ({
      id: v.id, type: v.type, len: v.len, width: v.width, cap: v.cap,
      x: +v.x.toFixed(3), y: +v.y.toFixed(3), ang: v.ang, color: colorList[i]
    }));

    // Warteschlange (in Gruppen) über die Musterlösung erzeugen
    const queue = [];
    const parked = []; // { color, left } – left in Gruppen
    const maxPark = Math.max(1, Math.min(spec.bays, spec.park));
    const mix = spec.mix === undefined ? 0.4 : spec.mix;
    // lifo: Gruppen bevorzugt für das zuletzt geparkte Fahrzeug – die vorher
    // freigeräumten stehen dann länger in den Buchten (schwerer)
    const lifo = spec.lifo || 0;
    let next = 0, cur = null;
    while (next < order.length || parked.length) {
      const canPark = next < order.length && parked.length < maxPark;
      if (canPark && (parked.length === 0 || rng() < (spec.parkRate || 0.45))) {
        const v = vehicles[order[next++]];
        parked.push({ color: v.color, left: v.cap / GROUP });
        continue;
      }
      if (!cur || !parked.includes(cur) || rng() < mix) {
        cur = rng() < lifo ? parked[parked.length - 1] : parked[Math.floor(rng() * parked.length)];
      }
      // einsteigen wird die Gruppe (wie im Spiel) beim ersten passenden Fahrzeug
      const target = parked.find((p) => p.color === cur.color);
      queue.push(target.color);
      if (--target.left === 0) parked.splice(parked.indexOf(target), 1);
    }

    return {
      w: spec.w, h: spec.h, bays: spec.bays, loop: spec.loop, arms: spec.arms || 2,
      colors: COLORS.slice(0, k).map((c) => c.hex),
      vehicles, blockers, queue
    };
  }

  // ---------- Testspieler (rechnen in Gruppen) ----------
  function freeOnes(vs, blockers) {
    return vs.filter((f) => f.inLot && blockers[f.id].every((j) => !vs[j].inLot));
  }
  /** Gemeinsamer Ablauf: Gruppen steigen ein, sobald es geht; sonst wählt pick() ein freies Fahrzeug. */
  function run(lvl, pick) {
    const { queue, blockers } = lvl;
    const vs = lvl.vehicles.map((v) => Object.assign({}, v, { inLot: true, used: 0, capG: v.cap / GROUP }));
    const bays = [], loop = [];
    let entered = 0, done = 0;
    while (done < queue.length) {
      while (loop.length < lvl.loop && entered < queue.length) loop.push(entered++);
      const k = loop.findIndex((i) => bays.some((b) => b.color === queue[i] && b.used < b.capG));
      if (k >= 0) {
        const v = bays.find((b) => b.color === queue[loop[k]] && b.used < b.capG);
        loop.splice(k, 1); done++; v.used++;
        if (v.used === v.capG) bays.splice(bays.indexOf(v), 1);
        continue;
      }
      if (bays.length >= lvl.bays) return false;
      const free = freeOnes(vs, blockers);
      if (!free.length) return false;
      const v = pick(free, { vs, bays, loop, entered, queue });
      v.inLot = false;
      bays.push(v);
    }
    return true;
  }

  /*
   * Gewinnquote eines „Gelegenheitsspielers“: Er parkt nur, wenn im Rundweg niemand
   * einsteigen kann, und nimmt dann zufällig ein freies Fahrzeug – bevorzugt eines in
   * einer Farbe, die gerade im Kreis läuft. Er plant aber nicht voraus.
   */
  function casualWinRate(lvl, rng, runs) {
    let wins = 0;
    for (let r = 0; r < runs; r++) {
      if (run(lvl, (free, s) => {
        const inLoop = new Set(s.loop.map((i) => s.queue[i]));
        const match = free.filter((f) => inLoop.has(f.color));
        const pool = match.length ? match : free;
        return pool[Math.floor(rng() * pool.length)];
      })) wins++;
    }
    return wins / runs;
  }

  /*
   * Spielt das Level wie ein aufmerksamer Mensch: von den freien Fahrzeugen wird das
   * genommen, dessen Farbe in der Schlange am frühesten gebraucht wird.
   */
  function greedyWins(lvl) {
    return run(lvl, (free, s) => {
      const left = {};
      s.bays.forEach((b) => { left[b.color] = (left[b.color] || 0) + b.capG - b.used; });
      const order = s.loop.concat(Array.from({ length: s.queue.length - s.entered }, (_, j) => s.entered + j));
      let best = free[0], bestPos = Infinity;
      for (const f of free) {
        const need = Object.assign({}, left);
        let pos = Infinity;
        for (let j = 0; j < order.length; j++) {
          const c = s.queue[order[j]];
          if (need[c] > 0) { need[c]--; continue; }
          if (c === f.color) { pos = j; break; }
        }
        if (pos < bestPos) { bestPos = pos; best = f; }
      }
      return best;
    });
  }

  /*
   * Rundweg der Fahrgäste: ein „Stadion“ (Rechteck mit Halbkreisen) mit `rows` festen
   * Reihen, die sich wie ein Förderband drehen. Halbe Breite a, halbe Höhe b.
   */
  function loopShape(rows, unit = 1) {
    const b = 1.25 * unit, sp = 0.42 * unit;
    const a = Math.max(b + 0.15 * unit, (rows * sp - 2 * Math.PI * b) / 4 + b);
    const P = 4 * (a - b) + 2 * Math.PI * b;
    return { a, b, P, n: rows, sp: P / rows };
  }

  global.BusEngine = {
    generate, greedyWins, casualWinRate, loopShape, hashString,
    boxOf, overlaps, blocks, gapTo, pointIn, dirOf, SHAPES, GROUP, TYPES, COLORS
  };
})(window);
