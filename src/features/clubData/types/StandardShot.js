// StandardShot — internal data model for one launch-monitor shot.
// trackmanImporter() (and future SkyTrak+, Foresight, etc importers) all
// normalize their device-specific column layouts into this shape. Everything
// downstream — analytics, UI, Firestore — only ever consumes StandardShot.
//
// All fields are stored even when not currently surfaced in UI, so adding
// new analytics (e.g. spin loft, vertical/horizontal angle) later doesn't
// require a re-import.
//
/**
 * @typedef {Object} StandardShot
 * @property {string} shotId            unique id
 * @property {string} sessionId         groups shots from one import
 * @property {string} timestamp         ISO 8601, time the shot was hit
 * @property {string} club              canonical club name ("7i", "PW", "Driver", ...)
 *
 * // distance / dispersion
 * @property {number|null} carryDistance  yards
 * @property {number|null} totalDistance  yards
 * @property {number|null} sideCarry      yards lateral, negative = left
 *
 * // ball / impact
 * @property {number|null} ballSpeed      mph
 * @property {number|null} clubSpeed      mph
 * @property {number|null} smashFactor    ballSpeed / clubSpeed
 * @property {number|null} launchAngle    degrees
 * @property {number|null} spinRate       rpm
 * @property {number|null} spinAxis       degrees, negative = draw
 *
 * // flight
 * @property {number|null} apexHeight     feet
 * @property {number|null} landingAngle   degrees
 * @property {number|null} descentAngle   degrees (alias used by some devices)
 *
 * // delivery
 * @property {number|null} clubPath       degrees, negative = out-to-in
 * @property {number|null} faceAngle      degrees, negative = closed
 * @property {number|null} faceToPath     degrees
 * @property {number|null} attackAngle    degrees, negative = down
 * @property {number|null} dynamicLoft    degrees
 *
 * // provenance
 * @property {('trackman'|'skytrak'|'foresight'|string)} deviceType
 * @property {Object} rawSourceRow       original CSV row as JSON, for debugging
 *
 * // outlier-filter result — applied after import
 * @property {boolean} [excluded]
 * @property {string}  [exclusionReason]
 */

// Helper so callers don't repeat the field list.
export function makeShot(partial = {}) {
  return {
    shotId: '',
    sessionId: '',
    timestamp: '',
    club: '',
    carryDistance: null,
    totalDistance: null,
    sideCarry: null,
    ballSpeed: null,
    clubSpeed: null,
    smashFactor: null,
    launchAngle: null,
    spinRate: null,
    spinAxis: null,
    apexHeight: null,
    landingAngle: null,
    descentAngle: null,
    clubPath: null,
    faceAngle: null,
    faceToPath: null,
    attackAngle: null,
    dynamicLoft: null,
    deviceType: 'trackman',
    rawSourceRow: null,
    excluded: false,
    exclusionReason: null,
    ...partial,
  };
}

// Club categories — used by the outlier filter and by club ordering in UI.
export const CLUB_CATEGORY = {
  Driver: 'driver',
  '3W': 'fairway',
  '4W': 'fairway',
  '5W': 'fairway',
  '7W': 'fairway',
  '2H': 'hybrid',
  '3H': 'hybrid',
  '4H': 'hybrid',
  '5H': 'hybrid',
  '6H': 'hybrid',
  '2i': 'iron',
  '3i': 'iron',
  '4i': 'iron',
  '5i': 'iron',
  '6i': 'iron',
  '7i': 'iron',
  '8i': 'iron',
  '9i': 'iron',
  PW: 'wedge',
  GW: 'wedge',
  SW: 'wedge',
  LW: 'wedge',
};

// Default bag display order — Driver → fairways → hybrids → long-to-short irons → wedges.
export const CLUB_ORDER = [
  'Driver',
  '3W', '4W', '5W', '7W',
  '2H', '3H', '4H', '5H', '6H',
  '2i', '3i', '4i', '5i', '6i', '7i', '8i', '9i',
  'PW', 'GW', 'SW', 'LW',
];

export function clubSortIndex(club) {
  const i = CLUB_ORDER.indexOf(club);
  return i === -1 ? 999 : i;
}
