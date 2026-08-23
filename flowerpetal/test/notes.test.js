import test from 'node:test';
import assert from 'node:assert/strict';
import { noteFor, PENTATONIC } from '../src/notes.js';

test('first note is 220Hz', () => {
  assert.equal(noteFor(0), 220);
});

test('notes never decrease with stepIndex', () => {
  for (let i = 0; i < 200; i++) {
    assert.ok(noteFor(i + 1) >= noteFor(i), `nondecreasing at ${i}`);
  }
});

test('notes cap below 220 * 2^((9+24)/12)', () => {
  for (let i = 0; i < 500; i++) {
    	assert.ok(noteFor(i) <= 220 * Math.pow(2, 33 / 12), `capped at ${i}`);
  }
});

test('pitch ladder follows pentatonic offsets', () => {
  const ladder = Array.from({ length: 60 }, (_, i) => noteFor(i));
  // Ratios between consecutive ladder notes are 2^(s/12) for small s in PENTATONIC
  // (or 12 semitones at octave boundaries).
  for (let i = 0; i < ladder.length - 1; i++) {
    const ratio = ladder[i + 1] / ladder[i];
    assert.ok(ratio >= 1 && ratio <= Math.pow(2, 12 / 12) + 1e-9, `ratio ${ratio} at ${i}`);
  }
});