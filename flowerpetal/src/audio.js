// Synthesized audio — WebAudio, no assets. Safe to call before user gesture;
// the AudioContext is created lazily on first initAudio().
//
// Includes a generative ambient pad: a slow crossfading chord drone plus
// sparse pentatonic "sparkles". Everything is synthesized at runtime, so
// there are no audio files, no licenses, no attribution — royalty-free by
// construction.

let ctx = null;
let master = null;
let ambientGain = null;
let ambientFilter = null;
let analyser = null;
let muted = false;
let ambientEnabled = false;
let ambientLive = false; // voices actually sounding right now
let ambientTimers = [];
let ambientVoices = new Set(); // { osc, g, stop }
let chordArmed = false; // a chord chain is scheduled
let sparkArmed = false; // a sparkle chain is scheduled
let lfo = null;

// Slow, spacey chord cycle (each entry: array of frequencies in Hz).
// Voices drift between m9 / add9 / maj7 colour in a C-major-ish family.
const AMBIENT_CHORDS = [
  [146.83, 220.0, 349.23, 440.0],   // D3 A3 F4 A4
  [130.81, 261.63, 392.0, 493.88],  // C3 C4 G4 B4
  [110.0, 220.0, 329.63, 493.88],   // A2 A3 E4 B4
  [174.61, 261.63, 349.23, 440.0],  // F3 C4 F4 A4
];
const CHORD_S = 26;
const CROSSFADE_S = 4;

// C major pentatonic, high register (Hz).
const SPARKLE_NOTES = [523.25, 587.33, 659.25, 783.99, 880.0, 987.77, 1046.5];

export function initAudio() {
  if (ctx) return getApi();
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.75;
    master.connect(ctx.destination);

    // Ambient bus: lowpass for a soft wash, straight into the master.
    ambientGain = ctx.createGain();
    ambientGain.gain.value = 0.0;
    ambientFilter = ctx.createBiquadFilter();
    ambientFilter.type = 'lowpass';
    ambientFilter.frequency.value = 1000;
    ambientFilter.Q.value = 0.4;
    ambientGain.connect(ambientFilter).connect(master);

    // Analyser taps the master so we can prove sound is flowing.
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    master.connect(analyser);
  } catch (e) {
    ctx = null;
    return null;
  }
  return getApi();
}

function rmsDb() {
  if (!analyser) return -Infinity;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / data.length);
  return 20 * Math.log10(rms + 1e-9);
}

// --- ambient engine ---------------------------------------------------

function spawnChord(freqs, startAt) {
  for (const f of freqs) {
    // Two detuned sine voices per pitch (gentle chorus).
    for (const detune of [-3.5, 3.5]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      osc.detune.value = detune;
      const g = ctx.createGain();
      const amp = 0.11 / Math.sqrt(freqs.length);
      g.gain.setValueAtTime(0.0001, startAt);
      g.gain.exponentialRampToValueAtTime(amp, startAt + CROSSFADE_S);
      g.gain.setValueAtTime(amp, startAt + CHORD_S - 1);
      g.gain.exponentialRampToValueAtTime(0.0001, startAt + CHORD_S + 1);
      osc.connect(g).connect(ambientFilter);
      osc.start(startAt);
      osc.stop(startAt + CHORD_S + 3);
      ambientVoices.add({ osc, g, stop: startAt + CHORD_S + 3 });
    }
    // Faint overtone an octave up for airiness.
    const hi = ctx.createOscillator();
    hi.type = 'sine';
    hi.frequency.value = f * 2;
    const hg = ctx.createGain();
    const hamp = 0.03 / Math.sqrt(freqs.length);
    hg.gain.setValueAtTime(0.0001, startAt);
    hg.gain.exponentialRampToValueAtTime(hamp, startAt + CROSSFADE_S);
    hg.gain.setValueAtTime(hamp, startAt + CHORD_S - 1);
    hg.gain.exponentialRampToValueAtTime(0.0001, startAt + CHORD_S + 1);
    hi.connect(hg).connect(ambientFilter);
    hi.start(startAt);
    hi.stop(startAt + CHORD_S + 3);
    ambientVoices.add({ osc: hi, g: hg, stop: startAt + CHORD_S + 3 });
  }
}

// Advance the chord cycle forever while ambient is live and unmuted.
function scheduleChord(idx, startAt) {
  if (!ambientEnabled) return;
  spawnChord(AMBIENT_CHORDS[idx % AMBIENT_CHORDS.length], startAt);
  const next = ctx.currentTime + (CHORD_S - CROSSFADE_S);
  const timer = setTimeout(
    () => {
      if (!ambientEnabled || muted) return; // chain pauses while muted
      scheduleChord(idx + 1, Math.max(ctx.currentTime + 0.3, next));
    },
    (CHORD_S - CROSSFADE_S) * 1000
  );
  ambientTimers.push(timer);
}

// Sparse high sparkle bells, self-rescheduling.
function scheduleSparkle() {
  if (!ambientEnabled) return;
  const delay = 2500 + Math.random() * 5000;
  const timer = setTimeout(
    () => {
      if (!ambientEnabled || muted) return;
      const t = ctx.currentTime;
      const base = SPARKLE_NOTES[Math.floor(Math.random() * SPARKLE_NOTES.length)];
      const interval = Math.random() < 0.35 ? 7 : 0;
      for (const semi of [0, interval]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = base * Math.pow(2, semi / 12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
        osc.connect(g).connect(ambientGain);
        osc.start(t);
        osc.stop(t + 5);
        ambientVoices.add({ osc, g, stop: t + 5.2 });
      }
      scheduleSparkle();
    },
    delay
  );
  ambientTimers.push(timer);
}

function startBreathing() {
  if (!ctx || lfo) return;
  lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07; // ~14s cycle
  const lg = ctx.createGain();
  lg.gain.value = 0.16;
  lfo.connect(lg).connect(ambientGain.gain);
  lfo.start();
}

function stopBreathing() {
  if (lfo) {
    try {
      lfo.stop();
      lfo.disconnect();
    } catch { /* already stopped */ }
    lfo = null;
  }
}

function clearSchedules() {
  for (const t of ambientTimers) clearTimeout(t);
  ambientTimers = [];
  chordArmed = false;
  sparkArmed = false;
}

// Fade out every live ambient voice quickly.
function hushAmbient(sec = 0.4) {
  if (!ctx || !ambientGain) return;
  const t = ctx.currentTime;
  ambientGain.gain.cancelScheduledValues(t);
  ambientGain.gain.setTargetAtTime(0.0, t, Math.max(0.02, sec / 3));
  for (const v of ambientVoices) {
    try {
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setTargetAtTime(0.0001, t, Math.max(0.02, sec / 3));
      v.osc.stop(t + 0.5); // physically end the oscillator instead of letting it ring
    } catch { /* gone */ }
  }
  ambientVoices.clear();
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
    // Start the pad. Call after a user gesture (autoplay policy).
    startAmbient() {
      if (!ctx || ambientEnabled) return;
      ambientEnabled = true;
      if (muted) return; // it will fade in when unmuted
      this.resumeAmbient();
    },
    // Bring the pad up AFTER the context is definitely running. A suspended
    // context has a frozen currentTime until resume() resolves; scheduling
    // voices before that would misplace every timestamp.
    async resumeAmbient() {
      if (!ctx || !ambientEnabled || muted) return;
      try {
        if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
          await ctx.resume();
        }
      } catch {
        /* resume can reject; scheduling clamps to now anyway */
      }
      const t = ctx.currentTime;
      ambientGain.gain.cancelScheduledValues(t);
      ambientGain.gain.setTargetAtTime(0.55, t, 1.2);
      startBreathing();
      if (!ambientLive) {
        ambientLive = true;
        spawnChord(AMBIENT_CHORDS[0], t + 0.5);
      }
      if (!chordArmed) {
        chordArmed = true;
        scheduleChord(1, t + (CHORD_S - CROSSFADE_S) + 0.5);
      }
      if (!sparkArmed) {
        sparkArmed = true;
        scheduleSparkle();
      }
    },
    stopAmbient() {
      ambientEnabled = false;
      clearSchedules();
      stopBreathing();
      hushAmbient(0.5);
      ambientLive = false;
    },
    setMuted(m) {
      const was = muted;
      muted = m;
      if (m) {
        clearSchedules(); // pause the chains; they re-arm on unmute
        hushAmbient(0.3);
      } else if (was && ambientEnabled) {
        this.resumeAmbient();
      }
    },
    get ambientRunning() {
      return ambientEnabled && ambientLive && !muted;
    },
    stats() {
      return {
        state: ctx ? ctx.state : 'none',
        voices: ambientVoices.size,
        ambientEnabled,
        ambientLive,
        muted,
        running: !!ctx && ambientEnabled && ambientLive && !muted,
        rmsDb: rmsDb(),
      };
    },
  };
}