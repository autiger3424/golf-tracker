import React from 'react';
import { summarizeClub, staleDays } from './analytics/dispersionStats';
import { clubSortIndex } from './types/StandardShot';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function StalePill({ days }) {
  if (days === null) return null;
  if (days < 30) return null;
  const isRed = days > 60;
  const color = isRed ? 'var(--red)' : 'var(--orange, #a3662a)';
  const bg = isRed ? 'rgba(153, 27, 27, 0.12)' : 'rgba(163, 102, 42, 0.14)';
  return (
    <span style={{
      display: 'inline-block', fontSize: '0.68rem', fontWeight: 700,
      color, background: bg, padding: '1px 7px', borderRadius: 10,
      marginLeft: 6, letterSpacing: '0.02em',
    }}>
      {days}d old
    </span>
  );
}

function ClubRow({ club, summary, onSelect }) {
  const staleDaysVal = staleDays(summary.lastUpdate);
  const lowSample = summary.sampleSize < 20;

  return (
    <button
      onClick={() => onSelect(club)}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 8,
        cursor: 'pointer', transition: 'transform 0.08s, border-color 0.15s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--blue)' }}>
          {club}
          {lowSample && (
            <span style={{
              fontSize: '0.65rem', fontWeight: 600, color: 'var(--orange)',
              background: 'rgba(163, 102, 42, 0.14)', padding: '1px 6px',
              marginLeft: 6, borderRadius: 10, letterSpacing: '0.02em',
            }}>LOW SAMPLE</span>
          )}
          <StalePill days={staleDaysVal} />
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          {summary.sampleSize} shot{summary.sampleSize !== 1 ? 's' : ''}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: '0.86rem' }}>
        <div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', display: 'block' }}>CARRY</span>
          <strong>{summary.avgCarry !== null ? `${Math.round(summary.avgCarry)}y` : '—'}</strong>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', display: 'block' }}>TOTAL</span>
          <strong>{summary.avgTotal !== null ? `${Math.round(summary.avgTotal)}y` : '—'}</strong>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', display: 'block' }}>SHAPE</span>
          <strong style={{ color: summary.shape === 'straight' ? 'var(--accent)'
            : summary.shape && summary.shape.includes('draw') ? 'var(--blue)'
            : 'var(--orange)' }}>
            {summary.shape || '—'}
          </strong>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', display: 'block' }}>RELIABLE RANGE</span>
          <strong>{summary.p10 !== null && summary.p90 !== null ? `${summary.p10}–${summary.p90}` : '—'}</strong>
        </div>
      </div>

      <div style={{
        marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between',
        fontSize: '0.72rem', color: 'var(--text-muted)',
      }}>
        <span>Last shot: {formatDate(summary.lastUpdate)}</span>
        <span>›</span>
      </div>
    </button>
  );
}

/**
 * BagSummary — View 1, the "pre-tournament reference card".
 *
 * @param {{
 *   shotsByClub: Map<string, StandardShot[]>,
 *   onSelectClub: (club: string) => void,
 *   onOpenTournamentCard?: () => void,
 * }} props
 */
export default function BagSummary({ shotsByClub, onSelectClub, onOpenTournamentCard }) {
  const clubs = [...shotsByClub.keys()].sort((a, b) => clubSortIndex(a) - clubSortIndex(b));

  if (clubs.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 24 }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>No imported club data yet.</p>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Import a TrackMan CSV to see per-club stats here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {onOpenTournamentCard && (
        <button
          onClick={onOpenTournamentCard}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%', padding: '14px 16px', marginBottom: 12,
            background: 'var(--gold)', color: '#111',
            border: 'none', borderRadius: 'var(--radius)',
            fontWeight: 700, fontSize: '1rem',
            cursor: 'pointer', textAlign: 'left',
            boxShadow: '0 2px 6px rgba(184, 145, 77, 0.3)',
          }}>
          <span>📋 Tournament Card</span>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, opacity: 0.85 }}>
            Quick reference →
          </span>
        </button>
      )}
      {clubs.map(club => {
        const all = shotsByClub.get(club) || [];
        const kept = all.filter(s => !s.excluded);
        const summary = summarizeClub(kept.length ? kept : all);
        if (!summary) return null;
        return <ClubRow key={club} club={club} summary={summary} onSelect={onSelectClub} />;
      })}
    </div>
  );
}
