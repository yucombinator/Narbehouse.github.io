import { CRUISE_SPEED, MAX_BANK_DEG } from './trail.js?v=2';

export const MAX_BANK_RAD = (MAX_BANK_DEG * Math.PI) / 180;

// Advance the petal one step. Constant speed; bank eases toward the held
// direction's max, back to level on release; both held = straight.
export function advance(state, dt, cfg, left, right) {
  const {
    speed = CRUISE_SPEED,
    maxBankRad = MAX_BANK_RAD,
    bankRate = 3,
    levelRate = 1.8,
  } = cfg || {};
  	const steer = (right ? 1 : 0) - (left ? 1 : 0); // -1 left (bank negative), +1 right; both = 0
  let bank = state.bank;
  if (steer !== 0) {
    const target = steer * maxBankRad;
    const d = target - bank;
    const maxD = bankRate * dt;
    bank += Math.abs(d) <= maxD ? d : Math.sign(d) * maxD;
  } else {
    const d = -bank;
    const maxD = levelRate * dt;
    bank += Math.abs(d) <= maxD ? d : Math.sign(d) * maxD;
  }
    const heading = Math.sin(bank);            // lateral fraction of speed
  const fwd = Math.cos(bank);                // forward fraction (still > 0 for sane bank)
  // Forward is -z in world space, so the petal gains negative z over time.
  return { x: state.x + speed * heading * dt, z: state.z - speed * fwd * dt, bank };
}