import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOTAL_STOPS,
  PHASES,
  createRun,
  reachStop,
  commitPick,
  beginCeremony,
  finishCeremony,
} from '../src/run.js';

const CHOICES = ['a', 'b', 'c'];

function runThroughStops(n) {
  let run = createRun(42);
  for (let i = 0; i < n; i++) {
    run = commitPick(reachStop(run), CHOICES[i % CHOICES.length], CHOICES);
  }
  return run;
}

test('run constants are as designed', () => {
  assert.equal(TOTAL_STOPS, 5);
  assert.deepEqual(PHASES, ['FLYING', 'STOPPING', 'DRIFTING', 'CEREMONY', 'DONE']);
});

test('a fresh run starts flying with no picks', () => {
  const run = createRun(42);
  assert.equal(run.phase, 'FLYING');
  assert.equal(run.stopsDone, 0);
  assert.deepEqual(run.picks, []);
});

test('reachStop pauses the world', () => {
  assert.equal(reachStop(createRun(42)).phase, 'STOPPING');
  assert.throws(() => reachStop({ ...createRun(42), phase: 'STOPPING' }));
});

test('commitPick records the pick and resumes flight until the last stop', () => {
  let run = createRun(42);
  for (let i = 1; i <= TOTAL_STOPS - 1; i++) {
    run = commitPick(reachStop(run), 'b', CHOICES);
    assert.equal(run.phase, 'FLYING');
    assert.equal(run.stopsDone, i);
    assert.deepEqual(run.picks, Array(i).fill('b').map((_, k) => (k === i - 1 ? 'b' : run.picks[k])));
  }
});

test('the final commit drifts into the ending instead of looping', () => {
  const run = runThroughStops(TOTAL_STOPS);
  assert.equal(run.phase, 'DRIFTING');
  assert.equal(run.stopsDone, TOTAL_STOPS);
  assert.equal(run.picks.length, TOTAL_STOPS);
  // No sixth stop exists.
  assert.throws(() => reachStop(run));
});

test('picked flower must be one of the offered choices', () => {
  const run = reachStop(createRun(42));
  assert.throws(() => commitPick(run, 'not-offered', CHOICES));
  assert.throws(() => commitPick(run, 'a', null));
});

test('ceremony transitions require the drifting phase', () => {
  const done = runThroughStops(TOTAL_STOPS);
  const ceremony = beginCeremony(done);
  assert.equal(ceremony.phase, 'CEREMONY');
  assert.throws(() => beginCeremony(ceremony));
  assert.throws(() => beginCeremony(createRun(42)));
});

test('finishCeremony produces a bouquet record with seed, picks, timestamp', () => {
  let run = runThroughStops(TOTAL_STOPS);
  run = beginCeremony(run);
  run = finishCeremony(run, 1724000000000);
  assert.equal(run.phase, 'DONE');
  assert.deepEqual(run.bouquet.picks, run.picks);
  assert.equal(run.bouquet.seed, 42);
  assert.equal(run.bouquet.finishedAt, 1724000000000);
  assert.throws(() => finishCeremony(run, 1));
});

test('full lifecycle walks every phase exactly once', () => {
  let run = createRun(9);
  const seen = [];
  seen.push(run.phase);
  for (let i = 0; i < TOTAL_STOPS; i++) {
    run = reachStop(run);
    seen.push(run.phase);
    run = commitPick(run, CHOICES[i % CHOICES.length], CHOICES);
    seen.push(run.phase);
  }
  run = beginCeremony(run);
  seen.push(run.phase);
  run = finishCeremony(run, 5);
  seen.push(run.phase);
  assert.deepEqual(seen, [
    'FLYING',
    'STOPPING', 'FLYING',
    'STOPPING', 'FLYING',
    'STOPPING', 'FLYING',
    'STOPPING', 'FLYING',
    'STOPPING',
    'DRIFTING', 'CEREMONY', 'DONE',
  ]);
});
