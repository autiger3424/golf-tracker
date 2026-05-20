import React from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, ResponsiveContainer,
  LineChart, Line, Tooltip, ReferenceLine,
} from 'recharts';
import { summarizeClub, dispersionEllipse, ellipsePoints, weeklyTrend, staleDays } from './analytics/dispersionStats';
import { clubSortIndex } from './types/StandardShot';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatBox({ label, value, hint }) {
  return (
    <div style={{
      background: 'var(--card2)', borderRadius: 'var(--radius)', padding: '10px 12px',
      textAlign: 'center', minWidth: 80,
    }}>
      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--blue)' }}>{value}</div>
      {hint && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function DispersionChart({ shots, ellipse }) {
  // Decorate shots for Recharts: { x: sideCarry, y: carryDistance }
  const data = shots
    .filter(s => s.sideCarry !== null && s.carryDistance !== null)
    .map(s => ({ x: s.sideCarry, y: s.carryDistance }));

  const e1 = ellipse ? ellipsePoints(ellipse, 1, 64).map(p => ({ x: p.x, y: p.y })) : [];
  const e2 = ellipse ? ellipsePoints(ellipse, 2, 64).map(p => ({ x: p.x, y: p.y })) : [];

  if (!data.length) {
    return <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: 20 }}>
      No dispersion data yet.
    </div>;
  }

  // Compute axis bounds with padding so ellipses don't get clipped.
  const allX = [...data.map(d => d.x), ...e1.map(d => d.x), ...e2.map(d => d.x)];
  const allY = [...data.map(d => d.y), ...e1.map(d => d.y), ...e2.map(d => d.y)];
  const xMin = Math.floor(Math.min(...allX) - 2);
  const xMax = Math.ceil(Math.max(...allX) + 2);
  const xBound = Math.max(Math.abs(xMin), Math.abs(xMax));
  const yMin = Math.floor(Math.min(...allY) - 2);
  const yMax = Math.ceil(Math.max(...allY) + 2);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ top: 10, right: 10, bottom: 30, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
        <XAxis type="number" dataKey="x" name="Lateral"
          domain={[-xBound, xBound]}
          label={{ value: 'Side (yds, − = left)', position: 'insideBottom', offset: -16, fontSize: 11 }}
          tick={{ fontSize: 11 }} />
        <YAxis type="number" dataKey="y" name="Carry"
          domain={[yMin, yMax]}
          label={{ value: 'Carry (yds)', angle: -90, position: 'insideLeft', fontSize: 11 }}
          tick={{ fontSize: 11 }} />
        <ZAxis range={[40, 40]} />
        <Tooltip
          formatter={(v, name) => [`${Math.round(v * 10) / 10} yds`, name === 'x' ? 'Side' : 'Carry']}
          labelFormatter={() => ''}
          cursor={{ strokeDasharray: '3 3' }} />
        <ReferenceLine x={0} stroke="rgba(0,0,0,0.3)" strokeDasharray="2 2" />
        {/* 2σ ellipse — drawn first so 1σ overlays it */}
        {e2.length > 0 && (
          <Scatter data={e2} line={{ stroke: 'rgba(30, 58, 95, 0.35)', strokeWidth: 1.5 }}
            shape={() => null} legendType="none" />
        )}
        {/* 1σ ellipse */}
        {e1.length > 0 && (
          <Scatter data={e1} line={{ stroke: 'rgba(30, 58, 95, 0.7)', strokeWidth: 2 }}
            shape={() => null} legendType="none" />
        )}
        {/* Shots */}
        <Scatter data={data} fill="var(--accent)" fillOpacity={0.65} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function TrendChart({ data, dataKey, yLabel, yColor = 'var(--accent)', referenceY = null }) {
  if (!data || !data.length) {
    return <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: 20 }}>
      Not enough data points yet.
    </div>;
  }
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 10, right: 10, bottom: 20, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
        <XAxis dataKey="week" tick={{ fontSize: 10 }}
          tickFormatter={(w) => {
            const d = new Date(w);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          }} />
        <YAxis tick={{ fontSize: 10 }} label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 10, offset: 10 }} />
        <Tooltip
          labelFormatter={(w) => `Week of ${formatDate(w)}`}
          formatter={(v, name) => [`${v}`, name]} />
        {referenceY !== null && (
          <ReferenceLine y={referenceY} stroke="rgba(0,0,0,0.3)" strokeDasharray="2 2" />
        )}
        <Line type="monotone" dataKey={dataKey} stroke={yColor} strokeWidth={2}
          dot={{ r: 3, fill: yColor }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function GapAnalysis({ club, shotsByClub }) {
  // Build avg-carry list across the bag in sort order
  const all = [...shotsByClub.entries()].map(([c, shots]) => {
    const kept = shots.filter(s => !s.excluded);
    const summary = summarizeClub(kept.length ? kept : shots);
    return summary ? { club: c, avgCarry: summary.avgCarry } : null;
  }).filter(Boolean)
    .filter(x => x.avgCarry !== null)
    .sort((a, b) => clubSortIndex(a.club) - clubSortIndex(b.club));

  const myIdx = all.findIndex(c => c.club === club);
  if (myIdx === -1) return null;

  const me = all[myIdx];
  const next = all[myIdx + 1]; // next club down (shorter)

  if (!next) {
    return (
      <div className="card">
        <div className="card-title">Gap to next club</div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {club} is your shortest tracked club — no next-down gap to analyze.
        </p>
      </div>
    );
  }

  const gap = Math.abs(me.avgCarry - next.avgCarry);
  const flag = gap < 5 ? 'tight' : gap > 15 ? 'large' : 'ok';
  const flagColor = flag === 'ok' ? 'var(--accent)' : 'var(--orange)';
  const flagText = flag === 'ok' ? 'Looks fine'
    : flag === 'tight' ? 'Tight gap — clubs overlap'
    : 'Large gap — distance hole in the bag';

  return (
    <div className="card">
      <div className="card-title">Gap to next club</div>
      <div style={{ fontSize: '0.95rem', marginBottom: 6 }}>
        {club} avg <strong>{Math.round(me.avgCarry)}</strong>, {next.club} avg <strong>{Math.round(next.avgCarry)}</strong>
        {' '}→ <strong>{Math.round(gap)} yard gap</strong>
      </div>
      <div style={{ fontSize: '0.82rem', color: flagColor, fontWeight: 600 }}>
        {flagText}
      </div>
    </div>
  );
}

/**
 * ClubDetail — View 2. Drill-in stats and trend charts for a single club.
 *
 * @param {{ club: string, shotsByClub: Map<string, StandardShot[]>, onBack: () => void }} props
 */
export default function ClubDetail({ club, shotsByClub, onBack }) {
  const all = shotsByClub.get(club) || [];
  const kept = all.filter(s => !s.excluded);
  const summary = summarizeClub(kept.length ? kept : all);
  const ellipse = React.useMemo(() => dispersionEllipse(kept), [kept]);
  const trend = React.useMemo(() => weeklyTrend(kept), [kept]);
  const staleDaysVal = staleDays(summary && summary.lastUpdate);
  const lowSample = summary && summary.sampleSize < 20;

  if (!summary) {
    return (
      <div className="screen">
        <button onClick={onBack} className="btn btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }}>
          ← Back
        </button>
        <h2>{club}</h2>
        <div className="card"><p style={{ color: 'var(--text-muted)' }}>No data for this club.</p></div>
      </div>
    );
  }

  return (
    <div className="screen">
      <button onClick={onBack}
        style={{
          background: 'transparent', border: '1px solid var(--blue)',
          color: 'var(--blue)', borderRadius: 14, padding: '5px 12px',
          fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', marginBottom: 12,
        }}>
        ← Bag Summary
      </button>

      <h2 style={{ marginBottom: 4 }}>{club}</h2>
      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 14 }}>
        {summary.sampleSize} shot{summary.sampleSize !== 1 ? 's' : ''} · last hit {formatDate(summary.lastUpdate)}
        {staleDaysVal !== null && staleDaysVal >= 30 && (
          <span style={{ color: staleDaysVal > 60 ? 'var(--red)' : 'var(--orange)', fontWeight: 600 }}>
            {' '}· {staleDaysVal} days ago
          </span>
        )}
      </div>

      {lowSample && (
        <div className="card" style={{ borderLeft: '3px solid var(--orange)', background: 'rgba(163, 102, 42, 0.06)' }}>
          <strong style={{ color: 'var(--orange)' }}>Limited data.</strong>
          <span style={{ fontSize: '0.85rem' }}> Dispersion estimates have wide confidence intervals — collect more shots before relying on these numbers.</span>
        </div>
      )}

      <div className="card">
        <div className="card-title">Summary</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          <StatBox label="Avg carry" value={summary.avgCarry !== null ? `${Math.round(summary.avgCarry)}y` : '—'} />
          <StatBox label="Avg total" value={summary.avgTotal !== null ? `${Math.round(summary.avgTotal)}y` : '—'} />
          <StatBox label="Shape" value={summary.shape || '—'}
            hint={summary.meanSide !== null ? `${summary.meanSide > 0 ? '+' : ''}${summary.meanSide}y mean side` : null} />
          <StatBox label="Reliable range"
            value={summary.p10 !== null && summary.p90 !== null ? `${summary.p10}–${summary.p90}y` : '—'}
            hint="10th–90th pct" />
        </div>
      </div>

      <div className="card">
        <div className="card-title">Dispersion</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 8 }}>
          1σ contains ~39%, 2σ contains ~86% of shots.
        </div>
        <DispersionChart shots={kept} ellipse={ellipse} />
      </div>

      <div className="card">
        <div className="card-title">Distance trend</div>
        <TrendChart data={trend} dataKey="avgCarry" yLabel="Avg carry (yd)" yColor="var(--accent)"
          referenceY={summary.avgCarry} />
      </div>

      <div className="card">
        <div className="card-title">Shape trend</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 8 }}>
          Mean side carry by week. Negative = draw, positive = fade. Dashed line = zero (straight).
        </div>
        <TrendChart data={trend} dataKey="meanSide" yLabel="Mean side (yd)" yColor="var(--blue)" referenceY={0} />
      </div>

      <GapAnalysis club={club} shotsByClub={shotsByClub} />
    </div>
  );
}
