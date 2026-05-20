import React from 'react';
import { trackmanImporter } from './importers/trackmanImporter';
import { applyOutlierFilter } from './analytics/outlierFilter';
import { clubSortIndex } from './types/StandardShot';

function genSessionId() {
  return 'sess_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

// Inline an import preview: shot count, club count, session date.
function ImportSummary({ shots, sessionDate, warnings }) {
  const clubs = new Set(shots.map(s => s.club));
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-title">Found in import</div>
      <div style={{ fontSize: '0.95rem', marginBottom: 6 }}>
        <strong>{shots.length}</strong> shots across <strong>{clubs.size}</strong> club{clubs.size !== 1 ? 's' : ''}
        {sessionDate && <> from session on <strong>{formatDate(sessionDate)}</strong></>}
      </div>
      {warnings && warnings.length > 0 && (
        <details style={{ marginTop: 8, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          <summary style={{ cursor: 'pointer' }}>{warnings.length} parser warning{warnings.length !== 1 ? 's' : ''}</summary>
          <ul style={{ marginTop: 6, marginLeft: 16 }}>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

// Filtered shot reviewer with per-shot re-include toggle.
function FilterReview({ shots, manualKeeps, onToggleKeep }) {
  const kept = shots.filter(s => !s.excluded || manualKeeps.has(s.shotId));
  const [open, setOpen] = React.useState(false);

  // Group filtered shots by club for easier review
  const byClub = new Map();
  for (const s of shots) {
    if (!s.excluded) continue;
    if (!byClub.has(s.club)) byClub.set(s.club, []);
    byClub.get(s.club).push(s);
  }
  const clubsSorted = [...byClub.keys()].sort((a, b) => clubSortIndex(a) - clubSortIndex(b));
  const filteredCount = shots.filter(s => s.excluded && !manualKeeps.has(s.shotId)).length;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-title">Outlier filter</div>
      <div style={{ fontSize: '0.95rem' }}>
        <strong>{kept.length}</strong> shots, <strong>{filteredCount}</strong> filtered as mishits
        {filteredCount > 0 && (
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              marginLeft: 10, fontSize: '0.78rem', padding: '2px 10px',
              border: '1px solid var(--blue)', background: 'transparent',
              color: 'var(--blue)', borderRadius: 12, cursor: 'pointer', fontWeight: 600,
            }}>
            {open ? 'Hide' : 'Review'}
          </button>
        )}
      </div>

      {open && filteredCount > 0 && (
        <div style={{ marginTop: 12 }}>
          {clubsSorted.map(club => (
            <div key={club} style={{ marginBottom: 12 }}>
              <div style={{
                fontSize: '0.78rem', fontWeight: 700, color: 'var(--blue)',
                textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4,
              }}>{club}</div>
              {byClub.get(club).map(s => {
                const isKept = manualKeeps.has(s.shotId);
                return (
                  <div key={s.shotId} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: '0.83rem',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: 'var(--text)' }}>
                        Carry {s.carryDistance !== null ? Math.round(s.carryDistance) : '—'}y
                        {s.smashFactor !== null && <> · Smash {s.smashFactor.toFixed(2)}</>}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{s.exclusionReason}</div>
                    </div>
                    <button
                      onClick={() => onToggleKeep(s.shotId)}
                      style={{
                        padding: '4px 10px', fontSize: '0.75rem', fontWeight: 600,
                        border: `1px solid ${isKept ? 'var(--accent)' : 'var(--text-muted)'}`,
                        background: isKept ? 'var(--accent)' : 'transparent',
                        color: isKept ? 'white' : 'var(--text-dim)',
                        borderRadius: 12, cursor: 'pointer',
                      }}>
                      {isKept ? '✓ Keep' : 'Re-include'}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ImportFlow — file picker → preview → filter review → confirm → onConfirm callback.
 * Parent decides what to do with the resulting shots/session (saving to Firestore lives there).
 */
export default function ImportFlow({ onCancel, onConfirm, initialCsv = null, initialSessionDate = null }) {
  const [csvText, setCsvText] = React.useState(initialCsv);
  const [fileName, setFileName] = React.useState(initialCsv ? 'Sample data' : null);
  const [parseResult, setParseResult] = React.useState(null);
  const [filtered, setFiltered] = React.useState(null); // shots after outlier filter
  const [manualKeeps, setManualKeeps] = React.useState(() => new Set());
  const [error, setError] = React.useState(null);
  const [trustFlag, setTrustFlag] = React.useState('normal');
  const fileInputRef = React.useRef(null);
  const sessionIdRef = React.useRef(genSessionId());

  // Parse on csv change
  React.useEffect(() => {
    if (!csvText) {
      setParseResult(null);
      setFiltered(null);
      return;
    }
    try {
      const result = trackmanImporter(csvText, { sessionId: sessionIdRef.current });
      setParseResult(result);
      setFiltered(applyOutlierFilter(result.shots));
      setManualKeeps(new Set());
      setError(null);
    } catch (e) {
      console.error('TrackMan import failed:', e);
      setError(e.message || 'Failed to parse CSV');
      setParseResult(null);
      setFiltered(null);
    }
  }, [csvText]);

  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      setCsvText(text);
    } catch (e) {
      setError('Could not read file: ' + (e.message || e));
    }
  };

  const handleConfirm = () => {
    if (!filtered || !filtered.length) return;
    // Apply manualKeeps: any shot the user re-included gets un-excluded
    const finalShots = filtered.map(s =>
      manualKeeps.has(s.shotId) ? { ...s, excluded: false, exclusionReason: null } : s
    );
    // Derive session date from earliest shot timestamp; fallback to today
    const timestamps = finalShots.map(s => s.timestamp).filter(Boolean);
    const earliest = timestamps.length
      ? new Date(Math.min(...timestamps.map(t => new Date(t).getTime()))).toISOString()
      : (initialSessionDate || new Date().toISOString());
    onConfirm({
      session: {
        sessionId: sessionIdRef.current,
        importDate: new Date().toISOString(),
        sessionDate: earliest,
        deviceType: 'trackman',
        shotCount: finalShots.filter(s => !s.excluded).length,
        filteredCount: finalShots.filter(s => s.excluded).length,
        userTrustFlag: trustFlag,
      },
      shots: finalShots,
    });
  };

  const toggleKeep = (shotId) => {
    setManualKeeps(prev => {
      const next = new Set(prev);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  };

  // Earliest timestamp from parsed shots, for the "session date" pill
  const sessionDate = parseResult && parseResult.shots.length
    ? parseResult.shots.map(s => s.timestamp).filter(Boolean).sort()[0]
    : initialSessionDate;

  return (
    <div className="screen">
      <h2 style={{ marginBottom: 14 }}>Import TrackMan Data</h2>

      {!csvText && (
        <div className="card" style={{ textAlign: 'center', padding: 28 }}>
          <div style={{ fontSize: '0.95rem', color: 'var(--text-dim)', marginBottom: 16 }}>
            Select a TrackMan CSV export to import.
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => handleFile(e.target.files && e.target.files[0])}
          />
          <button
            className="btn btn-primary"
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
          >
            Choose CSV file
          </button>
        </div>
      )}

      {fileName && (
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Source</div>
            <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>{fileName}</div>
          </div>
          <button
            onClick={() => { setCsvText(null); setFileName(null); setParseResult(null); setFiltered(null); }}
            style={{
              background: 'transparent', border: '1px solid var(--text-muted)',
              color: 'var(--text-dim)', borderRadius: 12,
              padding: '4px 10px', fontSize: '0.78rem', cursor: 'pointer', fontWeight: 600,
            }}>Change</button>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderLeft: '3px solid var(--red)', color: 'var(--red)' }}>
          <strong>Import error:</strong> {error}
        </div>
      )}

      {parseResult && parseResult.shots.length === 0 && !error && (
        <div className="card" style={{ borderLeft: '3px solid var(--orange)' }}>
          No usable shots found in this CSV. {parseResult.warnings.length > 0 && parseResult.warnings.join('; ')}
        </div>
      )}

      {parseResult && parseResult.shots.length > 0 && filtered && (
        <>
          <ImportSummary shots={parseResult.shots} sessionDate={sessionDate} warnings={parseResult.warnings} />
          <FilterReview shots={filtered} manualKeeps={manualKeeps} onToggleKeep={toggleKeep} />

          <div className="card">
            <div className="card-title">Session type</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['normal', 'lesson', 'warmup', 'tournament-prep'].map(t => (
                <button key={t}
                  onClick={() => setTrustFlag(t)}
                  className={'chip' + (trustFlag === t ? ' active' : '')}
                  style={{
                    padding: '6px 12px', fontSize: '0.82rem', fontWeight: 600,
                    border: `1px solid ${trustFlag === t ? 'var(--accent)' : 'var(--text-muted)'}`,
                    background: trustFlag === t ? 'var(--accent)' : 'transparent',
                    color: trustFlag === t ? 'white' : 'var(--text-dim)',
                    borderRadius: 14, cursor: 'pointer',
                  }}>
                  {t === 'tournament-prep' ? 'Tournament prep' : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleConfirm}>
              Import {filtered.filter(s => !s.excluded || manualKeeps.has(s.shotId)).length} shots
            </button>
          </div>
        </>
      )}

      {!csvText && (
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <button
            className="btn btn-secondary"
            style={{ width: 'auto', padding: '10px 18px' }}
            onClick={onCancel}>Cancel</button>
        </div>
      )}
    </div>
  );
}
