import { CLUB_CATEGORY } from '../types/StandardShot';

// Smash-factor floor by club category. Below this, the shot is considered a
// mishit (thin, chunked, off the toe) and excluded from stats. Floors are
// loose on purpose — we'd rather keep a borderline good shot than drop it.
export const SMASH_FLOORS = {
  wedge: 1.20,
  iron: 1.30,
  hybrid: 1.40,
  fairway: 1.40,
  driver: 1.45,
};

function categoryFor(club) {
  return CLUB_CATEGORY[club] || 'iron'; // unknown → treat as iron
}

// Percentile of an already-sorted ascending array of numbers.
function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const t = idx - lo;
  return sorted[lo] + t * (sorted[hi] - sorted[lo]);
}

/**
 * Apply outlier filtering to a list of StandardShot. Returns a NEW list of
 * shots with `excluded`/`exclusionReason` set on filtered shots.
 *
 * Two-stage filter, per club:
 *   1. Reject shots below the smash-factor floor for that club's category.
 *   2. Of what remains, trim the top and bottom 5% by carry distance.
 *
 * Shots with no smashFactor or no carryDistance are passed through unflagged
 * (we can't judge them — let the user decide).
 *
 * @param {import('../types/StandardShot').StandardShot[]} shots
 * @returns {import('../types/StandardShot').StandardShot[]}
 */
export function applyOutlierFilter(shots) {
  // Group by club
  const byClub = new Map();
  for (const s of shots) {
    if (!byClub.has(s.club)) byClub.set(s.club, []);
    byClub.get(s.club).push(s);
  }

  const out = new Map(); // shotId → flagged copy

  for (const [club, group] of byClub.entries()) {
    const floor = SMASH_FLOORS[categoryFor(club)] ?? 1.30;

    // Stage 1: smash-factor floor
    const stage1 = [];
    for (const s of group) {
      if (s.smashFactor !== null && s.smashFactor !== undefined && s.smashFactor < floor) {
        out.set(s.shotId, {
          ...s,
          excluded: true,
          exclusionReason: `mishit (smash ${s.smashFactor.toFixed(2)} < ${floor})`,
        });
      } else {
        stage1.push(s);
      }
    }

    // Stage 2: trim top/bottom 5% of remaining by carry distance.
    // Only shots that have a carry distance participate; the rest pass through.
    const withCarry = stage1.filter(s => s.carryDistance !== null && s.carryDistance !== undefined);
    const withoutCarry = stage1.filter(s => s.carryDistance === null || s.carryDistance === undefined);

    if (withCarry.length < 20) {
      // Too few shots for percentile trimming to be meaningful — keep all.
      for (const s of stage1) out.set(s.shotId, { ...s, excluded: false, exclusionReason: null });
      continue;
    }

    const sortedCarry = [...withCarry].map(s => s.carryDistance).sort((a, b) => a - b);
    const lo = percentile(sortedCarry, 5);
    const hi = percentile(sortedCarry, 95);

    for (const s of withCarry) {
      if (s.carryDistance < lo) {
        out.set(s.shotId, {
          ...s,
          excluded: true,
          exclusionReason: `carry ${Math.round(s.carryDistance)} below 5th pct (${Math.round(lo)})`,
        });
      } else if (s.carryDistance > hi) {
        out.set(s.shotId, {
          ...s,
          excluded: true,
          exclusionReason: `carry ${Math.round(s.carryDistance)} above 95th pct (${Math.round(hi)})`,
        });
      } else {
        out.set(s.shotId, { ...s, excluded: false, exclusionReason: null });
      }
    }
    for (const s of withoutCarry) out.set(s.shotId, { ...s, excluded: false, exclusionReason: null });
  }

  // Preserve original input order
  return shots.map(s => out.get(s.shotId) || s);
}
