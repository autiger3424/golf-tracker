import React from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { summarizeClub, staleDays } from './analytics/dispersionStats';
import { clubSortIndex, CLUB_CATEGORY } from './types/StandardShot';

// ── Constants ─────────────────────────────────────────────────────────
const STALE_DAYS = 60;       // gray out + footnote
const LOW_SAMPLE_THRESHOLD = 20;  // asterisk + footnote

// Group dividers reflect how a golfer mentally chunks the bag:
//   driver alone → fairways+hybrids → irons → wedges
function groupKey(club) {
  const cat = CLUB_CATEGORY[club];
  if (cat === 'driver') return 0;
  if (cat === 'fairway' || cat === 'hybrid') return 1;
  if (cat === 'iron') return 2;
  if (cat === 'wedge') return 3;
  return 4;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ── Share helpers ─────────────────────────────────────────────────────

// Build a plain-text table that aligns nicely in Notes / iMessage / email
// (monospace pastes leave column edges crisp).
function buildTextTable(rows, updatedDate) {
  const headers = ['Club', 'Carry', 'Range', 'Shape'];
  const data = rows.map(r => [
    r.club + (r.lowSample ? '*' : '') + (r.stale ? ' (stale)' : ''),
    r.avgCarry !== null ? `${r.avgCarry}y` : '—',
    (r.p10 !== null && r.p90 !== null) ? `${r.p10}-${r.p90}` : '—',
    r.shape || '—',
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...data.map(d => String(d[i]).length)));
  const pad = (s, w) => String(s).padEnd(w);
  const sep = widths.map(w => '-'.repeat(w)).join('  ');

  const lines = [];
  lines.push('TOURNAMENT CARD');
  lines.push(`Updated ${updatedDate}`);
  lines.push('');
  lines.push(headers.map((h, i) => pad(h, widths[i])).join('  '));
  lines.push(sep);
  for (const d of data) {
    lines.push(d.map((c, i) => pad(c, widths[i])).join('  '));
  }
  if (rows.some(r => r.lowSample)) lines.push('\n* limited data (<20 shots)');
  return lines.join('\n');
}

async function shareAsText(rows, updatedDate) {
  const text = buildTextTable(rows, updatedDate);
  // Prefer native share (mobile) — it lets the user pick the destination app.
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Tournament Card', text });
      return 'shared';
    } catch (e) {
      // user cancelled — fall through to clipboard
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  // Fallback: clipboard
  await navigator.clipboard.writeText(text);
  return 'copied';
}

async function shareAsImage(nodeRef) {
  if (!nodeRef.current) return 'no node';
  // html2canvas is heavy (~50KB gz) — only loaded when the user actually asks.
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(nodeRef.current, {
    backgroundColor: '#ffffff',
    scale: window.devicePixelRatio > 1 ? 2 : 1,
    logging: false,
  });
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { resolve('failed'); return; }
      const file = new File([blob], 'tournament-card.png', { type: 'image/png' });
      // Prefer native share with file payload (iOS Safari, Chrome Android)
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Tournament Card' });
          resolve('shared');
          return;
        } catch (e) {
          if (e.name === 'AbortError') { resolve('cancelled'); return; }
        }
      }
      // Desktop fallback: trigger a download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tournament-card.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      resolve('downloaded');
    }, 'image/png');
  });
}

// ── Render ────────────────────────────────────────────────────────────

function HeaderBack({ onBack }) {
  return (
    <button onClick={onBack}
      className="legacy-back-btn"
      style={{
        background: 'transparent', border: '1.5px solid #1a1a1a',
        color: '#1a1a1a', borderRadius: 14, padding: '6px 14px',
        fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
      }}>
      ← Back
    </button>
  );
}

function ShareButtons({ onCopy, onImage, statusMsg }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button onClick={onCopy}
        style={{
          background: '#1a1a1a', color: 'white', border: 'none',
          borderRadius: 14, padding: '8px 16px', fontWeight: 700, fontSize: '0.85rem',
          cursor: 'pointer',
        }}>
        📋 Share text
      </button>
      <button onClick={onImage}
        style={{
          background: 'white', color: '#1a1a1a', border: '1.5px solid #1a1a1a',
          borderRadius: 14, padding: '8px 16px', fontWeight: 700, fontSize: '0.85rem',
          cursor: 'pointer',
        }}>
        🖼️ Save as image
      </button>
      {statusMsg && <span style={{ fontSize: '0.78rem', color: '#1a4d2e', fontWeight: 600 }}>{statusMsg}</span>}
    </div>
  );
}

/**
 * TournamentCard — "parking-lot 20 minutes before tee time" reference view.
 * Stripped-down, high-contrast, light-themed, glanceable.
 *
 * @param {{ onBack: () => void }} props
 */
export default function TournamentCard({ onBack }) {
  const [shots, setShots] = React.useState(null); // null = loading
  const [statusMsg, setStatusMsg] = React.useState(null);
  const cardRef = React.useRef(null);

  // Own Firestore subscription — keeps this view self-contained so it can be
  // launched from anywhere in the app (Setup screen, Bag Summary, etc.)
  React.useEffect(() => {
    if (!db) { setShots([]); return; }
    return onSnapshot(collection(db, 'shots'), (snap) => {
      setShots(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  // Group shots by canonical club
  const shotsByClub = React.useMemo(() => {
    const map = new Map();
    if (!shots) return map;
    for (const s of shots) {
      if (!s.club) continue;
      if (!map.has(s.club)) map.set(s.club, []);
      map.get(s.club).push(s);
    }
    return map;
  }, [shots]);

  // Compute one row per club, sorted in standard bag order.
  const rows = React.useMemo(() => {
    const out = [];
    for (const [club, all] of shotsByClub.entries()) {
      const kept = all.filter(s => !s.excluded);
      const summary = summarizeClub(kept.length ? kept : all);
      if (!summary) continue;
      const days = staleDays(summary.lastUpdate);
      out.push({
        club,
        avgCarry: summary.avgCarry !== null ? Math.round(summary.avgCarry) : null,
        p10: summary.p10,
        p90: summary.p90,
        shape: summary.shape,
        sampleSize: summary.sampleSize,
        lastUpdate: summary.lastUpdate,
        staleDays: days,
        stale: days !== null && days > STALE_DAYS,
        lowSample: summary.sampleSize < LOW_SAMPLE_THRESHOLD,
      });
    }
    out.sort((a, b) => clubSortIndex(a.club) - clubSortIndex(b.club));
    return out;
  }, [shotsByClub]);

  // Header date = most-recent shot across the bag
  const mostRecent = rows
    .map(r => r.lastUpdate)
    .filter(Boolean)
    .sort()
    .at(-1);

  const hasStale = rows.some(r => r.stale);
  const hasLowSample = rows.some(r => r.lowSample);

  // Find Driver row (highlighted in footer)
  const driverRow = rows.find(r => r.club === 'Driver');

  const totalShots = rows.reduce((s, r) => s + r.sampleSize, 0);

  const handleShareText = async () => {
    setStatusMsg(null);
    try {
      const r = await shareAsText(rows, formatDate(mostRecent));
      setStatusMsg(r === 'copied' ? 'Copied to clipboard'
        : r === 'shared' ? 'Shared'
        : r === 'cancelled' ? null
        : null);
    } catch (e) {
      console.error('Share text failed:', e);
      setStatusMsg('Share failed');
    }
  };

  const handleShareImage = async () => {
    setStatusMsg('Rendering image…');
    try {
      const r = await shareAsImage(cardRef);
      setStatusMsg(r === 'shared' ? 'Shared'
        : r === 'downloaded' ? 'Saved tournament-card.png'
        : r === 'cancelled' ? null
        : null);
    } catch (e) {
      console.error('Share image failed:', e);
      setStatusMsg('Image export failed');
    }
  };

  // ── Light-themed wrapper, force-overrides app's themed surfaces ─────────
  const wrapStyle = {
    background: '#ffffff',
    color: '#1a1a1a',
    minHeight: 'calc(100vh - 110px)',
    padding: '16px',
    fontFeatureSettings: '"tnum" 1, "cv11", "ss01"',
    fontVariantNumeric: 'tabular-nums',
  };

  if (shots === null) {
    return (
      <div style={wrapStyle}>
        <HeaderBack onBack={onBack} />
        <p style={{ marginTop: 24, color: '#1a1a1a' }}>Loading…</p>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div style={wrapStyle}>
        <HeaderBack onBack={onBack} />
        <h1 style={{ marginTop: 16, fontSize: '1.6rem', color: '#1a1a1a' }}>Tournament Card</h1>
        <p style={{ marginTop: 12 }}>No club data imported yet. Go to the Club Data tab and import a TrackMan session first.</p>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <HeaderBack onBack={onBack} />
      </div>

      {/* The exported PNG captures everything inside cardRef */}
      <div ref={cardRef} style={{ background: '#ffffff', padding: '8px 0' }}>
        <h1 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#1a1a1a', letterSpacing: '-0.02em', marginBottom: 2 }}>
          Tournament Card
        </h1>
        <div style={{ fontSize: '0.92rem', color: '#444', marginBottom: 12 }}>
          Updated <strong style={{ color: '#1a1a1a' }}>{formatDate(mostRecent)}</strong>
        </div>

        {hasStale && (
          <div style={{
            background: '#fff4e0', border: '1.5px solid #b8742a', color: '#5e3a14',
            padding: '8px 12px', borderRadius: 6, marginBottom: 12,
            fontSize: '0.88rem', fontWeight: 600,
          }}>
            ⚠ Some clubs need updated data — see grayed rows
          </div>
        )}

        <Table rows={rows} />

        {/* Footer */}
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '2px solid #1a1a1a' }}>
          {driverRow && driverRow.avgCarry !== null && (
            <div style={{ fontSize: '1.05rem', marginBottom: 6 }}>
              <span style={{ color: '#444' }}>Total carry distance: </span>
              <strong style={{ fontSize: '1.4rem', color: '#1a1a1a' }}>{driverRow.avgCarry}y</strong>
            </div>
          )}
          <div style={{ fontSize: '0.78rem', color: '#555' }}>
            Based on {totalShots} shot{totalShots !== 1 ? 's' : ''} across {rows.length} club{rows.length !== 1 ? 's' : ''}
          </div>
          {hasLowSample && (
            <div style={{ fontSize: '0.78rem', color: '#555', marginTop: 4 }}>
              * limited data (&lt;{LOW_SAMPLE_THRESHOLD} shots)
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <ShareButtons onCopy={handleShareText} onImage={handleShareImage} statusMsg={statusMsg} />
      </div>
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────

function Table({ rows }) {
  return (
    <div style={{
      background: '#ffffff',
      border: '2px solid #1a1a1a',
      borderRadius: 6,
      overflow: 'hidden',
      fontFeatureSettings: '"tnum" 1, "cv11", "ss01"',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {/* Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(58px, 1fr) minmax(70px, 1.1fr) minmax(80px, 1.3fr) minmax(90px, 1.5fr)',
        gap: 0,
        background: '#1a1a1a', color: 'white',
        padding: '8px 12px', fontWeight: 700, fontSize: '0.78rem',
        letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>
        <div>Club</div>
        <div style={{ textAlign: 'right' }}>Avg carry</div>
        <div style={{ textAlign: 'right' }}>Range</div>
        <div style={{ textAlign: 'right' }}>Shape</div>
      </div>

      {/* Rows */}
      {rows.map((r, idx) => {
        const prevGroup = idx > 0 ? groupKey(rows[idx - 1].club) : null;
        const thisGroup = groupKey(r.club);
        const groupChange = prevGroup !== null && prevGroup !== thisGroup;
        const zebra = idx % 2 === 1;
        const baseBg = zebra ? '#f5f4ee' : '#ffffff';
        const bg = r.stale ? '#ececec' : baseBg;
        const fg = r.stale ? '#7a7a7a' : '#1a1a1a';

        return (
          <div key={r.club}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(58px, 1fr) minmax(70px, 1.1fr) minmax(80px, 1.3fr) minmax(90px, 1.5fr)',
              padding: '10px 12px',
              background: bg,
              color: fg,
              fontSize: '1.05rem',
              fontWeight: 600,
              borderTop: groupChange ? '2px solid #1a1a1a' : '1px solid rgba(0,0,0,0.08)',
              alignItems: 'baseline',
            }}>
            <div style={{ fontWeight: 700 }}>
              {r.club}
              {r.lowSample && <span style={{ color: '#b8742a', marginLeft: 2 }}>*</span>}
              {r.stale && (
                <span style={{
                  fontSize: '0.62rem', fontWeight: 700, color: '#666',
                  background: '#d4d4d4', padding: '1px 6px', borderRadius: 8,
                  marginLeft: 6, letterSpacing: '0.04em',
                  verticalAlign: 'middle',
                }}>STALE</span>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              {r.avgCarry !== null ? `${r.avgCarry}y` : '—'}
            </div>
            <div style={{ textAlign: 'right' }}>
              {(r.p10 !== null && r.p90 !== null) ? `${r.p10}–${r.p90}` : '—'}
            </div>
            <div style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.95rem' }}>
              {r.shape || '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
