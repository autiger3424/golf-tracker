import React from 'react';
import { db } from './firebase';
import { doc, onSnapshot } from 'firebase/firestore';

// ─── Score helpers ────────────────────────────────────────────────────────────

// Match the Round Analysis screen's score breakdown palette
const SCORE_COLORS = {
  eagle: '#ffd700',     // gold
  birdie: '#991b1b',    // var(--red)
  par: '#2d6a4f',       // var(--accent) — green
  bogey: '#1e3a5f',     // var(--blue) — navy
  double: '#ab47bc',    // pink/purple
  worse: '#e64a19',     // orange-red (Triple+)
};

function getScoreColor(diff) {
  if (diff === null || diff === undefined) return 'var(--blue)';
  if (diff <= -2) return SCORE_COLORS.eagle;
  if (diff === -1) return SCORE_COLORS.birdie;
  if (diff === 0) return SCORE_COLORS.par;
  if (diff === 1) return SCORE_COLORS.bogey;
  if (diff === 2) return SCORE_COLORS.double;
  return SCORE_COLORS.worse;
}

// Classic scorecard mark:
//   Par          → no symbol (plain number)
//   Birdie       → open circle, black number
//   Eagle        → two concentric circles, black number
//   Albatross+   → solid circle with outer frame, white number
//   Bogey        → open square, black number
//   Double bogey → two concentric squares, black number
//   Triple+      → solid square with outer frame, white number
function ScoreBadge({ score, par, isCurrent, isFlash, size = 26 }) {
  const hasScore = score !== '' && score !== null && score !== undefined;
  const flashBg = isFlash ? 'rgba(45,106,79,0.35)' : 'transparent';
  const wrapper = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: size, height: size, fontWeight: 800, fontSize: Math.floor(size * 0.5),
    background: flashBg, borderRadius: 4, transition: 'background 0.6s ease',
  };
  if (!hasScore) {
    return (
      <span style={{ ...wrapper, color: isCurrent ? 'var(--accent)' : 'var(--blue)', opacity: 0.45 }}>
        {isCurrent ? '•' : '–'}
      </span>
    );
  }
  const diff = Number(score) - Number(par || 0);
  const RED = '#c81f1f';
  const BLUE = '#1e3a8a';
  const outer = Math.floor(size * 0.92);
  const inner = Math.floor(size * 0.66);
  const BLACK = 'var(--text)';

  if (diff === 0) {
    return <span style={{ ...wrapper, color: BLACK, fontWeight: 700 }}>{score}</span>;
  }
  if (diff === -1) {
    // Birdie — open circle, black number
    return (
      <span style={wrapper}>
        <span style={{
          width: outer, height: outer, borderRadius: '50%',
          border: `2px solid ${RED}`, color: BLACK, background: 'transparent',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>{score}</span>
      </span>
    );
  }
  if (diff === -2) {
    // Eagle — two concentric circles, black number
    return (
      <span style={wrapper}>
        <span style={{
          width: outer, height: outer, borderRadius: '50%',
          border: `1.5px solid ${RED}`,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: BLACK, background: 'transparent',
        }}>
          <span style={{
            width: inner, height: inner, borderRadius: '50%',
            border: `1.5px solid ${RED}`, background: 'transparent',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: Math.floor(size * 0.4),
          }}>{score}</span>
        </span>
      </span>
    );
  }
  if (diff <= -3) {
    // Albatross or better — solid circle with outer frame
    return (
      <span style={wrapper}>
        <span style={{
          width: outer, height: outer, borderRadius: '50%',
          background: RED, color: 'white',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 0 0 2px white, 0 0 0 3.5px ${RED}`,
        }}>{score}</span>
      </span>
    );
  }
  if (diff === 1) {
    // Bogey — open square, black number
    return (
      <span style={wrapper}>
        <span style={{
          width: outer, height: outer,
          border: `2px solid ${BLUE}`, color: BLACK, background: 'transparent',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>{score}</span>
      </span>
    );
  }
  if (diff === 2) {
    // Double bogey — two concentric squares, black number
    return (
      <span style={wrapper}>
        <span style={{
          width: outer, height: outer,
          border: `1.5px solid ${BLUE}`,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: BLACK, background: 'transparent',
        }}>
          <span style={{
            width: inner, height: inner,
            border: `1.5px solid ${BLUE}`, background: 'transparent',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: Math.floor(size * 0.4),
          }}>{score}</span>
        </span>
      </span>
    );
  }
  // Triple bogey or worse — solid square with outer frame, white number (unchanged)
  return (
    <span style={wrapper}>
      <span style={{
        width: outer, height: outer,
        background: BLUE, color: 'white',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 0 0 2px white, 0 0 0 3.5px ${BLUE}`,
      }}>{score}</span>
    </span>
  );
}

function getScoreLabel(diff) {
  if (diff === null || diff === undefined) return '';
  if (diff <= -3) return 'Albatross';
  if (diff === -2) return 'Eagle';
  if (diff === -1) return 'Birdie';
  if (diff === 0) return 'Par';
  if (diff === 1) return 'Bogey';
  if (diff === 2) return 'Double Bogey';
  if (diff === 3) return 'Triple Bogey';
  return `+${diff}`;
}

function formatTimeSince(ms) {
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[660, 0], [880, 0.18]].forEach(([freq, when]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.08, ctx.currentTime + when);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + 0.4);
      osc.start(ctx.currentTime + when);
      osc.stop(ctx.currentTime + when + 0.4);
    });
  } catch (e) {}
}

// ─── Strokes Gained: Putting baseline (PGA Tour expected putts by feet) ──────
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

function calcLiveStats(holes) {
  const completed = holes.filter(h => h.score !== '' && h.score !== null && h.score !== undefined);
  if (completed.length === 0) return null;

  const totalScore = completed.reduce((s, h) => s + Number(h.score), 0);
  const totalPar = completed.reduce((s, h) => s + Number(h.par), 0);
  const scoreDiff = totalScore - totalPar;

  const fwHoles = completed.filter(h => Number(h.par) !== 3 && h.fairwayHit !== null && h.fairwayHit !== undefined);
  const fwPct = fwHoles.length > 0
    ? Math.round((fwHoles.filter(h => h.fairwayHit === true).length / fwHoles.length) * 100) : null;

  const girHoles = completed.filter(h => h.gir !== null && h.gir !== undefined);
  const girPct = girHoles.length > 0
    ? Math.round((girHoles.filter(h => h.gir === true).length / girHoles.length) * 100) : null;

  const puttHoles = completed.filter(h => h.putts !== '' && h.putts !== null && h.putts !== undefined);
  const totalPutts = puttHoles.reduce((s, h) => s + Number(h.putts), 0);
  const puttsAvg = puttHoles.length > 0 ? (totalPutts / puttHoles.length).toFixed(1) : null;

  // Strokes Gained: Putting (vs PGA Tour baseline) ─ needs first putt distance + putts
  const sgHoles = completed.filter(h =>
    h.firstPuttLength !== '' && h.firstPuttLength !== null && h.firstPuttLength !== undefined &&
    h.putts !== '' && h.putts !== null && h.putts !== undefined
  );
  let sgPutting = null;
  let sgT2G = null;
  if (sgHoles.length) {
    const total = sgHoles.reduce(
      (s, h) => s + (expectedPutts(Number(h.firstPuttLength)) - Number(h.putts)), 0
    );
    sgPutting = parseFloat(total.toFixed(2));
    // SG Tee-to-Green = (par - score) - SG putting, summed across the same holes
    const sgT2GTotal = sgHoles.reduce((s, h) => {
      const sgTotal = Number(h.par) - Number(h.score);
      const sgP = expectedPutts(Number(h.firstPuttLength)) - Number(h.putts);
      return s + (sgTotal - sgP);
    }, 0);
    sgT2G = parseFloat(sgT2GTotal.toFixed(2));
  }

  let eagles = 0, birdies = 0, pars = 0, bogeys = 0, doubles = 0, triples = 0, worse = 0;
  completed.forEach(h => {
    const d = Number(h.score) - Number(h.par);
    if (d <= -2) eagles++;
    else if (d === -1) birdies++;
    else if (d === 0) pars++;
    else if (d === 1) bogeys++;
    else if (d === 2) doubles++;
    else if (d === 3) triples++;
    else worse++;
  });

  let bestHole = null, worstHole = null;
  completed.forEach(h => {
    const d = Number(h.score) - Number(h.par);
    if (bestHole === null || d < bestHole.diff) bestHole = { ...h, diff: d };
    if (worstHole === null || d > worstHole.diff) worstHole = { ...h, diff: d };
  });

  // Current streak
  let streakType = null, streakCount = 0;
  for (let i = completed.length - 1; i >= 0; i--) {
    const d = Number(completed[i].score) - Number(completed[i].par);
    const t = d < 0 ? 'under' : d === 0 ? 'par' : 'over';
    if (streakType === null) { streakType = t; streakCount = 1; }
    else if (t === streakType) streakCount++;
    else break;
  }

  return {
    totalScore, totalPar, scoreDiff, holesPlayed: completed.length,
    fwPct, girPct, puttsAvg, totalPutts, sgPutting, sgT2G,
    eagles, birdies, pars, bogeys, doubles, triples, worse,
    bestHole, worstHole, streak: { type: streakType, count: streakCount },
  };
}

// ─── Table styles ─────────────────────────────────────────────────────────────

const thStyle = {
  padding: '7px 3px',
  fontSize: 11,
  color: 'var(--blue)',
  fontWeight: 700,
  textAlign: 'center',
  borderBottom: '1px solid var(--border)',
  minWidth: 24,
};

const tdStyle = {
  padding: '7px 3px',
  fontSize: 12,
  textAlign: 'center',
  borderBottom: '1px solid var(--border)',
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function LiveViewer({ liveId }) {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [notFound, setNotFound] = React.useState(false);
  const [lastUpdateMs, setLastUpdateMs] = React.useState(null);
  const [timeSince, setTimeSince] = React.useState('');
  const [soundEnabled, setSoundEnabled] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [flashHole, setFlashHole] = React.useState(null);
  const prevHolesRef = React.useRef(null);
  const soundEnabledRef = React.useRef(false);
  // Debounce notification toasts so rapid score edits don't fire multiple alerts
  const pendingToastRef = React.useRef(null);
  const toastDebounceRef = React.useRef(null);

  // Keep ref in sync so the Firebase callback can read it
  React.useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);

  // Update "X ago" every second
  React.useEffect(() => {
    if (!lastUpdateMs) return;
    setTimeSince(formatTimeSince(lastUpdateMs));
    const interval = setInterval(() => setTimeSince(formatTimeSince(lastUpdateMs)), 1000);
    return () => clearInterval(interval);
  }, [lastUpdateMs]);

  // Firebase real-time listener
  React.useEffect(() => {
    if (!db || !liveId) { setNotFound(true); setLoading(false); return; }

    const unsub = onSnapshot(
      doc(db, 'live_rounds', liveId.toUpperCase()),
      (snap) => {
        if (!snap.exists()) { setNotFound(true); setLoading(false); return; }

        const d = snap.data();
        console.log('Live round updated:', d);

        // Apply score data immediately (fast display)
        setData(d);
        setLoading(false);
        setLastUpdateMs(d.lastUpdate || Date.now());

        // Detect newly completed holes for toasts — debounced 3s
        // so rapid edits don't fire multiple notifications
        if (prevHolesRef.current) {
          const newlyCompleted = [];
          d.holes.forEach((hole, i) => {
            const prev = prevHolesRef.current[i];
            const wasEmpty = !prev || prev.score === '' || prev.score === null || prev.score === undefined;
            const nowFilled = hole.score !== '' && hole.score !== null && hole.score !== undefined;
            if (wasEmpty && nowFilled) newlyCompleted.push(hole);
          });

          if (newlyCompleted.length > 0) {
            // Store the latest notification candidate
            pendingToastRef.current = newlyCompleted[newlyCompleted.length - 1];
            // Reset 3s debounce — only fire toast after score stabilises
            if (toastDebounceRef.current) clearTimeout(toastDebounceRef.current);
            toastDebounceRef.current = setTimeout(() => {
              const hole = pendingToastRef.current;
              if (!hole) return;
              const diff = Number(hole.score) - Number(hole.par);
              const msg = `${getScoreLabel(diff)} on Hole ${hole.number}`;
              setToast(msg);
              setFlashHole(hole.number);
              setTimeout(() => setToast(null), 4000);
              setTimeout(() => setFlashHole(null), 1500);
              if (soundEnabledRef.current) playNotificationSound();
              pendingToastRef.current = null;
            }, 3000);
          }
        }
        prevHolesRef.current = d.holes;
      },
      (err) => {
        console.error('LiveViewer error:', err);
        setNotFound(true);
        setLoading(false);
      }
    );

    return () => { unsub(); if (toastDebounceRef.current) clearTimeout(toastDebounceRef.current); };
  }, [liveId]);

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={centerStyle}>
        <div style={{ color: 'var(--blue)', fontSize: 16, fontWeight: 700, letterSpacing: 2 }}>CONNECTING…</div>
        <div style={{ color: 'var(--text)', fontSize: 16, marginTop: 16, fontWeight: 700 }}>Connecting to live round</div>
        <div style={{ color: 'var(--blue)', fontSize: 13, marginTop: 6, fontFamily: 'monospace' }}>{liveId}</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div style={centerStyle}>
        <div style={{ color: 'var(--text)', fontSize: 20, fontWeight: 700, marginTop: 12 }}>Round not found</div>
        <div style={{ color: 'var(--blue)', textAlign: 'center', marginTop: 8 }}>
          No active round found with code <strong style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>{liveId}</strong>
        </div>
        <button
          onClick={() => { window.location.hash = ''; }}
          style={backBtnStyle}
        >
          ← Back to GolfTrack
        </button>
      </div>
    );
  }

  // ── Data ready ───────────────────────────────────────────────────────────────

  const stats = calcLiveStats(data.holes);
  const isExpired = data.lastUpdate && (Date.now() - data.lastUpdate) > 24 * 60 * 60 * 1000;
  const completedHoles = data.holes.filter(h => h.score !== '' && h.score !== null && h.score !== undefined);
  // Use server-supplied currentHole (computed sequentially), falling back to first empty hole
  const currentHoleObj = data.currentHole
    ? data.holes.find(h => h.number === data.currentHole && (h.score === '' || h.score === null || h.score === undefined))
    : null
    || data.holes.find(h => h.score === '' || h.score === null || h.score === undefined);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', maxWidth: 600, margin: '0 auto', paddingBottom: 40 }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--blue)', color: 'var(--card)',
          padding: '12px 24px', borderRadius: 24, fontWeight: 700, fontSize: 15,
          zIndex: 999, boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          animation: 'liveToastIn 0.3s ease',
          whiteSpace: 'nowrap',
        }}>
          {toast}
        </div>
      )}

      {/* Sticky Header */}
      <div style={{
        background: 'var(--surface)', padding: '16px 16px 12px',
        borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1.2 }}>
              {data.playerName}
            </div>
            <div style={{ fontSize: 13, color: 'var(--blue)', marginTop: 3 }}>
              {data.courseName} · {data.tee}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
            {data.isComplete ? (
              <span style={badgeStyle('#2d6a4f')}>Complete</span>
            ) : isExpired ? (
              <span style={badgeStyle('#a61b1b')}>Ended</span>
            ) : (
              <span className="live-badge">● LIVE</span>
            )}
            <span style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 700, letterSpacing: 0.5 }}>
              {data.roundType === 'competition' ? 'Competition' : 'Practice'}
            </span>
          </div>
        </div>
        {!data.isComplete && !isExpired && timeSince && (
          <div style={{ fontSize: 11, color: 'var(--blue)', marginTop: 6 }}>
            Updated {timeSince}
          </div>
        )}
      </div>

      <div style={{ padding: '0 16px' }}>

        {/* Complete Banner */}
        {data.isComplete && stats && (
          <div style={{
            background: 'rgba(45,106,79,0.12)', border: '1px solid var(--accent)',
            borderRadius: 12, padding: '16px', textAlign: 'center', margin: '16px 0 0',
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)' }}>Round Complete</div>
            <div style={{ fontSize: 16, color: 'var(--text)', marginTop: 4 }}>
              {stats.totalScore} strokes · {stats.scoreDiff === 0 ? 'E' : (stats.scoreDiff > 0 ? '+' : '') + stats.scoreDiff}
            </div>
          </div>
        )}

        {/* Current Status Card */}
        {stats ? (
          <div className="card" style={{ marginTop: 16, padding: '20px 16px', textAlign: 'center' }}>
            <div style={{
              fontSize: 60, fontWeight: 900, lineHeight: 1,
              color: stats.scoreDiff < 0 ? SCORE_COLORS.birdie : stats.scoreDiff > 0 ? SCORE_COLORS.double : SCORE_COLORS.par,
            }}>
              {stats.scoreDiff === 0 ? 'E' : (stats.scoreDiff > 0 ? '+' : '') + stats.scoreDiff}
            </div>
            <div style={{ fontSize: 14, color: 'var(--blue)', marginTop: 4 }}>
              {stats.totalScore} strokes
            </div>
            {!data.isComplete && currentHoleObj && (
              <div style={{
                marginTop: 12, padding: '7px 16px',
                background: 'rgba(45,106,79,0.1)',
                border: '1px solid rgba(45,106,79,0.3)',
                borderRadius: 20, display: 'inline-block',
                fontSize: 14, fontWeight: 700, color: 'var(--accent)',
                animation: 'subtlePulse 2s infinite',
              }}>
                Playing Hole {currentHoleObj.number}
              </div>
            )}
            <div style={{ fontSize: 13, color: 'var(--blue)', marginTop: 8 }}>
              Thru {stats.holesPlayed} hole{stats.holesPlayed !== 1 ? 's' : ''}
            </div>
          </div>
        ) : (
          <div className="card" style={{ marginTop: 16, padding: '24px 16px', textAlign: 'center', color: 'var(--blue)' }}>
            Waiting for first score…
          </div>
        )}

        {/* Live Stats Row */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
            {[
              { label: 'Fairways', value: stats.fwPct !== null ? stats.fwPct + '%' : '—' },
              { label: 'GIR', value: stats.girPct !== null ? stats.girPct + '%' : '—' },
              { label: 'Putts/Hole', value: stats.puttsAvg !== null ? stats.puttsAvg : '—' },
            ].map(s => (
              <div key={s.label} className="card" style={{ textAlign: 'center', padding: '10px 4px' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>{s.value}</div>
                <div style={{ fontSize: 10, color: 'var(--blue)', marginTop: 2, fontWeight: 600 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Strokes Gained Row */}
        {stats && (stats.sgPutting !== null || stats.sgT2G !== null) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 8 }}>
            {[
              { label: 'SG Putting', value: stats.sgPutting },
              { label: 'SG Tee-to-Green', value: stats.sgT2G },
            ].map(s => {
              const display = s.value === null
                ? '—'
                : (s.value > 0 ? '+' : '') + s.value.toFixed(2);
              const color = s.value === null
                ? 'var(--blue)'
                : s.value > 0 ? '#991b1b'
                : s.value < 0 ? '#1e3a5f'
                : 'var(--text)';
              return (
                <div key={s.label} className="card" style={{ textAlign: 'center', padding: '10px 4px' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color }}>{display}</div>
                  <div style={{ fontSize: 10, color: 'var(--blue)', marginTop: 2, fontWeight: 600 }}>{s.label}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Combined scorecard — player + opponents in one view */}
        <LiveScoreboard data={data} flashHole={flashHole} />

        {/* Score breakdown — horizontal bars to match the round-analysis style */}
        {stats && (() => {
          const items = [
            { label: 'Eagle / Better', count: stats.eagles, color: SCORE_COLORS.eagle },
            { label: 'Birdie', count: stats.birdies, color: SCORE_COLORS.birdie },
            { label: 'Par', count: stats.pars, color: SCORE_COLORS.par },
            { label: 'Bogey', count: stats.bogeys, color: SCORE_COLORS.bogey },
            { label: 'Double', count: stats.doubles, color: SCORE_COLORS.double },
            { label: 'Triple+', count: stats.triples + stats.worse, color: SCORE_COLORS.worse },
          ];
          const max = Math.max(...items.map(i => i.count), 1);
          if (items.every(i => i.count === 0)) return null;
          return (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-title">Score Breakdown</div>
              {items.map((it, i) => (
                <div key={i} className="breakdown-row">
                  <span className="breakdown-label">{it.label}</span>
                  <div className="breakdown-bar-wrap">
                    <div className="breakdown-bar" style={{ width: ((it.count / max) * 100) + '%', background: it.color }} />
                  </div>
                  <span className="breakdown-count">{it.count}</span>
                </div>
              ))}
            </div>
          );
        })()}


        {/* Highlights */}
        {stats && (stats.bestHole || stats.streak.count > 1) && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15, marginBottom: 10 }}>Highlights</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {stats.bestHole && (
                <HighlightCard label="BEST HOLE" holeNum={stats.bestHole.number} diff={stats.bestHole.diff} score={stats.bestHole.score} />
              )}
              {stats.worstHole && stats.worstHole.number !== stats.bestHole?.number && stats.worstHole.diff > 0 && (
                <HighlightCard label="WORST HOLE" holeNum={stats.worstHole.number} diff={stats.worstHole.diff} score={stats.worstHole.score} />
              )}
              {stats.streak.count > 1 && (
                <div className="card" style={{ padding: '10px 14px', flex: 1, minWidth: 110 }}>
                  <div style={{ fontSize: 11, color: 'var(--blue)', marginBottom: 4, fontWeight: 700, letterSpacing: 0.5 }}>STREAK</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{stats.streak.count} in a row</div>
                  <div style={{ fontSize: 12, color: 'var(--blue)' }}>
                    {stats.streak.type === 'under' ? 'Under par' : stats.streak.type === 'par' ? 'Pars' : 'Over par'}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Hole by Hole Feed */}
        {completedHoles.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>Hole by Hole</div>
              <button
                onClick={() => setSoundEnabled(s => !s)}
                style={{
                  background: soundEnabled ? 'rgba(45,106,79,0.15)' : 'none',
                  border: `1px solid ${soundEnabled ? 'var(--accent)' : 'var(--blue)'}`,
                  borderRadius: 20, padding: '4px 12px',
                  color: soundEnabled ? 'var(--accent)' : 'var(--blue)',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.5,
                }}
              >
                {soundEnabled ? 'ALERTS ON' : 'ALERTS OFF'}
              </button>
            </div>

            {/* Current hole in progress */}
            {!data.isComplete && currentHoleObj && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 10,
                background: 'rgba(45,106,79,0.08)',
                border: '1px solid rgba(45,106,79,0.3)',
                marginBottom: 6,
                animation: 'subtlePulse 2s infinite',
              }}>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 14 }}>
                    Hole {currentHoleObj.number} — In Progress
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--blue)' }}>
                    Par {currentHoleObj.par}{currentHoleObj.yards ? ' · ' + currentHoleObj.yards + 'y' : ''}
                  </div>
                </div>
              </div>
            )}

            {/* Completed holes newest-first */}
            {[...completedHoles].reverse().map(hole => {
              const diff = Number(hole.score) - Number(hole.par);
              const details = [
                hole.gir ? 'GIR' : null,
                hole.putts !== '' && hole.putts !== null && hole.putts !== undefined
                  ? hole.putts + ' putt' + (Number(hole.putts) !== 1 ? 's' : '') : null,
                hole.firstPuttLength !== '' && hole.firstPuttLength !== null && hole.firstPuttLength !== undefined
                  ? '1st putt ' + hole.firstPuttLength + 'ft' : null,
                hole.fairwayHit === true ? 'FW Hit' : Number(hole.par) !== 3 && hole.fairwayHit === false ? 'FW Missed' : null,
              ].filter(Boolean).join(' · ');

              return (
                <div key={hole.number} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', borderRadius: 10,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  marginBottom: 6,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: getScoreColor(diff), fontSize: 14 }}>
                      Hole {hole.number} — {getScoreLabel(diff)} ({hole.score})
                    </div>
                    {details && <div style={{ fontSize: 11, color: 'var(--blue)' }}>{details}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Back button */}
        <button
          onClick={() => { window.location.hash = ''; }}
          style={{ ...backBtnStyle, display: 'block', width: '100%', marginTop: 24 }}
        >
          ← Back to GolfTrack
        </button>

      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LiveScoreboard({ data, flashHole }) {
  const [expanded, setExpanded] = React.useState(true);
  const holes = data.holes;
  const opponents = data.opponents || [];
  const playerName = data.playerName;
  const hasOpponents = opponents.length > 0;

  // Build a unified leaderboard row per competitor (player + opponents)
  const buildRow = (name, scores) => {
    const validScores = scores
      .map((s, i) => ({ s, par: holes[i]?.par }))
      .filter(x => x.s !== '' && x.s !== null && x.s !== undefined);
    const totalScore = validScores.reduce((sum, x) => sum + Number(x.s), 0);
    const totalPar = validScores.reduce((sum, x) => sum + Number(x.par || 0), 0);
    const played = validScores.length;
    const diff = played > 0 ? totalScore - totalPar : null;
    return { name, totalScore, diff, played, scores };
  };

  const playerRow = buildRow(playerName || 'You', holes.map(h => h.score));
  const oppRows = opponents.map(o => buildRow(o.name || 'Opponent', o.scores || []));

  // Sort standings by score-to-par (lowest first), unplayed last
  const standingsRows = [{ ...playerRow, isPlayer: true }, ...oppRows.map(r => ({ ...r, isPlayer: false }))]
    .sort((a, b) => {
      if (a.played === 0 && b.played === 0) return 0;
      if (a.played === 0) return 1;
      if (b.played === 0) return -1;
      return (a.diff ?? 0) - (b.diff ?? 0);
    });

  // Rows for the per-hole scorecard (fixed order: player first, then opponents in input order)
  const cardRows = [{ name: playerName || 'You', scores: holes.map(h => h.score), isPlayer: true }]
    .concat(opponents.map(o => ({ name: o.name || 'Opponent', scores: o.scores || [], isPlayer: false })));

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>
          Scorecard
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            background: 'transparent',
            border: '1px solid var(--blue)',
            color: 'var(--blue)',
            borderRadius: 16, padding: '4px 12px',
            fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
            cursor: 'pointer',
          }}
        >
          {expanded ? 'MINIMIZE ▴' : 'EXPAND ▾'}
        </button>
      </div>

      {/* Standings — only when there are opponents to compare against */}
      {hasOpponents && (
        <div style={{ overflow: 'hidden', borderRadius: 10, border: '1px solid var(--border)', marginBottom: expanded ? 12 : 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface)' }}>
                <th style={{ ...thStyle, textAlign: 'left', paddingLeft: 10, width: 32 }}>#</th>
                <th style={{ ...thStyle, textAlign: 'left' }}>Player</th>
                <th style={thStyle}>Thru</th>
                <th style={thStyle}>To Par</th>
                <th style={thStyle}>Total</th>
              </tr>
            </thead>
            <tbody>
              {standingsRows.map((row, i) => {
                const diffColor = row.diff === null ? 'var(--blue)'
                  : row.diff < 0 ? '#991b1b'
                  : row.diff > 0 ? '#1e3a5f'
                  : '#2d6a4f';
                return (
                  <tr key={i} style={{
                    background: row.isPlayer ? 'rgba(45,106,79,0.08)' : 'transparent',
                    borderBottom: '1px solid var(--border)',
                  }}>
                    <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 10, fontWeight: 800, color: 'var(--blue)' }}>
                      {i + 1}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 700, color: 'var(--text)' }}>
                      {row.name}{row.isPlayer && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--accent)', fontWeight: 700, letterSpacing: 0.5 }}>YOU</span>}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--blue)', fontWeight: 700 }}>
                      {row.played > 0 ? row.played : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: diffColor, fontWeight: 800 }}>
                      {row.diff === null ? '—' : row.diff === 0 ? 'E' : (row.diff > 0 ? '+' : '') + row.diff}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--text)', fontWeight: 800 }}>
                      {row.played > 0 ? row.totalScore : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-hole side-by-side scorecard, split 1-9 / 10-18 like a real scorecard */}
      {expanded && (
        <>
          <LiveNineTable
            rows={cardRows}
            holes={holes}
            sliceStart={0}
            totalLabel="OUT"
            showGrandTotal={false}
            currentHole={data.currentHole}
            isComplete={data.isComplete}
            flashHole={flashHole}
          />
          {holes.length > 9 && (
            <LiveNineTable
              rows={cardRows}
              holes={holes}
              sliceStart={9}
              totalLabel="IN"
              showGrandTotal={true}
              currentHole={data.currentHole}
              isComplete={data.isComplete}
              flashHole={flashHole}
            />
          )}
        </>
      )}
    </div>
  );
}

function LiveNineTable({ rows, holes, sliceStart, totalLabel, showGrandTotal, currentHole, isComplete, flashHole }) {
  const nineHoles = holes.slice(sliceStart, sliceStart + 9);
  const sumPar = (slice) => slice.reduce((s, h) => s + Number(h.par || 0), 0);
  const sumYds = (slice) => slice.reduce((s, h) => s + Number(h.yards || 0), 0);
  const hasYards = holes.some(h => h.yards);
  const sumScores = (scores, slice, offset) => {
    let total = 0, played = 0;
    for (let i = 0; i < slice.length; i++) {
      const v = scores[i + offset];
      if (v !== '' && v !== null && v !== undefined) {
        total += Number(v);
        played += 1;
      }
    }
    return { total, played };
  };
  const sumAll = (scores) => {
    let total = 0, played = 0;
    for (let i = 0; i < holes.length; i++) {
      const v = scores[i];
      if (v !== '' && v !== null && v !== undefined) {
        total += Number(v);
        played += 1;
      }
    }
    return { total, played };
  };
  const ninePar = sumPar(nineHoles);
  const grandPar = showGrandTotal ? sumPar(holes) : null;
  const nineYds = sumYds(nineHoles);
  const grandYds = showGrandTotal ? sumYds(holes) : null;

  return (
    <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)', marginBottom: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'var(--surface)' }}>
            <th style={{ ...thStyle, textAlign: 'left', paddingLeft: 8, position: 'sticky', left: 0, background: 'var(--surface)', minWidth: 90 }}>
              Hole
            </th>
            {nineHoles.map(h => (
              <th key={h.number} style={{
                ...thStyle,
                color: h.number === currentHole && !isComplete ? 'var(--accent)' : 'var(--blue)',
              }}>{h.number}</th>
            ))}
            <th style={{ ...thStyle, color: 'var(--blue)', fontWeight: 800 }}>{totalLabel}</th>
            {showGrandTotal && <th style={{ ...thStyle, color: 'var(--blue)', fontWeight: 800 }}>TOT</th>}
          </tr>
          {hasYards && (
            <tr style={{ background: 'var(--card2)' }}>
              <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 8, color: 'var(--blue)', fontWeight: 600, fontSize: 11, position: 'sticky', left: 0, background: 'var(--card2)' }}>
                Yards
              </td>
              {nineHoles.map(h => (
                <td key={h.number} style={{ ...tdStyle, color: 'var(--blue)', fontSize: 11 }}>{h.yards || '—'}</td>
              ))}
              <td style={{ ...tdStyle, color: 'var(--blue)', fontWeight: 700, fontSize: 11 }}>{nineYds || '—'}</td>
              {showGrandTotal && <td style={{ ...tdStyle, color: 'var(--blue)', fontWeight: 700, fontSize: 11 }}>{grandYds || '—'}</td>}
            </tr>
          )}
          <tr style={{ background: 'var(--card2)' }}>
            <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 8, color: 'var(--blue)', fontWeight: 600, fontSize: 11, position: 'sticky', left: 0, background: 'var(--card2)' }}>
              Par
            </td>
            {nineHoles.map(h => (
              <td key={h.number} style={{ ...tdStyle, color: 'var(--blue)' }}>{h.par}</td>
            ))}
            <td style={{ ...tdStyle, color: 'var(--blue)', fontWeight: 800 }}>{ninePar}</td>
            {showGrandTotal && <td style={{ ...tdStyle, color: 'var(--blue)', fontWeight: 800 }}>{grandPar}</td>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const nine = sumScores(row.scores, nineHoles, sliceStart);
            const grand = showGrandTotal ? sumAll(row.scores) : null;
            return (
              <tr key={ri} style={{ background: row.isPlayer ? 'rgba(45,106,79,0.06)' : 'transparent' }}>
                <td style={{
                  ...tdStyle, textAlign: 'left', paddingLeft: 8, fontWeight: 700,
                  color: 'var(--text)', position: 'sticky', left: 0,
                  background: row.isPlayer ? 'rgba(216,220,206,0.95)' : 'var(--card)',
                  minWidth: 90, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {row.name}
                </td>
                {nineHoles.map((h, i) => {
                  const v = row.scores[i + sliceStart];
                  const isCurrent = row.isPlayer && h.number === currentHole && !isComplete;
                  const isFlash = row.isPlayer && h.number === flashHole;
                  return (
                    <td key={h.number} style={{ ...tdStyle, padding: '4px 2px' }}>
                      <ScoreBadge score={v} par={h.par} isCurrent={isCurrent} isFlash={isFlash} />
                    </td>
                  );
                })}
                <td style={{ ...tdStyle, color: 'var(--accent)', fontWeight: 800 }}>
                  {nine.played > 0 ? nine.total : '—'}
                </td>
                {showGrandTotal && (
                  <td style={{ ...tdStyle, color: 'var(--accent)', fontWeight: 800 }}>
                    {grand.played > 0 ? grand.total : '—'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


function HighlightCard({ label, holeNum, diff, score }) {
  return (
    <div className="card" style={{ padding: '10px 14px', flex: 1, minWidth: 110 }}>
      <div style={{ fontSize: 11, color: 'var(--blue)', marginBottom: 4, fontWeight: 700, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: getScoreColor(diff) }}>Hole {holeNum}</div>
      <div style={{ fontSize: 12, color: 'var(--blue)' }}>{getScoreLabel(diff)} ({score})</div>
    </div>
  );
}


// ─── Shared styles ────────────────────────────────────────────────────────────

const centerStyle = {
  minHeight: '100vh', background: 'var(--bg)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexDirection: 'column', gap: 12, padding: 24, textAlign: 'center',
};

const backBtnStyle = {
  background: 'none',
  border: '1px solid var(--blue)',
  borderRadius: 10, padding: '12px 20px',
  color: 'var(--blue)', fontSize: 14, cursor: 'pointer',
  marginTop: 16, fontWeight: 700,
};

const badgeStyle = (color) => ({
  background: color + '22',
  color: color,
  border: `1px solid ${color}44`,
  borderRadius: 20, padding: '3px 10px',
  fontSize: 11, fontWeight: 700,
});
