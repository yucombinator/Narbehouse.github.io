import test from 'node:test';
import assert from 'node:assert/strict';
import { advance, MAX_BANK_RAD } from '../src/steer.js';

const CFG = { speed: 6, maxBankRad: MAX_BANK_RAD, bankRate: 3, levelRate: 1.8 };

test('holding left banks left and turns x negative', () => {
  let s = { x: 0, z: 0, bank: 0 };
  for (let i = 0; i < 60; i++) s = advance(s, 1 / 60, CFG, true, false);
  assert.ok(s.bank < 0, 'banks left (negative)');
  assert.ok(s.x < 0, 'turns left');
  assert.ok(s.z > 0, 'always advances forward');
});

test('holding right banks right and turns x positive', () => {
  let s = { x: 0, z: 0, bank: 0 };
  for (let i = 0; i < 60; i++) s = advance(s, 1 / 60, CFG, false, true);
  assert.ok(s.bank > 0);
  assert.ok(s.x > 0);
});

test('releasing both straightens the bank toward zero', () => {
  let s = { x: 0, z: 0, bank: -0.5 };
  for (let i = 0; i < 120; i++) s = advance(s, 1 / 60, CFG, false, false);
  assert.ok(Math.abs(s.bank) < 0.02, 'bank returns to level');
});

test('both held = straight', () => {
  let s = { x: 0, z: 0, bank: 0 };
  for (let i = 0; i < 60; i++) s = advance(s, 1 / 60, CFG, true, true);
  assert.ok(Math.abs(s.bank) < 1e-9);
  assert.ok(Math.abs(s.x) < 1e-9);
});

test('bank is clamped to max', () => {
  let s = { x: 0, z: 0, bank: 0 };
  for (let i = 0; i < 600; i++) s = advance(s, 1 / 60, CFG, true, false);
  assert.ok(s.bank >= -CFG.maxBankRad - 1e-9 && s.bank <= 0);
});

test('forward speed is constant regardless of bank', () => {
	const step = (s, l, r) => {
		const a = advance(s, 1 / 60, CFG, l, r);
		return Math.hypot(a.x - s.x, a.z - s.z);
	};
	let straight = { x: 0, z: 0, bank: 0 };
	let banked = { x: 0, z: 0, bank: 0 };
	for (let i = 0; i < 120; i++) {
		assert.ok(Math.abs(step(straight, false, false) - 6 / 60) < 1e-9, 'straight step = speed*dt');
		assert.ok(Math.abs(step(banked, true, false) - 6 / 60) < 1e-9, 'banked step = speed*dt');
		straight = advance(straight, 1 / 60, CFG, false, false);
		banked = advance(banked, 1 / 60, CFG, true, false);
	}
});

test('bank eases toward max, not instantly', () => {
  let s = { x: 0, z: 0, bank: 0 };
  for (let i = 0; i < 10; i++) s = advance(s, 1 / 60, CFG, true, false);
  assert.ok(s.bank > -CFG.maxBankRad, 'bank ramps gradually');
  assert.ok(s.bank < 0);
});