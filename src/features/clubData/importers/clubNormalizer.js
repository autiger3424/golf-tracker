// Canonicalize free-form club strings ("7 Iron", "Seven", "7-iron") to a
// stable internal name ("7i"). TrackMan exports vary by user — some type
// "Pitching Wedge", some import "PW" from a club library, some use loft
// numbers ("46°"). This is the single source of truth.

const EXPLICIT_MAP = {
  // Driver
  driver: 'Driver',
  d: 'Driver',
  '1w': 'Driver',
  '1-wood': 'Driver',
  '1wood': 'Driver',

  // Fairway woods
  '3w': '3W', '3-wood': '3W', '3wood': '3W', 'threewood': '3W',
  '4w': '4W', '4-wood': '4W', '4wood': '4W',
  '5w': '5W', '5-wood': '5W', '5wood': '5W',
  '7w': '7W', '7-wood': '7W', '7wood': '7W',

  // Hybrids
  '2h': '2H', '2-hybrid': '2H', '2hybrid': '2H',
  '3h': '3H', '3-hybrid': '3H', '3hybrid': '3H',
  '4h': '4H', '4-hybrid': '4H', '4hybrid': '4H',
  '5h': '5H', '5-hybrid': '5H', '5hybrid': '5H',
  '6h': '6H', '6-hybrid': '6H', '6hybrid': '6H',

  // Wedges
  pw: 'PW', p: 'PW', 'pitchingwedge': 'PW', 'pitching-wedge': 'PW', 'pitching wedge': 'PW',
  gw: 'GW', 'gapwedge': 'GW', 'gap-wedge': 'GW', 'gap wedge': 'GW', aw: 'GW', 'approachwedge': 'GW',
  sw: 'SW', 'sandwedge': 'SW', 'sand-wedge': 'SW', 'sand wedge': 'SW',
  lw: 'LW', 'lobwedge': 'LW', 'lob-wedge': 'LW', 'lob wedge': 'LW',
};

const WORD_NUMBERS = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};

// Map club lofts (degrees) → canonical name. Used when a TrackMan export
// dumps just the loft in the club column.
function loftToClub(loft) {
  if (loft >= 8 && loft <= 12) return 'Driver';
  if (loft >= 13 && loft <= 16) return '3W';
  if (loft >= 16 && loft <= 19) return '5W';
  if (loft >= 19 && loft <= 22) return '7W';
  if (loft >= 18 && loft <= 21) return '3H';
  if (loft >= 22 && loft <= 25) return '4H';
  if (loft >= 25 && loft <= 28) return '5H';
  if (loft >= 23 && loft <= 26) return '4i';
  if (loft >= 26 && loft <= 29) return '5i';
  if (loft >= 29 && loft <= 33) return '6i';
  if (loft >= 33 && loft <= 36) return '7i';
  if (loft >= 36 && loft <= 40) return '8i';
  if (loft >= 40 && loft <= 43) return '9i';
  if (loft >= 44 && loft <= 47) return 'PW';
  if (loft >= 48 && loft <= 52) return 'GW';
  if (loft >= 54 && loft <= 56) return 'SW';
  if (loft >= 58 && loft <= 62) return 'LW';
  return null;
}

export function normalizeClub(raw) {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!str) return null;

  const lower = str.toLowerCase()
    .replace(/iron/gi, 'i')
    .replace(/\s+/g, '')
    .replace(/_/g, '-');

  // Direct lookup with hyphens and without
  if (EXPLICIT_MAP[lower]) return EXPLICIT_MAP[lower];
  const lowerNoHyphens = lower.replace(/-/g, '');
  if (EXPLICIT_MAP[lowerNoHyphens]) return EXPLICIT_MAP[lowerNoHyphens];

  // Iron: a digit followed by an "i" (after the wedge/iron substitution),
  // e.g. "7i", "7-i", "7iron" → "7i"
  const ironMatch = lower.match(/^(\d{1,2})-?i$/);
  if (ironMatch) {
    const n = parseInt(ironMatch[1], 10);
    if (n >= 2 && n <= 9) return `${n}i`;
  }

  // Hybrid / Wood pattern (covered by EXPLICIT_MAP but keep as fallback for
  // unusual spellings like "7w" already normalized).
  const woodMatch = lower.match(/^(\d{1,2})-?w$/);
  if (woodMatch) {
    const n = parseInt(woodMatch[1], 10);
    if (n === 1) return 'Driver';
    if ([3, 4, 5, 7].includes(n)) return `${n}W`;
  }
  const hybMatch = lower.match(/^(\d{1,2})-?h$/);
  if (hybMatch) {
    const n = parseInt(hybMatch[1], 10);
    if (n >= 2 && n <= 6) return `${n}H`;
  }

  // Word numbers: "seven iron" → "7i" (handled after iron substitution: "seveni")
  for (const [word, n] of Object.entries(WORD_NUMBERS)) {
    if (lower === `${word}i`) return `${n}i`;
    if (lower === `${word}w`) return n === 1 ? 'Driver' : `${n}W`;
    if (lower === `${word}h`) return `${n}H`;
  }

  // Bare digit ("7") — assume iron
  if (/^\d{1,2}$/.test(lower)) {
    const n = parseInt(lower, 10);
    if (n >= 2 && n <= 9) return `${n}i`;
  }

  // Loft in degrees ("46°", "46 deg", "46.0")
  const loftMatch = str.match(/^(\d{2}(?:\.\d)?)(°|\s*deg(?:rees)?)?$/i);
  if (loftMatch) {
    const loft = parseFloat(loftMatch[1]);
    const club = loftToClub(loft);
    if (club) return club;
  }

  return null;
}
