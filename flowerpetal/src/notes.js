// Pure pitch ladder for collection chimes. No three.js, DOM, or WebAudio.

export const PENTATONIC = [0, 2, 4, 7, 9]; // semitone offsets

// Three pentatonic octaves, laid flat so the ladder is strictly ascending;
// the cap note repeats after the ladder is exhausted.
const LADDER = [];
for (let o = 0; o < 3; o++) {
  for (const s of PENTATONIC) LADDER.push(s + 12 * o);
}
const CAP = LADDER[LADDER.length - 1]; // 33 semitones above 220Hz

export function noteFor(stepIndex) {
  const semi = LADDER[Math.min(stepIndex, LADDER.length - 1)];
  return 220 * Math.pow(2, semi / 12);
}