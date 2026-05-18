import React, { useCallback } from 'react';
import './App.css';
import { COURSES } from './courses';
import PracticeScreen from './PracticeScreen';
import LiveViewer from './LiveViewer';
import { GoogleOAuthProvider } from '@react-oauth/google';
// import { useGoogleLogin } from '@react-oauth/google'; // archived with Google Calendar
import { GOOGLE_CLIENT_ID } from './config';
import { db, storage } from './firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, getDoc, getDocs } from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';

// ============================================================
// HELPERS
// ============================================================
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function generateLiveId(playerName, date) {
  const name = (playerName || 'PLAYER').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
  const d = new Date(date);
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const dateStr = months[d.getMonth()] + d.getDate();
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return `${name}-${dateStr}-${rand}`;
}

function getTeeColor(color) {
  const map = {
    black: '#222222', gold: '#c9a84c', blue: '#1565c0', white: '#dddddd',
    red: '#c62828', green: '#2e7d32', silver: '#9e9e9e'
  };
  return map[color?.toLowerCase()] || '#555';
}

function scoreDiffLabel(diff) {
  if (diff === null || diff === undefined || diff === '') return '';
  const n = parseInt(diff);
  if (n < 0) return String(n);
  if (n === 0) return 'E';
  return '+' + n;
}

function scoreDiffClass(diff) {
  if (diff === null || diff === undefined || diff === '') return '';
  const n = parseInt(diff);
  if (n < 0) return 'under';
  if (n === 0) return 'even';
  return 'over';
}

function holeScoreClass(score, par) {
  if (score === '' || score === null || score === undefined) return '';
  const diff = parseInt(score) - par;
  if (diff <= -2) return 'eagle';
  if (diff === -1) return 'birdie';
  if (diff === 0) return 'par-score';
  if (diff === 1) return 'bogey';
  if (diff === 2) return 'double';
  return 'worse';
}

function calcStats(holes) {
  const played = holes.filter(h => h.score !== '' && h.score !== null && h.score !== undefined);
  if (!played.length) return null;

  const totalScore = played.reduce((s, h) => s + parseInt(h.score), 0);
  const totalPar = played.reduce((s, h) => s + h.par, 0);
  const scoreDiff = totalScore - totalPar;

  const drivingHoles = played.filter(h => h.par !== 3);
  const fwHit = drivingHoles.filter(h => h.fairwayHit === true).length;
  const fwAttempted = drivingHoles.filter(h => h.fairwayHit !== null && h.fairwayHit !== undefined).length;
  const fwPct = fwAttempted ? Math.round((fwHit / fwAttempted) * 100) : null;

  const girHit = played.filter(h => h.gir === true).length;
  const girPct = played.length ? Math.round((girHit / played.length) * 100) : null;

  const puttHoles = played.filter(h => h.putts !== '' && h.putts !== null && h.putts !== undefined);
  const totalPutts = puttHoles.reduce((s, h) => s + parseInt(h.putts), 0);
  const avgPutts = puttHoles.length ? (totalPutts / puttHoles.length).toFixed(1) : null;
  const sumPutts = puttHoles.length ? totalPutts : null;

  const breakdown = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0, worse: 0 };
  played.forEach(h => {
    const d = parseInt(h.score) - h.par;
    if (d <= -2) breakdown.eagle++;
    else if (d === -1) breakdown.birdie++;
    else if (d === 0) breakdown.par++;
    else if (d === 1) breakdown.bogey++;
    else if (d === 2) breakdown.double++;
    else breakdown.worse++;
  });

  // Front 9 / Back 9
  const frontH = played.filter(h => h.number <= 9);
  const backH = played.filter(h => h.number >= 10);
  const front9 = frontH.length ? {
    score: frontH.reduce((s, h) => s + parseInt(h.score), 0),
    par: frontH.reduce((s, h) => s + h.par, 0),
    holes: frontH.length,
  } : null;
  const back9 = backH.length ? {
    score: backH.reduce((s, h) => s + parseInt(h.score), 0),
    par: backH.reduce((s, h) => s + h.par, 0),
    holes: backH.length,
  } : null;
  if (front9) front9.diff = front9.score - front9.par;
  if (back9) back9.diff = back9.score - back9.par;

  // Par type scoring
  const parTypeStats = [3, 4, 5].reduce((acc, p) => {
    const hs = played.filter(h => h.par === p);
    if (!hs.length) { acc[p] = null; return acc; }
    const avgDiff = hs.reduce((s, h) => s + (parseInt(h.score) - h.par), 0) / hs.length;
    acc[p] = { n: hs.length, avgDiff: parseFloat(avgDiff.toFixed(2)) };
    return acc;
  }, {});

  // Penalties & hazards
  const penaltyCount = played.reduce((s, h) => s + (h.ob ? 1 : 0) + (h.water ? 1 : 0), 0);
  const bunkerCount = played.reduce((s, h) => s + (h.fairwayBunker ? 1 : 0) + (h.greensideBunker ? 1 : 0), 0);

  // First putt distance
  const firstPuttHoles = played.filter(h => h.firstPuttLength !== '' && h.firstPuttLength !== null && h.firstPuttLength !== undefined);
  const avgFirstPutt = firstPuttHoles.length
    ? (firstPuttHoles.reduce((s, h) => s + h.firstPuttLength, 0) / firstPuttHoles.length).toFixed(1)
    : null;

  // Strokes Gained: Putting — needs both firstPuttLength and putts recorded
  const sgHoles = played.filter(h =>
    h.firstPuttLength !== '' && h.firstPuttLength !== null && h.firstPuttLength !== undefined &&
    h.putts !== '' && h.putts !== null && h.putts !== undefined
  );
  let sgPutting = null;
  let sgPuttingPerHole = null;
  let sgT2G = null;
  let sgT2GPerHole = null;
  if (sgHoles.length) {
    const total = sgHoles.reduce((s, h) => s + (expectedPutts(h.firstPuttLength) - parseInt(h.putts)), 0);
    sgPutting = parseFloat(total.toFixed(2));
    sgPuttingPerHole = parseFloat((total / sgHoles.length).toFixed(2));
    // SG Tee-to-Green = (par - score) - SG putting, summed across the same holes
    const t2gTotal = sgHoles.reduce((s, h) => {
      const sgTotal = parseInt(h.par) - parseInt(h.score);
      const sgP = expectedPutts(h.firstPuttLength) - parseInt(h.putts);
      return s + (sgTotal - sgP);
    }, 0);
    sgT2G = parseFloat(t2gTotal.toFixed(2));
    sgT2GPerHole = parseFloat((t2gTotal / sgHoles.length).toFixed(2));
  }

  return { totalScore, totalPar, scoreDiff, fwPct, girPct, avgPutts, sumPutts, breakdown, holesPlayed: played.length, front9, back9, parTypeStats, penaltyCount, bunkerCount, avgFirstPutt, sgPutting, sgPuttingPerHole, sgT2G, sgT2GPerHole, sgHolesCount: sgHoles.length };
}

// Strokes Gained: Putting baseline — expected putts to hole out from distance (PGA Tour avg)
const SG_PUTT_BASELINE = [
  [0, 0], [1, 1.003], [2, 1.017], [3, 1.059], [4, 1.132], [5, 1.211],
  [6, 1.289], [7, 1.366], [8, 1.437], [9, 1.502], [10, 1.562],
  [12, 1.668], [14, 1.761], [16, 1.838], [18, 1.903], [20, 1.956],
  [25, 2.040], [30, 2.097], [35, 2.136], [40, 2.162], [45, 2.181],
  [50, 2.196], [60, 2.218], [70, 2.232], [75, 2.238],
];

function expectedPutts(distFt) {
  if (distFt <= 0) return 0;
  for (let i = 1; i < SG_PUTT_BASELINE.length; i++) {
    const [d0, p0] = SG_PUTT_BASELINE[i - 1];
    const [d1, p1] = SG_PUTT_BASELINE[i];
    if (distFt <= d1) {
      const t = (distFt - d0) / (d1 - d0);
      return p0 + t * (p1 - p0);
    }
  }
  return SG_PUTT_BASELINE[SG_PUTT_BASELINE.length - 1][1];
}

const FIRST_PUTT_OPTIONS = [
  ...Array.from({ length: 10 }, (_, i) => i + 1),          // 1–10 ft
  ...Array.from({ length: 10 }, (_, i) => 12 + i * 2),     // 12–30 ft (every 2)
  ...Array.from({ length: 9 },  (_, i) => 35 + i * 5),     // 35–75 ft (every 5)
];

function createHolesFromTee(tee) {
  return tee.holes.map(h => ({
    number: h.number, par: h.par, yards: h.yards,
    score: '', putts: '', firstPuttLength: '', fairwayHit: null, fairwayMissDirection: null, gir: null,
    fairwayBunker: false, greensideBunker: false, ob: false, water: false, notes: ''
  }));
}

// Find the next sequential unscored hole, wrapping around the round.
// Used so the live broadcast shows the correct "next hole" when the
// player starts mid-round (e.g. starts on 10 → next is 11, not 1).
function findCurrentHole(holes) {
  const isScored = h => h.score !== '' && h.score !== null && h.score !== undefined;
  const scoredCount = holes.filter(isScored).length;
  if (scoredCount === 0) return holes[0] || null;
  if (scoredCount === holes.length) return null;
  // Return the first unscored hole whose previous hole (wrapping)
  // has been scored — i.e. the next sequential hole to play.
  for (let i = 0; i < holes.length; i++) {
    if (!isScored(holes[i])) {
      const prevIdx = (i - 1 + holes.length) % holes.length;
      if (isScored(holes[prevIdx])) return holes[i];
    }
  }
  return holes.find(h => !isScored(h)) || null;
}

function createBlankHoles() {
  return Array.from({ length: 18 }, (_, i) => ({
    number: i + 1, par: 4, yards: 0,
    score: '', putts: '', firstPuttLength: '', fairwayHit: null, fairwayMissDirection: null, gir: null,
    fairwayBunker: false, greensideBunker: false, ob: false, water: false, notes: ''
  }));
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function saveRoundsToStorage(rs) {
  try { localStorage.setItem('golf_rounds', JSON.stringify(rs)); } catch (e) {}
}

function loadCustomCourses() {
  try { return JSON.parse(localStorage.getItem('golf_custom_courses') || '[]'); } catch { return []; }
}

function persistCustomCourses(courses) {
  try { localStorage.setItem('golf_custom_courses', JSON.stringify(courses)); } catch {}
}

// ============================================================
// IMAGE COMPRESSION — resize to ≤1600px and re-encode as JPEG
// keeps upload under the 10 MB serverless body limit
// ============================================================
function compressImage(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
    img.src = url;
  });
}

// ============================================================
// GEMINI VISION — calls our own serverless proxy (key stays server-side)
// ============================================================
async function scanScorecardWithGemini(base64Image, mediaType) {
  const response = await fetch('/api/scan-scorecard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Image, mediaType })
  });

  // Guard against non-JSON responses (e.g. Vercel HTML error pages)
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Server error ${response.status} — image may be too large or server crashed`);
  }

  if (!response.ok) throw new Error(data?.error || `Server error ${response.status}`);
  return data;
}

// ============================================================
// GOOGLE CALENDAR HELPER — archived, uncomment to restore
// ============================================================
/* async function addRoundToCalendar(round, stats) {
  const token = localStorage.getItem('google_calendar_token');
  if (!token) return { ok: false, msg: 'Not signed in to Google' };
  try {
    const d = new Date(round.date);
    const end = new Date(d.getTime() + 4 * 60 * 60 * 1000);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const lines = [
      `Course: ${round.courseName}`,
      `Tee: ${round.tee}`,
      `Score: ${stats.totalScore} (${stats.scoreDiff >= 0 ? '+' : ''}${stats.scoreDiff} vs par)`,
      stats.fwPct !== null ? `Fairways: ${stats.fwPct}%` : null,
      stats.girPct !== null ? `GIR: ${stats.girPct}%` : null,
      stats.avgPutts ? `Avg Putts: ${stats.avgPutts}` : null,
      `\nTracked with Grady GolfTrack`,
    ].filter(Boolean);
    const event = {
      summary: `⛳ Golf - ${round.courseName}`,
      description: lines.join('\n'),
      start: { dateTime: d.toISOString(), timeZone: tz },
      end: { dateTime: end.toISOString(), timeZone: tz },
      colorId: '2',
    };
    const r = await fetch('/api/calendar/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(event),
    });
    const data = await r.json();
    if (!r.ok) return { ok: false, msg: data.error?.message || 'Failed to create event' };
    return { ok: true, msg: '✓ Added to Google Calendar!' };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
} */

// ============================================================
// NUMBER STEPPER — +/- buttons for score and putts
// ============================================================
function NumberStepper({ value, onChange, min = 0, max = 20, defaultVal }) {
  const num = (value !== '' && value !== null && value !== undefined) ? parseInt(value) : null;

  const decrement = () => {
    if (num === null) return;
    const next = num - 1;
    if (next < min) { onChange(''); return; }
    onChange(String(next));
  };

  const increment = () => {
    if (num === null) { onChange(String(defaultVal ?? min)); return; }
    if (num >= max) return;
    onChange(String(num + 1));
  };

  return (
    <div className="stepper">
      <button className="stepper-btn" onClick={decrement}>−</button>
      <span className="stepper-val">{num !== null ? num : '—'}</span>
      <button className="stepper-btn" onClick={increment}>+</button>
    </div>
  );
}

// ============================================================
// HOLE CARD
// ============================================================
function HoleMedia({ roundId, holeNumber, media, onChange }) {
  const [uploads, setUploads] = React.useState([]);
  const [lightbox, setLightbox] = React.useState(null);
  const fileInputRef = React.useRef(null);

  if (!roundId) {
    return (
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
        Save the round to attach photos or videos.
      </div>
    );
  }

  const handleFiles = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;

    files.forEach(file => {
      if (file.size > 200 * 1024 * 1024) {
        alert(`${file.name} is over 200MB — please pick a smaller clip.`);
        return;
      }
      const id = genId();
      const isVideo = file.type.startsWith('video/');
      const ext = (file.name.split('.').pop() || (isVideo ? 'mp4' : 'jpg')).toLowerCase();
      const path = `rounds/${roundId}/hole_${holeNumber}/${id}.${ext}`;

      setUploads(u => [...u, { id, type: isVideo ? 'video' : 'image', progress: 0 }]);
      const ref = storageRef(storage, path);
      const task = uploadBytesResumable(ref, file, { contentType: file.type });
      task.on(
        'state_changed',
        snap => {
          const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
          setUploads(u => u.map(x => x.id === id ? { ...x, progress: pct } : x));
        },
        err => {
          console.error('Upload failed:', err);
          setUploads(u => u.map(x => x.id === id ? { ...x, error: err.code || 'failed' } : x));
        },
        async () => {
          try {
            const url = await getDownloadURL(task.snapshot.ref);
            const item = { id, type: isVideo ? 'video' : 'image', url, path, addedAt: Date.now() };
            onChange({ media: [...(media || []), item] });
          } catch (e) { console.error('getDownloadURL failed:', e); }
          setUploads(u => u.filter(x => x.id !== id));
        }
      );
    });
  };

  const handleDelete = async (item) => {
    if (!window.confirm('Delete this attachment?')) return;
    try { await deleteObject(storageRef(storage, item.path)); }
    catch (e) { console.warn('Storage delete failed (may already be gone):', e.code); }
    onChange({ media: (media || []).filter(m => m.id !== item.id) });
  };

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
        {(media || []).map(item => (
          <div key={item.id} style={{ position: 'relative', width: 80, height: 80 }}>
            <button
              onClick={() => setLightbox(item)}
              style={{
                width: '100%', height: '100%', padding: 0,
                border: '1px solid var(--border)', borderRadius: 8,
                background: 'var(--card)', cursor: 'pointer', overflow: 'hidden',
                position: 'relative',
              }}
            >
              {item.type === 'video' ? (
                <video src={item.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline preload="metadata" />
              ) : (
                <img src={item.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
              {item.type === 'video' && (
                <span style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontSize: 24, textShadow: '0 1px 4px rgba(0,0,0,0.7)',
                  pointerEvents: 'none',
                }}>▶</span>
              )}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
              title="Delete"
              style={{
                position: 'absolute', top: 2, right: 2,
                width: 22, height: 22, padding: 0, lineHeight: 1,
                background: 'rgba(0,0,0,0.6)', color: 'white',
                border: 'none', borderRadius: '50%',
                fontSize: 16, cursor: 'pointer',
              }}
            >×</button>
          </div>
        ))}
        {uploads.map(u => (
          <div key={u.id} style={{
            width: 80, height: 80, borderRadius: 8,
            border: '1px dashed var(--blue)', background: 'var(--card)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, color: u.error ? 'var(--red)' : 'var(--blue)', gap: 3, fontWeight: 700,
          }}>
            {u.error ? <span>Failed</span> : <><span>UPLOADING</span><span>{Math.round(u.progress)}%</span></>}
          </div>
        ))}
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: 80, height: 80, borderRadius: 8,
            border: '2px dashed var(--accent)',
            background: 'transparent', color: 'var(--accent)',
            cursor: 'pointer', fontSize: 28, fontWeight: 800, lineHeight: 1,
          }}
          title="Add photo or video"
        >+</button>
        <input
          ref={fileInputRef} type="file" accept="image/*,video/*" multiple
          style={{ display: 'none' }} onChange={handleFiles}
        />
      </div>
      {lightbox && <MediaLightbox item={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function MediaLightbox({ item, onClose }) {
  React.useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12,
      }}
    >
      {item.type === 'video' ? (
        <video src={item.url} controls autoPlay playsInline
          style={{ maxWidth: '100%', maxHeight: '100%' }}
          onClick={e => e.stopPropagation()} />
      ) : (
        <img src={item.url} alt=""
          style={{ maxWidth: '100%', maxHeight: '100%' }}
          onClick={e => e.stopPropagation()} />
      )}
      <button onClick={onClose} style={{
        position: 'absolute', top: 16, right: 16,
        width: 36, height: 36, padding: 0, lineHeight: 1,
        background: 'rgba(0,0,0,0.6)', color: 'white',
        border: 'none', borderRadius: '50%',
        fontSize: 22, cursor: 'pointer',
      }}>×</button>
    </div>
  );
}

// ============================================================
function HoleCard({ hole, onChange, isManual, roundId }) {
  const [expanded, setExpanded] = React.useState(false);
  const scoreClass = holeScoreClass(hole.score, hole.par);
  const diff = hole.score !== '' && hole.score !== null ? parseInt(hole.score) - hole.par : null;

  return (
    <div className={`hole-card${expanded ? ' expanded' : ''}`}>
      <div className="hole-card-header" onClick={() => setExpanded(e => !e)}>
        <div className="hole-num">{hole.number}</div>
        <div className="hole-info">
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Hole {hole.number}</span>
          <span className="hole-par-yds">Par {hole.par} · {hole.yards}y</span>
        </div>
        {diff !== null && (
          <span style={{
            fontSize: '0.78rem', fontWeight: 700, marginRight: 4,
            color: diff < 0 ? 'var(--red)' : diff > 0 ? 'var(--blue)' : 'var(--text-dim)'
          }}>
            {scoreDiffLabel(diff)}
          </span>
        )}
        <div className={`hole-score-badge ${scoreClass}`}>
          {hole.score !== '' && hole.score !== null ? hole.score : '–'}
        </div>
        <span className={`chevron${expanded ? ' open' : ''}`}>▼</span>
      </div>

      {expanded && (
        <div className="hole-card-body">
          {isManual && (
            <div className="stat-row" style={{ marginTop: 12 }}>
              <div className="stat-item">
                <label className="form-label" style={{ marginBottom: 6 }}>Par</label>
                <div className="toggle-buttons">
                  {[3, 4, 5].map(p => (
                    <button key={p} className={`chip${hole.par === p ? ' active' : ''}`}
                      onClick={() => onChange({ par: p })}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div className="stat-item">
                <label>Yards</label>
                <input type="number" className="score-input" value={hole.yards || ''}
                  min={0} max={999} placeholder="0"
                  onChange={e => onChange({ yards: parseInt(e.target.value) || 0 })} />
              </div>
            </div>
          )}
          <div className="stat-row" style={{ marginTop: 12 }}>
            <div className="stat-item">
              <label>Score</label>
              <NumberStepper value={hole.score} min={1} max={15} defaultVal={hole.par}
                onChange={v => onChange({ score: v })} />
            </div>
            <div className="stat-item">
              <label>Putts</label>
              <NumberStepper value={hole.putts} min={0} max={10} defaultVal={1}
                onChange={v => onChange({ putts: v })} />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="form-label" style={{ marginBottom: 6 }}>1st Putt Distance</label>
            <select className="putt-length-select"
              value={hole.firstPuttLength || ''}
              onChange={e => onChange({ firstPuttLength: e.target.value ? parseInt(e.target.value) : '' })}>
              <option value="">— not recorded —</option>
              {FIRST_PUTT_OPTIONS.map(ft => (
                <option key={ft} value={ft}>{ft} ft</option>
              ))}
            </select>
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="form-label" style={{ marginBottom: 6 }}>Fairway</label>
            <div className="toggle-buttons">
              {hole.par === 3 ? (
                <span className="chip na">N/A (Par 3)</span>
              ) : (
                <>
                  <button className={`chip${hole.fairwayHit === true ? ' active' : ''}`}
                    onClick={() => onChange({ fairwayHit: hole.fairwayHit === true ? null : true, fairwayMissDirection: null })}>
                    ✓ Hit
                  </button>
                  <button className={`chip${hole.fairwayHit === false ? ' active red' : ''}`}
                    onClick={() => {
                      const next = hole.fairwayHit === false ? null : false;
                      onChange({ fairwayHit: next, ...(next !== false ? { fairwayMissDirection: null } : {}) });
                    }}>
                    ✗ Miss
                  </button>
                </>
              )}
            </div>
            {hole.fairwayHit === false && (
              <div style={{ marginTop: 8 }}>
                <label className="form-label" style={{ marginBottom: 6, fontSize: '0.78rem', color: 'var(--text-muted)' }}>Miss Direction</label>
                <div className="toggle-buttons">
                  <button className={`chip${hole.fairwayMissDirection === 'left' ? ' active red' : ''}`}
                    onClick={() => onChange({ fairwayMissDirection: hole.fairwayMissDirection === 'left' ? null : 'left' })}>
                    ◀ Left
                  </button>
                  <button className={`chip${hole.fairwayMissDirection === 'right' ? ' active red' : ''}`}
                    onClick={() => onChange({ fairwayMissDirection: hole.fairwayMissDirection === 'right' ? null : 'right' })}>
                    Right ▶
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="form-label" style={{ marginBottom: 6 }}>GIR (Green in Regulation)</label>
            <div className="toggle-buttons">
              <button className={`chip${hole.gir === true ? ' active' : ''}`}
                onClick={() => onChange({ gir: hole.gir === true ? null : true })}>
                ✓ Yes
              </button>
              <button className={`chip${hole.gir === false ? ' active red' : ''}`}
                onClick={() => onChange({ gir: hole.gir === false ? null : false })}>
                ✗ No
              </button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="form-label" style={{ marginBottom: 6 }}>Penalties &amp; Hazards</label>
            <div className="toggle-buttons">
              <button className={`chip${hole.fairwayBunker ? ' active' : ''}`}
                onClick={() => onChange({ fairwayBunker: !hole.fairwayBunker })}>FW Bunker</button>
              <button className={`chip${hole.greensideBunker ? ' active' : ''}`}
                onClick={() => onChange({ greensideBunker: !hole.greensideBunker })}>GS Bunker</button>
              <button className={`chip${hole.ob ? ' active red' : ''}`}
                onClick={() => onChange({ ob: !hole.ob })}>OB</button>
              <button className={`chip${hole.water ? ' active blue' : ''}`}
                onClick={() => onChange({ water: !hole.water })}>Water</button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="form-label">Photos / Videos</label>
            <HoleMedia
              roundId={roundId}
              holeNumber={hole.number}
              media={hole.media}
              onChange={onChange}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="form-label">Notes</label>
            <textarea className="notes-input" rows={2} value={hole.notes}
              placeholder="Optional notes…"
              onChange={e => onChange({ notes: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SETUP SCREEN
// ============================================================
function SetupScreen({ onStart, preloadCourseName, customCourses, onSaveCustomCourse, onDeleteCustomCourse }) {
  const playerName = 'Grady';
  const [roundType, setRoundType] = React.useState('practice');
  const [courseSearch, setCourseSearch] = React.useState('');
  const [selectedCourse, setSelectedCourse] = React.useState(null);
  const [scanStatus, setScanStatus] = React.useState(null);
  const [scanMsg, setScanMsg] = React.useState('');
  const [scannedTees, setScannedTees] = React.useState(null);
  const fileRef = React.useRef(null);
  const [manualCourseName, setManualCourseName] = React.useState(preloadCourseName || '');
  const [manualTeeName, setManualTeeName] = React.useState('');
  const [showManualForm, setShowManualForm] = React.useState(!!preloadCourseName);
  const [showBuiltIn, setShowBuiltIn] = React.useState(false);

  const allCourses = [...customCourses, ...COURSES];
  const filtered = allCourses.filter(c =>
    c.name.toLowerCase().includes(courseSearch.toLowerCase()) ||
    (c.location || '').toLowerCase().includes(courseSearch.toLowerCase())
  );

  const handleScan = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setScanStatus('loading');
    setScanMsg('Compressing image…');
    setSelectedCourse(null);
    setManualCourseName('');

    let dataUrl;
    try {
      dataUrl = await compressImage(file);
    } catch (err) {
      setScanStatus('error');
      setScanMsg('Could not read image: ' + err.message);
      return;
    }

    const base64 = dataUrl.split(',')[1];
    setScanMsg('Analyzing scorecard with Gemini AI…');

    try {
      const result = await scanScorecardWithGemini(base64, 'image/jpeg');
      setScannedTees(result);
      setScanStatus('success');
      setScanMsg(
        (result.courseName ? result.courseName + ' — ' : '') +
        (result.tees?.length || 0) + ' tee(s) found: ' +
        (result.tees?.map(t => t.name).join(', ') || '')
      );
      // Auto-save scanned course to custom courses
      if (result.courseName && result.tees?.length) {
        const courseId = 'custom_' + result.courseName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        onSaveCustomCourse({
          id: courseId,
          name: result.courseName,
          location: '',
          tees: result.tees,
          isCustom: true,
        });
      }
    } catch (err) {
      setScanStatus('error');
      setScanMsg('Scan failed: ' + err.message);
    }
  };

  const isManualMode = !selectedCourse && !scannedTees?.tees?.length && manualCourseName.trim();
  const canStart = !!(selectedCourse || scannedTees?.tees?.length || manualCourseName.trim());

  const handleStart = () => {
    localStorage.setItem('golf_player_name', playerName.trim());
    if (isManualMode) {
      const tee = {
        name: manualTeeName.trim() || 'Manual',
        color: 'white',
        holes: createBlankHoles(),
      };
      const courseId = 'custom_manual_' + manualCourseName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const course = {
        id: courseId,
        name: manualCourseName.trim(),
        location: '',
        tees: [tee],
        isCustom: true,
      };
      onSaveCustomCourse(course);
      onStart({ playerName: playerName.trim(), roundType, course, selectedTee: tee });
    } else {
      let course;
      if (selectedCourse) {
        // Pass through full course incl. isCustom flag so renames know whether to overwrite the existing doc
        course = {
          id: selectedCourse.id,
          name: selectedCourse.name,
          location: selectedCourse.location,
          tees: selectedCourse.tees,
          isCustom: !!selectedCourse.isCustom,
        };
      } else {
        // Scan path — use the same custom_<name> id as the auto-saved doc so rename overwrites the right Firestore record
        const scannedName = scannedTees.courseName || 'Scanned Course';
        const scannedId = 'custom_' + scannedName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        course = { id: scannedId, name: scannedName, location: '', tees: scannedTees.tees, isCustom: true };
      }
      onStart({ playerName: playerName.trim(), roundType, course });
    }
  };

  return (
    <div className="screen screen-setup">
      <h2 style={{ marginBottom: 14 }}>New Round</h2>

      <div className="form-group">
        <label className="form-label">Round Type</label>
        <div className="toggle-group">
          <button className={`toggle-btn${roundType === 'practice' ? ' active' : ''}`}
            onClick={() => setRoundType('practice')}>Practice</button>
          <button className={`toggle-btn${roundType === 'competition' ? ' active competition' : ''}`}
            onClick={() => setRoundType('competition')}>Competition</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--blue)', marginBottom: 10 }}>Scan Scorecard — Gemini AI</div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginBottom: 10 }}>
          Take a photo or upload a scorecard image and AI will extract all tee boxes and hole data automatically.
        </p>
        <button className="btn btn-primary" onClick={() => fileRef.current?.click()}
          disabled={scanStatus === 'loading'}>
          {scanStatus === 'loading' ? 'Scanning…' : 'Choose Photo or Take Picture'}
        </button>
        <input ref={fileRef} type="file" accept="image/*"
          style={{ display: 'none' }} onChange={handleScan} />
        {scanStatus && (
          <div className={`scan-status ${scanStatus}`} style={{ marginTop: 10 }}>
            {scanStatus === 'loading' && <div className="spinner" />}
            {scanStatus === 'success' && <span style={{ marginRight: 4 }}>✓</span>}
            {scanStatus === 'error' && <span style={{ marginRight: 4 }}>✗</span>}
            <span>{scanMsg}</span>
          </div>
        )}
        {scannedTees?.courseName && (
          <div style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600 }}>
            {scannedTees.courseName}
          </div>
        )}
      </div>

      <div className={'collapsible-card' + (showManualForm ? ' open' : '')} style={{ marginBottom: 10 }}>
        <button className="collapsible-header" onClick={() => setShowManualForm(v => !v)}>
          <span>Enter Course Manually</span>
          <span className="collapsible-chevron">{showManualForm ? '▴' : '▾'}</span>
        </button>
        {showManualForm && (
          <div className="collapsible-body">
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label">Course Name</label>
              <input className="form-input" type="text" value={manualCourseName}
                onChange={e => { setManualCourseName(e.target.value); setSelectedCourse(null); setScannedTees(null); setScanStatus(null); }}
                placeholder="e.g. Pebble Beach Golf Links" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Tee Name</label>
              <input className="form-input" type="text" value={manualTeeName}
                onChange={e => setManualTeeName(e.target.value)}
                placeholder="e.g. Blue, White, Red" />
            </div>
            {manualCourseName.trim() && (
              <p style={{ fontSize: '0.78rem', color: 'var(--accent)', marginTop: 10 }}>
                ✓ You'll enter par and yardage per hole on the round screen.
              </p>
            )}
          </div>
        )}
      </div>

      <div className={'collapsible-card' + (showBuiltIn ? ' open' : '')} style={{ marginBottom: 10 }}>
        <button className="collapsible-header" onClick={() => setShowBuiltIn(v => !v)}>
          <span>Pick a Built-in Course{selectedCourse ? ` · ${selectedCourse.name}` : ''}</span>
          <span className="collapsible-chevron">{showBuiltIn ? '▴' : '▾'}</span>
        </button>
        {showBuiltIn && (
          <div className="collapsible-body">
            <input className="form-input" style={{ marginBottom: 8 }} type="text"
              value={courseSearch} onChange={e => setCourseSearch(e.target.value)}
              placeholder="Search courses…" />
            {courseSearch.trim() && <div className="course-list">
              {filtered.length === 0
                ? <div style={{ padding: '12px 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>No courses match "{courseSearch}"</div>
                : filtered.map(c => (
                <div key={c.id}
                  className={`course-item${selectedCourse?.id === c.id ? ' selected' : ''}`}
                  onClick={() => { setSelectedCourse(c); setScannedTees(null); setScanStatus(null); }}>
                  <div style={{ flex: 1 }}>
                    <div className="course-item-name">
                      {c.name}
                      {c.isCustom && <span className="custom-course-badge">Saved</span>}
                    </div>
                  </div>
                  {c.isCustom && (
                    <button className="delete-course-btn"
                      onClick={e => { e.stopPropagation(); onDeleteCustomCourse(c.id); if (selectedCourse?.id === c.id) setSelectedCourse(null); }}>
                      ✕
                    </button>
                  )}
                  {selectedCourse?.id === c.id && <span style={{ color: 'var(--accent)' }}>✓</span>}
                </div>
              ))}
            </div>}
          </div>
        )}
      </div>

      <WatchLiveCard />

      <button className="btn btn-primary" disabled={!canStart} onClick={handleStart} style={{ marginTop: 8 }}>
        {isManualMode ? 'Start Round →' : 'Select Tee Box →'}
      </button>
    </div>
  );
}

// ============================================================
// TEE SELECT SCREEN
// ============================================================
function TeeSelectScreen({ course, onSelectTee, onBack, onRenameCourse }) {
  const [selected, setSelected] = React.useState(null);
  const [editingName, setEditingName] = React.useState(false);
  const [draftName, setDraftName] = React.useState(course.name);
  const inputRef = React.useRef(null);
  const totalYards = (tee) => tee.holes.reduce((s, h) => s + h.yards, 0);

  React.useEffect(() => { setDraftName(course.name); }, [course.name]);
  React.useEffect(() => {
    if (editingName && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingName]);

  const commitRename = () => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== course.name && onRenameCourse) {
      onRenameCourse(trimmed);
    } else {
      setDraftName(course.name);
    }
    setEditingName(false);
  };

  return (
    <div className="screen">
      <button className="btn btn-secondary btn-sm" style={{ marginBottom: 16, width: 'auto' }} onClick={onBack}>
        ← Back
      </button>
      <div style={{ marginBottom: 20 }}>
        {editingName ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              ref={inputRef}
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setDraftName(course.name); setEditingName(false); }
              }}
              onBlur={commitRename}
              maxLength={80}
              style={{
                flex: 1, fontSize: '1.25rem', fontWeight: 600,
                padding: '6px 10px', borderRadius: 8,
                border: '1.5px solid var(--accent)', background: 'var(--card)', color: 'var(--text)',
              }}
            />
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={commitRename}
              style={{
                background: 'var(--accent)', color: 'var(--card)', border: 'none',
                borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700,
                cursor: 'pointer', letterSpacing: 0.5,
              }}
            >SAVE</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>{course.name}</h2>
            <button
              onClick={() => setEditingName(true)}
              title="Edit course name"
              style={{
                background: 'transparent', border: '1px solid var(--blue)', color: 'var(--blue)',
                borderRadius: 16, padding: '3px 10px', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', letterSpacing: 0.5,
              }}
            >EDIT NAME</button>
          </div>
        )}
        {course.location && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{course.location}</p>}
      </div>
      <p style={{ color: 'var(--text-dim)', marginBottom: 14, fontSize: '0.9rem' }}>
        Select your tee box to pre-fill hole yardages and pars:
      </p>
      <div className="tee-grid">
        {course.tees.map((tee, i) => (
          <button key={i} className={`tee-btn${selected === i ? ' selected' : ''}`}
            onClick={() => setSelected(i)}>
            <div className="tee-btn-header">
              <div className="tee-dot" style={{ background: getTeeColor(tee.color), border: '2px solid rgba(255,255,255,0.2)' }} />
              <span className="tee-name">{tee.name}</span>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
              <span className="tee-yardage">{totalYards(tee).toLocaleString()} yds</span>
            </div>
            <div style={{ marginTop: 6 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Par {tee.holes.reduce((s, h) => s + h.par, 0)} · {tee.holes.filter(h => h.par === 3).length} par 3s · {tee.holes.filter(h => h.par === 5).length} par 5s
              </span>
            </div>
          </button>
        ))}
      </div>
      <button className="btn btn-primary" style={{ marginTop: 16 }}
        disabled={selected === null}
        onClick={() => onSelectTee(course.tees[selected])}>
        Start Round →
      </button>
    </div>
  );
}

// ============================================================
// ROUND SCREEN
// ============================================================
// Tap-to-copy code box used in the live share panel
function CodeCopyBox({ code }) {
  const [copied, setCopied] = React.useState(false);
  function handleCopy() {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }
  return (
    <div
      onClick={handleCopy}
      style={{
        background: 'var(--card)', border: '2px solid var(--accent)', borderRadius: 12,
        padding: '14px 16px', textAlign: 'center', cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--accent)', letterSpacing: 4, fontFamily: 'monospace' }}>
        {code}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
        {copied ? '✓ Copied to clipboard!' : 'Tap to copy code'}
      </div>
    </div>
  );
}

// ============================================================
// OPPONENTS PANEL — track opponent names + scores per hole
// ============================================================
function OpponentsPanel({ playerName, opponents, holes, onAdd, onRemove, onUpdate, onUpdateScore }) {
  const [open, setOpen] = React.useState(opponents.length > 0);

  React.useEffect(() => {
    if (opponents.length > 0) setOpen(true);
  }, [opponents.length]);

  const hasScore = (v) => v !== '' && v !== null && v !== undefined;
  const toInt = (v) => (hasScore(v) ? parseInt(v) || 0 : 0);
  const sumRange = (scores, start, end) => scores.slice(start, end).reduce((s, v) => s + toInt(v), 0);
  const countRange = (scores, start, end) => scores.slice(start, end).filter(hasScore).length;
  const scoreColor = (v, par) => {
    if (!hasScore(v) || !par) return 'var(--text)';
    const d = parseInt(v) - par;
    if (d < 0) return 'var(--red)';
    if (d > 0) return 'var(--blue)';
    return 'var(--accent)';
  };

  const front = holes.slice(0, 9);
  const back = holes.slice(9, 18);
  const parOut = front.reduce((s, h) => s + (h.par || 0), 0);
  const parIn = back.reduce((s, h) => s + (h.par || 0), 0);

  const players = [
    { id: '__you', name: playerName || 'You', isYou: true, scores: holes.map(h => h.score) },
    ...opponents.map(o => ({ id: o.id, name: o.name || '', isYou: false, scores: o.scores || Array(holes.length).fill('') })),
  ];

  const gridCols = (n) => `70px repeat(${n}, minmax(0, 1fr)) 36px`;
  const cellBase = { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 28, fontSize: 12, fontWeight: 700, borderRadius: 4 };
  const headerCell = { ...cellBase, fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: 0.3, background: 'transparent', minHeight: 18 };
  const parCell = { ...cellBase, background: 'var(--card2)', color: 'var(--text-dim)' };
  const totalCell = { ...cellBase, background: 'var(--card2)', color: 'var(--blue)', fontWeight: 800 };
  const nameCell = { ...cellBase, justifyContent: 'flex-start', paddingLeft: 6, gap: 4, overflow: 'hidden' };

  function renderNine(sectionLabel, totalLabel, sectionHoles, parTotal, startIdx) {
    const n = sectionHoles.length;
    if (n === 0) return null;
    const cols = gridCols(n);
    return (
      <div style={{ marginBottom: 12 }}>
        {/* Hole number header */}
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 2, marginBottom: 2 }}>
          <div style={{ ...headerCell, justifyContent: 'flex-start', paddingLeft: 6 }}>{sectionLabel}</div>
          {sectionHoles.map(h => <div key={h.number} style={headerCell}>{h.number}</div>)}
          <div style={headerCell}>{totalLabel}</div>
        </div>
        {/* Par row */}
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 2, marginBottom: 2 }}>
          <div style={{ ...parCell, justifyContent: 'flex-start', paddingLeft: 6, fontSize: 10 }}>PAR</div>
          {sectionHoles.map(h => <div key={h.number} style={parCell}>{h.par || '–'}</div>)}
          <div style={totalCell}>{parTotal || '–'}</div>
        </div>
        {/* Player rows */}
        {players.map(p => {
          const tot = sumRange(p.scores, startIdx, startIdx + n);
          const played = countRange(p.scores, startIdx, startIdx + n);
          const parPlayedSec = p.scores.slice(startIdx, startIdx + n).reduce((s, v, idx) => s + (hasScore(v) ? (sectionHoles[idx]?.par || 0) : 0), 0);
          const diff = played > 0 ? tot - parPlayedSec : null;
          const diffColor = diff === null ? 'var(--text-dim)' : diff < 0 ? 'var(--red)' : diff > 0 ? 'var(--blue)' : 'var(--accent)';
          return (
            <div key={p.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 2, marginBottom: 2 }}>
              <div style={nameCell}>
                <span style={{
                  fontSize: 11, fontWeight: p.isYou ? 800 : 700,
                  color: p.isYou ? 'var(--blue)' : 'var(--text)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  maxWidth: '100%',
                }}>
                  {p.isYou ? p.name : (p.name || 'Opponent')}
                </span>
              </div>
              {sectionHoles.map((h, j) => {
                const i = startIdx + j;
                const v = p.scores[i] ?? '';
                const color = scoreColor(v, h.par);
                if (p.isYou) {
                  return (
                    <div key={h.number} style={{ ...cellBase, background: 'var(--bg)', border: '1px solid var(--border)', color }}>
                      {hasScore(v) ? v : '–'}
                    </div>
                  );
                }
                return (
                  <input
                    key={h.number}
                    type="number" inputMode="numeric" min={1} max={20}
                    value={v}
                    onChange={e => onUpdateScore(p.id, i, e.target.value)}
                    placeholder=""
                    style={{
                      ...cellBase, color, textAlign: 'center',
                      background: 'var(--bg)', border: '1px solid var(--border)',
                      padding: 0, MozAppearance: 'textfield', width: '100%',
                    }}
                  />
                );
              })}
              <div style={{ ...totalCell, color: diffColor }}>
                {played > 0 ? tot : '–'}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={'collapsible-card' + (open ? ' open' : '')} style={{ marginBottom: 10 }}>
      <button className="collapsible-header" onClick={() => setOpen(o => !o)}>
        <span>Scorecard{opponents.length > 0 ? ` · ${opponents.length} opponent${opponents.length === 1 ? '' : 's'}` : ''}</span>
        <span className="collapsible-chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="collapsible-body">
          {opponents.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Add opponents to track their score alongside yours, hole by hole.
            </div>
          )}
          {opponents.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              {opponents.map(o => (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <input
                    type="text" value={o.name || ''} placeholder="Opponent name" maxLength={30}
                    onChange={e => onUpdate(o.id, { name: e.target.value })}
                    style={{
                      flex: 1, minWidth: 0,
                      fontSize: 14, fontWeight: 600,
                      padding: '8px 10px', borderRadius: 8,
                      border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
                    }}
                  />
                  <button
                    onClick={() => { if (window.confirm(`Remove ${o.name || 'this opponent'} from the round?`)) onRemove(o.id); }}
                    title="Remove opponent"
                    style={{
                      flex: '0 0 auto', width: 32, height: 32, padding: 0,
                      background: 'transparent', border: '1px solid var(--red)',
                      color: 'var(--red)', borderRadius: 8,
                      fontSize: 18, fontWeight: 700, cursor: 'pointer', lineHeight: 1,
                    }}
                  >×</button>
                </div>
              ))}
            </div>
          )}
          {renderNine('FRONT', 'OUT', front, parOut, 0)}
          {renderNine('BACK', 'IN', back, parIn, 9)}
          {/* Totals row */}
          <div style={{ display: 'grid', gridTemplateColumns: gridCols(1), gap: 2, marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
            <div style={{ ...headerCell, justifyContent: 'flex-start', paddingLeft: 4 }}>TOTAL</div>
            <div style={headerCell}></div>
            <div style={headerCell}>TOT</div>
            <div style={{ ...parCell, justifyContent: 'flex-start', paddingLeft: 4, fontSize: 10 }}>PAR</div>
            <div style={parCell}></div>
            <div style={totalCell}>{(parOut + parIn) || '–'}</div>
            {players.map(p => {
              const tot = sumRange(p.scores, 0, holes.length);
              const played = countRange(p.scores, 0, holes.length);
              const parPlayed = p.scores.reduce((s, v, i) => s + (hasScore(v) ? (holes[i]?.par || 0) : 0), 0);
              const diff = played > 0 ? tot - parPlayed : null;
              const diffColor = diff === null ? 'var(--text-dim)' : diff < 0 ? 'var(--red)' : diff > 0 ? 'var(--blue)' : 'var(--accent)';
              return (
                <React.Fragment key={p.id}>
                  <div style={{ ...nameCell, gridColumn: '1 / span 2' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: p.isYou ? 'var(--blue)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.isYou ? p.name : (p.name || '—')}
                    </span>
                    {played > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: diffColor, marginLeft: 4 }}>
                        {scoreDiffLabel(diff)}
                      </span>
                    )}
                  </div>
                  <div style={{ ...totalCell, color: diffColor }}>{played > 0 ? tot : '–'}</div>
                </React.Fragment>
              );
            })}
          </div>
          <button
            onClick={onAdd}
            className="btn btn-secondary"
            style={{ width: '100%', fontWeight: 700, marginTop: 10 }}
          >
            + Add Opponent
          </button>
        </div>
      )}
    </div>
  );
}

function RoundScreen({ round, onUpdateHole, onAddOpponent, onRemoveOpponent, onUpdateOpponent, onUpdateOpponentScore, onFinish, onSave, saved, isManual, isLive, liveId, onToggleLive, showSharePanel, onShowShare, onHideShare, liveStatus, liveSyncing }) {
  const stats = calcStats(round.holes);
  const [copied, setCopied] = React.useState(false);

  const liveUrl = liveId
    ? `${window.location.origin}${window.location.pathname}#/live/${liveId}`
    : '';

  function copyLink() {
    if (!liveUrl) return;
    navigator.clipboard.writeText(liveUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  function shareLink() {
    if (!liveUrl) return;
    if (navigator.share) {
      navigator.share({
        title: `${round.playerName} is playing live golf`,
        text: `Follow ${round.playerName}'s round at ${round.courseName} — Live code: ${liveId}`,
        url: liveUrl,
      }).catch(() => {});
    } else {
      copyLink();
    }
  }

  return (
    <div>
      {/* Summary bar */}
      <div className="round-summary-bar">
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>
            {round.courseName} · {round.tee}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="round-score-big">{stats?.totalScore ?? '—'}</span>
            {stats?.scoreDiff !== undefined && stats.scoreDiff !== null && (
              <span className={`vs-par ${scoreDiffClass(stats.scoreDiff)}`}>
                {scoreDiffLabel(stats.scoreDiff)}
              </span>
            )}
            {isLive && <span className="live-badge">● LIVE</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {stats?.holesPlayed ?? 0}/18 holes
          </div>
          {stats && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
              {stats.fwPct !== null ? 'FW ' + stats.fwPct + '%' : ''}{stats.girPct !== null ? ' · GIR ' + stats.girPct + '%' : ''}
            </div>
          )}
          {stats && (stats.sgPutting !== null || stats.sgT2G !== null) && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
              {stats.sgPutting !== null && (
                <>SG Putt <span style={{ color: stats.sgPutting > 0 ? 'var(--red)' : stats.sgPutting < 0 ? 'var(--blue)' : 'var(--text)', fontWeight: 700 }}>{stats.sgPutting > 0 ? '+' : ''}{stats.sgPutting}</span></>
              )}
              {stats.sgPutting !== null && stats.sgT2G !== null && ' · '}
              {stats.sgT2G !== null && (
                <>SG T2G <span style={{ color: stats.sgT2G > 0 ? 'var(--red)' : stats.sgT2G < 0 ? 'var(--blue)' : 'var(--text)', fontWeight: 700 }}>{stats.sgT2G > 0 ? '+' : ''}{stats.sgT2G}</span></>
              )}
            </div>
          )}
          <button
            onClick={onToggleLive}
            style={{
              background: isLive ? 'rgba(255,77,79,0.15)' : 'rgba(76,175,80,0.12)',
              border: `1px solid ${isLive ? '#ff4d4f' : 'var(--accent)'}`,
              color: isLive ? '#ff4d4f' : 'var(--accent)',
              borderRadius: 20, padding: '4px 10px',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {isLive ? '⏹ Stop Live' : '📡 Go Live'}
          </button>
        </div>
      </div>

      {/* Share panel (full) */}
      {isLive && showSharePanel && (
        <div style={{ background: 'var(--surface)', borderBottom: '2px solid var(--accent)', padding: '16px 16px 20px', position: 'relative' }}>
          <button onClick={onHideShare} style={{ position: 'absolute', top: 10, right: 14, background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>

          {/* Connection status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span className="live-badge">● LIVE</span>
            {liveStatus === 'ok' && !liveSyncing && <span style={{ fontSize: 12, color: '#52c41a', fontWeight: 700 }}>✓ Connected</span>}
            {liveSyncing && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Syncing…</span>}
            {liveStatus === 'error' && <span style={{ fontSize: 12, color: '#ff4d4f', fontWeight: 700 }}>⚠ Connection error — check Firebase rules</span>}
            {liveStatus === null && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Connecting…</span>}
          </div>

          {/* Section A — Direct link */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Direct Link — tap to open
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <a
                href={liveUrl}
                target="_blank"
                rel="noreferrer"
                style={{ flex: 1, fontSize: 12, color: '#4a9eff', wordBreak: 'break-all', textDecoration: 'underline', lineHeight: 1.4 }}
              >
                {liveUrl}
              </a>
              <button
                onClick={copyLink}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--accent)', padding: '6px 10px', fontSize: 12, cursor: 'pointer', flexShrink: 0, fontWeight: 700 }}
              >
                {copied ? '✓' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Section B — Code box */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Or share this code
            </div>
            <CodeCopyBox code={liveId} />
          </div>

          {/* Section C — Share sheet */}
          <button
            onClick={shareLink}
            className="btn btn-primary"
            style={{ width: '100%', minHeight: 48, fontSize: 15, fontWeight: 700 }}
          >
            📤 Share via Text / WhatsApp / Email
          </button>
        </div>
      )}

      {/* Collapsed live bar (panel is hidden) */}
      {isLive && !showSharePanel && (
        <div style={{ background: 'rgba(76,175,80,0.07)', borderBottom: '1px solid rgba(76,175,80,0.2)', padding: '7px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="live-badge">● LIVE</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1, fontFamily: 'monospace', letterSpacing: 1 }}>{liveId}</span>
          {liveSyncing && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Syncing…</span>}
          <button onClick={onShowShare} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>Share ↗</button>
        </div>
      )}

      <div className="screen" style={{ paddingTop: 12 }}>
        <OpponentsPanel
          playerName={round.playerName}
          opponents={round.opponents || []}
          holes={round.holes}
          onAdd={onAddOpponent}
          onRemove={onRemoveOpponent}
          onUpdate={onUpdateOpponent}
          onUpdateScore={onUpdateOpponentScore}
        />
        {round.holes.map((hole, i) => (
          <HoleCard key={hole.number} hole={hole} isManual={isManual} roundId={round.id}
            onChange={(updates) => onUpdateHole(i, updates)} />
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          {saved ? (
            <div className="btn btn-primary" style={{ flex: 1, textAlign: 'center', opacity: 0.8 }}>✓ Saved</div>
          ) : (
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={onSave}>💾 Save Round</button>
          )}
          <button className="btn btn-gold" style={{ flex: 1 }} onClick={onFinish}>View Analysis →</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// HOLE NOTES SECTION (collapsible)
// ============================================================
function HoleNotesSection({ holes }) {
  const [open, setOpen] = React.useState(false);
  const noted = holes.filter(h => h.notes && h.notes.trim());
  if (!noted.length) return null;
  return (
    <div className="card" style={{ marginTop: 8 }}>
      <button className="notes-toggle" onClick={() => setOpen(o => !o)}>
        <span>📝 Hole Notes ({noted.length} hole{noted.length !== 1 ? 's' : ''})</span>
        <span className={`chevron${open ? ' open' : ''}`}>▼</span>
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          {noted.map(h => (
            <div key={h.number} className="hole-note-row">
              <div className="hole-note-header">
                <span className="hole-note-num">Hole {h.number}</span>
                <span className="hole-note-meta">Par {h.par}{h.score !== '' && h.score !== null ? ` · Score ${h.score}` : ''}</span>
              </div>
              <p className="hole-note-text">{h.notes.trim()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// ANALYSIS SCREEN
// ============================================================
// ============================================================
// ROUND RECAP — auto-plays each hole's photos/videos in sequence
// ============================================================
function RoundRecap({ holes }) {
  const [playing, setPlaying] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [exportProgress, setExportProgress] = React.useState(null);

  const items = React.useMemo(() => (holes || []).flatMap(h =>
    (h.media || []).map(m => ({
      ...m,
      hole: h.number,
      par: h.par,
      score: h.score,
    }))
  ), [holes]);

  if (items.length === 0) return null;

  const videoCount = items.filter(i => i.type === 'video').length;
  const imageCount = items.length - videoCount;
  const parts = [];
  if (videoCount) parts.push(`${videoCount} video${videoCount === 1 ? '' : 's'}`);
  if (imageCount) parts.push(`${imageCount} photo${imageCount === 1 ? '' : 's'}`);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportProgress({ index: 0, total: items.length });
    try {
      const blob = await recordMontage(items, (p) => setExportProgress(p));
      await offerSaveOrShare(blob);
    } catch (err) {
      console.error('Montage export failed:', err);
      alert('Could not export montage: ' + (err.message || err));
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-title">Round Recap</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        {parts.join(' + ')} from {items.length === 1 ? '1 hole' : `${new Set(items.map(i => i.hole)).size} holes`}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => setPlaying(true)}
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={exporting}
        >▶ Play Recap</button>
        <button
          onClick={handleExport}
          className="btn btn-secondary"
          style={{ flex: 1 }}
          disabled={exporting}
        >{exporting ? 'Saving…' : '⬇ Save to Phone'}</button>
      </div>
      {exporting && exportProgress && (
        <div style={{
          marginTop: 10, padding: 10, borderRadius: 8,
          background: 'var(--surface)', fontSize: 12, color: 'var(--text-dim)',
        }}>
          <div style={{ marginBottom: 6 }}>
            Recording clip {Math.min(exportProgress.index + 1, exportProgress.total)} of {exportProgress.total}…
          </div>
          <div style={{ height: 4, background: 'var(--card2)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              width: ((exportProgress.index / exportProgress.total) * 100) + '%',
              height: '100%', background: 'var(--accent)', transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )}
      {playing && <RecapPlayer items={items} onClose={() => setPlaying(false)} />}
    </div>
  );
}

// ─── Montage recorder ──────────────────────────────────────
// Paint each clip to a canvas, record the canvas stream with MediaRecorder.
// Returns a Blob (video/mp4 on iOS Safari, video/webm elsewhere).
const MONTAGE_W = 720;
const MONTAGE_H = 1280;
const PHOTO_MS = 2000;
const VIDEO_MAX_MS = 8000;

async function recordMontage(items, onProgress) {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Your browser does not support video recording.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = MONTAGE_W;
  canvas.height = MONTAGE_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const stream = canvas.captureStream(30);
  const mime = pickMime();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  const stopped = new Promise(r => { recorder.onstop = r; });
  recorder.start();

  // Brief lead-in so the recorder has a first frame.
  await sleep(100);

  for (let i = 0; i < items.length; i++) {
    onProgress({ index: i, total: items.length });
    const item = items[i];
    if (item.type === 'image') {
      const img = await loadImage(item.url);
      await paintForMs(ctx, img, item, PHOTO_MS);
    } else {
      const video = await loadVideo(item.url);
      try {
        video.currentTime = 0;
        await video.play().catch(() => {});
        await paintVideoUntil(ctx, video, item, VIDEO_MAX_MS);
      } finally {
        try { video.pause(); } catch (e) {}
        video.src = '';
        video.load();
      }
    }
  }
  onProgress({ index: items.length, total: items.length });

  await sleep(200);
  recorder.stop();
  await stopped;
  return new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
}

function pickMime() {
  const options = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const opt of options) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(opt)) return opt;
  }
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = url;
  });
}

function loadVideo(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onloadeddata = () => resolve(video);
    video.onerror = () => reject(new Error('Video load failed'));
    video.src = url;
  });
}

async function paintForMs(ctx, source, item, ms) {
  const start = performance.now();
  while (performance.now() - start < ms) {
    drawCovered(ctx, source);
    drawOverlay(ctx, item);
    await new Promise(r => requestAnimationFrame(r));
  }
}

async function paintVideoUntil(ctx, video, item, maxMs) {
  const start = performance.now();
  while (performance.now() - start < maxMs && !video.ended) {
    drawCovered(ctx, video);
    drawOverlay(ctx, item);
    await new Promise(r => requestAnimationFrame(r));
  }
}

function drawCovered(ctx, source) {
  const sw = source.videoWidth || source.naturalWidth || 0;
  const sh = source.videoHeight || source.naturalHeight || 0;
  if (!sw || !sh) return;
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const sAR = sw / sh, cAR = cw / ch;
  let dw, dh, dx, dy;
  if (sAR > cAR) { dh = ch; dw = ch * sAR; dx = (cw - dw) / 2; dy = 0; }
  else           { dw = cw; dh = cw / sAR; dx = 0; dy = (ch - dh) / 2; }
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(source, dx, dy, dw, dh);
}

function drawOverlay(ctx, item) {
  const hasScore = item.score !== '' && item.score !== null && item.score !== undefined;
  const diff = hasScore && item.par ? parseInt(item.score) - item.par : null;
  const diffLabel = diff === null ? '' : diff === 0 ? ' (E)' : diff > 0 ? ` (+${diff})` : ` (${diff})`;
  const text = `HOLE ${item.hole}${item.par ? ` · PAR ${item.par}` : ''}${hasScore ? ` · ${item.score}${diffLabel}` : ''}`;

  ctx.font = 'bold 28px -apple-system, system-ui, sans-serif';
  const metrics = ctx.measureText(text);
  const padX = 18, padY = 10, pillX = 24, pillY = 28;
  const pillW = metrics.width + padX * 2;
  const pillH = 28 + padY * 2 - 4;

  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, 24);
    ctx.fill();
  } else {
    ctx.fillRect(pillX, pillY, pillW, pillH);
  }
  ctx.fillStyle = 'white';
  ctx.textBaseline = 'top';
  ctx.fillText(text, pillX + padX, pillY + padY - 2);
}

async function offerSaveOrShare(blob) {
  const isMp4 = (blob.type || '').includes('mp4');
  const ext = isMp4 ? 'mp4' : 'webm';
  const filename = `round-recap-${new Date().toISOString().slice(0, 10)}.${ext}`;
  const file = new File([blob], filename, { type: blob.type });

  // Prefer native share sheet — on iOS this exposes Save Video to Photos.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Round Recap' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('Share failed, falling back to download:', err);
    }
  }
  // Fallback: download link.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function RecapPlayer({ items, onClose }) {
  const [idx, setIdx] = React.useState(0);
  const videoRef = React.useRef(null);
  const timerRef = React.useRef(null);

  const PHOTO_DURATION = 2000;
  const VIDEO_MAX_DURATION = 8000;

  const advance = React.useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setIdx(i => {
      if (i + 1 >= items.length) { onClose(); return i; }
      return i + 1;
    });
  }, [items.length, onClose]);

  React.useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const cur = items[idx];
    if (!cur) return;
    if (cur.type === 'image') {
      timerRef.current = setTimeout(advance, PHOTO_DURATION);
    } else {
      timerRef.current = setTimeout(advance, VIDEO_MAX_DURATION);
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {});
      }
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [idx, advance, items]);

  React.useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') advance();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, advance]);

  const cur = items[idx];
  if (!cur) return null;

  const hasScore = cur.score !== '' && cur.score !== null && cur.score !== undefined;
  const diff = hasScore && cur.par ? parseInt(cur.score) - cur.par : null;
  const diffLabel = diff === null ? null : diff === 0 ? 'E' : (diff > 0 ? '+' + diff : String(diff));
  const diffColor = diff === null ? 'rgba(255,255,255,0.85)'
    : diff < 0 ? '#ff8a8a' : diff > 0 ? '#9fb6e8' : '#9be6b0';

  return (
    <div
      onClick={advance}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.96)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {cur.type === 'video' ? (
        <video
          key={cur.id}
          ref={videoRef}
          src={cur.url}
          autoPlay muted playsInline
          style={{ maxWidth: '100%', maxHeight: '100%' }}
          onEnded={advance}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <img
          key={cur.id}
          src={cur.url}
          alt=""
          style={{ maxWidth: '100%', maxHeight: '100%' }}
        />
      )}

      {/* Hole + score overlay */}
      <div style={{
        position: 'absolute', top: 20, left: 20,
        background: 'rgba(0,0,0,0.6)', color: 'white',
        padding: '10px 16px', borderRadius: 24,
        fontWeight: 800, fontSize: 13, letterSpacing: 0.6,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span>HOLE {cur.hole}</span>
        {cur.par && <span style={{ opacity: 0.7 }}>PAR {cur.par}</span>}
        {hasScore && (
          <span style={{ color: diffColor }}>
            {cur.score}{diffLabel && ` (${diffLabel})`}
          </span>
        )}
      </div>

      {/* Progress dots */}
      <div style={{
        position: 'absolute', bottom: 24, left: 16, right: 16,
        display: 'flex', justifyContent: 'center', gap: 4,
      }}>
        {items.map((_, i) => (
          <div key={i} style={{
            flex: 1, maxWidth: 28, height: 3, borderRadius: 2,
            background: i < idx ? 'white' : i === idx ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)',
            transition: 'background 0.2s',
          }} />
        ))}
      </div>

      <button onClick={e => { e.stopPropagation(); onClose(); }}
        style={{
          position: 'absolute', top: 16, right: 16,
          width: 36, height: 36, padding: 0, lineHeight: 1,
          background: 'rgba(0,0,0,0.6)', color: 'white',
          border: 'none', borderRadius: '50%',
          fontSize: 22, cursor: 'pointer',
        }}>×</button>
    </div>
  );
}

// ============================================================
function AnalysisScreen({ round, onSave, onNewRound, saved, onBack }) {
  const stats = calcStats(round.holes);

  if (!stats) {
    return (
      <div className="screen">
        {onBack && (
          <button className="btn btn-secondary btn-sm" style={{ marginBottom: 12 }} onClick={onBack}>
            ← Back to History
          </button>
        )}
        <div className="empty-state">
          <div className="empty-state-text">No holes scored yet.</div>
        </div>
        <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={onBack || onNewRound}>← Back</button>
      </div>
    );
  }

  const { totalScore, totalPar, scoreDiff, fwPct, girPct, avgPutts, sumPutts, breakdown, holesPlayed, front9, back9, parTypeStats, penaltyCount, bunkerCount, avgFirstPutt, sgPutting, sgPuttingPerHole, sgT2G, sgT2GPerHole, sgHolesCount } = stats;

  const breakdownItems = [
    { label: 'Eagle / Better', count: breakdown.eagle, color: '#ffd700' },
    { label: 'Birdie', count: breakdown.birdie, color: 'var(--red)' },
    { label: 'Par', count: breakdown.par, color: 'var(--accent)' },
    { label: 'Bogey', count: breakdown.bogey, color: 'var(--blue)' },
    { label: 'Double', count: breakdown.double, color: '#ab47bc' },
    { label: 'Triple+', count: breakdown.worse, color: '#e64a19' },
  ];
  const maxBreakdown = Math.max(...breakdownItems.map(b => b.count), 1);

  return (
    <div className="screen">
      {onBack && (
        <button className="btn btn-secondary btn-sm" style={{ marginBottom: 10 }} onClick={onBack}>
          ← Back to History
        </button>
      )}
      <h2 style={{ marginBottom: 14 }}>Round Analysis</h2>

      <div className="score-total-card">
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 4 }}>
          {round.courseName} · {round.tee}
        </div>
        <div className="score-total-num">{totalScore}</div>
        <div className="score-total-par">vs par {totalPar}</div>
        <div className="score-vs-par-large" style={{
          color: scoreDiff < 0 ? 'var(--red)' : scoreDiff > 0 ? 'var(--blue)' : 'var(--text)'
        }}>
          {scoreDiffLabel(scoreDiff)}
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 6 }}>
          {holesPlayed} holes · {round.roundType === 'competition' ? 'Competition' : 'Practice'} · {formatDate(round.date)}
        </div>
      </div>

      <RoundRecap holes={round.holes} />

      <div className="stats-grid">
        <div className="stat-box">
          <div className="stat-box-value">{fwPct !== null ? fwPct + '%' : '—'}</div>
          <div className="stat-box-label">Fairways</div>
        </div>
        <div className="stat-box">
          <div className="stat-box-value">{girPct !== null ? girPct + '%' : '—'}</div>
          <div className="stat-box-label">GIR</div>
        </div>
        <div className="stat-box">
          <div className="stat-box-value">{sumPutts ?? '—'}</div>
          <div className="stat-box-label">Total Putts</div>
        </div>
        <div className="stat-box">
          <div className="stat-box-value">{avgPutts ?? '—'}</div>
          <div className="stat-box-label">Avg Putts</div>
        </div>
        <div className="stat-box">
          <div className="stat-box-value">{avgFirstPutt ? avgFirstPutt + 'ft' : '—'}</div>
          <div className="stat-box-label">Avg 1st Putt</div>
        </div>
      </div>

      {sgPutting !== null && (
        <div className="card">
          <div className="card-title">Strokes Gained: Putting</div>
          <div className="sg-putt-main" style={{ color: sgPutting > 0 ? 'var(--red)' : sgPutting < 0 ? 'var(--blue)' : 'var(--text)' }}>
            {sgPutting > 0 ? '+' : ''}{sgPutting}
          </div>
          <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {sgPuttingPerHole > 0 ? '+' : ''}{sgPuttingPerHole} per hole · based on {sgHolesCount} hole{sgHolesCount !== 1 ? 's' : ''}
          </div>
          <div style={{ marginTop: 12, fontSize: '0.78rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
            <span style={{ color: 'var(--red)', fontWeight: 600 }}>Positive</span> = better than PGA Tour avg from that distance.{' '}
            <span style={{ color: 'var(--blue)', fontWeight: 600 }}>Negative</span> = more putts than expected.
            Requires both 1st putt distance and putt count to be recorded.
          </div>
        </div>
      )}

      {sgT2G !== null && (
        <div className="card">
          <div className="card-title">Strokes Gained: Tee-to-Green</div>
          <div className="sg-putt-main" style={{ color: sgT2G > 0 ? 'var(--red)' : sgT2G < 0 ? 'var(--blue)' : 'var(--text)' }}>
            {sgT2G > 0 ? '+' : ''}{sgT2G}
          </div>
          <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {sgT2GPerHole > 0 ? '+' : ''}{sgT2GPerHole} per hole · based on {sgHolesCount} hole{sgHolesCount !== 1 ? 's' : ''}
          </div>
          <div style={{ marginTop: 12, fontSize: '0.78rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
            Score-vs-par minus SG Putting — measures everything from the tee through the approach.{' '}
            <span style={{ color: 'var(--red)', fontWeight: 600 }}>Positive</span> = strokes gained off the green.{' '}
            <span style={{ color: 'var(--blue)', fontWeight: 600 }}>Negative</span> = lost off the green.
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Score Breakdown</div>
        {breakdownItems.map((item, i) => (
          <div key={i} className="breakdown-row">
            <span className="breakdown-label">{item.label}</span>
            <div className="breakdown-bar-wrap">
              <div className="breakdown-bar"
                style={{ width: ((item.count / maxBreakdown) * 100) + '%', background: item.color }} />
            </div>
            <span className="breakdown-count">{item.count}</span>
          </div>
        ))}
      </div>

      {front9 && back9 && front9.holes >= 9 && back9.holes >= 9 && (
        <div className="card">
          <div className="card-title">Front 9 / Back 9</div>
          <div className="split-grid">
            {[{ label: 'Front 9', d: front9 }, { label: 'Back 9', d: back9 }].map(({ label, d }) => (
              <div key={label} className="split-box">
                <div className="split-label">{label}</div>
                <div className="split-score">{d.score}</div>
                <div className={`split-diff ${scoreDiffClass(d.diff)}`}>{scoreDiffLabel(d.diff)}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>vs par {d.par}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(parTypeStats[3] || parTypeStats[4] || parTypeStats[5]) && (
        <div className="card">
          <div className="card-title">Scoring by Par Type</div>
          {[3, 4, 5].map(p => {
            const pt = parTypeStats[p];
            if (!pt) return null;
            const sign = pt.avgDiff >= 0 ? '+' : '';
            return (
              <div key={p} className="par-type-row">
                <span className="par-type-label">Par {p}s</span>
                <span className="par-type-count">{pt.n} hole{pt.n !== 1 ? 's' : ''}</span>
                <span className={`par-type-diff ${pt.avgDiff < 0 ? 'under' : pt.avgDiff > 0 ? 'over' : 'even'}`}>
                  {sign}{pt.avgDiff} avg
                </span>
              </div>
            );
          })}
        </div>
      )}

      {(penaltyCount > 0 || bunkerCount > 0) && (
        <div className="card">
          <div className="card-title">Penalties &amp; Hazards</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.88rem', color: 'var(--text-dim)' }}>
            {penaltyCount > 0 && <span>⚠️ {penaltyCount} penalty stroke{penaltyCount !== 1 ? 's' : ''} (OB / Water)</span>}
            {bunkerCount > 0 && <span>⛱ {bunkerCount} bunker{bunkerCount !== 1 ? 's' : ''}</span>}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Hole by Hole</div>
        <div className="table-scroll">
          <table className="hole-table">
            <thead>
              <tr><th>#</th><th>Par</th><th>Yds</th><th>Score</th><th>Putts</th><th>FW</th><th>Miss</th><th>GIR</th></tr>
            </thead>
            <tbody>
              {round.holes.map(h => {
                const sc = holeScoreClass(h.score, h.par);
                return (
                  <tr key={h.number}>
                    <td>{h.number}</td>
                    <td>{h.par}</td>
                    <td>{h.yards}</td>
                    <td className={'score-cell ' + sc}>{h.score !== '' && h.score !== null ? h.score : '—'}</td>
                    <td>{h.putts !== '' && h.putts !== null ? h.putts : '—'}</td>
                    <td>{h.par === 3 ? '—' : h.fairwayHit === true ? '✓' : h.fairwayHit === false ? '✗' : '—'}</td>
                    <td>{h.par === 3 ? '—' : h.fairwayHit === false && h.fairwayMissDirection ? (h.fairwayMissDirection === 'left' ? '◀L' : 'R▶') : '—'}</td>
                    <td>{h.gir === true ? '✓' : h.gir === false ? '✗' : '—'}</td>
                  </tr>
                );
              })}
              <tr style={{ background: 'var(--surface)', fontWeight: 700 }}>
                <td style={{ color: 'var(--text-dim)' }}>Total</td>
                <td>{round.holes.reduce((s, h) => s + h.par, 0)}</td>
                <td>{round.holes.reduce((s, h) => s + (h.yards || 0), 0).toLocaleString()}</td>
                <td className={'score-cell ' + scoreDiffClass(scoreDiff)}>{totalScore}</td>
                <td>{sumPutts ?? '—'}</td>
                <td>{fwPct !== null ? fwPct + '%' : '—'}</td>
                <td>—</td>
                <td>{girPct !== null ? girPct + '%' : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <HoleNotesSection holes={round.holes} />

      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        {!saved ? (
          <button className="btn btn-primary" onClick={onSave} style={{ flex: 1 }}>💾 Save Round</button>
        ) : (
          <div style={{ flex: 1, textAlign: 'center', padding: 13, color: 'var(--accent)', fontWeight: 600 }}>
            ✓ Round Saved
          </div>
        )}
        <button className="btn btn-secondary" onClick={onNewRound} style={{ flex: 1 }}>New Round</button>
      </div>

      {/* Google Calendar "Add to Calendar" button — archived
      {saved && hasCalToken && (
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-secondary" style={{ width: '100%' }}
            disabled={calStatus === 'loading' || calStatus === 'success'}
            onClick={handleAddToCalendar}>
            {calStatus === 'loading' ? 'Adding…' : calStatus === 'success' ? 'Added to Calendar' : 'Add to Google Calendar'}
          </button>
          {calMsg && (
            <div style={{ marginTop: 6, fontSize: '0.82rem', textAlign: 'center',
              color: calStatus === 'success' ? 'var(--accent)' : 'var(--red)' }}>
              {calMsg}
            </div>
          )}
        </div>
      )} */}
    </div>
  );
}

// ============================================================
// EDIT ROUND SCREEN
// ============================================================
function EditRoundScreen({ round, onSave, onCancel }) {
  const [date, setDate] = React.useState(round.date.slice(0, 10));
  const [roundType, setRoundType] = React.useState(round.roundType);
  const [playerName, setPlayerName] = React.useState(round.playerName || '');
  const [holes, setHoles] = React.useState(round.holes.map(h => ({ ...h })));

  const handleHoleChange = (index, updates) => {
    setHoles(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  };

  const handleSave = () => {
    onSave({
      ...round,
      date: new Date(date + 'T12:00:00').toISOString(),
      roundType,
      playerName,
      holes,
    });
  };

  const stats = calcStats(holes);

  return (
    <div>
      <div className="round-summary-bar">
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>
            {round.courseName} · {round.tee}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="round-score-big">{stats?.totalScore ?? '—'}</span>
            {stats?.scoreDiff !== undefined && stats.scoreDiff !== null && (
              <span className={`vs-par ${scoreDiffClass(stats.scoreDiff)}`}>
                {scoreDiffLabel(stats.scoreDiff)}
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {stats?.holesPlayed ?? 0}/18 holes
          </div>
          {stats && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 2 }}>
              {stats.fwPct !== null ? 'FW ' + stats.fwPct + '%' : ''}{stats.girPct !== null ? ' · GIR ' + stats.girPct + '%' : ''}
            </div>
          )}
        </div>
      </div>

      <div className="screen" style={{ paddingTop: 12 }}>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Round Details</div>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label">Date</label>
            <input className="form-input" type="date" value={date}
              onChange={e => setDate(e.target.value)} />
          </div>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label">Player Name</label>
            <input className="form-input" type="text" value={playerName}
              placeholder="Player name"
              onChange={e => setPlayerName(e.target.value)} />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Round Type</label>
            <div className="toggle-group">
              <button className={`toggle-btn${roundType === 'practice' ? ' active' : ''}`}
                onClick={() => setRoundType('practice')}>Practice</button>
              <button className={`toggle-btn${roundType === 'competition' ? ' active competition' : ''}`}
                onClick={() => setRoundType('competition')}>Competition</button>
            </div>
          </div>
        </div>

        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Holes
        </div>
        {holes.map((hole, i) => (
          <HoleCard key={hole.number} hole={hole} isManual={round.isManual} roundId={round.id}
            onChange={(updates) => handleHoleChange(i, updates)} />
        ))}

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSave}>
            💾 Save Changes
          </button>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ICS PARSER — parses Apple/iCloud calendar feed
// ============================================================
function parseICS(text) {
  // Unfold continuation lines (CRLF or LF followed by space/tab)
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\n|\r/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT' && cur) { events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.substring(0, colon).split(';')[0].toUpperCase();
    const val = line.substring(colon + 1);
    if (key === 'SUMMARY') cur.summary = val;
    else if (key === 'DTSTART') cur.start = parseICSDate(val);
    else if (key === 'DTEND') cur.end = parseICSDate(val);
    else if (key === 'DESCRIPTION') cur.description = val.replace(/\\n/g, '\n').replace(/\\,/g, ',');
    else if (key === 'UID') cur.uid = val;
    else if (key === 'LOCATION') cur.location = val;
  }
  return events;
}

function parseICSDate(val) {
  // DATE only: 20240408
  if (/^\d{8}$/.test(val)) {
    return new Date(val.slice(0,4) + '-' + val.slice(4,6) + '-' + val.slice(6,8) + 'T00:00:00');
  }
  // DATETIME: 20240408T080000Z or 20240408T080000
  const y = val.slice(0,4), mo = val.slice(4,6), d = val.slice(6,8);
  const h = val.slice(9,11), mi = val.slice(11,13), s = val.slice(13,15);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${val.endsWith('Z') ? 'Z' : ''}`);
}

// ============================================================
// CALENDAR SCREEN
// ============================================================
function CalendarScreen({ onPreloadCourse }) {
  // ── Grady Golf Calendar state ──────────────────────────────
  const [appleCalUrl, setAppleCalUrl] = React.useState('');
  const [appleUrlInput, setAppleUrlInput] = React.useState('');
  const [appleEvents, setAppleEvents] = React.useState([]);
  const [appleLoading, setAppleLoading] = React.useState(false);
  const [appleError, setAppleError] = React.useState('');
  const [appleEditing, setAppleEditing] = React.useState(false);
  const [viewMode, setViewMode] = React.useState('list'); // 'list' | 'calendar'
  const [calMonth, setCalMonth] = React.useState(() => {
    const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = React.useState(null);

  // Load saved Apple Calendar URL from Firestore (shared across all family devices)
  React.useEffect(() => {
    if (!db) return;
    getDoc(doc(db, 'settings', 'appleCalendar')).then(snap => {
      if (snap.exists()) {
        const url = snap.data().url || '';
        setAppleCalUrl(url);
        setAppleUrlInput(url);
      }
    }).catch(() => {});
  }, []);

  // Fetch Apple Calendar events whenever the URL changes
  React.useEffect(() => {
    if (!appleCalUrl) return;
    setAppleLoading(true);
    setAppleError('');
    fetch('/api/calendar/apple?url=' + encodeURIComponent(appleCalUrl))
      .then(r => r.text())
      .then(text => {
        const all = parseICS(text);
        const now = new Date();
        const upcoming = all
          .filter(e => e.start && e.start >= now)
          .sort((a, b) => a.start - b.start)
          .slice(0, 20);
        setAppleEvents(upcoming);
        setAppleLoading(false);
      })
      .catch(e => { setAppleError(e.message); setAppleLoading(false); });
  }, [appleCalUrl]);

  const saveAppleUrl = async () => {
    const url = appleUrlInput.trim();
    if (!url) return;
    setAppleCalUrl(url);
    setAppleEditing(false);
    if (db) {
      try { await setDoc(doc(db, 'settings', 'appleCalendar'), { url }); } catch {}
    }
  };

  /* ── Google Calendar — archived, uncomment to restore ────────
  const [accessToken, setAccessToken] = React.useState(
    () => localStorage.getItem('google_calendar_token') || null
  );
  const [userInfo, setUserInfo] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('google_user_info') || 'null'); } catch { return null; }
  });
  const [events, setEvents] = React.useState([]);
  const [loadingEvents, setLoadingEvents] = React.useState(false);
  const [eventsError, setEventsError] = React.useState('');
  const [scheduleDate, setScheduleDate] = React.useState('');
  const [scheduleTime, setScheduleTime] = React.useState('08:00');
  const [scheduleCourse, setScheduleCourse] = React.useState('');
  const [scheduleStatus, setScheduleStatus] = React.useState(null);
  const [scheduleMsg, setScheduleMsg] = React.useState('');
  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      const token = tokenResponse.access_token;
      setAccessToken(token);
      localStorage.setItem('google_calendar_token', token);
      try {
        const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const info = await r.json();
        setUserInfo(info);
        localStorage.setItem('google_user_info', JSON.stringify(info));
      } catch {}
    },
    onError: () => setEventsError('Sign-in failed. Please try again.'),
    scope: 'https://www.googleapis.com/auth/calendar.events',
  });
  const signOut = () => {
    setAccessToken(null); setUserInfo(null); setEvents([]);
    localStorage.removeItem('google_calendar_token');
    localStorage.removeItem('google_user_info');
  };
  const fetchEvents = React.useCallback(async (token) => {
    const t = token || accessToken;
    if (!t) return;
    setLoadingEvents(true); setEventsError('');
    try {
      const r = await fetch('/api/calendar/events', { headers: { Authorization: `Bearer ${t}` } });
      if (r.status === 401) { signOut(); return; }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || 'Failed to load events');
      setEvents(data.items || []);
    } catch (e) { setEventsError(e.message); }
    setLoadingEvents(false);
  }, [accessToken]);
  React.useEffect(() => { if (accessToken) fetchEvents(accessToken); }, [accessToken, fetchEvents]);
  const scheduleRound = async () => { ... };
  ── end Google Calendar archive ── */

  // ── Monthly calendar grid renderer ────────────────────────
  const renderMonthGrid = () => {
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();

    // Build a map of date-string → events for quick lookup
    const eventsByDate = {};
    appleEvents.forEach(ev => {
      const key = ev.start.getFullYear() + '-' + ev.start.getMonth() + '-' + ev.start.getDate();
      if (!eventsByDate[key]) eventsByDate[key] = [];
      eventsByDate[key].push(ev);
    });
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    const selKey = selectedDay ? year + '-' + month + '-' + selectedDay : null;
    const dayEvents = selKey ? (eventsByDate[selKey] || []) : [];

    return (
      <>
        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => { setCalMonth(new Date(year, month - 1, 1)); setSelectedDay(null); }}>‹</button>
          <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>
            {calMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={() => { setCalMonth(new Date(year, month + 1, 1)); setSelectedDay(null); }}>›</button>
        </div>

        {/* Day-of-week headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
          {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700 }}>{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={'e' + i} />;
            const key = year + '-' + month + '-' + d;
            const hasEvents = !!eventsByDate[key];
            const isToday = today.getDate() === d && today.getMonth() === month && today.getFullYear() === year;
            const isSelected = selectedDay === d;
            return (
              <div key={d} onClick={() => setSelectedDay(isSelected ? null : d)}
                style={{
                  textAlign: 'center', padding: '6px 2px', borderRadius: 6, cursor: hasEvents ? 'pointer' : 'default',
                  background: isSelected ? 'var(--accent)' : isToday ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: isToday && !isSelected ? '1px solid var(--accent)' : '1px solid transparent',
                  position: 'relative',
                }}>
                <span style={{ fontSize: '0.82rem', fontWeight: isToday ? 700 : 400, color: isSelected ? '#000' : 'var(--text)' }}>{d}</span>
                {hasEvents && (
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: isSelected ? '#000' : 'var(--accent)', margin: '2px auto 0' }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Selected day events */}
        {selectedDay && (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            {dayEvents.length === 0 ? (
              <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)' }}>No events on this day.</div>
            ) : dayEvents.map((ev, i) => (
              <div key={i} className="cal-event" onClick={() => {
                const name = ev.summary.replace(/^⛳\s*Golf\s*[-–]\s*/i, '').trim();
                if (name) onPreloadCourse(name);
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{ev.summary}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {ev.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    {ev.location ? ' · ' + ev.location : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  const appleCalCard = (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">Grady Golf Calendar</div>
      {!appleCalUrl || appleEditing ? (
        <>
          <p style={{ fontSize: '0.83rem', color: 'var(--text-dim)', marginBottom: 10 }}>
            Paste a shared iCloud calendar link to show events for everyone in the family.
          </p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 10 }}>
            In Apple Calendar: tap the calendar name → Share Calendar → enable Public Calendar → Copy Link
          </p>
          <input className="form-input" type="text" value={appleUrlInput}
            onChange={e => setAppleUrlInput(e.target.value)}
            placeholder="webcal://p12-caldav.icloud.com/published/…" />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary" style={{ flex: 1 }}
              disabled={!appleUrlInput.trim()} onClick={saveAppleUrl}>
              Save Calendar Link
            </button>
            {appleCalUrl && (
              <button className="btn btn-secondary" onClick={() => { setAppleEditing(false); setAppleUrlInput(appleCalUrl); }}>
                Cancel
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {/* List / Calendar toggle */}
          <div className="toggle-group" style={{ marginBottom: 12 }}>
            <button className={`toggle-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')}>List</button>
            <button className={`toggle-btn${viewMode === 'calendar' ? ' active' : ''}`} onClick={() => setViewMode('calendar')}>Month</button>
          </div>

          {appleLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: '0.85rem', padding: '8px 0' }}>
              <div className="spinner" />Loading events…
            </div>
          )}
          {appleError && <div style={{ color: 'var(--red)', fontSize: '0.85rem' }}>{appleError}</div>}

          {!appleLoading && !appleError && viewMode === 'list' && (
            appleEvents.length === 0
              ? <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No upcoming events found.</div>
              : appleEvents.map((ev, i) => (
                <div key={ev.uid || i} className="cal-event" onClick={() => {
                  const name = ev.summary.replace(/^⛳\s*Golf\s*[-–]\s*/i, '').trim();
                  if (name) onPreloadCourse(name);
                }}>
                  <div className="cal-event-date">
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, lineHeight: 1 }}>{ev.start.getDate()}</div>
                    <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 1 }}>
                      {ev.start.toLocaleString('en-US', { month: 'short' })}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.summary}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      {ev.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      {ev.location ? ' · ' + ev.location : ''}
                    </div>
                  </div>
                </div>
              ))
          )}

          {!appleLoading && !appleError && viewMode === 'calendar' && renderMonthGrid()}

          <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}
            onClick={() => setAppleEditing(true)}>
            ✎ Change Calendar
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="screen">
      {appleCalCard}
    </div>
  );
}

// ============================================================
// RECOVER LIVE ROUND — reads live_rounds from Firestore
// ============================================================
function RecoverLiveRounds({ onRecover }) {
  const [open, setOpen] = React.useState(false);
  const [liveRounds, setLiveRounds] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [recovering, setRecovering] = React.useState(null);

  const fetchLive = async () => {
    if (!db) return;
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'live_rounds'));
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      docs.sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));
      setLiveRounds(docs);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleOpen = () => { setOpen(true); fetchLive(); };

  const handleRecover = async (lr) => {
    setRecovering(lr.id);
    const newRound = {
      id: 'recovered_' + lr.id + '_' + Date.now(),
      playerName: lr.playerName || 'Grady',
      courseName: lr.courseName || 'Unknown Course',
      courseId: (lr.courseName || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      tee: lr.tee || 'Manual',
      teeColor: lr.teeColor || 'white',
      date: lr.startTime || new Date().toISOString(),
      roundType: lr.roundType || 'practice',
      isManual: lr.isManual !== undefined ? lr.isManual : true,
      holes: (lr.holes || []).map(h => ({
        number: h.number,
        par: h.par ?? 4,
        yards: h.yards ?? 0,
        score: h.score ?? '',
        putts: h.putts ?? '',
        firstPuttLength: h.firstPuttLength ?? '',
        fairwayHit: h.fairwayHit ?? null,
        fairwayMissDirection: h.fairwayMissDirection ?? null,
        gir: h.gir ?? null,
        fairwayBunker: h.fairwayBunker ?? false,
        greensideBunker: h.greensideBunker ?? false,
        ob: h.ob ?? false,
        water: h.water ?? false,
        notes: h.notes ?? '',
      })),
    };
    await onRecover(newRound);
    setRecovering(null);
    setOpen(false);
  };

  if (!db) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      {!open ? (
        <button className="btn btn-secondary" style={{ width: '100%', fontSize: '0.85rem' }}
          onClick={handleOpen}>
          Recover Round from Live History
        </button>
      ) : (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div className="card-title" style={{ margin: 0 }}>Live Round History</div>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
          </div>
          {loading && <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', padding: '8px 0' }}>Loading…</div>}
          {!loading && liveRounds.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', padding: '8px 0' }}>No live rounds found.</div>
          )}
          {liveRounds.map(lr => {
            const st = lr.holes ? calcStats(lr.holes) : null;
            return (
              <div key={lr.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{lr.courseName || 'Unknown Course'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      {lr.startTime ? formatDate(lr.startTime) : 'Unknown date'} · {lr.playerName || '—'} · Code: {lr.id}
                    </div>
                    {st && <div style={{ fontSize: '0.78rem', color: 'var(--accent)', marginTop: 2 }}>
                      Score {st.totalScore} ({scoreDiffLabel(st.scoreDiff)}) · {st.holesPlayed} holes
                    </div>}
                  </div>
                  <button className="btn btn-primary btn-sm"
                    disabled={recovering === lr.id}
                    onClick={() => handleRecover(lr)}>
                    {recovering === lr.id ? '…' : '+ Save'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// HISTORY SCREEN
// ============================================================
function HistoryScreen({ rounds, onViewRound, onEdit, onDelete, onRecover }) {
  const [filter, setFilter] = React.useState('all');
  const [expandedId, setExpandedId] = React.useState(null);
  const [excludedIds, setExcludedIds] = React.useState(() => new Set());
  // Track which year / "year-month" groups are expanded.
  // Default: most recent year + month opened, the rest collapsed.
  const [expandedYears, setExpandedYears] = React.useState(() => new Set());
  const [expandedMonths, setExpandedMonths] = React.useState(() => new Set());
  const groupingInitRef = React.useRef(false);

  const filtered = rounds
    .filter(r => filter === 'all' || r.roundType === filter)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // Build year → month → rounds grouping
  const grouped = React.useMemo(() => {
    const byYear = new Map();
    filtered.forEach(r => {
      const d = new Date(r.date);
      const y = d.getFullYear();
      const m = d.getMonth(); // 0-11
      const ym = `${y}-${m}`;
      if (!byYear.has(y)) byYear.set(y, new Map());
      const months = byYear.get(y);
      if (!months.has(ym)) months.set(ym, { year: y, monthIdx: m, key: ym, rounds: [] });
      months.get(ym).rounds.push(r);
    });
    const years = [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, months]) => ({
        year: y,
        months: [...months.values()].sort((a, b) => b.monthIdx - a.monthIdx),
      }));
    return years;
  }, [filtered]);

  // Auto-expand most recent year + month on first load
  React.useEffect(() => {
    if (groupingInitRef.current) return;
    if (grouped.length === 0) return;
    const firstYear = grouped[0].year;
    const firstMonth = grouped[0].months[0]?.key;
    setExpandedYears(new Set([firstYear]));
    if (firstMonth) setExpandedMonths(new Set([firstMonth]));
    groupingInitRef.current = true;
  }, [grouped]);

  const toggleYear = (y) => {
    setExpandedYears(prev => {
      const next = new Set(prev);
      if (next.has(y)) next.delete(y); else next.add(y);
      return next;
    });
  };
  const toggleMonth = (key) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleIncluded = (id) => {
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const includeAll = () => setExcludedIds(new Set());
  const excludeAll = () => setExcludedIds(new Set(filtered.map(r => r.id)));

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];

  const statsRounds = filtered.filter(r => !excludedIds.has(r.id));
  const excludedInFilter = filtered.length - statsRounds.length;

  const calcAllTime = (rs) => {
    if (!rs.length) return null;
    const allStats = rs.map(r => calcStats(r.holes)).filter(Boolean);
    if (!allStats.length) return null;
    const scores = allStats.map(s => s.totalScore);
    const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
    const best = Math.min(...scores);
    const fwArr = allStats.map(s => s.fwPct).filter(x => x !== null);
    const girArr = allStats.map(s => s.girPct).filter(x => x !== null);
    const puttArr = allStats.map(s => s.avgPutts ? parseFloat(s.avgPutts) : null).filter(x => x !== null);
    const firstPuttArr = allStats.map(s => s.avgFirstPutt ? parseFloat(s.avgFirstPutt) : null).filter(x => x !== null);
    const parTypeDiffs = (parVal) => {
      const diffs = [];
      rs.forEach(r => r.holes
        .filter(h => h.par === parVal && h.score !== '' && h.score !== null && h.score !== undefined)
        .forEach(h => diffs.push(parseInt(h.score) - h.par)));
      if (!diffs.length) return null;
      return parseFloat((diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(2));
    };
    const sgArr = allStats.map(s => s.sgPutting).filter(x => x !== null);
    const avgSgPutting = sgArr.length ? parseFloat((sgArr.reduce((a, b) => a + b, 0) / sgArr.length).toFixed(2)) : null;
    const sgT2GArr = allStats.map(s => s.sgT2G).filter(x => x !== null && x !== undefined);
    const avgSgT2G = sgT2GArr.length ? parseFloat((sgT2GArr.reduce((a, b) => a + b, 0) / sgT2GArr.length).toFixed(2)) : null;
    const scoreDiffs = allStats.map(s => s.scoreDiff);
    const avgScoreDiff = scoreDiffs.length ? scoreDiffs.reduce((a, b) => a + b, 0) / scoreDiffs.length : 0;
    return {
      rounds: rs.length, avg, best,
      fwPct: fwArr.length ? Math.round(fwArr.reduce((a, b) => a + b, 0) / fwArr.length) : null,
      girPct: girArr.length ? Math.round(girArr.reduce((a, b) => a + b, 0) / girArr.length) : null,
      avgPutts: puttArr.length ? (puttArr.reduce((a, b) => a + b, 0) / puttArr.length).toFixed(1) : null,
      avgFirstPutt: firstPuttArr.length ? (firstPuttArr.reduce((a, b) => a + b, 0) / firstPuttArr.length).toFixed(1) : null,
      par3avg: parTypeDiffs(3), par4avg: parTypeDiffs(4), par5avg: parTypeDiffs(5),
      avgSgPutting,
      avgSgT2G,
      avgScoreDiff,
    };
  };

  // Compute deltas: most recent SCORED round stats vs average across the rest
  const latestStats = statsRounds.length >= 2
    ? (() => {
        const sorted = [...statsRounds]
          .map(r => ({ r, st: calcStats(r.holes) }))
          .filter(x => x.st)
          .sort((a, b) => new Date(b.r.date) - new Date(a.r.date));
        if (sorted.length < 2) return null;
        const latest = sorted[0].st;
        const prior = calcAllTime(sorted.slice(1).map(x => x.r));
        if (!latest || !prior) return null;
        const pct = (v) => (v !== null && v !== undefined && v !== '' ? parseFloat(v) : null);
        return {
          avg: { curr: latest.totalScore, prior: pct(prior.avg) },
          fwPct: { curr: latest.fwPct, prior: prior.fwPct },
          girPct: { curr: latest.girPct, prior: prior.girPct },
          avgPutts: { curr: pct(latest.avgPutts), prior: pct(prior.avgPutts) },
          avgFirstPutt: { curr: pct(latest.avgFirstPutt), prior: pct(prior.avgFirstPutt) },
          avgSgPutting: { curr: latest.sgPutting, prior: prior.avgSgPutting },
          avgSgT2G: { curr: latest.sgT2G, prior: prior.avgSgT2G },
        };
      })()
    : null;

  const deltaLabel = (pair, lowerIsBetter = true) => {
    if (!pair || pair.curr === null || pair.prior === null) return null;
    const d = pair.curr - pair.prior;
    if (Math.abs(d) < 0.05) return { sign: '•', value: 0, good: true };
    const good = lowerIsBetter ? d < 0 : d > 0;
    return { sign: d < 0 ? '▼' : '▲', value: Math.abs(d).toFixed(1), good };
  };

  const currentAllTime = calcAllTime(statsRounds);

  return (
    <div className="screen">
      <div className="section-header" style={{ marginBottom: 14 }}>
        <h2>Round History</h2>
        <span className="badge">{filtered.length}</span>
      </div>

      <div className="toggle-group" style={{ marginBottom: 14 }}>
        <button className={'toggle-btn' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>All</button>
        <button className={'toggle-btn' + (filter === 'practice' ? ' active' : '')} onClick={() => setFilter('practice')}>Practice</button>
        <button className={'toggle-btn' + (filter === 'competition' ? ' active competition' : '')} onClick={() => setFilter('competition')}>Competition</button>
      </div>

      {currentAllTime && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>
              {filter === 'competition' ? 'Competition ' : filter === 'practice' ? 'Practice ' : 'All-Time '}Stats
            </span>
            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-dim)', letterSpacing: 0 }}>
              {statsRounds.length} of {filtered.length} rounds
            </span>
          </div>
          <div className="alltime-grid">
            {[
              { v: currentAllTime.rounds, l: 'Rounds' },
              { v: currentAllTime.avg, l: 'Avg Score',
                color: currentAllTime.avgScoreDiff < 0 ? '#86efac' : currentAllTime.avgScoreDiff > 0 ? '#d63838' : 'var(--linen)',
                delta: latestStats && deltaLabel(latestStats.avg, true) },
              { v: currentAllTime.best, l: 'Best Score' },
              { v: currentAllTime.fwPct !== null ? currentAllTime.fwPct + '%' : '—', l: 'FW Hit %',
                delta: latestStats && deltaLabel(latestStats.fwPct, false) },
              { v: currentAllTime.girPct !== null ? currentAllTime.girPct + '%' : '—', l: 'GIR %',
                delta: latestStats && deltaLabel(latestStats.girPct, false) },
              { v: currentAllTime.avgPutts ?? '—', l: 'Avg Putts',
                delta: latestStats && deltaLabel(latestStats.avgPutts, true) },
              { v: currentAllTime.avgFirstPutt !== null ? currentAllTime.avgFirstPutt + "'" : '—', l: 'Avg 1st Putt',
                delta: latestStats && deltaLabel(latestStats.avgFirstPutt, true) },
              { v: currentAllTime.avgSgPutting !== null ? (currentAllTime.avgSgPutting > 0 ? '+' : '') + currentAllTime.avgSgPutting : '—', l: 'Avg SG: Putt',
                delta: latestStats && deltaLabel(latestStats.avgSgPutting, false) },
              { v: currentAllTime.avgSgT2G !== null ? (currentAllTime.avgSgT2G > 0 ? '+' : '') + currentAllTime.avgSgT2G : '—', l: 'Avg SG: T2G',
                delta: latestStats && deltaLabel(latestStats.avgSgT2G, false) },
            ].map((item, i) => (
              <div key={i} className="alltime-box">
                <div className="alltime-value" style={item.color ? { color: item.color } : undefined}>{item.v}</div>
                <div className="alltime-label">{item.l}</div>
                {item.delta && (
                  <div className="alltime-delta" style={{ color: item.delta.good ? '#86efac' : '#d63838' }}>
                    {item.delta.sign} {item.delta.value !== 0 ? item.delta.value : 'same'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {statsRounds.length >= 2 && (() => {
        const trendRounds = [...statsRounds]
          .sort((a, b) => new Date(a.date) - new Date(b.date))
          .slice(-10)
          .map(r => ({ r, st: calcStats(r.holes) }))
          .filter(x => x.st);
        if (!trendRounds.length) return null;
        const scores = trendRounds.map(x => x.st.totalScore);
        const maxS = Math.max(...scores);
        const minS = Math.min(...scores);
        const range = maxS - minS || 1;
        return (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">Score Trend — Last {trendRounds.length} Rounds</div>
            <div className="trend-chart">
              {trendRounds.map(({ r, st }) => {
                const pct = Math.max(10, Math.round(((st.totalScore - minS) / range) * 80 + 10));
                return (
                  <div key={r.id} className="trend-bar-wrap" title={`${r.courseName}: ${st.totalScore}`}>
                    <div className="trend-score-top">{st.totalScore}</div>
                    <div className="trend-bar" style={{
                      height: pct + '%',
                      background: st.scoreDiff < 0 ? 'var(--red)' : st.scoreDiff > 0 ? 'var(--blue)' : 'var(--accent)'
                    }} />
                    <div className="trend-label">{new Date(r.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {currentAllTime && (currentAllTime.par3avg !== null || currentAllTime.par4avg !== null || currentAllTime.par5avg !== null) && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-title">Avg Score vs Par by Hole Type</div>
          {[['Par 3s', currentAllTime.par3avg], ['Par 4s', currentAllTime.par4avg], ['Par 5s', currentAllTime.par5avg]].map(([label, avg]) => {
            if (avg === null) return null;
            const sign = avg >= 0 ? '+' : '';
            return (
              <div key={label} className="par-type-row">
                <span className="par-type-label">{label}</span>
                <span className={`par-type-diff ${avg < 0 ? 'under' : avg > 0 ? 'over' : 'even'}`}>{sign}{avg} / hole</span>
              </div>
            );
          })}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-text">No rounds saved yet.<br />Complete a round to see it here.</div>
        </div>
      ) : (
        <>
          {/* Stats inclusion controls — sit just above the rounds list */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 8, marginBottom: 10, padding: '10px 12px',
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
          }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--blue)' }}>
              {statsRounds.length} of {filtered.length} included in stats
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={includeAll}
                disabled={excludedInFilter === 0}
                style={{
                  background: excludedInFilter === 0 ? 'transparent' : 'var(--accent)',
                  color: excludedInFilter === 0 ? 'var(--blue)' : 'var(--card)',
                  border: '1px solid ' + (excludedInFilter === 0 ? 'var(--border)' : 'var(--accent)'),
                  borderRadius: 16, padding: '4px 12px',
                  fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                  cursor: excludedInFilter === 0 ? 'default' : 'pointer',
                  opacity: excludedInFilter === 0 ? 0.55 : 1,
                }}
              >CHECK ALL</button>
              <button
                onClick={excludeAll}
                disabled={statsRounds.length === 0}
                style={{
                  background: 'transparent',
                  color: 'var(--blue)',
                  border: '1px solid var(--blue)',
                  borderRadius: 16, padding: '4px 12px',
                  fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                  cursor: statsRounds.length === 0 ? 'default' : 'pointer',
                  opacity: statsRounds.length === 0 ? 0.55 : 1,
                }}
              >UNCHECK ALL</button>
            </div>
          </div>

          {/* Year → Month grouped, collapsible rounds list */}
          {grouped.map(yearGroup => {
            const yearOpen = expandedYears.has(yearGroup.year);
            const yearTotal = yearGroup.months.reduce((s, m) => s + m.rounds.length, 0);
            return (
              <div key={yearGroup.year} style={{ marginBottom: 10 }}>
                <button
                  onClick={() => toggleYear(yearGroup.year)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'var(--blue)', color: 'var(--card)',
                    border: 'none', borderRadius: 10, padding: '10px 14px',
                    fontSize: 14, fontWeight: 700, letterSpacing: 0.5,
                    cursor: 'pointer', marginBottom: 6,
                  }}
                >
                  <span>{yearGroup.year}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.85 }}>
                    {yearTotal} round{yearTotal !== 1 ? 's' : ''} {yearOpen ? '▾' : '▸'}
                  </span>
                </button>
                {yearOpen && yearGroup.months.map(monthGroup => {
                  const monthOpen = expandedMonths.has(monthGroup.key);
                  return (
                    <div key={monthGroup.key} style={{ marginLeft: 8, marginBottom: 8 }}>
                      <button
                        onClick={() => toggleMonth(monthGroup.key)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          background: 'var(--surface)', color: 'var(--blue)',
                          border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px',
                          fontSize: 13, fontWeight: 700,
                          cursor: 'pointer', marginBottom: 6,
                        }}
                      >
                        <span>{MONTH_NAMES[monthGroup.monthIdx]} {monthGroup.year}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.75 }}>
                          {monthGroup.rounds.length} round{monthGroup.rounds.length !== 1 ? 's' : ''} {monthOpen ? '▾' : '▸'}
                        </span>
                      </button>
                      {monthOpen && monthGroup.rounds.map(r => {
                        const st = calcStats(r.holes);
                        const isExpanded = expandedId === r.id;
                        const isIncluded = !excludedIds.has(r.id);
                        return (
                          <div key={r.id} className={'round-history-item' + (isIncluded ? '' : ' excluded-from-stats')}
                            onClick={() => setExpandedId(isExpanded ? null : r.id)}>
                            <div className="round-history-header">
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={isIncluded}
                                  onClick={e => e.stopPropagation()}
                                  onChange={() => toggleIncluded(r.id)}
                                  title={isIncluded ? 'Included in stats · click to exclude' : 'Excluded from stats · click to include'}
                                  className="round-include-checkbox"
                                />
                                <div style={{ minWidth: 0 }}>
                                  <div className="round-history-course">{r.courseName}</div>
                                  <div className="round-history-date">{formatDate(r.date)} · {r.playerName}</div>
                                </div>
                              </div>
                              <div className="round-history-score">
                                {st?.totalScore ?? '—'}
                                {st && (
                                  <div style={{ fontSize: '0.8rem', fontWeight: 600,
                                    color: st.scoreDiff < 0 ? 'var(--red)' : st.scoreDiff > 0 ? 'var(--blue)' : 'var(--text-dim)' }}>
                                    {scoreDiffLabel(st.scoreDiff)}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="round-history-meta">
                              <span className={'tag tag-' + r.roundType}>
                                {r.roundType === 'competition' ? 'Competition' : 'Practice'}
                              </span>
                              <span className="tag tag-tee">{r.tee}</span>
                            </div>

                            {isExpanded && (
                              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                                {st ? (
                                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '0.82rem', color: 'var(--text-dim)', marginBottom: 10 }}>
                                    {st.fwPct !== null && <span>FW: {st.fwPct}%</span>}
                                    {st.girPct !== null && <span>GIR: {st.girPct}%</span>}
                                    {st.avgPutts && <span>Putts: {st.avgPutts}/hole</span>}
                                    <span>Eagle: {st.breakdown.eagle}</span>
                                    <span>Birdie: {st.breakdown.birdie}</span>
                                    <span>Par: {st.breakdown.par}</span>
                                    <span>Bogey: {st.breakdown.bogey}</span>
                                    <span>+2+: {st.breakdown.double + st.breakdown.worse}</span>
                                  </div>
                                ) : (
                                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 10, fontStyle: 'italic' }}>
                                    No scores recorded yet.
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: 8 }}>
                                  {st && (
                                    <button className="btn btn-secondary btn-sm"
                                      onClick={e => { e.stopPropagation(); onViewRound(r); }}>
                                      View Analysis
                                    </button>
                                  )}
                                  <button className="btn btn-secondary btn-sm"
                                    onClick={e => { e.stopPropagation(); onEdit(r); }}>
                                    Edit
                                  </button>
                                  <button className="btn btn-delete btn-sm"
                                    onClick={e => {
                                      e.stopPropagation();
                                      if (window.confirm(`Delete round at ${r.courseName} on ${formatDate(r.date)}? This cannot be undone.`)) {
                                        onDelete(r.id);
                                        setExpandedId(null);
                                      }
                                    }}>
                                    Delete
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </>
      )}

      <div style={{ marginTop: 24 }}>
        <RecoverLiveRounds onRecover={onRecover} />
      </div>
    </div>
  );
}

// ============================================================
// WATCH LIVE CARD
// ============================================================
function WatchLiveCard() {
  const [code, setCode] = React.useState('');
  const [open, setOpen] = React.useState(false);
  function handleWatch() {
    const clean = code.trim().toUpperCase().replace(/\s+/g, '');
    if (clean) window.location.hash = '#/live/' + clean;
  }
  return (
    <div className={'collapsible-card' + (open ? ' open' : '')} style={{ marginBottom: 10 }}>
      <button className="collapsible-header" onClick={() => setOpen(v => !v)}>
        <span>Watch a Live Round</span>
        <span className="collapsible-chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="collapsible-body">
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
            Get the code from the player's GolfTrack app, then enter it below
          </div>
          <input
            className="form-input"
            placeholder="e.g. GRADY-APR8-X4K2"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleWatch()}
            style={{ width: '100%', fontSize: 18, fontFamily: 'monospace', letterSpacing: 2, marginBottom: 12, textAlign: 'center', fontWeight: 700 }}
          />
          <button
            className="btn btn-primary"
            onClick={handleWatch}
            disabled={!code.trim()}
            style={{ width: '100%', minHeight: 50, fontSize: 16, fontWeight: 700 }}
          >
            Watch Live →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Global Practice Timer Banner ─────────────────────────────────────────────
// Shows across ALL tabs when a drill timer is running in Practice

function GlobalTimerBanner({ timer, onGoToPractice }) {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  // Recalculate every 500ms
  React.useEffect(() => {
    if (!timer || timer.paused) return;
    const id = setInterval(() => forceUpdate(), 500);
    return () => clearInterval(id);
  }, [timer]);

  // Recalculate on screen wake
  React.useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') forceUpdate(); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  if (!timer) return null;

  const remainingMs = timer.paused
    ? timer.adjustedMs
    : Math.max(0, timer.adjustedMs - (Date.now() - timer.startTime));
  const secs = Math.ceil(remainingMs / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  const mmss = `${String(m).padStart(2,'0')}:${String(Math.max(0,s)).padStart(2,'0')}`;

  return (
    <div
      onClick={onGoToPractice}
      style={{
        position: 'fixed', bottom: 64, left: 0, right: 0, zIndex: 500,
        background: 'var(--surface)', borderTop: '2px solid var(--accent)',
        padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
        cursor: 'pointer',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          ⏱ {timer.drillName || 'Drill Timer'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {timer.paused ? 'Paused — tap to resume' : 'Tap to go to Practice'}
        </div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 900, color: secs <= 30 ? '#ff4d4f' : 'var(--accent)', fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'center' }}>
        {mmss}
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
function App() {
  const [screen, setScreen] = React.useState('setup');
  const [rounds, setRounds] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('golf_rounds') || '[]'); } catch { return []; }
  });
  const [customCourses, setCustomCourses] = React.useState(loadCustomCourses);
  const [pendingSetup, setPendingSetup] = React.useState(null);
  const [currentRound, setCurrentRound] = React.useState(null);
  const [roundSaved, setRoundSaved] = React.useState(false);
  const [historyRound, setHistoryRound] = React.useState(null);
  const [editingRound, setEditingRound] = React.useState(null);
  const [preloadCourse, setPreloadCourse] = React.useState(null);

  // ── Live round state ───────────────────────────────────────
  const [isLive, setIsLive] = React.useState(false);
  const [liveId, setLiveId] = React.useState(null);
  const [showSharePanel, setShowSharePanel] = React.useState(false);
  const [liveStatus, setLiveStatus] = React.useState(null); // null | 'ok' | 'error'
  const [liveSyncing, setLiveSyncing] = React.useState(false);
  const isLiveRef = React.useRef(false);
  const liveIdRef = React.useRef(null);
  const liveDebounceRef = React.useRef(null);
  React.useEffect(() => { isLiveRef.current = isLive; }, [isLive]);
  React.useEffect(() => { liveIdRef.current = liveId; }, [liveId]);

  // ── Practice timer (global banner across tabs) ─────────────
  const [practiceTimer, setPracticeTimer] = React.useState(null);

  // ── Firestore real-time rounds listener (shared family db) ─
  React.useEffect(() => {
    if (!db) {
      try { setRounds(JSON.parse(localStorage.getItem('golf_rounds') || '[]')); } catch { setRounds([]); }
      return;
    }
    const unsub = onSnapshot(collection(db, 'rounds'), (snap) => {
      const rs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      rs.sort((a, b) => new Date(b.date) - new Date(a.date));
      setRounds(rs);
    });
    return unsub;
  }, []);

  // ── One-time migration: upload any localStorage rounds to Firestore ──
  React.useEffect(() => {
    if (!db) return;
    if (localStorage.getItem('golf_migrated_to_firestore')) return;
    try {
      const localRounds = JSON.parse(localStorage.getItem('golf_rounds') || '[]');
      const localCourses = JSON.parse(localStorage.getItem('golf_custom_courses') || '[]');
      if (localRounds.length > 0) {
        localRounds.forEach(async (round) => {
          try { await setDoc(doc(db, 'rounds', round.id), round); } catch (e) { console.error(e); }
        });
      }
      if (localCourses.length > 0) {
        localCourses.forEach(async (course) => {
          try { await setDoc(doc(db, 'courses', course.id), course); } catch (e) { console.error(e); }
        });
      }
      localStorage.setItem('golf_migrated_to_firestore', 'true');
    } catch (e) { console.error(e); }
  }, []);

  // ── Firestore real-time courses listener ──────────────────
  React.useEffect(() => {
    if (!db) {
      setCustomCourses(loadCustomCourses());
      return;
    }
    const unsub = onSnapshot(collection(db, 'courses'), (snap) => {
      const cs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setCustomCourses(cs);
    });
    return unsub;
  }, []);

  // ── Write live round to Firebase — debounced 3s ────────────
  // Prevents rapid score edits from pushing unstable data to spectators
  React.useEffect(() => {
    if (!isLive || !liveId || !currentRound || !db) return;

    // Show "Syncing..." during debounce window
    setLiveSyncing(true);
    if (liveDebounceRef.current) clearTimeout(liveDebounceRef.current);

    liveDebounceRef.current = setTimeout(() => {
      const currentHoleObj = findCurrentHole(currentRound.holes);
      const cleanHoles = currentRound.holes.map(h => {
        const clean = {};
        Object.keys(h).forEach(k => { if (h[k] !== undefined) clean[k] = h[k]; });
        return clean;
      });
      const cleanOpponents = (currentRound.opponents || []).map(o => ({
        id: o.id || '',
        name: o.name || '',
        scores: (o.scores || []).map(s => (s === '' || s === null || s === undefined) ? '' : String(s)),
      }));
      const liveData = {
        playerName: currentRound.playerName || '',
        courseName: currentRound.courseName || '',
        tee: currentRound.tee || '',
        roundType: currentRound.roundType || '',
        holes: cleanHoles,
        opponents: cleanOpponents,
        currentHole: currentHoleObj ? currentHoleObj.number : 18,
        lastUpdate: Date.now(),
        isComplete: false,
        isLive: true,
        startTime: currentRound.date || '',
      };
      setDoc(doc(db, 'live_rounds', liveId), liveData)
        .then(() => { setLiveSyncing(false); console.log('Live round synced:', liveId); })
        .catch(err => { setLiveSyncing(false); console.error('Live sync failed:', err.code, err.message); });
    }, 3000);

    return () => {
      if (liveDebounceRef.current) clearTimeout(liveDebounceRef.current);
    };
  }, [currentRound, isLive, liveId]);

  // ── Custom course handlers ─────────────────────────────────
  const handleSaveCustomCourse = useCallback(async (course) => {
    if (db) {
      try { await setDoc(doc(db, 'courses', course.id), course); } catch (e) { console.error(e); }
    } else {
      const existing = loadCustomCourses();
      const updated = [course, ...existing.filter(c => c.id !== course.id)];
      persistCustomCourses(updated);
      setCustomCourses(updated);
    }
  }, []);

  // ── One-time backfill: populate blank tees from prior rounds ───────
  // Earlier versions did not write a round's entered par/yards back to
  // the saved course. This migration walks every saved round and, for
  // each (course, tee) pair, fills in any blank holes on the matching
  // custom course from the round's hole data. If the round references
  // a custom course that no longer exists in storage, the course is
  // recreated from the round. Built-in courses (numeric ids) are left
  // alone.
  React.useEffect(() => {
    if (localStorage.getItem('golf_courses_holes_backfilled_v3')) return;
    if (!rounds.length) return;

    const roundsByDate = [...rounds].sort((a, b) => new Date(b.date) - new Date(a.date));
    const normalize = (s) => (s || '').toString().trim().toLowerCase();
    const holeHasData = (h) => h && ((h.yards > 0) || (h.par && h.par !== 4));
    const isCustomId = (id) => typeof id === 'string' && id.startsWith('custom_');
    const isBuiltInId = (id) => COURSES.some(c => String(c.id) === String(id));

    // Index existing custom courses by id and by normalized name for lookup.
    const byId = new Map(customCourses.map(c => [c.id, c]));
    const byName = new Map(customCourses.map(c => [normalize(c.name), c]));
    const workingCourses = new Map();
    const log = [];

    for (const round of roundsByDate) {
      if (!round.holes?.length) continue;
      if (!round.holes.some(holeHasData)) continue;
      if (isBuiltInId(round.courseId)) continue;

      // Resolve the course this round belongs to: prefer in-flight working
      // copy, then existing customCourses (by id, then by name), then build
      // a fresh course from the round itself.
      const nameKey = normalize(round.courseName);
      let course =
        workingCourses.get(round.courseId) ||
        byId.get(round.courseId) ||
        (nameKey && byName.get(nameKey));

      if (course) {
        course = workingCourses.get(course.id) || { ...course, tees: (course.tees || []).map(t => ({ ...t, holes: [...(t.holes || [])] })) };
      } else {
        const newId = (isCustomId(round.courseId) && round.courseId) ||
          ('custom_recovered_' + (nameKey || 'course').replace(/[^a-z0-9]+/g, '_') + '_' + Date.now().toString(36));
        course = { id: newId, name: round.courseName || 'Recovered Course', location: '', tees: [], isCustom: true };
        log.push(`recovered ${course.name}`);
      }

      // Find or create the matching tee on the course (case-insensitive).
      const teeKey = normalize(round.tee);
      let teeIdx = (course.tees || []).findIndex(t => normalize(t.name) === teeKey);
      if (teeIdx < 0) {
        course.tees = [...(course.tees || []), { name: round.tee || 'Manual', color: 'white', holes: [] }];
        teeIdx = course.tees.length - 1;
      }
      const tee = course.tees[teeIdx];
      const teeHoles = [...(tee.holes || [])];

      // Backfill any blank tee hole from the round's matching hole.
      let teeChanged = false;
      for (const src of round.holes) {
        if (!holeHasData(src)) continue;
        const existingIdx = teeHoles.findIndex(h => h.number === src.number);
        if (existingIdx >= 0) {
          if (!holeHasData(teeHoles[existingIdx])) {
            teeHoles[existingIdx] = { number: src.number, par: src.par, yards: src.yards };
            teeChanged = true;
          }
        } else {
          teeHoles.push({ number: src.number, par: src.par, yards: src.yards });
          teeChanged = true;
        }
      }
      if (teeChanged) {
        teeHoles.sort((a, b) => a.number - b.number);
        course.tees[teeIdx] = { ...tee, holes: teeHoles };
        log.push(`${course.name} / ${tee.name}`);
      }

      workingCourses.set(course.id, course);
    }

    // Compare against the original snapshot to decide which to persist.
    const updates = [];
    for (const course of workingCourses.values()) {
      const original = byId.get(course.id);
      if (!original || JSON.stringify(original) !== JSON.stringify(course)) {
        updates.push(course);
      }
    }

    if (updates.length) {
      console.log('[course-backfill]', log);
      console.log(`[course-backfill] Saving ${updates.length} course(s):`, updates.map(c => c.name));
    } else {
      console.log('[course-backfill] No updates needed');
    }
    updates.forEach(handleSaveCustomCourse);
    localStorage.setItem('golf_courses_holes_backfilled_v3', 'true');
  }, [customCourses, rounds, handleSaveCustomCourse]);

  const handleDeleteCustomCourse = useCallback(async (courseId) => {
    if (db) {
      try { await deleteDoc(doc(db, 'courses', courseId)); } catch (e) { console.error(e); }
    } else {
      const updated = customCourses.filter(c => c.id !== courseId);
      persistCustomCourses(updated);
      setCustomCourses(updated);
    }
  }, [customCourses]);

  const handleSetupStart = (setup) => {
    setPendingSetup(setup);
    if (setup.selectedTee) {
      // Manual entry: skip tee selection, go straight to round
      const round = {
        id: genId(),
        date: new Date().toISOString(),
        playerName: setup.playerName,
        roundType: setup.roundType,
        courseId: setup.course.id,
        courseName: setup.course.name,
        tee: setup.selectedTee.name,
        teeColor: setup.selectedTee.color,
        isManual: true,
        holes: createHolesFromTee(setup.selectedTee),
        opponents: [],
      };
      setCurrentRound(round);
      setRoundSaved(false);
      setScreen('round');
    } else {
      setScreen('teeSelect');
    }
  };

  const handleTeeSelect = (tee) => {
    const round = {
      id: genId(),
      date: new Date().toISOString(),
      playerName: pendingSetup.playerName,
      roundType: pendingSetup.roundType,
      courseId: pendingSetup.course.id,
      courseName: pendingSetup.course.name,
      tee: tee.name,
      teeColor: tee.color,
      holes: createHolesFromTee(tee),
      opponents: [],
    };
    setCurrentRound(round);
    setRoundSaved(false);
    setScreen('round');
  };

  const handleUpdateHole = useCallback((index, updates) => {
    setCurrentRound(prev => {
      const holes = [...prev.holes];
      holes[index] = { ...holes[index], ...updates };
      return { ...prev, holes };
    });
  }, []);

  const handleAddOpponent = useCallback(() => {
    setCurrentRound(prev => {
      const holeCount = prev.holes.length || 18;
      const opponents = prev.opponents || [];
      return {
        ...prev,
        opponents: [...opponents, { id: genId(), name: '', scores: Array(holeCount).fill('') }],
      };
    });
  }, []);

  const handleRemoveOpponent = useCallback((opponentId) => {
    setCurrentRound(prev => ({
      ...prev,
      opponents: (prev.opponents || []).filter(o => o.id !== opponentId),
    }));
  }, []);

  const handleUpdateOpponent = useCallback((opponentId, updates) => {
    setCurrentRound(prev => ({
      ...prev,
      opponents: (prev.opponents || []).map(o => o.id === opponentId ? { ...o, ...updates } : o),
    }));
  }, []);

  const handleUpdateOpponentScore = useCallback((opponentId, holeIndex, score) => {
    setCurrentRound(prev => ({
      ...prev,
      opponents: (prev.opponents || []).map(o => {
        if (o.id !== opponentId) return o;
        const scores = [...(o.scores || [])];
        scores[holeIndex] = score;
        return { ...o, scores };
      }),
    }));
  }, []);

  const handleToggleLive = async () => {
    if (isLiveRef.current) {
      // Stop broadcasting
      setIsLive(false);
      setShowSharePanel(false);
      setLiveStatus(null);
      if (liveIdRef.current && db) {
        setDoc(doc(db, 'live_rounds', liveIdRef.current), { isLive: false }, { merge: true }).catch(console.error);
      }
    } else {
      // Start broadcasting
      if (!currentRound) return;
      const newId = generateLiveId(currentRound.playerName, currentRound.date);
      setLiveId(newId);
      liveIdRef.current = newId;
      setIsLive(true);
      isLiveRef.current = true;
      setShowSharePanel(true);
      setLiveStatus(null);
      if (db) {
        const currentHoleObj = findCurrentHole(currentRound.holes);
        // Strip undefined values from holes — Firestore rejects them
        const cleanHoles = currentRound.holes.map(h => {
          const clean = {};
          Object.keys(h).forEach(k => { if (h[k] !== undefined) clean[k] = h[k]; });
          return clean;
        });
        const cleanOpponents = (currentRound.opponents || []).map(o => ({
          id: o.id || '',
          name: o.name || '',
          scores: (o.scores || []).map(s => (s === '' || s === null || s === undefined) ? '' : String(s)),
        }));
        const liveData = {
          playerName: currentRound.playerName || '',
          courseName: currentRound.courseName || '',
          tee: currentRound.tee || '',
          roundType: currentRound.roundType || '',
          holes: cleanHoles,
          opponents: cleanOpponents,
          currentHole: currentHoleObj ? currentHoleObj.number : 1,
          lastUpdate: Date.now(),
          isComplete: false,
          isLive: true,
          startTime: currentRound.date || '',
        };
        try {
          await setDoc(doc(db, 'live_rounds', newId), liveData);
          console.log('Live round created successfully:', newId);
          setLiveStatus('ok');
        } catch (err) {
          console.error('Failed to start live round:', err.code, err.message);
          setLiveStatus('error');
          alert(`Could not go live: ${err.message}\n\nFix: Go to Firebase Console → Firestore → Rules and make sure live_rounds is allowed:\n\nmatch /{document=**} {\n  allow read, write: if true;\n}`);
        }
      } else {
        setLiveStatus('error');
        alert('Firebase is not connected. Live scoring requires an internet connection.');
      }
    }
  };

  const handleSaveRound = async () => {
    if (db) {
      try { await setDoc(doc(db, 'rounds', currentRound.id), currentRound); } catch (e) { console.error(e); }
    } else {
      const newRounds = [currentRound, ...rounds];
      setRounds(newRounds);
      saveRoundsToStorage(newRounds);
    }
    // Persist per-hole par/distance back to the saved custom course so the
    // next round on the same course+tee prefills with the values the user
    // entered manually (instead of the blank par=4, yards=0 defaults).
    if (currentRound.courseId) {
      const baseCourse =
        customCourses.find(c => c.id === currentRound.courseId) ||
        (pendingSetup?.course?.id === currentRound.courseId ? pendingSetup.course : null);
      const isCustomCourse = !!(baseCourse && (baseCourse.isCustom || (typeof baseCourse.id === 'string' && baseCourse.id.startsWith('custom_'))));
      if (baseCourse && isCustomCourse) {
        const holeData = currentRound.holes.map(h => ({ number: h.number, par: h.par, yards: h.yards }));
        const updatedTees = (baseCourse.tees || []).map(t =>
          t.name === currentRound.tee ? { ...t, holes: holeData } : t
        );
        handleSaveCustomCourse({ ...baseCourse, tees: updatedTees, isCustom: true });
      }
    }
    // Mark live round complete when saving
    if (isLiveRef.current && liveIdRef.current && db) {
      setIsLive(false);
      setDoc(doc(db, 'live_rounds', liveIdRef.current), { isComplete: true, isLive: false, lastUpdate: Date.now() }, { merge: true }).catch(console.error);
    }
    setRoundSaved(true);
  };

  const handleNewRound = () => {
    setCurrentRound(null);
    setPendingSetup(null);
    setHistoryRound(null);
    setRoundSaved(false);
    setIsLive(false);
    setLiveId(null);
    setShowSharePanel(false);
    isLiveRef.current = false;
    liveIdRef.current = null;
    setScreen('setup');
  };

  const handleViewHistoryRound = (r) => {
    setHistoryRound(r);
    setScreen('historyAnalysis');
  };

  const handleStartEdit = (r) => {
    setEditingRound(r);
    setHistoryRound(null);
    setScreen('editRound');
  };

  const handleRecoverRound = async (newRound) => {
    if (db) {
      try { await setDoc(doc(db, 'rounds', newRound.id), newRound); } catch (e) { console.error(e); }
    } else {
      const newRounds = [newRound, ...rounds];
      setRounds(newRounds);
      saveRoundsToStorage(newRounds);
    }
  };

  const handleDeleteRound = async (roundId) => {
    if (db) {
      try { await deleteDoc(doc(db, 'rounds', roundId)); } catch (e) { console.error(e); }
    } else {
      const newRounds = rounds.filter(r => r.id !== roundId);
      setRounds(newRounds);
      saveRoundsToStorage(newRounds);
    }
  };

  const handleSaveEdit = async (updatedRound) => {
    if (db) {
      try { await setDoc(doc(db, 'rounds', updatedRound.id), updatedRound); } catch (e) { console.error(e); }
    } else {
      const newRounds = rounds.map(r => r.id === updatedRound.id ? updatedRound : r);
      setRounds(newRounds);
      saveRoundsToStorage(newRounds);
    }
    setEditingRound(null);
    setScreen('history');
  };

  const handlePreloadCourse = (courseName) => {
    setPreloadCourse(courseName);
    setScreen('setup');
  };

  // Nav tabs config
  const navItems = [
    { key: 'setup', label: '⛳ New' },
    { key: 'round', label: '📋 Round', disabled: !currentRound },
    { key: 'analysis', label: '📊 Analysis', disabled: !currentRound },
    { key: 'history', label: '📁 History' },
    { key: 'calendar', label: '📅 Cal' },
    { key: 'practice', label: '🏌️‍♂️ Practice' },
  ];

  const handleNavClick = (key) => {
    if ((key === 'round' || key === 'analysis') && !currentRound) return;
    setHistoryRound(null);
    setScreen(key);
  };

  const activeNav = screen === 'historyAnalysis' ? 'history'
    : screen === 'teeSelect' ? 'setup'
    : screen === 'editRound' ? 'history'
    : screen;

  return (
    <div>
      <div className="app-header">
        <div className="logo">Grady <span>GolfTrack</span></div>
        <div style={{ fontSize: '0.78rem', color: 'rgba(240, 236, 224, 0.7)' }}>
          {rounds.length} round{rounds.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="nav-tabs">
        {navItems.map(item => (
          <button key={item.key}
            className={'nav-tab' + (activeNav === item.key ? ' active' : '')}
            disabled={item.disabled}
            onClick={() => handleNavClick(item.key)}>
            {item.label}
          </button>
        ))}
      </div>

      {screen === 'setup' && (
        <>
          <SetupScreen
            onStart={handleSetupStart}
            preloadCourseName={preloadCourse}
            customCourses={customCourses}
            onSaveCustomCourse={handleSaveCustomCourse}
            onDeleteCustomCourse={handleDeleteCustomCourse}
          />
        </>
      )}
      {screen === 'teeSelect' && pendingSetup && (
        <TeeSelectScreen
          course={pendingSetup.course}
          onSelectTee={handleTeeSelect}
          onBack={() => setScreen('setup')}
          onRenameCourse={(newName) => {
            // Update pending setup so the round picks up the new name
            setPendingSetup(prev => prev ? { ...prev, course: { ...prev.course, name: newName, isCustom: true } } : prev);
            // Persist every rename to Firestore so the new name is in the database next time.
            // - Custom/scanned courses (string id starting with custom_) overwrite in place
            // - Built-in courses (numeric id) are saved as a new custom doc keyed off the original id
            //   so the original built-in stays intact and the renamed copy joins the user's custom courses
            const c = pendingSetup.course;
            const isAlreadyCustom = !!c.isCustom || (typeof c.id === 'string' && c.id.startsWith('custom_'));
            const id = isAlreadyCustom
              ? c.id
              : 'custom_override_' + String(c.id);
            handleSaveCustomCourse({ ...c, id, name: newName, isCustom: true });
          }} />
      )}
      {screen === 'round' && currentRound && (
        <RoundScreen
          round={currentRound}
          onUpdateHole={handleUpdateHole}
          onAddOpponent={handleAddOpponent}
          onRemoveOpponent={handleRemoveOpponent}
          onUpdateOpponent={handleUpdateOpponent}
          onUpdateOpponentScore={handleUpdateOpponentScore}
          onFinish={() => setScreen('analysis')}
          onSave={handleSaveRound}
          saved={roundSaved}
          isManual={currentRound.isManual}
          isLive={isLive}
          liveId={liveId}
          onToggleLive={handleToggleLive}
          showSharePanel={showSharePanel}
          onShowShare={() => setShowSharePanel(true)}
          onHideShare={() => setShowSharePanel(false)}
          liveStatus={liveStatus}
          liveSyncing={liveSyncing}
        />
      )}
      {screen === 'analysis' && currentRound && (
        <AnalysisScreen round={currentRound} onSave={handleSaveRound} onNewRound={handleNewRound} saved={roundSaved} />
      )}
      {screen === 'historyAnalysis' && historyRound && (
        <AnalysisScreen
          round={historyRound}
          onSave={() => {}}
          onNewRound={() => { setHistoryRound(null); setScreen('history'); }}
          onBack={() => { setHistoryRound(null); setScreen('history'); }}
          saved={true} />
      )}
      {screen === 'history' && (
        <HistoryScreen rounds={rounds} onViewRound={handleViewHistoryRound} onEdit={handleStartEdit} onDelete={handleDeleteRound} onRecover={handleRecoverRound} />
      )}
      {screen === 'editRound' && editingRound && (
        <EditRoundScreen
          round={editingRound}
          onSave={handleSaveEdit}
          onCancel={() => { setEditingRound(null); setScreen('history'); }} />
      )}
      {screen === 'calendar' && (
        <CalendarScreen onPreloadCourse={handlePreloadCourse} />
      )}
      {screen === 'practice' && (
        <PracticeScreen onTimerChange={setPracticeTimer} />
      )}

      {/* Global practice timer banner — visible on ALL tabs when timer runs */}
      {practiceTimer && screen !== 'practice' && (
        <GlobalTimerBanner
          timer={practiceTimer}
          onGoToPractice={() => setScreen('practice')}
        />
      )}
    </div>
  );
}

export default function AppWrapper() {
  const [hash, setHash] = React.useState(window.location.hash);

  React.useEffect(() => {
    const handler = () => setHash(window.location.hash);
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const liveMatch = hash.match(/^#\/live\/([A-Z0-9-]+)$/i);
  if (liveMatch) {
    return <LiveViewer liveId={liveMatch[1].toUpperCase()} />;
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  );
}
