import React from 'react';
import { db } from './firebase';
import { doc, onSnapshot } from 'firebase/firestore';

// ─── Score helpers ────────────────────────────────────────────────────────────

const SCORE_COLORS = {
  eagle: '#f4d03f',
  birdie: '#52c41a',
  par: '#e8e8e8',
  bogey: '#f39c12',
  double: '#ff4d4f',
  worse: '#8b0000',
};

function getScoreColor(diff) {
  if (diff === null || diff === undefined) return 'var(--text-muted)';
  if (diff <= -2) return SCORE_COLORS.eagle;
  if (diff === -1) return SCORE_COLORS.birdie;
  if (diff === 0) return SCORE_COLORS.par;
  if (diff === 1) return SCORE_COLORS.bogey;
  if (diff === 2) return SCORE_COLORS.double;
  return SCORE_COLORS.worse;
}

function getScoreLabel(diff) {
  if (diff === null || diff === undefined) return '';
  if (diff <= -2) return 'Eagle';
  if (diff === -1) return 'Birdie';
  if (diff === 0) return 'Par';
  if (diff === 1) return 'Bogey';
  if (diff === 2) return 'Double';
  return 'Triple+';
}

function getScoreEmoji(diff) {
  if (diff <= -2) return '🦅';
  if (diff === -1) return '🐦';
  if (diff === 0) return '✅';
  if (diff === 1) return '😬';
  return '😤';
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

  let eagles = 0, birdies = 0, pars = 0, bogeys = 0, doubles = 0, worse = 0;
  completed.forEach(h => {
    const d = Number(h.score) - Number(h.par);
    if (d <= -2) eagles++;
    else if (d === -1) birdies++;
    else if (d === 0) pars++;
    else if (d === 1) bogeys++;
    else if (d === 2) doubles++;
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
    fwPct, girPct, puttsAvg, totalPutts,
    eagles, birdies, pars, bogeys, doubles, worse,
    bestHole, worstHole, streak: { type: streakType, count: streakCount },
  };
}

// ─── Table styles ─────────────────────────────────────────────────────────────

const thStyle = {
  padding: '7px 3px',
  fontSize: 11,
  color: 'var(--text-muted)',
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

        // Detect newly completed holes for toasts
        if (prevHolesRef.current) {
          d.holes.forEach((hole, i) => {
            const prev = prevHolesRef.current[i];
            const wasEmpty = !prev || prev.score === '' || prev.score === null || prev.score === undefined;
            const nowFilled = hole.score !== '' && hole.score !== null && hole.score !== undefined;
            if (wasEmpty && nowFilled) {
              const diff = Number(hole.score) - Number(hole.par);
              const msg = `${getScoreEmoji(diff)} ${getScoreLabel(diff)} on Hole ${hole.number}!`;
              setToast(msg);
              setFlashHole(hole.number);
              setTimeout(() => setToast(null), 4000);
              setTimeout(() => setFlashHole(null), 1500);
              if (soundEnabledRef.current) playNotificationSound();
            }
          });
        }
        prevHolesRef.current = d.holes;

        setData(d);
        setLoading(false);
        setLastUpdateMs(d.lastUpdate || Date.now());
      },
      (err) => {
        console.error('LiveViewer error:', err);
        setNotFound(true);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [liveId]);

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={centerStyle}>
        <div style={{ fontSize: 48 }}>⛳</div>
        <div style={{ color: 'var(--text)', fontSize: 16, marginTop: 12 }}>Loading live round…</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div style={centerStyle}>
        <div style={{ fontSize: 48 }}>🔍</div>
        <div style={{ color: 'var(--text)', fontSize: 20, fontWeight: 700, marginTop: 12 }}>Round not found</div>
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
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
  const currentHoleObj = data.holes.find(h => h.score === '' || h.score === null || h.score === undefined);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', maxWidth: 600, margin: '0 auto', paddingBottom: 40 }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--accent)', color: '#fff',
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
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
              {data.courseName} · {data.tee}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
            {data.isComplete ? (
              <span style={badgeStyle('#52c41a')}>🏁 Complete</span>
            ) : isExpired ? (
              <span style={badgeStyle('#ff4d4f')}>Ended</span>
            ) : (
              <span className="live-badge">● LIVE</span>
            )}
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {data.roundType === 'competition' ? '🏆 Competition' : '⛳ Practice'}
            </span>
          </div>
        </div>
        {!data.isComplete && !isExpired && timeSince && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            Updated {timeSince}
          </div>
        )}
      </div>

      <div style={{ padding: '0 16px' }}>

        {/* Complete Banner */}
        {data.isComplete && stats && (
          <div style={{
            background: 'rgba(76,175,80,0.12)', border: '1px solid var(--accent)',
            borderRadius: 12, padding: '16px', textAlign: 'center', margin: '16px 0 0',
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)' }}>Round Complete 🏁</div>
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
            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 4 }}>
              {stats.totalScore} strokes
            </div>
            {!data.isComplete && currentHoleObj && (
              <div style={{
                marginTop: 12, padding: '7px 16px',
                background: 'rgba(76,175,80,0.1)',
                border: '1px solid rgba(76,175,80,0.3)',
                borderRadius: 20, display: 'inline-block',
                fontSize: 14, fontWeight: 700, color: 'var(--accent)',
                animation: 'subtlePulse 2s infinite',
              }}>
                ⛳ Playing Hole {currentHoleObj.number}
              </div>
            )}
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
              Thru {stats.holesPlayed} hole{stats.holesPlayed !== 1 ? 's' : ''}
            </div>
          </div>
        ) : (
          <div className="card" style={{ marginTop: 16, padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Waiting for first score…
          </div>
        )}

        {/* Live Stats Row */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 10 }}>
            {[
              { label: 'Fairways', value: stats.fwPct !== null ? stats.fwPct + '%' : '—' },
              { label: 'GIR', value: stats.girPct !== null ? stats.girPct + '%' : '—' },
              { label: 'Putts/Hole', value: stats.puttsAvg !== null ? stats.puttsAvg : '—' },
              { label: 'Birdies', value: stats.birdies },
            ].map(s => (
              <div key={s.label} className="card" style={{ textAlign: 'center', padding: '10px 4px' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>{s.value}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Score breakdown pills */}
        {stats && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {stats.eagles > 0 && <ScorePill emoji="🦅" count={stats.eagles} color={SCORE_COLORS.eagle} />}
            {stats.birdies > 0 && <ScorePill emoji="🐦" count={stats.birdies} color={SCORE_COLORS.birdie} />}
            {stats.pars > 0 && <ScorePill emoji="⛳" count={stats.pars} color={SCORE_COLORS.par} />}
            {stats.bogeys > 0 && <ScorePill emoji="😬" count={stats.bogeys} color={SCORE_COLORS.bogey} />}
            {stats.doubles > 0 && <ScorePill emoji="😤" count={stats.doubles} color={SCORE_COLORS.double} />}
            {stats.worse > 0 && <ScorePill emoji="💀" count={stats.worse} color={SCORE_COLORS.worse} />}
          </div>
        )}

        {/* Scorecard */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15, marginBottom: 10 }}>Scorecard</div>
          <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  <th style={{ ...thStyle, textAlign: 'left', paddingLeft: 8 }}>Hole</th>
                  {data.holes.map(h => (
                    <th key={h.number} style={{
                      ...thStyle,
                      color: h.number === data.currentHole && !data.isComplete ? 'var(--accent)' : 'var(--text-muted)',
                    }}>{h.number}</th>
                  ))}
                </tr>
                <tr style={{ background: 'var(--card)' }}>
                  <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 8, color: 'var(--text-muted)', fontWeight: 600, fontSize: 11 }}>Par</td>
                  {data.holes.map(h => (
                    <td key={h.number} style={{ ...tdStyle, color: 'var(--text-muted)' }}>{h.par}</td>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 8, fontWeight: 700 }}>Score</td>
                  {data.holes.map(h => {
                    const hasScore = h.score !== '' && h.score !== null && h.score !== undefined;
                    const diff = hasScore ? Number(h.score) - Number(h.par) : null;
                    const isCurrent = h.number === data.currentHole && !data.isComplete;
                    const isFlash = h.number === flashHole;
                    return (
                      <td key={h.number} style={{
                        ...tdStyle,
                        color: hasScore ? getScoreColor(diff) : isCurrent ? 'var(--accent)' : 'var(--text-muted)',
                        fontWeight: hasScore ? 700 : 400,
                        background: isFlash ? 'rgba(76,175,80,0.35)' : isCurrent ? 'rgba(76,175,80,0.1)' : 'transparent',
                        transition: 'background 0.6s ease',
                        opacity: !hasScore && !isCurrent ? 0.35 : 1,
                      }}>
                        {hasScore ? h.score : isCurrent ? '▸' : '–'}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

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
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>STREAK</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{stats.streak.count} in a row</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {stats.streak.type === 'under' ? '🔥 Under par' : stats.streak.type === 'par' ? 'Pars' : 'Over par'}
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
                  background: soundEnabled ? 'rgba(76,175,80,0.15)' : 'none',
                  border: `1px solid ${soundEnabled ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: 20, padding: '4px 12px',
                  color: soundEnabled ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {soundEnabled ? '🔔 Alerts On' : '🔕 Alerts Off'}
              </button>
            </div>

            {/* Current hole in progress */}
            {!data.isComplete && currentHoleObj && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 10,
                background: 'rgba(76,175,80,0.08)',
                border: '1px solid rgba(76,175,80,0.3)',
                marginBottom: 6,
                animation: 'subtlePulse 2s infinite',
              }}>
                <span style={{ fontSize: 18 }}>📍</span>
                <div>
                  <div style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 14 }}>
                    Hole {currentHoleObj.number} — In Progress
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
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
                hole.fairwayHit === true ? 'FW ✓' : Number(hole.par) !== 3 && hole.fairwayHit === false ? 'FW ✗' : null,
              ].filter(Boolean).join(' · ');

              return (
                <div key={hole.number} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', borderRadius: 10,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  marginBottom: 6,
                }}>
                  <span style={{ fontSize: 16 }}>{getScoreEmoji(diff)}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: getScoreColor(diff), fontSize: 14 }}>
                      Hole {hole.number} — {getScoreLabel(diff)} ({hole.score})
                    </div>
                    {details && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{details}</div>}
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

function ScorePill({ emoji, count, color }) {
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 20,
      background: color + '22',
      color: color, fontSize: 12, fontWeight: 700,
    }}>
      {emoji} {count}
    </span>
  );
}

function HighlightCard({ label, holeNum, diff, score }) {
  return (
    <div className="card" style={{ padding: '10px 14px', flex: 1, minWidth: 110 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: getScoreColor(diff) }}>Hole {holeNum}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{getScoreLabel(diff)} ({score})</div>
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
  border: '1px solid var(--border)',
  borderRadius: 10, padding: '12px 20px',
  color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer',
  marginTop: 16,
};

const badgeStyle = (color) => ({
  background: color + '22',
  color: color,
  border: `1px solid ${color}44`,
  borderRadius: 20, padding: '3px 10px',
  fontSize: 11, fontWeight: 700,
});
