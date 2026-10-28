/* BusFieber – Sound & Vibration */
(function (global) {
  'use strict';

  // Freie Sounds (CC0) – Herkunft siehe assets/sfx/CREDITS.md
  const FILES = {
    click: 'click', blocked: 'wrong', go: 'enter', board: 'x', full: 'combo2', depart: 'combo3',
    win: 'win', fail: 'fail', booster: 'hint', dialog: 'dialog', nobay: 'unx'
  };
  const url = (n) => `assets/sfx/${n}.m4a`;

  let ctx = null, buffers = {}, useElements = false, unlocked = false;
  const elements = {};
  let bgm = null;
  const settings = { sound: true, music: false };

  function initContext() {
    if (ctx || useElements) return;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC || location.protocol === 'file:') { useElements = true; return; }
    ctx = new AC();
    for (const [key, name] of Object.entries(FILES)) {
      fetch(url(name))
        .then((r) => r.arrayBuffer())
        .then((b) => new Promise((res, rej) => ctx.decodeAudioData(b, res, rej)))
        .then((buf) => { buffers[key] = buf; })
        .catch(() => { useElements = true; });
    }
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    initContext();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    if (settings.music) startMusic();
  }

  function play(key, volume = 1) {
    if (!settings.sound) return;
    initContext();
    if (ctx && buffers[key] && !useElements) {
      if (ctx.state === 'suspended') ctx.resume();
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = volume;
      src.buffer = buffers[key];
      src.connect(gain).connect(ctx.destination);
      src.start();
      return;
    }
    let pool = elements[key];
    if (!pool) pool = elements[key] = [];
    let el = pool.find((a) => a.paused || a.ended);
    if (!el && pool.length < 4) { el = new Audio(url(FILES[key])); pool.push(el); }
    if (!el) return;
    el.volume = volume;
    try { el.currentTime = 0; } catch (e) { /* noch nicht geladen */ }
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
  }

  function startMusic() {
    if (!bgm) { bgm = new Audio('assets/sfx/music.m4a'); bgm.loop = true; bgm.volume = 0.35; }
    const p = bgm.play();
    if (p && p.catch) p.catch(() => {});
  }
  function stopMusic() { if (bgm) bgm.pause(); }

  function configure(s) {
    settings.sound = !!s.sound;
    const musicChanged = settings.music !== !!s.music;
    settings.music = !!s.music;
    if (musicChanged && unlocked) (settings.music ? startMusic() : stopMusic());
  }

  let vibrateOn = true;
  function vibrate(pattern) { if (vibrateOn && navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* egal */ } } }

  document.addEventListener('visibilitychange', () => {
    if (!bgm) return;
    if (document.hidden) bgm.pause(); else if (settings.music && unlocked) startMusic();
  });

  global.BusSound = {
    play, unlock, configure, vibrate,
    setVibrate(v) { vibrateOn = !!v; }
  };
})(window);
