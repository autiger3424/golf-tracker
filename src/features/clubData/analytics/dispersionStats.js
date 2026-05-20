// Stats for a single club's non-excluded shots.
// Pure functions — no React, no Firestore, easy to unit test.

function mean(xs) {
  if (!xs.length) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function variance(xs, mu) {
  if (xs.length < 2) return null;
  let s = 0;
  for (const x of xs) s += (x - mu) * (x - mu);
  return s / (xs.length - 1);
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const t = idx - lo;
  return sortedAsc[lo] + t * (sortedAsc[hi] - sortedAsc[lo]);
}

// Mean sideCarry → "draw" / "fade" / "straight". Negative = left = draw
// for a right-handed golfer (which we assume).
export function shapeLabel(meanSide) {
  if (meanSide === null || meanSide === undefined || Number.isNaN(meanSide)) return null;
  const abs = Math.abs(meanSide);
  if (abs < 2) return 'straight';
  if (meanSide < 0) return `${Math.round(abs)}-yd draw`;
  return `${Math.round(abs)}-yd fade`;
}

/**
 * Summary stats for one club's shots (caller passes the non-excluded subset).
 * Returns null if there are no usable shots.
 */
export function summarizeClub(shots) {
  if (!shots || !shots.length) return null;
  const carries = shots
    .map(s => s.carryDistance)
    .filter(x => x !== null && x !== undefined && Number.isFinite(x));
  const totals = shots
    .map(s => s.totalDistance)
    .filter(x => x !== null && x !== undefined && Number.isFinite(x));
  const sides = shots
    .map(s => s.sideCarry)
    .filter(x => x !== null && x !== undefined && Number.isFinite(x));

  const carriesSorted = [...carries].sort((a, b) => a - b);
  const avgCarry = mean(carries);
  const avgTotal = mean(totals);
  const meanSide = mean(sides);

  const timestamps = shots
    .map(s => s.timestamp ? new Date(s.timestamp).getTime() : null)
    .filter(t => t && !Number.isNaN(t));
  const lastUpdate = timestamps.length ? new Date(Math.max(...timestamps)) : null;

  return {
    sampleSize: shots.length,
    avgCarry: avgCarry !== null ? Math.round(avgCarry * 10) / 10 : null,
    avgTotal: avgTotal !== null ? Math.round(avgTotal * 10) / 10 : null,
    meanSide: meanSide !== null ? Math.round(meanSide * 10) / 10 : null,
    shape: shapeLabel(meanSide),
    p10: carriesSorted.length ? Math.round(percentile(carriesSorted, 10)) : null,
    p90: carriesSorted.length ? Math.round(percentile(carriesSorted, 90)) : null,
    lastUpdate: lastUpdate ? lastUpdate.toISOString() : null,
  };
}

/**
 * Bivariate normal stats for the dispersion ellipse. We use the standard
 * estimator: sample mean and 2×2 covariance of (sideCarry, carryDistance),
 * then eigendecompose to get the principal axes. Caller draws an ellipse
 * at 1σ and 2σ — equivalent to ~39% and ~86% coverage of a bivariate normal
 * (chi-square with 2 dof).
 *
 * Returns null if fewer than 5 shots have both fields.
 */
export function dispersionEllipse(shots) {
  const xs = []; // sideCarry
  const ys = []; // carryDistance
  for (const s of shots) {
    if (s.sideCarry === null || s.sideCarry === undefined) continue;
    if (s.carryDistance === null || s.carryDistance === undefined) continue;
    xs.push(s.sideCarry);
    ys.push(s.carryDistance);
  }
  if (xs.length < 5) return null;

  const mx = mean(xs);
  const my = mean(ys);
  const vx = variance(xs, mx);
  const vy = variance(ys, my);
  let cxy = 0;
  for (let i = 0; i < xs.length; i++) cxy += (xs[i] - mx) * (ys[i] - my);
  cxy = cxy / (xs.length - 1);

  // Eigendecomposition of [[vx, cxy], [cxy, vy]]
  const tr = vx + vy;
  const det = vx * vy - cxy * cxy;
  const disc = Math.max(0, (tr * tr) / 4 - det);
  const sqDisc = Math.sqrt(disc);
  const l1 = tr / 2 + sqDisc;
  const l2 = tr / 2 - sqDisc;

  // Angle of major axis (radians, from +x axis = sideCarry direction).
  // If eigenvector is in the direction of (vx-l, -cxy)... use atan2 on the
  // standard eigenvector formula.
  let angle = 0;
  if (Math.abs(cxy) > 1e-9) {
    angle = Math.atan2(l1 - vx, cxy);
  } else {
    angle = vx >= vy ? 0 : Math.PI / 2;
  }

  return {
    meanX: mx, meanY: my,
    sigmaMajor: Math.sqrt(Math.max(0, l1)),
    sigmaMinor: Math.sqrt(Math.max(0, l2)),
    angle, // radians
    n: xs.length,
  };
}

/**
 * Sample points along an ellipse for plotting.
 * sigmaScale = 1 → 1-sigma ellipse, 2 → 2-sigma, etc.
 * Returns array of { x, y } in the same units as the input shots.
 */
export function ellipsePoints(e, sigmaScale = 1, steps = 64) {
  if (!e) return [];
  const pts = [];
  const a = e.sigmaMajor * sigmaScale;
  const b = e.sigmaMinor * sigmaScale;
  const cos = Math.cos(e.angle);
  const sin = Math.sin(e.angle);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const xr = a * Math.cos(t);
    const yr = b * Math.sin(t);
    pts.push({
      x: e.meanX + xr * cos - yr * sin,
      y: e.meanY + xr * sin + yr * cos,
    });
  }
  return pts;
}

// Bucket shots by ISO week (Mon-start). Returns Map<weekKey, shot[]> in chronological order.
export function bucketByWeek(shots) {
  const buckets = new Map();
  for (const s of shots) {
    if (!s.timestamp) continue;
    const d = new Date(s.timestamp);
    if (isNaN(d.getTime())) continue;
    // Move to Monday of that week
    const day = d.getDay(); // 0=Sun
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(s);
  }
  return new Map([...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

// For trend charts: list of { week, avgCarry, meanSide, n }
export function weeklyTrend(shots) {
  const buckets = bucketByWeek(shots);
  const out = [];
  for (const [week, group] of buckets.entries()) {
    const summary = summarizeClub(group);
    if (!summary) continue;
    out.push({
      week,
      avgCarry: summary.avgCarry,
      meanSide: summary.meanSide,
      n: summary.sampleSize,
    });
  }
  return out;
}

// Days since lastUpdate ISO timestamp. null if no timestamp.
export function staleDays(lastUpdateISO, now = new Date()) {
  if (!lastUpdateISO) return null;
  const d = new Date(lastUpdateISO);
  if (isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}
