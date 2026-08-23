// Synthesized audio — WebAudio, no assets. Safe to call before user gesture;
// the AudioContext is created lazily on first initAudio().

let ctx = null;
let master = null;
let muted = false;
let started = false;

export function initAudio() {
  if (ctx) return getApi();
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  } catch (e) {
    ctx = null;
    return null;
  }
  return getApi();
}

function getApi() {
  return {
    chime(freq) {
      if (!ctx || muted) return;
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.65);
    },
    bloomChord() {
      if (!ctx || muted) return;
      if (ctx.state === 'suspended') ctx.resume();
      const base = 261.63; // C4
      [0, 4, 7, 12].forEach((semi, i) => {
        const t = ctx.currentTime + i * 0.08;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = base * Math.pow(2, semi / 12);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        osc.connect(gain).connect(master);
        osc.start(t);
        osc.stop(t + 1.7);
      });
    },
    setMuted(m) {
      muted = m;
    },
    get state() {
      return ctx ? ctx.state : 'none';
    },
  };
}