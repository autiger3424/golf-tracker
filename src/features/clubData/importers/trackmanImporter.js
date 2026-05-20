import Papa from 'papaparse';
import { makeShot } from '../types/StandardShot';
import { normalizeClub } from './clubNormalizer';

// The ONLY place in the app that knows TrackMan-specific column names.
// Everything else consumes StandardShot.

// Canonical column name → list of accepted header aliases (compared
// case-insensitively, whitespace/underscores collapsed).
// Add new device importers by mirroring this shape, not by editing
// downstream code.
const COLUMN_ALIASES = {
  club: ['club', 'club name', 'clubname', 'club type'],
  timestamp: ['date', 'time', 'datetime', 'timestamp', 'date time', 'shot time'],
  carryDistance: ['carry', 'carry distance', 'carry (yds)', 'carry yards'],
  totalDistance: ['total', 'total distance', 'total (yds)', 'total yards'],
  sideCarry: ['side', 'side carry', 'side carry (yds)', 'side total', 'lateral', 'offline'],
  ballSpeed: ['ball speed', 'ballspeed', 'ball speed (mph)'],
  clubSpeed: ['club speed', 'clubspeed', 'club head speed', 'club speed (mph)'],
  smashFactor: ['smash factor', 'smash', 'smashfactor'],
  launchAngle: ['launch angle', 'launch', 'launch ang', 'launch (deg)'],
  spinRate: ['spin rate', 'spin', 'spinrate', 'spin (rpm)'],
  spinAxis: ['spin axis', 'spinaxis', 'axis'],
  apexHeight: ['max height', 'maximum height', 'apex', 'apex height', 'height'],
  landingAngle: ['landing angle', 'land angle', 'land ang'],
  descentAngle: ['descent angle', 'descent ang'],
  clubPath: ['club path', 'path', 'clubpath'],
  faceAngle: ['face angle', 'faceangle', 'face'],
  faceToPath: ['face to path', 'face-to-path', 'facetopath'],
  attackAngle: ['attack angle', 'attackangle', 'angle of attack', 'aoa'],
  dynamicLoft: ['dynamic loft', 'dyn loft', 'dynloft'],
};

function normHeader(h) {
  return String(h || '').toLowerCase().replace(/[\s_]+/g, ' ').trim();
}

// Build a lookup: normalized csv header → canonical StandardShot field.
// Returns the mapping plus the lists of matched / missing canonical fields,
// so callers can warn (but not fail) on missing columns.
function buildHeaderMap(headers) {
  const map = {};
  const matched = new Set();
  const aliasIndex = {};
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const a of aliases) aliasIndex[normHeader(a)] = canonical;
  }
  for (const h of headers) {
    const key = normHeader(h);
    if (aliasIndex[key]) {
      map[h] = aliasIndex[key];
      matched.add(aliasIndex[key]);
    }
  }
  const expected = Object.keys(COLUMN_ALIASES);
  const missing = expected.filter(f => !matched.has(f));
  return { map, missing };
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // Strip units that some TrackMan exports include in the cell, e.g. "158 yds"
  const cleaned = String(v).replace(/[^0-9.\-+eE]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function genShotId() {
  return 'sh_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function parseTimestamp(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString();
  return '';
}

/**
 * Parse a TrackMan-format CSV string into StandardShot[].
 *
 * Tolerant:
 *  - Header matching is case-insensitive and ignores whitespace/underscores
 *  - Unknown columns are silently dropped (kept in rawSourceRow for debugging)
 *  - Missing expected columns produce a warning, not a failure
 *  - Rows missing a recognizable club are skipped (counted in result.skipped)
 *
 * @param {string} csvText
 * @param {{ sessionId: string, deviceType?: string }} opts
 * @returns {{
 *   shots: import('../types/StandardShot').StandardShot[],
 *   warnings: string[],
 *   skipped: number,
 *   missingColumns: string[],
 * }}
 */
export function trackmanImporter(csvText, opts) {
  const { sessionId, deviceType = 'trackman' } = opts;
  const warnings = [];
  let skipped = 0;

  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h, // keep original; we map ourselves
  });

  if (parsed.errors && parsed.errors.length) {
    for (const err of parsed.errors.slice(0, 5)) {
      warnings.push(`CSV parse warning row ${err.row}: ${err.message}`);
    }
  }

  const rows = parsed.data || [];
  if (!rows.length) {
    warnings.push('No data rows found in CSV.');
    return { shots: [], warnings, skipped: 0, missingColumns: Object.keys(COLUMN_ALIASES) };
  }

  const headers = Object.keys(rows[0]);
  const { map, missing } = buildHeaderMap(headers);
  if (missing.length) {
    warnings.push(`Unmatched columns (skipping): ${missing.join(', ')}`);
  }

  const shots = [];
  for (const row of rows) {
    // Project the row into canonical fields
    const canonical = {};
    for (const [origHeader, canonicalKey] of Object.entries(map)) {
      canonical[canonicalKey] = row[origHeader];
    }

    const club = normalizeClub(canonical.club);
    if (!club) {
      skipped++;
      continue;
    }

    // smashFactor: derive if missing
    let smashFactor = toNumber(canonical.smashFactor);
    const ballSpeed = toNumber(canonical.ballSpeed);
    const clubSpeed = toNumber(canonical.clubSpeed);
    if (smashFactor === null && ballSpeed !== null && clubSpeed && clubSpeed > 0) {
      smashFactor = parseFloat((ballSpeed / clubSpeed).toFixed(3));
    }

    shots.push(makeShot({
      shotId: genShotId(),
      sessionId,
      timestamp: parseTimestamp(canonical.timestamp),
      club,
      carryDistance: toNumber(canonical.carryDistance),
      totalDistance: toNumber(canonical.totalDistance),
      sideCarry: toNumber(canonical.sideCarry),
      ballSpeed,
      clubSpeed,
      smashFactor,
      launchAngle: toNumber(canonical.launchAngle),
      spinRate: toNumber(canonical.spinRate),
      spinAxis: toNumber(canonical.spinAxis),
      apexHeight: toNumber(canonical.apexHeight),
      landingAngle: toNumber(canonical.landingAngle),
      descentAngle: toNumber(canonical.descentAngle),
      clubPath: toNumber(canonical.clubPath),
      faceAngle: toNumber(canonical.faceAngle),
      faceToPath: toNumber(canonical.faceToPath),
      attackAngle: toNumber(canonical.attackAngle),
      dynamicLoft: toNumber(canonical.dynamicLoft),
      deviceType,
      rawSourceRow: row,
    }));
  }

  if (skipped > 0) {
    warnings.push(`${skipped} row(s) skipped — unrecognized or missing club`);
  }

  return { shots, warnings, skipped, missingColumns: missing };
}

// Exported for tests / debugging
export const _internals = { COLUMN_ALIASES, buildHeaderMap, normHeader };
