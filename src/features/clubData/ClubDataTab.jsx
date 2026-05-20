import React from 'react';
import { db } from '../../firebase';
import {
  collection, doc, setDoc, deleteDoc, getDocs, onSnapshot, writeBatch,
} from 'firebase/firestore';
import BagSummary from './BagSummary';
import ClubDetail from './ClubDetail';
import ImportFlow from './ImportFlow';
import { generateSampleSessions } from './sampleData';

// CRA env-var convention. Enable in .env.local with REACT_APP_ENABLE_SAMPLE_DATA=true
const SAMPLE_DATA_ENABLED = String(process.env.REACT_APP_ENABLE_SAMPLE_DATA || '').toLowerCase() === 'true';

// Firestore can't store undefined; coerce to null.
function cleanForFirestore(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export default function ClubDataTab() {
  const [shots, setShots] = React.useState([]);     // all shots across all sessions
  const [sessions, setSessions] = React.useState([]); // session metadata docs
  const [view, setView] = React.useState('bag');    // 'bag' | 'detail' | 'import'
  const [selectedClub, setSelectedClub] = React.useState(null);
  const [importBootstrap, setImportBootstrap] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [statusMsg, setStatusMsg] = React.useState(null);

  // ── Firestore listeners ─────────────────────────────────────
  React.useEffect(() => {
    if (!db) return;
    const unsubShots = onSnapshot(collection(db, 'shots'), (snap) => {
      setShots(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const unsubSessions = onSnapshot(collection(db, 'sessions'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (b.importDate || '').localeCompare(a.importDate || ''));
      setSessions(list);
    });
    return () => { unsubShots(); unsubSessions(); };
  }, []);

  // Group shots by canonical club name
  const shotsByClub = React.useMemo(() => {
    const map = new Map();
    for (const s of shots) {
      if (!s.club) continue;
      if (!map.has(s.club)) map.set(s.club, []);
      map.get(s.club).push(s);
    }
    return map;
  }, [shots]);

  // ── Save imported batch ─────────────────────────────────────
  const saveImport = async ({ session, shots: newShots }) => {
    if (!db) {
      setStatusMsg('Firestore not connected — cannot save.');
      return;
    }
    setSaving(true);
    setStatusMsg(null);
    try {
      // Write session doc
      await setDoc(doc(db, 'sessions', session.sessionId), cleanForFirestore(session));
      // Batch write shots in chunks (Firestore batch limit is 500)
      const chunkSize = 400;
      for (let i = 0; i < newShots.length; i += chunkSize) {
        const batch = writeBatch(db);
        for (const s of newShots.slice(i, i + chunkSize)) {
          batch.set(doc(db, 'shots', s.shotId), cleanForFirestore(s));
        }
        await batch.commit();
      }
      setStatusMsg(`Imported ${newShots.length} shots.`);
      setView('bag');
      setImportBootstrap(null);
    } catch (e) {
      console.error('Save failed:', e);
      setStatusMsg('Save failed: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  // ── Clear all data (two-step confirm) ───────────────────────
  const handleClearAll = async () => {
    const totalShots = shots.length;
    const totalSessions = sessions.length;
    if (totalShots === 0 && totalSessions === 0) return true; // nothing to clear

    const step1 = window.confirm('Replace existing data?\n\nThis loads sample data and removes anything imported so far.');
    if (!step1) return false;

    const mostRecent = sessions[0];
    const recentLabel = mostRecent && mostRecent.sessionDate
      ? new Date(mostRecent.sessionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'unknown date';
    const step2 = window.confirm(
      `This will delete ${totalShots} shot${totalShots !== 1 ? 's' : ''} from ${totalSessions} session${totalSessions !== 1 ? 's' : ''}, ` +
      `including data from ${recentLabel}.\n\nContinue?`
    );
    if (!step2) return false;

    try {
      // Bulk delete
      const [shotDocs, sessionDocs] = await Promise.all([
        getDocs(collection(db, 'shots')),
        getDocs(collection(db, 'sessions')),
      ]);
      // Batch deletes 400 at a time
      const deleteInChunks = async (docs) => {
        const chunkSize = 400;
        for (let i = 0; i < docs.length; i += chunkSize) {
          const batch = writeBatch(db);
          for (const d of docs.slice(i, i + chunkSize)) batch.delete(d.ref);
          await batch.commit();
        }
      };
      await deleteInChunks(shotDocs.docs);
      await deleteInChunks(sessionDocs.docs);
      return true;
    } catch (e) {
      console.error('Clear failed:', e);
      setStatusMsg('Could not clear data: ' + (e.message || e));
      return false;
    }
  };

  // ── Load sample data ────────────────────────────────────────
  const handleLoadSample = async () => {
    if (!SAMPLE_DATA_ENABLED) return;
    const ok = await handleClearAll();
    if (!ok) return;

    setSaving(true);
    setStatusMsg('Generating sample data…');

    try {
      const { trackmanImporter } = await import('./importers/trackmanImporter');
      const { applyOutlierFilter } = await import('./analytics/outlierFilter');
      const sampleSessions = generateSampleSessions(42, new Date());
      let totalShots = 0;

      for (const { csv, sessionDate } of sampleSessions) {
        if (!csv || csv.split('\n').length < 2) continue; // skip sessions with no shots
        const sessionId = 'sample_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const parsed = trackmanImporter(csv, { sessionId });
        const filtered = applyOutlierFilter(parsed.shots);
        if (!filtered.length) continue;

        const sessionDoc = {
          sessionId,
          importDate: new Date().toISOString(),
          sessionDate,
          deviceType: 'trackman',
          shotCount: filtered.filter(s => !s.excluded).length,
          filteredCount: filtered.filter(s => s.excluded).length,
          userTrustFlag: 'normal',
          isSample: true,
        };
        await setDoc(doc(db, 'sessions', sessionId), cleanForFirestore(sessionDoc));

        const chunkSize = 400;
        for (let i = 0; i < filtered.length; i += chunkSize) {
          const batch = writeBatch(db);
          for (const s of filtered.slice(i, i + chunkSize)) {
            batch.set(doc(db, 'shots', s.shotId), cleanForFirestore(s));
          }
          await batch.commit();
        }
        totalShots += filtered.length;
      }
      setStatusMsg(`Loaded ${totalShots} sample shots across ${sampleSessions.length} sessions.`);
    } catch (e) {
      console.error('Sample load failed:', e);
      setStatusMsg('Sample load failed: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  // ── Delete one session ──────────────────────────────────────
  const handleDeleteSession = async (sessionId) => {
    if (!db) return;
    const ok = window.confirm('Delete this session and all its shots?');
    if (!ok) return;
    try {
      const sessionShots = shots.filter(s => s.sessionId === sessionId);
      const chunkSize = 400;
      for (let i = 0; i < sessionShots.length; i += chunkSize) {
        const batch = writeBatch(db);
        for (const s of sessionShots.slice(i, i + chunkSize)) {
          batch.delete(doc(db, 'shots', s.shotId));
        }
        await batch.commit();
      }
      await deleteDoc(doc(db, 'sessions', sessionId));
    } catch (e) {
      console.error('Delete session failed:', e);
      setStatusMsg('Delete failed: ' + (e.message || e));
    }
  };

  // ── Render ──────────────────────────────────────────────────
  if (view === 'import') {
    return (
      <ImportFlow
        initialCsv={importBootstrap && importBootstrap.csv}
        initialSessionDate={importBootstrap && importBootstrap.sessionDate}
        onCancel={() => { setView('bag'); setImportBootstrap(null); }}
        onConfirm={saveImport}
      />
    );
  }

  if (view === 'detail' && selectedClub) {
    return (
      <ClubDetail
        club={selectedClub}
        shotsByClub={shotsByClub}
        onBack={() => { setSelectedClub(null); setView('bag'); }}
      />
    );
  }

  // Default: bag view
  return (
    <div className="screen">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Club Data</h2>
        <button
          className="btn btn-primary"
          style={{ width: 'auto', padding: '8px 14px', fontSize: '0.85rem' }}
          onClick={() => { setImportBootstrap(null); setView('import'); }}
          disabled={saving}
        >
          + Import TrackMan
        </button>
      </div>

      {statusMsg && (
        <div className="card" style={{
          borderLeft: '3px solid var(--accent)',
          background: 'rgba(45, 106, 79, 0.06)', fontSize: '0.88rem', padding: '10px 14px',
        }}>
          {statusMsg}
        </div>
      )}

      <BagSummary
        shotsByClub={shotsByClub}
        onSelectClub={(c) => { setSelectedClub(c); setView('detail'); }}
      />

      {sessions.length > 0 && (
        <div className="card">
          <div className="card-title">Sessions ({sessions.length})</div>
          {sessions.map(s => (
            <div key={s.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0', borderBottom: '1px solid var(--border)',
              fontSize: '0.85rem',
            }}>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {s.sessionDate ? new Date(s.sessionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  {s.isSample && <span style={{
                    fontSize: '0.65rem', color: 'var(--gold)', background: 'rgba(184, 145, 77, 0.15)',
                    padding: '1px 6px', borderRadius: 8, marginLeft: 8, fontWeight: 700,
                  }}>SAMPLE</span>}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {s.shotCount || 0} kept · {s.filteredCount || 0} filtered · {s.userTrustFlag || 'normal'}
                </div>
              </div>
              <button
                onClick={() => handleDeleteSession(s.sessionId)}
                style={{
                  background: 'transparent', border: '1px solid var(--text-muted)',
                  color: 'var(--text-dim)', borderRadius: 12, padding: '3px 10px',
                  fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600,
                }}
              >Delete</button>
            </div>
          ))}
        </div>
      )}

      {SAMPLE_DATA_ENABLED && (
        <div className="card" style={{ borderLeft: '3px solid var(--gold)' }}>
          <div className="card-title" style={{ color: 'var(--gold-dim)' }}>Dev tools</div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: 10 }}>
            Replaces all club data with a synthetic dataset for testing.
          </p>
          <button
            className="btn btn-gold"
            style={{ width: 'auto', padding: '8px 14px', fontSize: '0.85rem' }}
            onClick={handleLoadSample}
            disabled={saving}
          >
            {saving ? 'Working…' : 'Load Sample Data'}
          </button>
        </div>
      )}
    </div>
  );
}
