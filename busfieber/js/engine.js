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

  // Richtungen: 0 = hoch, 1 = rechts, 2 = runter, 3 = links
  const DIRS = [{ dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }];
  const TYPES = {
    car: { len: 2, cap: 4 },
    van: { len: 3, cap: 6 },
    bus: { len: 4, cap: 8 }
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

  /** Felder eines Fahrzeugs; (x, y) ist das vordere Feld, der Rest liegt dahinter. */
  function cellsOf(v) {
    const d = DIRS[v.dir], out = [];
    for (let k = 0; k < v.len; k++) out.push({ x: v.x - d.dx * k, y: v.y - d.dy * k });
    return out;
  }
  /** Felder vor dem Fahrzeug bis zum Rand des Parkplatzes. */
  function rayOf(v, cols, rows) {
    const d = DIRS[v.dir], out = [];
    let x = v.x + d.dx, y = v.y + d.dy;
    while (x >= 0 && y >= 0 && x < cols && y < rows) { out.push({ x, y }); x += d.dx; y += d.dy; }
    return out;
  }

  function pickWeighted(rng, weights) {
    const keys = Object.keys(weights);
    let sum = 0;
    for (const k of keys) sum += weights[k];
    let r = rng() * sum;
    for (const k of keys) { r -= weights[k]; if (r < 0) return k; }
    return keys[keys.length - 1];
  }

  /*
   * Erzeugt ein lösbares Level.
   * Fahrzeuge werden in einem Muster (Ringe, Fahrspuren) und/oder gestreut gesetzt;
   * eine Probe-Räumung liefert eine Ausfahr-Reihenfolge (Fahrzeuge, die sich gegenseitig
   * blockieren, fliegen raus). Die Warteschlange entsteht, indem diese Lösung mit `bays`
   * Haltebuchten durchgespielt wird – dadurch ist das Level garantiert schaffbar.
   *
   * spec: { cols, rows, colors, count, types: {car: w, van: w, bus: w}, layouts, gap, bays, park }
   *   park = wie viele Buchten die Lösung höchstens gleichzeitig nutzt (kleiner = leichter)
   */
  function generate(spec, seed) {
    // Viele Varianten bauen und die nehmen, deren Schwierigkeit am besten passt:
    // spec.target = gewünschte Gewinnquote eines Spielers ohne Vorausplanen (0..1),
    // spec.greedy = true verlangt zusätzlich, dass man es mit Vorausschauen sicher schafft.
    let best = null, bestScore = Infinity;
    for (let variant = 0; variant < 120; variant++) {
      const lvl = build(spec, mulberry32(seed + variant * 7919));
      if (spec.greedy !== undefined && greedyWins(lvl) !== spec.greedy) continue;
      if (spec.target === undefined) return lvl;
      const score = Math.abs(casualWinRate(lvl, mulberry32(seed ^ 0x5bd1e995), 40) - spec.target);
      if (score < bestScore) { best = lvl; bestScore = score; }
      if (score <= 0.05) break;
    }
    return best || build(spec, mulberry32(seed));
  }

  /*
   * Gewinnquote eines „Gelegenheitsspielers“: Er parkt nur, wenn im Rundweg niemand
   * einsteigen kann, und nimmt dann zufällig ein freies Fahrzeug – bevorzugt eines in
   * einer Farbe, die gerade im Kreis läuft. Er plant aber nicht voraus.
   */
  function casualWinRate(lvl, rng, runs) {
    let wins = 0;
    for (let r = 0; r < runs; r++) if (simulate(lvl, rng)) wins++;
    return wins / runs;
  }
  function simulate(lvl, rng) {
    const { cols, rows, queue } = lvl;
    const grid = new Int16Array(cols * rows).fill(-1);
    const vs = lvl.vehicles.map((v) => Object.assign({}, v, { inLot: true, used: 0 }));
    vs.forEach((v) => cellsOf(v).forEach((c) => { grid[c.y * cols + c.x] = v.id; }));
    const bays = [], loop = [];
    let entered = 0, done = 0;
    while (done < queue.length) {
      while (loop.length < lvl.loop && entered < queue.length) loop.push(entered++);
      const k = loop.findIndex((i) => bays.some((b) => b.color === queue[i] && b.used < b.cap));
      if (k >= 0) {
        const v = bays.find((b) => b.color === queue[loop[k]] && b.used < b.cap);
        loop.splice(k, 1); done++; v.used++;
        if (v.used === v.cap) bays.splice(bays.indexOf(v), 1);
        continue;
      }
      if (bays.length >= lvl.bays) return false;
      let free = vs.filter((f) => f.inLot && !rayOf(f, cols, rows).some((c) => grid[c.y * cols + c.x] >= 0));
      const inLoop = new Set(loop.map((i) => queue[i]));
      const match = free.filter((f) => inLoop.has(f.color));
      if (match.length) free = match;
      const pick = free[Math.floor(rng() * free.length)];
      pick.inLot = false;
      cellsOf(pick).forEach((c) => { grid[c.y * cols + c.x] = -1; });
      bays.push(pick);
    }
    return true;
  }

  // ---------- Anordnungen der Fahrzeuge ----------

  /** Streut Fahrzeuge zufällig; jedes neue braucht freie Bahn gegenüber den vorherigen. */
  function layoutScatter(spec, rng, grid, vehicles, count) {
    const { cols, rows } = spec;
    for (let tries = 0; tries < 4000 && vehicles.length < count; tries++) {
      const t = TYPES[pickWeighted(rng, spec.types)];
      const v = { len: t.len, cap: t.cap, dir: Math.floor(rng() * 4), x: Math.floor(rng() * cols), y: Math.floor(rng() * rows) };
      const cells = cellsOf(v);
      if (!cells.every((c) => c.x >= 0 && c.y >= 0 && c.x < cols && c.y < rows && grid[c.y * cols + c.x] < 0)) continue;
      if (rayOf(v, cols, rows).some((c) => grid[c.y * cols + c.x] >= 0)) continue;
      place(v, grid, vehicles, cols);
    }
  }

  /** Füllt eine Zellenfolge (in Fahrtrichtung) mit hintereinander stehenden Fahrzeugen. */
  function fillLane(cells, dir, spec, rng, grid, vehicles) {
    const { cols } = spec;
    let i = 0;
    while (i < cells.length) {
      if (rng() < (spec.gap || 0)) { i++; continue; }
      const t = TYPES[pickWeighted(rng, spec.types)];
      if (i + t.len > cells.length) { i++; continue; }
      const chunk = cells.slice(i, i + t.len);
      if (chunk.some((c) => grid[c.y * cols + c.x] >= 0)) { i++; continue; }
      const head = chunk[chunk.length - 1];
      place({ len: t.len, cap: t.cap, dir, x: head.x, y: head.y }, grid, vehicles, cols);
      i += t.len;
    }
  }

  /** Ringe um die Mitte; alle Fahrzeuge eines Rings fahren im (Gegen-)Uhrzeigersinn. */
  function layoutRings(spec, rng, grid, vehicles) {
    const { cols, rows } = spec;
    for (let r = 0; ; r++) {
      const x0 = r, y0 = r, x1 = cols - 1 - r, y1 = rows - 1 - r;
      if (x1 - x0 < 2 || y1 - y0 < 2) break;
      const sides = [[], [], [], []]; // oben, rechts, unten, links – im Uhrzeigersinn durchlaufen
      for (let x = x0; x < x1; x++) sides[0].push({ x, y: y0 });
      for (let y = y0; y < y1; y++) sides[1].push({ x: x1, y });
      for (let x = x1; x > x0; x--) sides[2].push({ x, y: y1 });
      for (let y = y1; y > y0; y--) sides[3].push({ x: x0, y });
      const cw = rng() < 0.5;
      sides.forEach((cells, k) => {
        if (cw) fillLane(cells, [1, 2, 3, 0][k], spec, rng, grid, vehicles);
        else fillLane(cells.slice().reverse(), [3, 0, 1, 2][k], spec, rng, grid, vehicles);
      });
    }
  }

  /** Fahrspuren: senkrechte Spalten am Rand, dazwischen waagerechte Reihen. */
  function layoutLanes(spec, rng, grid, vehicles) {
    const { cols, rows } = spec;
    const left = Math.floor(rng() * 3), right = Math.floor(rng() * 3);
    for (let x = 0; x < cols; x++) {
      if (x >= left && x < cols - right) continue;
      const down = rng() < 0.5, cells = [];
      for (let y = 0; y < rows; y++) cells.push({ x, y: down ? y : rows - 1 - y });
      fillLane(cells, down ? 2 : 0, spec, rng, grid, vehicles);
    }
    for (let y = 0; y < rows; y++) {
      const goRight = rng() < 0.5, cells = [];
      for (let x = left; x < cols - right; x++) cells.push({ x: goRight ? x : cols - 1 - right - (x - left), y });
      fillLane(cells, goRight ? 1 : 3, spec, rng, grid, vehicles);
    }
  }

  function place(v, grid, vehicles, cols) {
    v.id = vehicles.length;
    v.type = v.len === 2 ? 'car' : v.len === 3 ? 'van' : 'bus';
    cellsOf(v).forEach((c) => { grid[c.y * cols + c.x] = v.id; });
    vehicles.push(v);
  }

  /**
   * Räumt den Parkplatz probehalber leer (immer ein zufälliges freies Fahrzeug).
   * Liefert die Ausfahr-Reihenfolge; Fahrzeuge, die sich gegenseitig blockieren, fehlen darin.
   */
  function peel(vehicles, cols, rows, rng) {
    const grid = new Int16Array(cols * rows).fill(-1);
    vehicles.forEach((v) => cellsOf(v).forEach((c) => { grid[c.y * cols + c.x] = v.id; }));
    const left = new Set(vehicles.map((v) => v.id)), order = [];
    for (;;) {
      const free = vehicles.filter((v) => left.has(v.id) && !rayOf(v, cols, rows).some((c) => grid[c.y * cols + c.x] >= 0));
      if (!free.length) break;
      const v = free[Math.floor(rng() * free.length)];
      left.delete(v.id); order.push(v.id);
      cellsOf(v).forEach((c) => { grid[c.y * cols + c.x] = -1; });
    }
    return order;
  }

  function build(spec, rng) {
    const { cols, rows } = spec;
    const grid = new Int16Array(cols * rows).fill(-1);
    let vehicles = [];
    const layout = pickWeighted(rng, spec.layouts || { scatter: 1 });
    if (layout === 'rings') layoutRings(spec, rng, grid, vehicles);
    else if (layout === 'lanes') layoutLanes(spec, rng, grid, vehicles);
    // Lücken mit gestreuten Fahrzeugen auffüllen
    layoutScatter(spec, rng, grid, vehicles, layout === 'scatter' ? spec.count : vehicles.length + Math.round(spec.count * 0.25));

    // nur Fahrzeuge behalten, die auch herauskommen; IDs neu vergeben
    let order = peel(vehicles, cols, rows, rng);
    const keep = new Set(order);
    vehicles = vehicles.filter((v) => keep.has(v.id));
    const remap = new Map(vehicles.map((v, i) => [v.id, i]));
    vehicles.forEach((v) => { v.id = remap.get(v.id); });
    order = order.map((id) => remap.get(id));

    // Farben: jede Farbe mindestens einmal, Rest zufällig
    const k = Math.min(spec.colors, vehicles.length);
    const colorList = [];
    for (let i = 0; i < vehicles.length; i++) colorList.push(i < k ? i : Math.floor(rng() * k));
    for (let i = colorList.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [colorList[i], colorList[j]] = [colorList[j], colorList[i]];
    }
    vehicles.forEach((v, i) => { v.color = colorList[i]; });

    // Warteschlange über die Musterlösung (Ausfahr-Reihenfolge) erzeugen
    const queue = [];
    const parked = []; // { id, color, left }
    const maxPark = Math.max(1, Math.min(spec.bays, spec.park));
    const mix = spec.mix === undefined ? 0.4 : spec.mix;
    // lifo: Fahrgäste bevorzugt für das zuletzt geparkte Fahrzeug – die vorher
    // freigeräumten stehen dann länger in den Buchten (schwerer)
    const lifo = spec.lifo || 0;
    let next = 0, cur = null;
    while (next < order.length || parked.length) {
      const canPark = next < order.length && parked.length < maxPark;
      if (canPark && (parked.length === 0 || rng() < (spec.parkRate || 0.45))) {
        const v = vehicles[order[next++]];
        parked.push({ id: v.id, color: v.color, left: v.cap });
        continue;
      }
      // ein Fahrgast für ein geparktes Fahrzeug – mit Wahrscheinlichkeit `mix` für ein
      // anderes als zuletzt; einsteigen wird er (wie im Spiel) beim ersten passenden Fahrzeug
      if (!cur || !parked.includes(cur) || rng() < mix) {
        cur = rng() < lifo ? parked[parked.length - 1] : parked[Math.floor(rng() * parked.length)];
      }
      const target = parked.find((p) => p.color === cur.color);
      queue.push(target.color);
      if (--target.left === 0) parked.splice(parked.indexOf(target), 1);
    }

    return {
      cols, rows, bays: spec.bays, loop: spec.loop,
      colors: COLORS.slice(0, k).map((c) => c.hex),
      vehicles: vehicles.map((v) => ({ id: v.id, type: v.type, len: v.len, cap: v.cap, dir: v.dir, x: v.x, y: v.y, color: v.color })),
      queue
    };
  }

  /*
   * Rundweg der Fahrgäste: ein „Stadion“ (Rechteck mit Halbkreisen) mit `slots` festen
   * Plätzen, die sich wie ein Förderband drehen. Halbe Breite a, halbe Höhe b (in Feldern).
   */
  function loopShape(slots, unit = 1) {
    const b = 0.8 * unit, sp = 0.62 * unit;
    const a = Math.max(b + 0.15 * unit, (slots * sp - 2 * Math.PI * b) / 4 + b);
    const P = 4 * (a - b) + 2 * Math.PI * b;
    return { a, b, P, n: slots, sp: P / slots };
  }

  /*
   * Spielt das Level wie ein aufmerksamer Mensch: Fahrgäste steigen ein, sobald es geht;
   * sonst wird von den freien Fahrzeugen das genommen, dessen Farbe in der Schlange
   * am frühesten gebraucht wird. Liefert true, wenn das ohne Stau aufgeht.
   */
  function greedyWins(lvl) {
    const { cols, rows, queue } = lvl;
    const cap = lvl.loop;
    const grid = new Int16Array(cols * rows).fill(-1);
    const vs = lvl.vehicles.map((v) => Object.assign({}, v, { inLot: true, used: 0 }));
    vs.forEach((v) => cellsOf(v).forEach((c) => { grid[c.y * cols + c.x] = v.id; }));
    const bays = [];
    const loop = []; // Indizes in queue, die gerade im Kreis laufen
    let entered = 0, done = 0;
    while (done < queue.length) {
      while (loop.length < cap && entered < queue.length) loop.push(entered++);
      const k = loop.findIndex((i) => bays.some((b) => b.color === queue[i] && b.used < b.cap));
      if (k >= 0) {
        const v = bays.find((b) => b.color === queue[loop[k]] && b.used < b.cap);
        loop.splice(k, 1); done++; v.used++;
        if (v.used === v.cap) bays.splice(bays.indexOf(v), 1);
        continue;
      }
      if (bays.length >= lvl.bays) return false;
      const free = vs.filter((f) => f.inLot && !rayOf(f, cols, rows).some((c) => grid[c.y * cols + c.x] >= 0));
      const left = {};
      bays.forEach((b) => { left[b.color] = (left[b.color] || 0) + b.cap - b.used; });
      const order = loop.concat(Array.from({ length: queue.length - entered }, (_, j) => entered + j));
      let best = free[0], bestPos = Infinity;
      for (const f of free) {
        const need = Object.assign({}, left);
        let pos = Infinity;
        for (let j = 0; j < order.length; j++) {
          const c = queue[order[j]];
          if (need[c] > 0) { need[c]--; continue; }
          if (c === f.color) { pos = j; break; }
        }
        if (pos < bestPos) { bestPos = pos; best = f; }
      }
      best.inLot = false;
      cellsOf(best).forEach((c) => { grid[c.y * cols + c.x] = -1; });
      bays.push(best);
    }
    return true;
  }

  global.BusEngine = { generate, greedyWins, casualWinRate, loopShape, hashString, cellsOf, rayOf, DIRS, TYPES, COLORS };
})(window);
