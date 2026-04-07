import React, { useCallback } from 'react';
import './App.css';
import { COURSES } from './courses';
import { GEMINI_API_KEY } from './config';

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
    score: '', putts: '', fairwayHit: null, gir: false,
    fairwayBunker: false, greensideBunker: false, ob: false, water: false, notes: ''
  }));
}

function createBlankHoles() {
  return Array.from({ length: 18 }, (_, i) => ({
    number: i + 1, par: 4, yards: 0,
    score: '', putts: '', fairwayHit: null, gir: false,
    fairwayBunker: false, greensideBunker: false, ob: false, water: false, notes: ''
  }));
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function saveRoundsToStorage(rs) {
  try { localStorage.setItem('golf_rounds', JSON.stringify(rs)); } catch (e) {}
}

// ============================================================
// GEMINI VISION API
// ============================================================
async function scanScorecardWithGemini(base64Image, mediaType) {
  const prompt = `Read this golf scorecard. Return ONLY valid JSON with no other text:
{"courseName": "string", "tees": [{"name": "string", "color": "string", "holes": [{"hole": 1, "par": 4, "yards": 400}]}]}
Include every tee box visible. Each tee must have exactly 18 holes. color should be one of: black/blue/white/red/gold/green/silver.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: prompt },
          { inlineData: { mimeType: mediaType, data: base64Image } }
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4000 }
      })
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini API error ${response.status}`);
  }

  const data = await response.json();
  const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text || '')
    .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(raw);

  // Normalize: prompt returns "hole" field; app expects "number"
  if (parsed.tees) {
    parsed.tees = parsed.tees.map(tee => ({
      name: tee.name || 'Unknown',
      color: tee.color || 'white',
      holes: (tee.holes || []).map((h, i) => ({
        number: h.hole || h.number || (i + 1),
        par: h.par || 4,
        yards: h.yards || 0
      }))
    }));
  }
  return parsed;
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
              <input type="number" className="score-input" value={hole.score}
                min={1} max={15} placeholder={hole.par}
                onChange={e => onChange({ score: e.target.value })} />
            </div>
            <div className="stat-item">
              <label>Putts</label>
              <input type="number" className="score-input" value={hole.putts}
                min={0} max={10} placeholder="0"
                onChange={e => onChange({ putts: e.target.value })} />
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
                    onClick={() => onChange({ fairwayHit: hole.fairwayHit === true ? null : true })}>
                    ✓ Hit
                  </button>
                  <button className={`chip${hole.fairwayHit === false ? ' active red' : ''}`}
                    onClick={() => onChange({ fairwayHit: hole.fairwayHit === false ? null : false })}>
                    ✗ Miss
                  </button>
                </>
              )}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="form-label" style={{ marginBottom: 6 }}>GIR (Green in Regulation)</label>
            <div className="toggle-buttons">
              <button className={`chip${hole.gir === true ? ' active' : ''}`}
                onClick={() => onChange({ gir: !hole.gir })}>
                {hole.gir ? '✓ Yes' : 'No'}
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
function SetupScreen({ onStart }) {
  const [playerName, setPlayerName] = React.useState(() => localStorage.getItem('golf_player_name') || '');
  const [roundType, setRoundType] = React.useState('practice');
  const [courseSearch, setCourseSearch] = React.useState('');
  const [selectedCourse, setSelectedCourse] = React.useState(null);
  const [scanStatus, setScanStatus] = React.useState(null);
  const [scanMsg, setScanMsg] = React.useState('');
  const [scannedTees, setScannedTees] = React.useState(null);
  const fileRef = React.useRef(null);
  const [manualCourseName, setManualCourseName] = React.useState('');
  const [manualTeeName, setManualTeeName] = React.useState('');

  const filtered = COURSES.filter(c =>
    c.name.toLowerCase().includes(courseSearch.toLowerCase()) ||
    c.location.toLowerCase().includes(courseSearch.toLowerCase())
  );

  const handleScan = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result.split(',')[1];
      const mediaType = file.type || 'image/jpeg';
      setScanStatus('loading');
      setScanMsg('Analyzing scorecard with Gemini AI…');
      setSelectedCourse(null);
      setManualCourseName('');
      try {
        const result = await scanScorecardWithGemini(base64, mediaType);
        setScannedTees(result);
        setScanStatus('success');
        setScanMsg(
          (result.courseName ? result.courseName + ' — ' : '') +
          (result.tees?.length || 0) + ' tee(s) found: ' +
          (result.tees?.map(t => t.name).join(', ') || '')
        );
      } catch (err) {
        setScanStatus('error');
        setScanMsg('Scan failed: ' + err.message);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
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
      const course = {
        id: 'manual',
        name: manualCourseName.trim(),
        location: '',
        tees: [tee],
      };
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
              <div>
                <div className="course-item-name">{c.name}</div>
                <div className="course-item-loc">{c.location}</div>
              </div>
              {selectedCourse?.id === c.id && <span style={{ marginLeft: 'auto', color: 'var(--accent)' }}>✓</span>}
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
              <tr><th>#</th><th>Par</th><th>Yds</th><th>Score</th><th>Putts</th><th>FW</th><th>GIR</th></tr>
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
                    <td>{h.gir ? '✓' : '—'}</td>
                  </tr>
                );
              })}
              <tr style={{ background: 'var(--surface)', fontWeight: 700 }}>
                <td colSpan={3} style={{ textAlign: 'left', paddingLeft: 4, color: 'var(--text-dim)' }}>Total</td>
                <td className={'score-cell ' + scoreDiffClass(scoreDiff)}>{totalScore}</td>
                <td>{sumPutts ?? '—'}</td>
                <td>{fwPct !== null ? fwPct + '%' : '—'}</td>
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
    </div>
  );
}

// ============================================================
// HISTORY SCREEN
// ============================================================
function HistoryScreen({ rounds, onViewRound }) {
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
                  <button className="btn btn-secondary btn-sm"
                    onClick={e => { e.stopPropagation(); onViewRound(r); }}>
                    View Full Analysis
                  </button>
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
export default function App() {
  const [screen, setScreen] = React.useState('setup');
  const [rounds, setRounds] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('golf_rounds') || '[]'); } catch { return []; }
  });
  const [pendingSetup, setPendingSetup] = React.useState(null);
  const [currentRound, setCurrentRound] = React.useState(null);
  const [roundSaved, setRoundSaved] = React.useState(false);
  const [historyRound, setHistoryRound] = React.useState(null);

  const saveRounds = useCallback((rs) => {
    setRounds(rs);
    saveRoundsToStorage(rs);
  }, []);

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

  const handleSaveRound = () => {
    const newRounds = [currentRound, ...rounds];
    saveRounds(newRounds);
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

  // Nav tabs config
  const navItems = [
    { key: 'setup', label: '⛳ New' },
    { key: 'round', label: '📋 Round', disabled: !currentRound },
    { key: 'analysis', label: '📊 Analysis', disabled: !currentRound },
    { key: 'history', label: '📁 History' },
  ];

  const handleNavClick = (key) => {
    if ((key === 'round' || key === 'analysis') && !currentRound) return;
    setHistoryRound(null);
    setScreen(key);
  };

  const activeNav = screen === 'historyAnalysis' ? 'analysis' : screen === 'teeSelect' ? 'setup' : screen;

  return (
    <div>
      <div className="app-header">
        <div className="logo">Golf<span>Track</span></div>
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
        <SetupScreen onStart={handleSetupStart} />
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
        <HistoryScreen rounds={rounds} onViewRound={handleViewHistoryRound} />
      )}
    </div>
  );
}
