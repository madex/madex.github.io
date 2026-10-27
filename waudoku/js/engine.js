/* WauDoku – Puzzle-Engine: Generator, Löser, Tipps.
 * Regeln: genau eine Katze pro Zeile, Spalte und Farbregion; Katzen dürfen sich
 * nicht berühren (auch nicht diagonal). */
(function (global) {
  'use strict';

  // ---------- Zufall (deterministisch pro Level) ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------- Farben ----------
  // Farbfamilien (Töne aus dem Original-Spiel). Pro Level höchstens eine Farbe je Familie,
  // damit nie zwei ähnliche Töne (z. B. hell- und dunkelgrün) gleichzeitig vorkommen.
  const FAMILIES = [
    ['#e76f58', '#ca6666'],             // Rot
    ['#de7e34', '#ca7849'],             // Orange
    ['#e4bc4a', '#dbbc48'],             // Gelb
    ['#4aba34', '#459a5e'],             // Grün
    ['#399295', '#4bb5b1'],             // Petrol
    ['#89c4e6', '#4cabdb'],             // Hellblau
    ['#6584b3', '#686dbf'],             // Blau
    ['#9684ec', '#c58ced'],             // Lila
    ['#fea3e9', '#f4a4e7'],             // Rosa
    ['#dc5599', '#c36a8a'],             // Himbeere
    ['#ac7147', '#a67b63'],             // Braun
    ['#afb4d2', '#c0d1dc']              // Graublau
  ];
  const PALETTE = FAMILIES.flat();

  function hexToLab(hex) {
    const v = parseInt(hex.slice(1), 16);
    let r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
    const lin = (c) => (c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92);
    r = lin(r); g = lin(g); b = lin(b);
    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    x = f(x); y = f(y); z = f(z);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  const labDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // Wählt n Farben aus verschiedenen Familien; benachbarte Regionen sollen sich stark unterscheiden.
  function pickColors(n, regions, size, rnd) {
    const adj = Array.from({ length: n }, () => new Set());
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const a = regions[r * size + c];
      if (c + 1 < size && regions[r * size + c + 1] !== a) { adj[a].add(regions[r * size + c + 1]); adj[regions[r * size + c + 1]].add(a); }
      if (r + 1 < size && regions[(r + 1) * size + c] !== a) { adj[a].add(regions[(r + 1) * size + c]); adj[regions[(r + 1) * size + c]].add(a); }
    }
    // je Familie zufällig einen Ton
    const tones = FAMILIES.map((f) => f[Math.floor(rnd() * f.length)]);
    const labs = tones.map(hexToLab);
    const order = shuffle([...Array(n).keys()], rnd).sort((a, b) => adj[b].size - adj[a].size);
    const chosen = new Array(n).fill(-1);
    const used = new Set();
    for (const reg of order) {
      let best = -1, bestScore = -Infinity;
      for (const p of shuffle([...Array(tones.length).keys()], rnd)) {
        if (used.has(p)) continue;
        let minAdj = Infinity;
        for (const o of adj[reg]) if (chosen[o] >= 0) minAdj = Math.min(minAdj, labDist(labs[p], labs[chosen[o]]));
        const score = Math.min(minAdj, 120) + rnd() * 6;
        if (score > bestScore) { bestScore = score; best = p; }
      }
      chosen[reg] = best; used.add(best);
    }
    return chosen.map((i) => tones[i]);
  }

  // ---------- Hilfsfunktionen Brett ----------
  function makeGeometry(size) {
    const rowOf = new Int8Array(size * size), colOf = new Int8Array(size * size);
    const neigh = [];
    for (let i = 0; i < size * size; i++) {
      const r = Math.floor(i / size), c = i % size;
      rowOf[i] = r; colOf[i] = c;
      const list = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < size && cc < size) list.push(rr * size + cc);
      }
      neigh.push(list);
    }
    return { rowOf, colOf, neigh };
  }

  // Zählt Lösungen (bis limit) per Backtracking Zeile für Zeile.
  function solve(size, regions, limit) {
    const sols = [];
    const colUsed = new Array(size).fill(false);
    const regUsed = new Array(size).fill(false);
    const pos = new Array(size).fill(-1);
    // Pruning: jede Region muss noch erreichbar sein (rest-Zeilen).
    const regRows = Array.from({ length: size }, () => 0);
    for (let i = 0; i < size * size; i++) regRows[regions[i]] |= 1 << Math.floor(i / size);
    function rec(r) {
      if (sols.length >= limit) return;
      if (r === size) { sols.push(pos.slice()); return; }
      const remMask = ((1 << size) - 1) & ~((1 << r) - 1);
      for (let g = 0; g < size; g++) if (!regUsed[g] && !(regRows[g] & remMask)) return;
      for (let c = 0; c < size; c++) {
        if (colUsed[c]) continue;
        if (r > 0 && Math.abs(pos[r - 1] - c) <= 1) continue;
        const g = regions[r * size + c];
        if (regUsed[g]) continue;
        colUsed[c] = regUsed[g] = true; pos[r] = c;
        rec(r + 1);
        colUsed[c] = regUsed[g] = false; pos[r] = -1;
        if (sols.length >= limit) return;
      }
    }
    rec(0);
    return sols;
  }

  function randomQueens(size, rnd) {
    const pos = new Array(size).fill(-1), used = new Array(size).fill(false);
    function rec(r) {
      if (r === size) return true;
      const cols = shuffle([...Array(size).keys()], rnd);
      for (const c of cols) {
        if (used[c] || (r > 0 && Math.abs(pos[r - 1] - c) <= 1)) continue;
        used[c] = true; pos[r] = c;
        if (rec(r + 1)) return true;
        used[c] = false;
      }
      return false;
    }
    rec(0);
    return pos;
  }

  function growRegions(size, queens, rnd) {
    const N = size * size, regions = new Int16Array(N).fill(-1);
    queens.forEach((c, r) => { regions[r * size + c] = r; });
    const sizes = new Array(size).fill(1);
    let left = N - size;
    const orth = (i) => {
      const r = Math.floor(i / size), c = i % size, out = [];
      if (r > 0) out.push(i - size); if (r < size - 1) out.push(i + size);
      if (c > 0) out.push(i - 1); if (c < size - 1) out.push(i + 1);
      return out;
    };
    // Wachstum mit leichter Bevorzugung kleiner Regionen, aber zufälligen Formen.
    const bias = 0.6 + rnd() * 1.4;
    while (left > 0) {
      const frontier = [];
      for (let i = 0; i < N; i++) {
        if (regions[i] !== -1) continue;
        for (const j of orth(i)) if (regions[j] !== -1) { frontier.push([i, regions[j]]); }
      }
      let total = 0;
      const w = frontier.map(([, g]) => { const x = 1 / Math.pow(sizes[g], bias); total += x; return x; });
      let t = rnd() * total, k = 0;
      while (k < w.length - 1 && t > w[k]) { t -= w[k]; k++; }
      const [cell, g] = frontier[k];
      regions[cell] = g; sizes[g]++; left--;
    }
    return regions;
  }

  function regionConnectedWithout(size, regions, g, skip) {
    const cells = [];
    for (let i = 0; i < size * size; i++) if (regions[i] === g && i !== skip) cells.push(i);
    if (!cells.length) return false;
    const seen = new Set([cells[0]]), stack = [cells[0]];
    while (stack.length) {
      const i = stack.pop(), r = Math.floor(i / size), c = i % size;
      const nb = [];
      if (r > 0) nb.push(i - size); if (r < size - 1) nb.push(i + size);
      if (c > 0) nb.push(i - 1); if (c < size - 1) nb.push(i + 1);
      for (const j of nb) if (j !== skip && regions[j] === g && !seen.has(j)) { seen.add(j); stack.push(j); }
    }
    return seen.size === cells.length;
  }

  // Verändert Regionen so lange, bis die Lösung eindeutig ist.
  function makeUnique(size, regions, queens, rnd) {
    const queenCells = new Set(queens.map((c, r) => r * size + c));
    for (let iter = 0; iter < 400; iter++) {
      const sols = solve(size, regions, 2);
      if (sols.length === 1) return true;
      const alt = sols.find((s) => s.some((c, r) => c !== queens[r]));
      if (!alt) return false;
      const moves = [];
      alt.forEach((c, r) => {
        const i = r * size + c;
        if (queenCells.has(i)) return;
        const g = regions[i];
        const nb = [];
        if (r > 0) nb.push(i - size); if (r < size - 1) nb.push(i + size);
        if (c > 0) nb.push(i - 1); if (c < size - 1) nb.push(i + 1);
        const targets = new Set(nb.map((j) => regions[j]).filter((h) => h !== g));
        if (!targets.size || !regionConnectedWithout(size, regions, g, i)) return;
        for (const h of targets) moves.push([i, h]);
      });
      if (!moves.length) return false;
      const [cell, h] = moves[Math.floor(rnd() * moves.length)];
      regions[cell] = h;
    }
    return false;
  }

  // ---------- Logik-Löser (für Tipps und Schwierigkeitsbewertung) ----------
  // state: Array der Länge N mit 0 = leer, 1 = X, 2 = Katze
  function units(size, regions) {
    const list = [];
    for (let r = 0; r < size; r++) list.push({ type: 'row', index: r, cells: [...Array(size).keys()].map((c) => r * size + c) });
    for (let c = 0; c < size; c++) list.push({ type: 'col', index: c, cells: [...Array(size).keys()].map((r) => r * size + c) });
    for (let g = 0; g < size; g++) {
      const cells = [];
      for (let i = 0; i < size * size; i++) if (regions[i] === g) cells.push(i);
      list.push({ type: 'region', index: g, cells });
    }
    return list;
  }

  function Logic(size, regions) {
    this.size = size;
    this.regions = regions;
    this.geo = makeGeometry(size);
    this.units = units(size, regions);
  }

  // Zellen, die von einer bestehenden Katze blockiert werden.
  Logic.prototype.blockedBy = function (state, cat) {
    const { size, regions, geo } = this, out = [];
    for (let i = 0; i < size * size; i++) {
      if (i === cat || state[i] !== 0) continue;
      if (geo.rowOf[i] === geo.rowOf[cat] || geo.colOf[i] === geo.colOf[cat] || regions[i] === regions[cat] || geo.neigh[cat].includes(i)) out.push(i);
    }
    return out;
  };

  Logic.prototype.unitHasCat = function (state, u) { return u.cells.some((i) => state[i] === 2); };
  Logic.prototype.candidates = function (state, u) { return u.cells.filter((i) => state[i] === 0); };

  // Simuliert eine Katze und prüft, ob dabei eine Einheit keine Möglichkeit mehr hat.
  Logic.prototype.catKillsUnit = function (state, cell) {
    const s = state.slice();
    s[cell] = 2;
    for (const b of this.blockedBy(s, cell)) s[b] = 1;
    for (const u of this.units) {
      if (this.unitHasCat(s, u)) continue;
      if (!this.candidates(s, u).length) return u;
    }
    return null;
  };

  // Propagation (nur einfache Regeln) für Widerspruchsketten.
  Logic.prototype.propagate = function (s) {
    for (let guard = 0; guard < 200; guard++) {
      let changed = false;
      for (const u of this.units) {
        if (this.unitHasCat(s, u)) continue;
        const c = this.candidates(s, u);
        if (!c.length) return false;
        if (c.length === 1) {
          s[c[0]] = 2;
          for (const b of this.blockedBy(s, c[0])) s[b] = 1;
          changed = true;
        }
      }
      // Katzen dürfen sich nicht widersprechen
      if (!changed) break;
    }
    for (const u of this.units) {
      const cats = u.cells.filter((i) => s[i] === 2).length;
      if (cats > 1) return false;
      if (!cats && !this.candidates(s, u).length) return false;
    }
    return true;
  };

  // Wörter für die Spielfigur in den Tipp-Texten
  const W = { nom: 'der Hund', acc: 'den Hund', indef: 'ein Hund', Indef: 'Ein Hund', negAcc: 'keinen Hund' };
  function setWords(words) { Object.assign(W, words); }

  const UNIT_NAME = { row: 'Zeile', col: 'Spalte', region: 'Farbe' };
  function unitLabel(u) { return u.type === 'region' ? 'dieser Farbe' : `${UNIT_NAME[u.type]} ${u.index + 1}`; }

  function combos(arr, k, start = 0, acc = [], out = []) {
    if (acc.length === k) { out.push(acc.slice()); return out; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); combos(arr, k, i + 1, acc, out); acc.pop(); }
    return out;
  }

  /* Findet den nächsten logischen Schritt.
   * Rückgabe: { tier, kind:'cat'|'x', cells:[...], focus:[...], text } oder null */
  Logic.prototype.nextStep = function (state, maxTier = 5) {
    const { size, regions } = this;
    // Tier 0: blockierte Felder um vorhandene Katzen
    for (let i = 0; i < size * size; i++) {
      if (state[i] !== 2) continue;
      const b = this.blockedBy(state, i);
      if (b.length) return { tier: 0, kind: 'x', cells: b, focus: [i], text: `Diese Felder sind durch ${W.acc} blockiert: gleiche Zeile, Spalte oder Farbe – oder direkt daneben.` };
    }
    // Tier 1: Einheit mit nur einem freien Feld
    for (const u of this.units) {
      if (this.unitHasCat(state, u)) continue;
      const c = this.candidates(state, u);
      if (c.length === 1) return { tier: 1, kind: 'cat', cells: c, focus: u.cells, text: `In ${unitLabel(u)} ist nur noch ein Feld frei – hier muss ${W.nom} hin.` };
    }
    if (maxTier < 2) return null;
    // Tier 2: Region liegt komplett in einer Zeile/Spalte (und umgekehrt)
    const lines = this.units.filter((u) => u.type !== 'region');
    const regs = this.units.filter((u) => u.type === 'region');
    for (const k of [1]) {
      const r = this.groupStep(state, regs, lines, k, 2); if (r) return r;
      const r2 = this.groupStep(state, lines, regs, k, 2); if (r2) return r2;
    }
    // Tier 3: Katze hier würde eine Einheit komplett blockieren
    if (maxTier < 3) return null;
    for (let i = 0; i < size * size; i++) {
      if (state[i] !== 0) continue;
      const u = this.catKillsUnit(state, i);
      if (u) return { tier: 3, kind: 'x', cells: [i], focus: u.cells.concat([i]), text: `${W.Indef} hier würde alle freien Felder von ${unitLabel(u)} blockieren.` };
    }
    // Tier 4: k Regionen in k Zeilen/Spalten (k = 2,3)
    if (maxTier < 4) return null;
    for (const k of [2, 3]) {
      if (k >= size - 1) break;
      const r = this.groupStep(state, regs, lines, k, 4); if (r) return r;
      const r2 = this.groupStep(state, lines, regs, k, 4); if (r2) return r2;
    }
    // Tier 5: Widerspruch durch Kette
    if (maxTier < 5) return null;
    for (let i = 0; i < size * size; i++) {
      if (state[i] !== 0) continue;
      const s = state.slice();
      s[i] = 2;
      for (const b of this.blockedBy(s, i)) s[b] = 1;
      if (!this.propagate(s)) return { tier: 5, kind: 'x', cells: [i], focus: [i], text: `${W.Indef} hier führt nach ein paar Schritten zu einem Widerspruch.` };
    }
    return null;
  };

  // k Einheiten aus "sources" liegen vollständig in k Einheiten aus "targets" →
  // alle anderen Felder dieser Ziel-Einheiten können keine Katze haben.
  Logic.prototype.groupStep = function (state, sources, targets, k, tier) {
    const open = sources.filter((u) => !this.unitHasCat(state, u) && this.candidates(state, u).length);
    const openT = targets.filter((u) => !this.unitHasCat(state, u));
    const cellTargets = (i, type) => openT.filter((t) => t.type === type && t.cells.includes(i));
    for (const type of new Set(openT.map((t) => t.type))) {
      for (const group of combos(open, k)) {
        const cand = group.flatMap((u) => this.candidates(state, u));
        const ts = new Set();
        let ok = true;
        for (const i of cand) {
          const t = cellTargets(i, type);
          if (!t.length) { ok = false; break; }
          t.forEach((x) => ts.add(x));
          if (ts.size > k) { ok = false; break; }
        }
        if (!ok || ts.size !== k) continue;
        const inGroup = new Set(cand);
        const groupCells = new Set(group.flatMap((u) => u.cells));
        const elim = [];
        for (const t of ts) for (const i of t.cells) if (state[i] === 0 && !inGroup.has(i) && !groupCells.has(i)) elim.push(i);
        if (!elim.length) continue;
        const tsArr = [...ts];
        let text;
        if (k === 1) {
          const src = group[0], tgt = tsArr[0];
          text = src.type === 'region'
            ? `Diese Farbe liegt nur noch in ${unitLabel(tgt)} – deshalb kann sonst nirgends in ${unitLabel(tgt)} ${W.indef} sein.`
            : `Alle freien Felder von ${unitLabel(src)} liegen in einer Farbe – deshalb kann der Rest dieser Farbe ${W.negAcc} haben.`;
        } else {
          text = group[0].type === 'region'
            ? `${k} Farben passen nur noch in ${k} ${tgtName(tsArr[0].type, k)} – dort ist für andere Farben kein Platz.`
            : `${k} ${tgtName(group[0].type, k)} haben ihre freien Felder nur in ${k} Farben – der Rest dieser Farben fällt weg.`;
        }
        return { tier, kind: 'x', cells: [...new Set(elim)], focus: [...groupCells], text };
      }
    }
    return null;
  };
  function tgtName(type, k) { return type === 'row' ? (k > 1 ? 'Zeilen' : 'Zeile') : type === 'col' ? (k > 1 ? 'Spalten' : 'Spalte') : 'Farben'; }

  // Löst rein logisch; liefert höchste benötigte Stufe oder -1 wenn steckengeblieben.
  Logic.prototype.grade = function (maxTier = 5) {
    const N = this.size * this.size, state = new Array(N).fill(0);
    let hardest = 0, steps = 0;
    for (let guard = 0; guard < N * 4; guard++) {
      if (state.filter((v) => v === 2).length === this.size) return { tier: hardest, steps };
      const st = this.nextStep(state, maxTier);
      if (!st) return { tier: -1, steps };
      hardest = Math.max(hardest, st.tier);
      if (st.tier >= 2) steps++;
      for (const i of st.cells) state[i] = st.kind === 'cat' ? 2 : 1;
    }
    return { tier: -1, steps };
  };

  // ---------- Generator ----------
  // Nach vielen Fehlversuchen werden 1-Feld-Regionen doch erlaubt.
  const attemptAllowsSingles = (attempt) => attempt > 200;
  function generate(size, seed, opts = {}) {
    const minTier = opts.minTier ?? 0, maxTier = opts.maxTier ?? 5;
    const rnd = mulberry32(seed);
    let fallback = null;
    const deadline = Date.now() + (opts.timeLimit ?? 1500);
    for (let attempt = 0; attempt < 300; attempt++) {
      const queens = randomQueens(size, rnd);
      const regions = growRegions(size, queens, rnd);
      if (!makeUnique(size, regions, queens, rnd)) continue;
      if (opts.noSingles && !attemptAllowsSingles(attempt)) {
        const counts = new Array(size).fill(0);
        for (const g of regions) counts[g]++;
        if (counts.some((c) => c < 2)) continue;
      }
      const sol = solve(size, regions, 1)[0];
      const logic = new Logic(size, Array.from(regions));
      const g = logic.grade(maxTier);
      const level = { size, regions: Array.from(regions), solution: sol.map((c, r) => r * size + c), tier: g.tier };
      if (g.tier >= minTier && g.tier !== -1) { level.colors = pickColors(size, level.regions, size, rnd); return level; }
      if (g.tier !== -1 && (!fallback || g.tier > fallback.tier)) fallback = level;
      if (Date.now() > deadline && fallback) break;
    }
    if (!fallback) return generate(size, seed + 1, opts);
    fallback.colors = pickColors(size, fallback.regions, size, rnd);
    return fallback;
  }

  global.MeowEngine = { generate, solve, Logic, setWords, mulberry32, hashString, PALETTE, makeGeometry };
  if (typeof module !== 'undefined') module.exports = global.MeowEngine;
})(typeof window !== 'undefined' ? window : globalThis);
