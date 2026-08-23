// Pure run lifecycle: five meadow stops between flight phases, ending in a
// bouquet ceremony. A run replaces the endless loop — after the last stop the
// player drifts into the finale. No three.js, DOM, or WebAudio.

export const TOTAL_STOPS = 5;

// A full game is a session of up to five stages; each stage ends with one
// postcard in the album.
export const TOTAL_STAGES = 3;

export const PHASES = ['FLYING', 'STOPPING', 'DRIFTING', 'CEREMONY', 'DONE'];

export function createRun(seed) {
  return { seed: seed >>> 0, phase: 'FLYING', stopsDone: 0, picks: [] };
}

function assertPhase(run, expected) {
  if (!run || run.phase !== expected) {
    throw new Error(`expected phase ${expected}, got ${run ? run.phase : String(run)}`);
  }
}

// Flight arrives at a meadow clearing; the world pauses and choices appear.
export function reachStop(run) {
  assertPhase(run, 'FLYING');
  return { ...run, phase: 'STOPPING' };
}

// Ben commits one flower. choices is the array of ids offered at this stop
// (flowers.sampleChoices). After the final pick the run drifts into the end.
export function commitPick(run, flowerId, choices) {
  assertPhase(run, 'STOPPING');
  if (!Array.isArray(choices) || !choices.includes(flowerId)) {
    throw new Error('picked flower must be one of the offered choices');
  }
  const picks = run.picks.concat(flowerId);
  const stopsDone = run.stopsDone + 1;
  const phase = stopsDone >= TOTAL_STOPS ? 'DRIFTING' : 'FLYING';
  return { ...run, phase, stopsDone, picks };
}

// The final glide has played out; the bouquet ceremony overlay begins.
export function beginCeremony(run) {
  assertPhase(run, 'DRIFTING');
  return { ...run, phase: 'CEREMONY' };
}

// Ceremony completes. finishedAt (ms epoch) is passed in so purity holds.
export function finishCeremony(run, finishedAt) {
  assertPhase(run, 'CEREMONY');
  return {
    ...run,
    phase: 'DONE',
    bouquet: {
      seed: run.seed,
      picks: [...run.picks],
      finishedAt: typeof finishedAt === 'number' ? finishedAt : null,
    },
  };
}
