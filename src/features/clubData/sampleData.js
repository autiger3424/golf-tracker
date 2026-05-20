// Generates a synthetic TrackMan-format CSV for a competitive junior golfer.
// Designed to exercise every code path: importer, club normalizer, outlier
// filter, dispersion stats, trend charts, stale-data flag, low-sample warning.
//
// We deliberately emit a CSV string (not StandardShot[]) so the data flows
// through trackmanImporter exactly like a real import. If the importer
// breaks, the "Load Sample Data" button will surface it.

// ── Seeded RNG (Mulberry32) — reproducible across loads ─────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal via Box-Muller.
function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Per-club profile: realistic carry/total/spin/etc for a competitive junior.
// carryMu = mean carry, carrySigma = std dev (longitudinal),
// sideSigma = lateral std dev. sideMu drives the natural ~2-3y draw bias.
const PROFILES = {
  Driver:  { carryMu: 245, carrySigma: 9,  rollout: 25, sideMu: -2.5, sideSigma: 12, clubSpeed: 108, smashMu: 1.49, smashSig: 0.02, launch: 12, spin: 2400, apex: 95, attack: 2,   path: 1,  face: -1 },
  '3W':    { carryMu: 220, carrySigma: 8,  rollout: 18, sideMu: -2.0, sideSigma: 9,  clubSpeed: 102, smashMu: 1.46, smashSig: 0.02, launch: 11, spin: 3200, apex: 85, attack: -1,  path: 1,  face: -1 },
  '4H':    { carryMu: 205, carrySigma: 7,  rollout: 15, sideMu: -2.0, sideSigma: 8,  clubSpeed: 98,  smashMu: 1.44, smashSig: 0.02, launch: 13, spin: 4100, apex: 90, attack: -2,  path: 1,  face: -1 },
  '5i':    { carryMu: 188, carrySigma: 6,  rollout: 12, sideMu: -2.5, sideSigma: 7,  clubSpeed: 93,  smashMu: 1.38, smashSig: 0.02, launch: 14, spin: 5200, apex: 95, attack: -3,  path: 1,  face: -1 },
  '6i':    { carryMu: 175, carrySigma: 6,  rollout: 10, sideMu: -2.0, sideSigma: 6,  clubSpeed: 90,  smashMu: 1.37, smashSig: 0.02, launch: 15, spin: 5700, apex: 98, attack: -3,  path: 1,  face: -1 },
  '7i':    { carryMu: 162, carrySigma: 5,  rollout: 8,  sideMu: -2.5, sideSigma: 6,  clubSpeed: 87,  smashMu: 1.36, smashSig: 0.02, launch: 16, spin: 6500, apex: 100, attack: -4, path: 1,  face: -1 },
  '8i':    { carryMu: 150, carrySigma: 5,  rollout: 6,  sideMu: -2.0, sideSigma: 5,  clubSpeed: 84,  smashMu: 1.35, smashSig: 0.02, launch: 18, spin: 7300, apex: 102, attack: -4, path: 1,  face: -1 },
  '9i':    { carryMu: 137, carrySigma: 5,  rollout: 5,  sideMu: -2.0, sideSigma: 5,  clubSpeed: 81,  smashMu: 1.33, smashSig: 0.02, launch: 21, spin: 8200, apex: 104, attack: -5, path: 1,  face: -1 },
  PW:      { carryMu: 125, carrySigma: 4,  rollout: 4,  sideMu: -1.5, sideSigma: 4,  clubSpeed: 78,  smashMu: 1.30, smashSig: 0.025, launch: 24, spin: 9000, apex: 102, attack: -5, path: 0,  face: 0  },
  GW:      { carryMu: 110, carrySigma: 4,  rollout: 3,  sideMu: -1.0, sideSigma: 4,  clubSpeed: 74,  smashMu: 1.28, smashSig: 0.025, launch: 26, spin: 9600, apex: 100, attack: -5, path: 0,  face: 0  },
  SW:      { carryMu: 90,  carrySigma: 4,  rollout: 2,  sideMu: -1.0, sideSigma: 4,  clubSpeed: 70,  smashMu: 1.26, smashSig: 0.025, launch: 28, spin: 10200, apex: 95, attack: -5, path: 0,  face: 0  },
  LW:      { carryMu: 70,  carrySigma: 4,  rollout: 2,  sideMu: -0.5, sideSigma: 4,  clubSpeed: 64,  smashMu: 1.25, smashSig: 0.025, launch: 32, spin: 10800, apex: 85, attack: -5, path: 0,  face: 0  },
};

// Driver, 3W, 4H, 5i..9i, PW, GW, SW, LW — the enumerated junior bag from spec.
const BAG = ['Driver', '3W', '4H', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW'];

// 4 sessions across ~8 weeks. Most-recent session ~3 days ago so the bag
// summary doesn't all look stale immediately.
function buildSessions(now) {
  const oneDay = 24 * 60 * 60 * 1000;
  // Days-ago for each session, oldest first.
  // Oldest > 60d so the 4H-only-from-oldest-session club triggers both the
  // BagSummary red stale flag (>60d) and the TournamentCard gray-out.
  const daysAgo = [68, 38, 22, 4];
  return daysAgo.map(d => new Date(now.getTime() - d * oneDay));
}

function clip(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// Generate one shot's raw values from a profile + RNG.
function generateShot(rng, profile, options = {}) {
  const isMishit = options.isMishit;
  const carry = profile.carryMu + gaussian(rng) * profile.carrySigma;
  const side = profile.sideMu + gaussian(rng) * profile.sideSigma;
  const clubSpeed = profile.clubSpeed + gaussian(rng) * 1.5;
  let smashFactor;
  if (isMishit) {
    // Force smash below the floor so the outlier filter has work to do.
    // Wedge floor 1.20, iron 1.30, hybrid/fairway 1.40, driver 1.45 — drop ~0.10 below floor.
    const floor = profile.smashMu - 0.18;
    smashFactor = clip(floor + (rng() - 0.5) * 0.06, 0.85, 1.18);
  } else {
    smashFactor = profile.smashMu + gaussian(rng) * profile.smashSig;
  }
  const ballSpeed = clubSpeed * smashFactor;
  const launch = profile.launch + gaussian(rng) * 0.8;
  const spin = profile.spin + gaussian(rng) * 250;
  const apex = profile.apex + gaussian(rng) * 4;
  const attack = profile.attack + gaussian(rng) * 0.6;
  const path = profile.path + gaussian(rng) * 0.8;
  const face = profile.face + gaussian(rng) * 1.0;
  // Total = carry + roll. For mishits, kill the carry and total.
  const carryFinal = isMishit ? carry * 0.65 : carry;
  const total = carryFinal + profile.rollout * (isMishit ? 0.4 : 1) + gaussian(rng) * 2;
  return {
    Carry: Math.round(carryFinal * 10) / 10,
    Total: Math.round(total * 10) / 10,
    Side: Math.round(side * 10) / 10,
    'Ball Speed': Math.round(ballSpeed * 10) / 10,
    'Club Speed': Math.round(clubSpeed * 10) / 10,
    'Smash Factor': Math.round(smashFactor * 1000) / 1000,
    'Launch Angle': Math.round(launch * 10) / 10,
    'Spin Rate': Math.round(spin),
    'Spin Axis': Math.round((face - path) * 5 * 10) / 10, // crude proxy: ~negative when face left of path
    'Max Height': Math.round(apex),
    'Landing Angle': Math.round((40 + (apex - 90) * 0.1) * 10) / 10,
    'Descent Angle': Math.round((42 + (apex - 90) * 0.1) * 10) / 10,
    'Club Path': Math.round(path * 10) / 10,
    'Face Angle': Math.round(face * 10) / 10,
    'Face to Path': Math.round((face - path) * 10) / 10,
    'Attack Angle': Math.round(attack * 10) / 10,
    'Dynamic Loft': Math.round((launch + 4) * 10) / 10,
  };
}

// CSV escape (quote any cell containing comma/quote/newline).
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Build the full CSV. Headers chosen to match what TrackMan exports.
export function generateSampleCsv(seed = 42, now = new Date()) {
  const rng = mulberry32(seed);
  const sessions = buildSessions(now);
  const rows = [];

  // Special clubs (per spec):
  //   - 6i: only ~8 shots total (low-sample warning)
  //   - 4H: data only from the OLDEST session (stale-data flag)
  //   - everything else: ~30-40 shots/club spread evenly across sessions
  const shotsPerClubPerSession = {}; // club → [n0, n1, n2, n3]
  for (const club of BAG) {
    if (club === '6i') {
      shotsPerClubPerSession[club] = [0, 0, 0, 8]; // only most recent session, but only 8 shots
    } else if (club === '4H') {
      shotsPerClubPerSession[club] = [32, 0, 0, 0]; // only oldest session → stale
    } else {
      // 30-40 shots split across the 4 sessions
      const total = 30 + Math.floor(rng() * 11); // 30..40
      const perSession = Math.floor(total / 4);
      const remainder = total - perSession * 4;
      shotsPerClubPerSession[club] = [perSession, perSession, perSession, perSession];
      // Distribute remainder to later sessions (so trend has gentle drift)
      for (let i = 0; i < remainder; i++) {
        shotsPerClubPerSession[club][3 - i] += 1;
      }
    }
  }

  // Generate shots
  for (let sIdx = 0; sIdx < sessions.length; sIdx++) {
    const sessionStart = sessions[sIdx];
    let timeCursor = sessionStart.getTime();

    for (const club of BAG) {
      const profile = PROFILES[club];
      if (!profile) continue;
      const n = shotsPerClubPerSession[club][sIdx] || 0;
      for (let i = 0; i < n; i++) {
        // ~5% mishits across all shots
        const isMishit = rng() < 0.05;
        const baseShot = generateShot(rng, profile, { isMishit });
        // Each shot ~45-90 seconds apart
        timeCursor += 45000 + Math.floor(rng() * 45000);
        rows.push({
          Date: new Date(timeCursor).toISOString(),
          Club: club,
          ...baseShot,
        });
      }
    }
  }

  // Shuffle rows within a session ordering? Keep chronological — TrackMan
  // exports are in capture order, so it's most realistic to leave them.

  // Build CSV
  const headers = [
    'Date', 'Club',
    'Carry', 'Total', 'Side',
    'Ball Speed', 'Club Speed', 'Smash Factor',
    'Launch Angle', 'Spin Rate', 'Spin Axis',
    'Max Height', 'Landing Angle', 'Descent Angle',
    'Club Path', 'Face Angle', 'Face to Path',
    'Attack Angle', 'Dynamic Loft',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => csvCell(row[h])).join(','));
  }
  return lines.join('\n');
}

// Build one synthetic CSV per session date — caller imports each as its own
// session so the sessions collection in Firestore reflects 4 distinct
// imports (better mirrors how a real user would feed data in).
export function generateSampleSessions(seed = 42, now = new Date()) {
  const sessions = buildSessions(now);
  const baseRng = mulberry32(seed);
  const out = [];

  for (let sIdx = 0; sIdx < sessions.length; sIdx++) {
    const sessionDate = sessions[sIdx];
    // Re-seed each session so a session's contents are stable even if you
    // change another session.
    const sessionSeed = (seed * 7919 + sIdx * 31337) >>> 0;
    const rng = mulberry32(sessionSeed);
    let timeCursor = sessionDate.getTime();
    const rows = [];

    for (const club of BAG) {
      const profile = PROFILES[club];
      if (!profile) continue;
      // Same per-session distribution rules as generateSampleCsv
      let n;
      if (club === '6i') {
        n = sIdx === 3 ? 8 : 0;
      } else if (club === '4H') {
        n = sIdx === 0 ? 32 : 0;
      } else {
        // Stable per-club total across sessions
        const totalRng = mulberry32((seed ^ (club.charCodeAt(0) * 1009)) >>> 0);
        const total = 30 + Math.floor(totalRng() * 11);
        const base = Math.floor(total / 4);
        const remainder = total - base * 4;
        n = base + (sIdx >= 4 - remainder ? 1 : 0);
      }

      for (let i = 0; i < n; i++) {
        const isMishit = rng() < 0.05;
        const baseShot = generateShot(rng, profile, { isMishit });
        timeCursor += 45000 + Math.floor(rng() * 45000);
        rows.push({
          Date: new Date(timeCursor).toISOString(),
          Club: club,
          ...baseShot,
        });
      }
    }

    const headers = [
      'Date', 'Club',
      'Carry', 'Total', 'Side',
      'Ball Speed', 'Club Speed', 'Smash Factor',
      'Launch Angle', 'Spin Rate', 'Spin Axis',
      'Max Height', 'Landing Angle', 'Descent Angle',
      'Club Path', 'Face Angle', 'Face to Path',
      'Attack Angle', 'Dynamic Loft',
    ];
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map(h => csvCell(row[h])).join(','));
    }
    out.push({
      sessionDate: sessionDate.toISOString(),
      csv: lines.join('\n'),
    });
    // Consume some entropy from baseRng so re-runs are stable
    baseRng();
  }
  return out;
}
