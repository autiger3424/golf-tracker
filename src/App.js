import React, { useCallback } from 'react';
import './App.css';
import { COURSES } from './courses';
import PracticeScreen from './PracticeScreen';
import { GoogleOAuthProvider } from '@react-oauth/google';
// import { useGoogleLogin } from '@react-oauth/google'; // archived with Google Calendar
import { GOOGLE_CLIENT_ID } from './config';
import { db } from './firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, getDoc } from 'firebase/firestore';

// ============================================================
// HELPERS
// ============================================================
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
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

  return { totalScore, totalPar, scoreDiff, fwPct, girPct, avgPutts, sumPutts, breakdown, holesPlayed: played.length };
}

function createHolesFromTee(tee) {
  return tee.holes.map(h => ({
    number: h.number, par: h.par, yards: h.yards,
    score: '', putts: '', fairwayHit: null, fairwayMissDirection: null, gir: null,
    fairwayBunker: false, greensideBunker: false, ob: false, water: false, notes: ''
  }));
}

function createBlankHoles() {
  return Array.from({ length: 18 }, (_, i) => ({
    number: i + 1, par: 4, yards: 0,
    score: '', putts: '', fairwayHit: null, fairwayMissDirection: null, gir: null,
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
function HoleCard({ hole, onChange, isManual }) {
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
                <label>Par</label>
                <input type="number" className="score-input" value={hole.par}
                  min={3} max={6} placeholder="4"
                  onChange={e => onChange({ par: parseInt(e.target.value) || 4 })} />
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
  const [playerName, setPlayerName] = React.useState(() => localStorage.getItem('golf_player_name') || '');
  const [roundType, setRoundType] = React.useState('practice');
  const [courseSearch, setCourseSearch] = React.useState('');
  const [selectedCourse, setSelectedCourse] = React.useState(null);
  const [scanStatus, setScanStatus] = React.useState(null);
  const [scanMsg, setScanMsg] = React.useState('');
  const [scannedTees, setScannedTees] = React.useState(null);
  const fileRef = React.useRef(null);
  const [manualCourseName, setManualCourseName] = React.useState(preloadCourseName || '');
  const [manualTeeName, setManualTeeName] = React.useState('');

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
      const course = selectedCourse
        ? { id: selectedCourse.id, name: selectedCourse.name, location: selectedCourse.location, tees: selectedCourse.tees }
        : { id: 'scanned', name: scannedTees.courseName || 'Scanned Course', location: '', tees: scannedTees.tees };
      onStart({ playerName: playerName.trim(), roundType, course });
    }
  };

  return (
    <div className="screen">
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 4 }}>New Round</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Set up your round details</p>
      </div>

      <div className="form-group">
        <label className="form-label">Player Name</label>
        <input className="form-input" type="text" value={playerName}
          onChange={e => setPlayerName(e.target.value)} placeholder="Your name" />
      </div>

      <div className="form-group">
        <label className="form-label">Round Type</label>
        <div className="toggle-group">
          <button className={`toggle-btn${roundType === 'practice' ? ' active' : ''}`}
            onClick={() => setRoundType('practice')}>⛳ Practice</button>
          <button className={`toggle-btn${roundType === 'competition' ? ' active competition' : ''}`}
            onClick={() => setRoundType('competition')}>🏆 Competition</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">📷 Scan Scorecard — Gemini AI</div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', marginBottom: 10 }}>
          Take a photo or upload a scorecard image and AI will extract all tee boxes and hole data automatically.
        </p>
        <button className="btn btn-primary" onClick={() => fileRef.current?.click()}
          disabled={scanStatus === 'loading'}>
          {scanStatus === 'loading' ? '⏳ Scanning…' : '📷 Choose Photo or Take Picture'}
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
            📍 {scannedTees.courseName}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">Or Enter Course Manually</div>
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

      <div className="card">
        <div className="card-title">Or Choose a Built-in Course</div>
        <input className="form-input" style={{ marginBottom: 8 }} type="text"
          value={courseSearch} onChange={e => setCourseSearch(e.target.value)}
          placeholder="Search 10 famous US courses…" />
        <div className="course-list">
          {filtered.map(c => (
            <div key={c.id}
              className={`course-item${selectedCourse?.id === c.id ? ' selected' : ''}`}
              onClick={() => { setSelectedCourse(c); setScannedTees(null); setScanStatus(null); }}>
              <div style={{ flex: 1 }}>
                <div className="course-item-name">
                  {c.name}
                  {c.isCustom && <span className="custom-course-badge">⭐ Saved</span>}
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
        </div>
      </div>

      <button className="btn btn-primary" disabled={!canStart} onClick={handleStart} style={{ marginTop: 8 }}>
        {isManualMode ? 'Start Round →' : 'Select Tee Box →'}
      </button>
    </div>
  );
}

// ============================================================
// TEE SELECT SCREEN
// ============================================================
function TeeSelectScreen({ course, onSelectTee, onBack }) {
  const [selected, setSelected] = React.useState(null);
  const totalYards = (tee) => tee.holes.reduce((s, h) => s + h.yards, 0);

  return (
    <div className="screen">
      <button className="btn btn-secondary btn-sm" style={{ marginBottom: 16, width: 'auto' }} onClick={onBack}>
        ← Back
      </button>
      <div style={{ marginBottom: 20 }}>
        <h2>{course.name}</h2>
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
function RoundScreen({ round, onUpdateHole, onFinish, isManual }) {
  const stats = calcStats(round.holes);

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
        {round.holes.map((hole, i) => (
          <HoleCard key={hole.number} hole={hole} isManual={isManual}
            onChange={(updates) => onUpdateHole(i, updates)} />
        ))}
        <button className="btn btn-gold" style={{ marginTop: 8 }} onClick={onFinish}>
          View Analysis →
        </button>
      </div>
    </div>
  );
}

// ============================================================
// ANALYSIS SCREEN
// ============================================================
function AnalysisScreen({ round, onSave, onNewRound, saved }) {
  const stats = calcStats(round.holes);

  if (!stats) {
    return (
      <div className="screen">
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <div className="empty-state-text">No holes scored yet.</div>
        </div>
        <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={onNewRound}>← Back</button>
      </div>
    );
  }

  const { totalScore, totalPar, scoreDiff, fwPct, girPct, avgPutts, sumPutts, breakdown, holesPlayed } = stats;

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
          {holesPlayed} holes · {round.roundType === 'competition' ? '🏆 Competition' : '⛳ Practice'} · {formatDate(round.date)}
        </div>
      </div>

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
          <div className="stat-box-value">{avgPutts ?? '—'}</div>
          <div className="stat-box-label">Avg Putts</div>
        </div>
      </div>

      {sumPutts !== null && (
        <div style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: -6, marginBottom: 12 }}>
          Total putts: {sumPutts}
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
            {calStatus === 'loading' ? '⏳ Adding…' : calStatus === 'success' ? '✓ Added to Calendar' : '📅 Add to Google Calendar'}
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
                onClick={() => setRoundType('practice')}>⛳ Practice</button>
              <button className={`toggle-btn${roundType === 'competition' ? ' active competition' : ''}`}
                onClick={() => setRoundType('competition')}>🏆 Competition</button>
            </div>
          </div>
        </div>

        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Holes
        </div>
        {holes.map((hole, i) => (
          <HoleCard key={hole.number} hole={hole} isManual={round.isManual}
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
            <button className={`toggle-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => setViewMode('list')}>☰ List</button>
            <button className={`toggle-btn${viewMode === 'calendar' ? ' active' : ''}`} onClick={() => setViewMode('calendar')}>📅 Month</button>
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
// HISTORY SCREEN
// ============================================================
function HistoryScreen({ rounds, onViewRound, onEdit }) {
  const [filter, setFilter] = React.useState('all');
  const [expandedId, setExpandedId] = React.useState(null);

  const filtered = rounds
    .filter(r => filter === 'all' || r.roundType === filter)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

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
    return {
      rounds: rs.length, avg, best,
      fwPct: fwArr.length ? Math.round(fwArr.reduce((a, b) => a + b, 0) / fwArr.length) : null,
      girPct: girArr.length ? Math.round(girArr.reduce((a, b) => a + b, 0) / girArr.length) : null,
      avgPutts: puttArr.length ? (puttArr.reduce((a, b) => a + b, 0) / puttArr.length).toFixed(1) : null,
    };
  };

  const allTimeData = {
    all: calcAllTime(rounds),
    practice: calcAllTime(rounds.filter(r => r.roundType === 'practice')),
    competition: calcAllTime(rounds.filter(r => r.roundType === 'competition')),
  };
  const currentAllTime = allTimeData[filter];

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
          <div className="card-title">
            {filter === 'competition' ? 'Competition ' : filter === 'practice' ? 'Practice ' : 'All-Time '}Stats
          </div>
          <div className="alltime-grid">
            {[
              { v: currentAllTime.rounds, l: 'Rounds' },
              { v: currentAllTime.avg, l: 'Avg Score' },
              { v: currentAllTime.best, l: 'Best Score' },
              { v: currentAllTime.fwPct !== null ? currentAllTime.fwPct + '%' : '—', l: 'FW Hit %' },
              { v: currentAllTime.girPct !== null ? currentAllTime.girPct + '%' : '—', l: 'GIR %' },
              { v: currentAllTime.avgPutts ?? '—', l: 'Avg Putts' },
            ].map((item, i) => (
              <div key={i} className="alltime-box">
                <div className="alltime-value">{item.v}</div>
                <div className="alltime-label">{item.l}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏌️</div>
          <div className="empty-state-text">No rounds saved yet.<br />Complete a round to see it here.</div>
        </div>
      ) : (
        filtered.map(r => {
          const st = calcStats(r.holes);
          const isExpanded = expandedId === r.id;
          return (
            <div key={r.id} className="round-history-item"
              onClick={() => setExpandedId(isExpanded ? null : r.id)}>
              <div className="round-history-header">
                <div>
                  <div className="round-history-course">{r.courseName}</div>
                  <div className="round-history-date">{formatDate(r.date)} · {r.playerName}</div>
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
                  {r.roundType === 'competition' ? '🏆 Competition' : '⛳ Practice'}
                </span>
                <span className="tag tag-tee">{r.tee}</span>
              </div>

              {isExpanded && st && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '0.82rem', color: 'var(--text-dim)', marginBottom: 10 }}>
                    {st.fwPct !== null && <span>FW: {st.fwPct}%</span>}
                    {st.girPct !== null && <span>GIR: {st.girPct}%</span>}
                    {st.avgPutts && <span>Putts: {st.avgPutts}/hole</span>}
                    <span>🦅 {st.breakdown.eagle}</span>
                    <span>🐦 {st.breakdown.birdie}</span>
                    <span>⚪ {st.breakdown.par}</span>
                    <span>+1: {st.breakdown.bogey}</span>
                    <span>+2+: {st.breakdown.double + st.breakdown.worse}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary btn-sm"
                      onClick={e => { e.stopPropagation(); onViewRound(r); }}>
                      View Analysis
                    </button>
                    <button className="btn btn-secondary btn-sm"
                      onClick={e => { e.stopPropagation(); onEdit(r); }}>
                      ✏️ Edit Round
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
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

  const handleSaveRound = async () => {
    if (db) {
      try { await setDoc(doc(db, 'rounds', currentRound.id), currentRound); } catch (e) { console.error(e); }
    } else {
      const newRounds = [currentRound, ...rounds];
      setRounds(newRounds);
      saveRoundsToStorage(newRounds);
    }
    setRoundSaved(true);
  };

  const handleNewRound = () => {
    setCurrentRound(null);
    setPendingSetup(null);
    setHistoryRound(null);
    setRoundSaved(false);
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
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
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
        <SetupScreen
          onStart={handleSetupStart}
          preloadCourseName={preloadCourse}
          customCourses={customCourses}
          onSaveCustomCourse={handleSaveCustomCourse}
          onDeleteCustomCourse={handleDeleteCustomCourse}
        />
      )}
      {screen === 'teeSelect' && pendingSetup && (
        <TeeSelectScreen
          course={pendingSetup.course}
          onSelectTee={handleTeeSelect}
          onBack={() => setScreen('setup')} />
      )}
      {screen === 'round' && currentRound && (
        <RoundScreen round={currentRound} onUpdateHole={handleUpdateHole}
          onFinish={() => setScreen('analysis')} isManual={currentRound.isManual} />
      )}
      {screen === 'analysis' && currentRound && (
        <AnalysisScreen round={currentRound} onSave={handleSaveRound} onNewRound={handleNewRound} saved={roundSaved} />
      )}
      {screen === 'historyAnalysis' && historyRound && (
        <AnalysisScreen
          round={historyRound}
          onSave={() => {}}
          onNewRound={() => { setHistoryRound(null); setScreen('history'); }}
          saved={true} />
      )}
      {screen === 'history' && (
        <HistoryScreen rounds={rounds} onViewRound={handleViewHistoryRound} onEdit={handleStartEdit} />
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
        <PracticeScreen />
      )}
    </div>
  );
}

export default function AppWrapper() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  );
}
