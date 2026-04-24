import React from 'react';
import { db } from './firebase';
import { collection, doc, setDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { DRILLS, CATEGORIES, CATEGORY_COLORS, STANDARD_PLANS, ELITE_PLANS } from './drills';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function today() {
  return new Date();
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatDateShort(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatMMSS(secs) {
  const s = Math.max(0, Math.floor(secs));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// Wall-clock-based timer helper — immune to phone sleep / JS throttling
function getRemainingMs(t) {
  if (!t) return 0;
  if (t.paused) return t.adjustedMs;
  return Math.max(0, t.adjustedMs - (Date.now() - t.startTime));
}

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[440, 0], [330, 0.25]].forEach(([freq, when]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.12, ctx.currentTime + when);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + 0.8);
      osc.start(ctx.currentTime + when);
      osc.stop(ctx.currentTime + when + 0.8);
    });
  } catch (e) {
    // Audio not available
  }
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, n) {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function getWeekDates(referenceDate) {
  const d = new Date(referenceDate);
  const day = d.getDay(); // 0=Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    return dd;
  });
}

// ─── SortableScheduleItem ─────────────────────────────────────────────────────

function SortableScheduleItem({ id, drill, completed, onToggleComplete, onRemove, onStartTimer }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const color = CATEGORY_COLORS[drill.category] || '#4caf50';

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        background: 'var(--card)',
        borderRadius: 10,
        marginBottom: 6,
        border: completed ? '1px solid var(--accent)' : '1px solid var(--border)',
        opacity: completed ? 0.65 : 1,
      }}
    >
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        style={{ cursor: 'grab', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, userSelect: 'none', touchAction: 'none' }}
      >
        ⠿
      </span>

      {/* Color dot */}
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {drill.name}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{drill.duration} min</div>
      </div>

      {/* Timer button */}
      {onStartTimer && (
        <button
          onClick={() => onStartTimer(drill)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            cursor: 'pointer',
            fontSize: 16,
            padding: '4px 6px',
            borderRadius: 6,
            minWidth: 32,
            minHeight: 32,
          }}
          title="Start timer"
        >
          ▶
        </button>
      )}

      {/* Check button */}
      <button
        onClick={() => onToggleComplete(drill.id)}
        style={{
          background: 'none',
          border: `2px solid ${completed ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: '50%',
          width: 30,
          height: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: completed ? 'var(--accent)' : 'var(--text-muted)',
          flexShrink: 0,
          fontSize: 14,
        }}
      >
        {completed ? '✓' : ''}
      </button>

      {/* Remove button */}
      <button
        onClick={() => onRemove(drill.id)}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: 18,
          padding: '4px 6px',
          borderRadius: 6,
          lineHeight: 1,
          minWidth: 32,
          minHeight: 32,
        }}
      >
        ×
      </button>
    </div>
  );
}

// ─── DrillCard (library) ──────────────────────────────────────────────────────

function DrillCard({ drill, onEdit, onAdd, onDelete, onStartTimer, compact }) {
  const color = CATEGORY_COLORS[drill.category] || '#4caf50';
  const isCustom = drill.id.startsWith('custom_');

  if (compact) {
    return (
      <div
        className="card"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          marginBottom: 6,
          cursor: 'pointer',
        }}
        onClick={() => onAdd(drill)}
      >
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {drill.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{drill.duration} min · {drill.category}</div>
        </div>
        <span style={{ fontSize: 18, color: 'var(--accent)', fontWeight: 700 }}>+</span>
      </div>
    );
  }

  return (
    <div className="card" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 14px', marginBottom: 8 }}>
      {/* Left dot */}
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 4 }} />

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{drill.name}</span>
          {isCustom && (
            <span style={{
              fontSize: 11,
              background: 'rgba(255,215,0,0.15)',
              color: '#f4d03f',
              borderRadius: 6,
              padding: '1px 7px',
              border: '1px solid rgba(244,208,63,0.3)',
            }}>⭐ Custom</span>
          )}
          <span style={{
            fontSize: 11,
            background: 'rgba(76,175,80,0.15)',
            color: 'var(--accent)',
            borderRadius: 6,
            padding: '1px 7px',
            border: '1px solid rgba(76,175,80,0.3)',
          }}>{drill.duration} min</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>{drill.description}</div>
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
        <button
          onClick={() => onStartTimer(drill)}
          className="btn btn-primary btn-sm"
          style={{ minWidth: 52, minHeight: 36, padding: '0 10px', fontSize: 13, fontWeight: 700 }}
          title="Start timer for this drill"
        >
          ▶ Start
        </button>
        <button onClick={() => onEdit(drill)} className="btn btn-sm" style={{ minWidth: 44, minHeight: 36 }}>
          Edit
        </button>
        <button
          onClick={() => onAdd(drill)}
          className="btn btn-primary btn-sm"
          style={{ minWidth: 36, minHeight: 36, fontSize: 18, padding: '0 8px' }}
        >
          +
        </button>
        {isCustom && (
          <button
            onClick={() => onDelete(drill)}
            className="btn btn-sm"
            style={{ minWidth: 48, minHeight: 36, color: 'var(--red)', borderColor: 'var(--red)' }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Edit/Add Drill Modal ─────────────────────────────────────────────────────

function DrillModal({ drill, isNew, onSave, onReset, onDelete, onCancel }) {
  const [name, setName] = React.useState(drill.name || '');
  const [category, setCategory] = React.useState(drill.category || CATEGORIES[0]);
  const [duration, setDuration] = React.useState(drill.duration || 15);
  const [description, setDescription] = React.useState(drill.description || '');
  const isCustom = drill.id && drill.id.startsWith('custom_');

  function handleSave() {
    if (!name.trim()) return;
    onSave({ ...drill, name: name.trim(), category, duration: Number(duration), description: description.trim() });
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      zIndex: 200, overflowY: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '20px 16px',
    }}>
      <div style={{
        background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 24,
        width: '100%', maxWidth: 480, border: '1px solid var(--border)',
      }}>
        <h2 style={{ margin: '0 0 20px', color: 'var(--text)', fontSize: 18 }}>
          {isNew ? 'Add Custom Drill' : 'Edit Drill'}
        </h2>

        <div className="form-group">
          <label className="form-label">Drill Name</label>
          <input
            className="form-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Drill name"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Category</label>
          <select
            className="form-input"
            value={category}
            onChange={e => setCategory(e.target.value)}
            style={{ background: 'var(--card)', color: 'var(--text)' }}
          >
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Duration (minutes)</label>
          <select
            className="form-input"
            value={duration}
            onChange={e => setDuration(Number(e.target.value))}
            style={{ background: 'var(--card)', color: 'var(--text)' }}
          >
            {[5, 10, 15, 20, 25, 30, 45, 60].map(d => (
              <option key={d} value={d}>{d} min</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea
            className="form-input"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Drill description"
            rows={3}
            style={{ resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
          <button className="btn btn-primary" onClick={handleSave} style={{ flex: 1, minHeight: 44 }}>
            {isNew ? 'Save Drill' : 'Save Changes'}
          </button>
          {!isNew && !isCustom && (
            <button className="btn btn-secondary" onClick={onReset} style={{ minHeight: 44 }}>
              Reset to Default
            </button>
          )}
          {isCustom && (
            <button
              className="btn btn-secondary"
              onClick={() => onDelete(drill)}
              style={{ minHeight: 44, color: 'var(--red)', borderColor: 'var(--red)' }}
            >
              Delete
            </button>
          )}
          <button className="btn btn-secondary" onClick={onCancel} style={{ minHeight: 44 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function PracticeStats({ completions, drillsById, onSelectDay }) {
  const todayDate = today();
  const weekDates = getWeekDates(todayDate);
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const weekMinutes = weekDates.map(d => {
    const key = dateKey(d);
    const ids = completions[key] || [];
    return ids.reduce((sum, id) => {
      const dr = drillsById[id];
      return sum + (dr ? dr.duration : 0);
    }, 0);
  });

  const totalWeekMins = weekMinutes.reduce((a, b) => a + b, 0);
  const sessionsCount = weekMinutes.filter(m => m > 0).length;

  // Streak
  let streak = 0;
  const check = new Date(todayDate);
  while (true) {
    const key = dateKey(check);
    if ((completions[key] || []).length > 0) {
      streak++;
      check.setDate(check.getDate() - 1);
    } else {
      break;
    }
  }

  // Most practiced category this month
  const monthStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
  const catCounts = {};
  Object.entries(completions).forEach(([key, ids]) => {
    const d = new Date(key);
    if (d >= monthStart) {
      ids.forEach(id => {
        const dr = drillsById[id];
        if (dr) catCounts[dr.category] = (catCounts[dr.category] || 0) + 1;
      });
    }
  });
  const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];

  const maxMins = Math.max(...weekMinutes, 1);

  return (
    <div className="card" style={{ marginBottom: 16, padding: '16px 16px 12px' }}>
      <div className="card-title" style={{ marginBottom: 12 }}>This Week</div>
      <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>{totalWeekMins}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>minutes</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>{sessionsCount}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>sessions</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>{streak}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>day streak</div>
        </div>
        {topCat && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: CATEGORY_COLORS[topCat[0]] || 'var(--accent)' }}>
              {topCat[0]}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>top category</div>
          </div>
        )}
      </div>

      {/* Bar chart — tap any day to edit */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 60 }}>
        {weekMinutes.map((mins, i) => {
          const isToday = isSameDay(weekDates[i], todayDate);
          const heightPct = (mins / maxMins) * 100;
          return (
            <div
              key={i}
              onClick={() => onSelectDay && onSelectDay(weekDates[i])}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer' }}
            >
              <div style={{
                width: '100%',
                height: `${Math.max(heightPct * 0.5, mins > 0 ? 4 : 0)}px`,
                background: isToday ? 'var(--accent)' : mins > 0 ? 'var(--accent-dim)' : 'var(--border)',
                borderRadius: '3px 3px 0 0',
                minHeight: mins > 0 ? 4 : 2,
                transition: 'height 0.3s',
              }} />
              <div style={{ fontSize: 10, color: isToday ? 'var(--accent)' : 'var(--text-muted)' }}>
                {DAY_LABELS[i]}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
        Tap a day to edit sessions
      </div>
    </div>
  );
}

// ─── Calendar View ────────────────────────────────────────────────────────────

function PracticeCalendar({ calMonth, setCalMonth, schedules, completions, drillsById, onSelectDay }) {
  const todayDate = today();
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7; // Mon = 0

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  return (
    <div>
      {/* Month nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setCalMonth(addMonths(calMonth, -1))}>◀</button>
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 16 }}>
          {MONTH_NAMES[month]} {year}
        </span>
        <button className="btn btn-secondary btn-sm" onClick={() => setCalMonth(addMonths(calMonth, 1))}>▶</button>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
        {['Mo','Tu','We','Th','Fr','Sa','Su'].map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((date, i) => {
          if (!date) return <div key={`empty-${i}`} />;
          const key = dateKey(date);
          const scheduled = schedules[key] || [];
          const completed = completions[key] || [];
          const isToday = isSameDay(date, todayDate);
          const allDone = scheduled.length > 0 && completed.length >= scheduled.length;
          const hasSched = scheduled.length > 0;
          const totalMins = scheduled.reduce((s, id) => {
            const dr = drillsById[id];
            return s + (dr ? dr.duration : 0);
          }, 0);

          return (
            <div
              key={key}
              onClick={() => onSelectDay(date)}
              style={{
                background: 'var(--card)',
                borderRadius: 8,
                padding: '6px 4px',
                textAlign: 'center',
                cursor: 'pointer',
                border: isToday ? '2px solid var(--accent)' : '1px solid var(--border)',
                minHeight: 56,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--accent)' : 'var(--text)' }}>
                {date.getDate()}
              </span>
              {hasSched && (
                allDone ? (
                  <span style={{ fontSize: 14, color: 'var(--accent)' }}>✓</span>
                ) : (
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
                )
              )}
              {hasSched && totalMins > 0 && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{totalMins}m</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Day Planner Overlay ──────────────────────────────────────────────────────

function DayPlanner({
  date,
  allDrills,
  drillsById,
  scheduleIds,
  completionIds,
  onClose,
  onUpdateSchedule,
  onToggleComplete,
  onStartTimer,
  onStartPractice,
}) {
  const [search, setSearch] = React.useState('');
  const [categoryFilter, setCategoryFilter] = React.useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const key = dateKey(date);

  // Which plan day to load
  const [stdDay, setStdDay] = React.useState(() => {
    try { return parseInt(localStorage.getItem('practice_std_day') || '0', 10); } catch { return 0; }
  });
  const [eliteDay, setEliteDay] = React.useState(() => {
    try { return parseInt(localStorage.getItem('practice_elite_day') || '0', 10); } catch { return 0; }
  });

  function loadStandard() {
    const plan = STANDARD_PLANS[stdDay % STANDARD_PLANS.length];
    const newDay = (stdDay + 1) % STANDARD_PLANS.length;
    setStdDay(newDay);
    try { localStorage.setItem('practice_std_day', String(newDay)); } catch {}
    onUpdateSchedule(key, [...plan]);
  }

  function loadElite() {
    const plan = ELITE_PLANS[eliteDay % ELITE_PLANS.length];
    const newDay = (eliteDay + 1) % ELITE_PLANS.length;
    setEliteDay(newDay);
    try { localStorage.setItem('practice_elite_day', String(newDay)); } catch {}
    onUpdateSchedule(key, [...plan]);
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = scheduleIds.indexOf(active.id);
    const newIndex = scheduleIds.indexOf(over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onUpdateSchedule(key, arrayMove([...scheduleIds], oldIndex, newIndex));
  }

  function addDrill(drill) {
    if (!scheduleIds.includes(drill.id)) {
      onUpdateSchedule(key, [...scheduleIds, drill.id]);
    }
  }

  function removeDrill(drillId) {
    onUpdateSchedule(key, scheduleIds.filter(id => id !== drillId));
  }

  const totalMins = scheduleIds.reduce((s, id) => {
    const dr = drillsById[id];
    return s + (dr ? dr.duration : 0);
  }, 0);

  const completedCount = scheduleIds.filter(id => completionIds.includes(id)).length;
  const allComplete = scheduleIds.length > 0 && completedCount >= scheduleIds.length;
  const progressPct = scheduleIds.length > 0 ? (completedCount / scheduleIds.length) * 100 : 0;

  // Filter drills for compact library
  const filtered = allDrills.filter(d => {
    const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.category.toLowerCase().includes(search.toLowerCase());
    const matchCat = !categoryFilter || d.category === categoryFilter;
    return matchSearch && matchCat;
  });

  const categoriesWithDrills = CATEGORIES.filter(cat => filtered.some(d => d.category === cat));

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'var(--bg)', overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 16px 12px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            style={{ minHeight: 36 }}
          >
            ← Close
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{formatDate(date)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{totalMins} min planned</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={loadStandard} style={{ flex: 1, minHeight: 36, fontSize: 12 }}>
            Load Standard Plan
          </button>
          <button className="btn btn-secondary btn-sm" onClick={loadElite} style={{ flex: 1, minHeight: 36, fontSize: 12 }}>
            Load Elite Plan
          </button>
        </div>
        {onStartPractice && scheduleIds.length > 0 && (
          <button
            className="btn btn-primary"
            onClick={() => onStartPractice(key)}
            style={{ width: '100%', minHeight: 44, fontSize: 15, fontWeight: 700 }}
          >
            ▶ Start Practice
          </button>
        )}
      </div>

      <div style={{ padding: '0 16px 120px' }}>

        {/* Schedule section */}
        <div style={{ marginTop: 16, marginBottom: 20 }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>Schedule</div>
          </div>

          {/* Progress bar */}
          {scheduleIds.length > 0 && (
            <div style={{
              height: 6, background: 'var(--border)', borderRadius: 3, marginBottom: 10, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${progressPct}%`,
                background: 'var(--accent)',
                borderRadius: 3,
                transition: 'width 0.3s',
              }} />
            </div>
          )}

          {/* Celebration */}
          {allComplete && (
            <div style={{
              background: 'rgba(76,175,80,0.12)',
              border: '1px solid var(--accent)',
              borderRadius: 10,
              padding: '12px 16px',
              textAlign: 'center',
              marginBottom: 12,
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--accent)',
            }}>
              Session Complete! 🏆
            </div>
          )}

          {scheduleIds.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0', fontSize: 14 }}>
              Tap drills below to add them
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={scheduleIds} strategy={verticalListSortingStrategy}>
                {scheduleIds.map(id => {
                  const drill = drillsById[id];
                  if (!drill) return null;
                  return (
                    <SortableScheduleItem
                      key={id}
                      id={id}
                      drill={drill}
                      completed={completionIds.includes(id)}
                      onToggleComplete={(drillId) => onToggleComplete(drillId, key)}
                      onRemove={removeDrill}
                      onStartTimer={onStartTimer ? (d) => onStartTimer(d, scheduleIds.indexOf(d.id), scheduleIds) : null}
                    />
                  );
                })}
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Compact drill library */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15, marginBottom: 10 }}>
            Add Drills
          </div>

          <input
            className="form-input"
            placeholder="Search drills..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ marginBottom: 10 }}
          />

          {/* Category filter */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 14, paddingBottom: 4 }}>
            <button
              className={`chip${!categoryFilter ? ' active' : ''}`}
              onClick={() => setCategoryFilter(null)}
              style={{ flexShrink: 0 }}
            >
              All
            </button>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                className={`chip${categoryFilter === cat ? ' active' : ''}`}
                onClick={() => setCategoryFilter(cat === categoryFilter ? null : cat)}
                style={{ flexShrink: 0 }}
              >
                {cat}
              </button>
            ))}
          </div>

          {categoriesWithDrills.map(cat => {
            const catDrills = filtered.filter(d => d.category === cat);
            if (!catDrills.length) return null;
            return (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: CATEGORY_COLORS[cat] || 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  marginBottom: 6,
                }}>
                  {cat}
                </div>
                {catDrills.map(drill => (
                  <DrillCard
                    key={drill.id}
                    drill={drill}
                    onAdd={addDrill}
                    onEdit={() => {}}
                    onDelete={() => {}}
                    onStartTimer={() => {}}
                    compact
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Practice Mode Screen ─────────────────────────────────────────────────────

// ── Silent audio blob URL (created once) ─────────────────────
// Playing silent audio keeps iOS from throttling JS & enables lock screen display
function createSilentAudioUrl() {
  // 1-second silent WAV (PCM 8kHz mono 8-bit)
  const sampleRate = 8000;
  const buf = new ArrayBuffer(44 + sampleRate);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + sampleRate, true);
  str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, sampleRate, true);
  for (let i = 0; i < sampleRate; i++) v.setUint8(44 + i, 128); // silence
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
let _silentUrl = null;
function getSilentUrl() {
  if (!_silentUrl) _silentUrl = createSilentAudioUrl();
  return _silentUrl;
}

function mmss(secs) {
  const s = Math.max(0, Math.floor(secs));
  return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
}

function PracticeModeScreen({ dayKey, scheduleIds, completionIds, drillsById, onToggleComplete, onClose, onTimerChange }) {
  const [activeDrillIndex, setActiveDrillIndex] = React.useState(() => {
    const idx = scheduleIds.findIndex(id => !completionIds.includes(id));
    return idx >= 0 ? idx : 0;
  });
  // timer shape: { totalMs, adjustedMs, startTime, paused }
  const [timer, setTimer] = React.useState(null);
  // Worker-driven remaining ms (updates every 500ms even in background)
  const [workerRemaining, setWorkerRemaining] = React.useState(null);
  const [sessionDone, setSessionDone] = React.useState(false);
  const wakeLockRef = React.useRef(null);
  const audioRef = React.useRef(null);
  const workerRef = React.useRef(null);

  const activeDrillId = scheduleIds[activeDrillIndex];
  const activeDrill = activeDrillId ? drillsById[activeDrillId] : null;
  const completedCount = scheduleIds.filter(id => completionIds.includes(id)).length;
  const allComplete = scheduleIds.length > 0 && completedCount >= scheduleIds.length;
  const remainingSessionMins = scheduleIds
    .filter(id => !completionIds.includes(id))
    .reduce((s, id) => { const dr = drillsById[id]; return s + (dr ? dr.duration : 0); }, 0);

  // ── Web Worker (background-safe timer tick) ─────────────────
  React.useEffect(() => {
    try {
      const w = new Worker('/timerWorker.js');
      workerRef.current = w;
      w.onmessage = (e) => {
        if (e.data.type === 'tick') {
          setWorkerRemaining(e.data.remaining);
          // Update lock screen countdown text
          if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
            const secs = Math.ceil(e.data.remaining / 1000);
            navigator.mediaSession.metadata.artist = `⏱ ${mmss(secs)} remaining`;
          }
        }
        if (e.data.type === 'complete') {
          playChime();
          setTimer(prev => prev ? { ...prev, paused: true, adjustedMs: 0 } : null);
          setWorkerRemaining(0);
        }
      };
    } catch (e) { /* Worker not supported */ }
    return () => {
      if (workerRef.current) { workerRef.current.postMessage({ type: 'stop' }); workerRef.current.terminate(); workerRef.current = null; }
    };
  }, []);

  // ── Wake lock helpers ───────────────────────────────────────
  const acquireWakeLock = React.useCallback(async () => {
    if (!('wakeLock' in navigator) || wakeLockRef.current) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      wakeLockRef.current.addEventListener('release', () => { wakeLockRef.current = null; });
    } catch (e) { /* not supported */ }
  }, []);

  const releaseWakeLock = React.useCallback(() => {
    if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; }
  }, []);

  // ── Silent audio session (prevents JS throttle, enables lock screen) ──
  const startAudioSession = React.useCallback(async (drillName) => {
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio(getSilentUrl());
        audioRef.current.loop = true;
        audioRef.current.volume = 0.01;
      }
      await audioRef.current.play();
    } catch (e) { /* needs user interaction — already have it */ }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: drillName || 'Drill Timer',
        artist: 'Starting…',
        album: 'Grady GolfTrack — Practice',
        artwork: [
          { src: window.location.origin + '/logo192.png', sizes: '192x192', type: 'image/png' },
          { src: window.location.origin + '/logo512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
      navigator.mediaSession.playbackState = 'playing';
    }
  }, []);

  const stopAudioSession = React.useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); }
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      try { navigator.mediaSession.setActionHandler('play', null); } catch (e) {}
      try { navigator.mediaSession.setActionHandler('pause', null); } catch (e) {}
    }
  }, []);

  // Wire up lock screen play/pause buttons
  React.useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', () => {
        setTimer(prev => prev ? { ...prev, paused: false, startTime: Date.now() } : prev);
        if (audioRef.current) audioRef.current.play().catch(() => {});
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        setTimer(prev => {
          if (!prev) return prev;
          const adj = getRemainingMs(prev);
          return { ...prev, paused: true, adjustedMs: adj };
        });
        if (audioRef.current) audioRef.current.pause();
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
      });
    } catch (e) {}
  }, []);

  // ── Re-acquire wake lock & audio on screen wake ─────────────
  React.useEffect(() => {
    const handler = async () => {
      if (document.visibilityState === 'visible' && timer && !timer.paused) {
        await acquireWakeLock();
        if (audioRef.current) audioRef.current.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [timer, acquireWakeLock]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      releaseWakeLock();
      stopAudioSession();
    };
  }, [releaseWakeLock, stopAudioSession]);

  // ── Auto-start timer when active drill changes ──────────────
  React.useEffect(() => {
    if (!activeDrill) return;
    const ms = activeDrill.duration * 60000;
    const newTimer = { totalMs: ms, adjustedMs: ms, startTime: Date.now(), paused: false };
    setTimer(newTimer);
    setWorkerRemaining(ms);
    // Start worker
    if (workerRef.current) workerRef.current.postMessage({ type: 'start', data: { adjustedMs: ms, startTime: Date.now() } });
    acquireWakeLock();
    startAudioSession(activeDrill.name);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrillIndex]);

  // ── Sync worker when timer paused/resumed ───────────────────
  React.useEffect(() => {
    if (!timer || !workerRef.current) return;
    if (timer.paused) {
      workerRef.current.postMessage({ type: 'pause', data: { adjustedMs: timer.adjustedMs, startTime: timer.startTime } });
      releaseWakeLock();
      if (audioRef.current) audioRef.current.pause();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    } else {
      workerRef.current.postMessage({ type: 'resume', data: { adjustedMs: timer.adjustedMs } });
      acquireWakeLock();
      if (audioRef.current) audioRef.current.play().catch(() => {});
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    }
  }, [timer?.paused, acquireWakeLock, releaseWakeLock]); // eslint-disable-line

  // ── Notify parent (global banner) of timer changes ──────────
  React.useEffect(() => {
    if (onTimerChange) {
      onTimerChange(timer ? { ...timer, drillName: activeDrill?.name || '' } : null);
    }
  }, [timer, activeDrill?.name, onTimerChange]);

  // ── Session completion ───────────────────────────────────────
  React.useEffect(() => {
    if (allComplete) { stopAudioSession(); setSessionDone(true); }
  }, [allComplete, stopAudioSession]);

  function goToIndex(idx) { if (idx < scheduleIds.length) setActiveDrillIndex(idx); }

  function handleMarkDone() {
    if (!activeDrillId) return;
    onToggleComplete(activeDrillId, dayKey);
    const next = scheduleIds.findIndex((id, i) => i > activeDrillIndex && !completionIds.includes(id) && id !== activeDrillId);
    if (next >= 0) { goToIndex(next); return; }
    const fromStart = scheduleIds.findIndex(id => id !== activeDrillId && !completionIds.includes(id));
    if (fromStart >= 0) goToIndex(fromStart);
  }

  function handleSkip() {
    const next = activeDrillIndex + 1;
    if (next < scheduleIds.length) goToIndex(next);
  }

  function togglePause() {
    setTimer(prev => {
      if (!prev) return prev;
      if (prev.paused) return { ...prev, paused: false, startTime: Date.now() };
      return { ...prev, paused: true, adjustedMs: getRemainingMs(prev) };
    });
  }

  const progressPct = scheduleIds.length > 0 ? (completedCount / scheduleIds.length) * 100 : 0;
  // Prefer worker remaining (background-accurate), fall back to wall-clock
  const remainingMs = workerRemaining !== null ? workerRemaining : getRemainingMs(timer);
  const remainingSecs = Math.ceil(remainingMs / 1000);
  const isAlmostDone = remainingSecs <= 30 && remainingSecs > 0;

  if (sessionDone || allComplete) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 110,
        background: 'var(--bg)', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 32,
      }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🏆</div>
        <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--accent)', marginBottom: 8 }}>Session Complete!</div>
        <div style={{ fontSize: 15, color: 'var(--text-muted)', marginBottom: 32, textAlign: 'center' }}>
          You finished {scheduleIds.length} drill{scheduleIds.length !== 1 ? 's' : ''} today. Great work!
        </div>
        <button
          className="btn btn-primary"
          onClick={onClose}
          style={{ width: '100%', maxWidth: 320, minHeight: 52, fontSize: 17, fontWeight: 700 }}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 110,
      background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px 10px', background: 'var(--surface)',
        borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 10, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ minHeight: 36 }}>← Exit</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Practice Session</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {completedCount}/{scheduleIds.length} drills · {remainingSessionMins} min left
            </div>
          </div>
        </div>
        <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progressPct}%`, background: 'var(--accent)', borderRadius: 3, transition: 'width 0.4s' }} />
        </div>
      </div>

      {/* Current Drill Card */}
      {activeDrill && (
        <div style={{ padding: '20px 16px 0', flexShrink: 0 }}>
          <div style={{ background: 'var(--surface)', border: '2px solid var(--accent)', borderRadius: 16, padding: '20px 20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: CATEGORY_COLORS[activeDrill.category] || 'var(--accent)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {activeDrill.category}
              </span>
              {completionIds.includes(activeDrillId) && (
                <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontWeight: 700, fontSize: 13 }}>✓ Done</span>
              )}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>{activeDrill.name}</div>
            {activeDrill.description
              ? <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.4 }}>{activeDrill.description}</div>
              : <div style={{ marginBottom: 20 }} />}

            {/* Big timer — wall-clock based */}
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{
                fontSize: 56, fontWeight: 900, letterSpacing: 2, lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
                color: isAlmostDone ? '#ff4d4f' : (timer?.paused ? 'var(--text-muted)' : 'var(--accent)'),
              }}>
                {formatMMSS(remainingSecs || activeDrill.duration * 60)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {activeDrill.duration} min drill{timer?.paused ? ' · paused' : ''}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={togglePause} className="btn btn-secondary" style={{ flex: 1, minHeight: 48, fontSize: 15, fontWeight: 700 }}>
                {timer && !timer.paused ? '⏸ Pause' : '▶ Resume'}
              </button>
              <button
                onClick={handleMarkDone}
                className="btn btn-primary"
                style={{ flex: 2, minHeight: 48, fontSize: 15, fontWeight: 700 }}
                disabled={completionIds.includes(activeDrillId)}
              >
                ✓ Mark Done
              </button>
            </div>
            {activeDrillIndex < scheduleIds.length - 1 && (
              <button
                onClick={handleSkip}
                style={{ marginTop: 8, width: '100%', background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: '6px 0' }}
              >
                Skip to next →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Drill list */}
      <div style={{ padding: '20px 16px 40px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          All Drills
        </div>
        {scheduleIds.map((id, index) => {
          const drill = drillsById[id];
          if (!drill) return null;
          const done = completionIds.includes(id);
          const isActive = index === activeDrillIndex;
          return (
            <div
              key={id}
              onClick={() => setActiveDrillIndex(index)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '11px 14px', borderRadius: 10, marginBottom: 6, cursor: 'pointer',
                background: isActive ? 'rgba(76,175,80,0.1)' : 'var(--card)',
                border: isActive ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                opacity: done ? 0.55 : 1,
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: CATEGORY_COLORS[drill.category] || 'var(--accent)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: done ? 'line-through' : 'none' }}>
                  {drill.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{drill.duration} min</div>
              </div>
              <div style={{ width: 28, height: 28, borderRadius: '50%', border: `2px solid ${done ? 'var(--accent)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: done ? 'var(--accent)' : 'transparent', fontSize: 14, flexShrink: 0 }}>
                {done ? '✓' : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Timer Bar ────────────────────────────────────────────────────────────────

function TimerBar({ timer, fallbackScheduleIds, drillsById, onUpdate, onClear }) {
  const drill = timer ? drillsById[timer.drillId] : null;
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  // Wall-clock-based countdown — immune to phone sleep / JS throttle
  React.useEffect(() => {
    if (!timer || timer.paused) return;
    const id = setInterval(() => {
      const rem = getRemainingMs(timer);
      if (rem <= 0) {
        playChime();
        const scheduleIds = timer.scheduleIds || fallbackScheduleIds;
        if (timer.scheduleIndex != null && scheduleIds && scheduleIds.length > 0) {
          const nextIdx = timer.scheduleIndex + 1;
          if (nextIdx < scheduleIds.length) {
            const nextDrill = drillsById[scheduleIds[nextIdx]];
            if (nextDrill) {
              const ms = nextDrill.duration * 60000;
              onUpdate({ drillId: nextDrill.id, totalMs: ms, adjustedMs: ms, startTime: Date.now(), paused: false, scheduleIndex: nextIdx, scheduleIds });
              return;
            }
          }
        }
        onUpdate(null);
      } else {
        forceUpdate();
      }
    }, 500);
    return () => clearInterval(id);
  }, [timer, fallbackScheduleIds, drillsById, onUpdate]);

  // Re-render on visibility change (phone wakes up)
  React.useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') forceUpdate(); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  if (!timer || !drill) return null;

  const remainingMs = getRemainingMs(timer);
  const remainingSecs = Math.ceil(remainingMs / 1000);
  const progressPct = timer.totalMs > 0 ? ((timer.totalMs - remainingMs) / timer.totalMs) * 100 : 0;

  return (
    <div style={{
      position: 'fixed', bottom: 64, left: 0, right: 0,
      zIndex: 90, background: 'var(--surface)', borderTop: '2px solid var(--accent)',
      padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, height: 3, width: `${progressPct}%`, background: 'var(--accent)', transition: 'width 0.5s linear' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{drill.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{drill.category}</div>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: remainingSecs <= 30 ? '#ff4d4f' : 'var(--accent)', fontVariantNumeric: 'tabular-nums', minWidth: 56, textAlign: 'center' }}>
        {formatMMSS(remainingSecs)}
      </div>
      <button
        onClick={() => onUpdate(prev => {
          if (!prev) return prev;
          if (prev.paused) return { ...prev, paused: false, startTime: Date.now() };
          return { ...prev, paused: true, adjustedMs: getRemainingMs(prev) };
        })}
        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', width: 40, height: 40, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {timer.paused ? '▶' : '⏸'}
      </button>
      <button
        onClick={onClear}
        style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', width: 40, height: 40, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        ⏭
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PracticeScreen({ onTimerChange }) {
  const [view, setView] = React.useState('library');
  const [calMonth, setCalMonth] = React.useState(() => startOfMonth(today()));
  const [selectedDate, setSelectedDate] = React.useState(null);
  const [schedules, setSchedules] = React.useState({});
  const [completions, setCompletions] = React.useState({});
  const [customDrills, setCustomDrills] = React.useState([]);
  const [drillEdits, setDrillEdits] = React.useState({});
  const [editingDrill, setEditingDrill] = React.useState(null);
  const [addingCustom, setAddingCustom] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [categoryFilter, setCategoryFilter] = React.useState(null);
  const [timer, setTimer] = React.useState(null);
  const [practiceModeKey, setPracticeModeKey] = React.useState(null);

  // ── Firebase listeners ──────────────────────────────────────────────────────

  React.useEffect(() => {
    const unsubs = [];

    // Schedules
    unsubs.push(onSnapshot(collection(db, 'practice_schedules'), snap => {
      const data = {};
      snap.forEach(d => { data[d.id] = d.data().drillIds || []; });
      setSchedules(data);
      try { localStorage.setItem('practice_schedules', JSON.stringify(data)); } catch {}
    }, () => {
      try {
        const local = localStorage.getItem('practice_schedules');
        if (local) setSchedules(JSON.parse(local));
      } catch {}
    }));

    // Completions
    unsubs.push(onSnapshot(collection(db, 'practice_completions'), snap => {
      const data = {};
      snap.forEach(d => { data[d.id] = d.data().drillIds || []; });
      setCompletions(data);
      try { localStorage.setItem('practice_completions', JSON.stringify(data)); } catch {}
    }, () => {
      try {
        const local = localStorage.getItem('practice_completions');
        if (local) setCompletions(JSON.parse(local));
      } catch {}
    }));

    // Custom drills
    unsubs.push(onSnapshot(collection(db, 'practice_custom_drills'), snap => {
      const data = [];
      snap.forEach(d => { data.push({ id: d.id, ...d.data() }); });
      setCustomDrills(data);
      try { localStorage.setItem('practice_custom_drills', JSON.stringify(data)); } catch {}
    }, () => {
      try {
        const local = localStorage.getItem('practice_custom_drills');
        if (local) setCustomDrills(JSON.parse(local));
      } catch {}
    }));

    // Drill edits
    unsubs.push(onSnapshot(collection(db, 'practice_drill_edits'), snap => {
      const data = {};
      snap.forEach(d => { data[d.id] = d.data(); });
      setDrillEdits(data);
      try { localStorage.setItem('practice_drill_edits', JSON.stringify(data)); } catch {}
    }, () => {
      try {
        const local = localStorage.getItem('practice_drill_edits');
        if (local) setDrillEdits(JSON.parse(local));
      } catch {}
    }));

    return () => unsubs.forEach(u => u());
  }, []);

  // ── Merged drill lookup ─────────────────────────────────────────────────────

  const allDrills = React.useMemo(() => {
    const base = DRILLS.map(d => {
      const edit = drillEdits[d.id];
      return edit ? { ...d, ...edit } : d;
    });
    return [...base, ...customDrills];
  }, [customDrills, drillEdits]);

  const drillsById = React.useMemo(() => {
    const map = {};
    allDrills.forEach(d => { map[d.id] = d; });
    return map;
  }, [allDrills]);

  // ── Save schedule ───────────────────────────────────────────────────────────

  async function updateSchedule(key, drillIds) {
    setSchedules(prev => ({ ...prev, [key]: drillIds }));
    try {
      await setDoc(doc(db, 'practice_schedules', key), { drillIds });
    } catch {
      try { localStorage.setItem('practice_schedules', JSON.stringify({ ...schedules, [key]: drillIds })); } catch {}
    }
  }

  // ── Toggle completion ───────────────────────────────────────────────────────

  async function toggleComplete(drillId, dayKey) {
    const key = dayKey || dateKey(today());
    const current = completions[key] || [];
    const next = current.includes(drillId)
      ? current.filter(id => id !== drillId)
      : [...current, drillId];
    setCompletions(prev => ({ ...prev, [key]: next }));
    try {
      await setDoc(doc(db, 'practice_completions', key), { drillIds: next });
    } catch {
      try { localStorage.setItem('practice_completions', JSON.stringify({ ...completions, [key]: next })); } catch {}
    }
  }

  // ── Add drill to today ──────────────────────────────────────────────────────

  async function addToToday(drill) {
    const key = dateKey(today());
    const current = schedules[key] || [];
    if (current.includes(drill.id)) return;
    await updateSchedule(key, [...current, drill.id]);
  }

  // ── Edit / save drill ───────────────────────────────────────────────────────

  async function saveDrillEdit(updated) {
    const isCustom = updated.id.startsWith('custom_');
    if (isCustom) {
      // Update custom drill document
      const next = customDrills.map(d => d.id === updated.id ? updated : d);
      setCustomDrills(next);
      try {
        await setDoc(doc(db, 'practice_custom_drills', updated.id), updated);
      } catch {
        try { localStorage.setItem('practice_custom_drills', JSON.stringify(next)); } catch {}
      }
    } else {
      // Save to drill edits
      const edit = { name: updated.name, category: updated.category, duration: updated.duration, description: updated.description };
      setDrillEdits(prev => ({ ...prev, [updated.id]: edit }));
      try {
        await setDoc(doc(db, 'practice_drill_edits', updated.id), edit);
      } catch {
        try { localStorage.setItem('practice_drill_edits', JSON.stringify({ ...drillEdits, [updated.id]: edit })); } catch {}
      }
    }
    setEditingDrill(null);
  }

  async function resetDrillEdit(drill) {
    setDrillEdits(prev => {
      const next = { ...prev };
      delete next[drill.id];
      return next;
    });
    try {
      await deleteDoc(doc(db, 'practice_drill_edits', drill.id));
    } catch {
      try {
        const local = JSON.parse(localStorage.getItem('practice_drill_edits') || '{}');
        delete local[drill.id];
        localStorage.setItem('practice_drill_edits', JSON.stringify(local));
      } catch {}
    }
    setEditingDrill(null);
  }

  async function deleteDrill(drill) {
    const next = customDrills.filter(d => d.id !== drill.id);
    setCustomDrills(next);
    try {
      await deleteDoc(doc(db, 'practice_custom_drills', drill.id));
    } catch {
      try { localStorage.setItem('practice_custom_drills', JSON.stringify(next)); } catch {}
    }
    setEditingDrill(null);
  }

  // ── Add custom drill ────────────────────────────────────────────────────────

  async function saveCustomDrill(data) {
    const id = 'custom_' + Date.now();
    const newDrill = { id, ...data };
    const next = [...customDrills, newDrill];
    setCustomDrills(next);
    try {
      await setDoc(doc(db, 'practice_custom_drills', id), newDrill);
    } catch {
      try { localStorage.setItem('practice_custom_drills', JSON.stringify(next)); } catch {}
    }
    setAddingCustom(false);
  }

  // ── Start timer ─────────────────────────────────────────────────────────────

  function startTimer(drill, scheduleIndex, planScheduleIds) {
    const ms = drill.duration * 60000;
    setTimer({
      drillId: drill.id,
      drillName: drill.name,
      totalMs: ms,
      adjustedMs: ms,
      startTime: Date.now(),
      paused: false,
      scheduleIndex: scheduleIndex != null ? scheduleIndex : null,
      scheduleIds: planScheduleIds || null,
    });
  }

  // Sync TimerBar timer to parent (global banner across tabs)
  React.useEffect(() => {
    if (onTimerChange) onTimerChange(timer ? { ...timer } : null);
  }, [timer, onTimerChange]);

  // ── Library filtered drills ─────────────────────────────────────────────────

  const filteredDrills = React.useMemo(() => {
    return allDrills.filter(d => {
      const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase()) || d.description.toLowerCase().includes(search.toLowerCase()) || d.category.toLowerCase().includes(search.toLowerCase());
      const matchCat = !categoryFilter || d.category === categoryFilter;
      return matchSearch && matchCat;
    });
  }, [allDrills, search, categoryFilter]);

  const categoriesWithDrills = React.useMemo(() => {
    return CATEGORIES.filter(cat => filteredDrills.some(d => d.category === cat));
  }, [filteredDrills]);

  // Category counts for filter buttons
  const catCounts = React.useMemo(() => {
    const counts = {};
    allDrills.forEach(d => { counts[d.category] = (counts[d.category] || 0) + 1; });
    return counts;
  }, [allDrills]);

  const todayKey = dateKey(today());
  const todaySchedule = schedules[todayKey] || [];
  // eslint-disable-next-line no-unused-vars
  const todayCompletions = completions[todayKey] || [];

  return (
    <div className="screen" style={{ paddingBottom: timer ? 140 : 80 }}>

      {/* Practice Mode Screen */}
      {practiceModeKey && (
        <PracticeModeScreen
          dayKey={practiceModeKey}
          scheduleIds={schedules[practiceModeKey] || []}
          completionIds={completions[practiceModeKey] || []}
          drillsById={drillsById}
          onToggleComplete={toggleComplete}
          onClose={() => { setPracticeModeKey(null); if (onTimerChange) onTimerChange(null); }}
          onTimerChange={onTimerChange}
        />
      )}

      {/* Day Planner overlay */}
      {selectedDate && (
        <DayPlanner
          date={selectedDate}
          allDrills={allDrills}
          drillsById={drillsById}
          scheduleIds={schedules[dateKey(selectedDate)] || []}
          completionIds={completions[dateKey(selectedDate)] || []}
          onClose={() => setSelectedDate(null)}
          onUpdateSchedule={updateSchedule}
          onToggleComplete={toggleComplete}
          onStartTimer={startTimer}
          onStartPractice={(key) => { setSelectedDate(null); setPracticeModeKey(key); }}
        />
      )}

      {/* Edit drill modal */}
      {editingDrill && (
        <DrillModal
          drill={editingDrill}
          isNew={false}
          onSave={saveDrillEdit}
          onReset={() => resetDrillEdit(editingDrill)}
          onDelete={deleteDrill}
          onCancel={() => setEditingDrill(null)}
        />
      )}

      {/* Add custom drill modal */}
      {addingCustom && (
        <DrillModal
          drill={{ name: '', category: CATEGORIES[0], duration: 15, description: '' }}
          isNew
          onSave={saveCustomDrill}
          onReset={() => {}}
          onDelete={() => {}}
          onCancel={() => setAddingCustom(false)}
        />
      )}

      {/* Header */}
      <div style={{ padding: '16px 16px 0' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px' }}>
          Practice Tracker
        </h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          {formatDateShort(today())} · {todaySchedule.length} drill{todaySchedule.length !== 1 ? 's' : ''} planned today
        </div>

        {/* View toggle */}
        <div className="toggle-group" style={{ marginBottom: 16 }}>
          <button
            className={`toggle-btn${view === 'library' ? ' active' : ''}`}
            onClick={() => setView('library')}
          >
            Library
          </button>
          <button
            className={`toggle-btn${view === 'calendar' ? ' active' : ''}`}
            onClick={() => setView('calendar')}
          >
            Calendar
          </button>
        </div>

        {/* Stats */}
        <PracticeStats completions={completions} drillsById={drillsById} onSelectDay={setSelectedDate} />

        {/* Start Practice button — only when today has drills */}
        {todaySchedule.length > 0 && (
          <button
            className="btn btn-primary"
            onClick={() => setPracticeModeKey(todayKey)}
            style={{ width: '100%', minHeight: 48, fontSize: 16, fontWeight: 700, marginBottom: 16 }}
          >
            ▶ Start Practice — {todaySchedule.length} Drill{todaySchedule.length !== 1 ? 's' : ''} Today
          </button>
        )}
      </div>

      {/* Library View */}
      {view === 'library' && (
        <div style={{ padding: '0 16px' }}>
          {/* Search */}
          <input
            className="form-input"
            placeholder="Search drills..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ marginBottom: 10 }}
          />

          {/* Category filters */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 16, paddingBottom: 4 }}>
            <button
              className={`chip${!categoryFilter ? ' active' : ''}`}
              onClick={() => setCategoryFilter(null)}
              style={{ flexShrink: 0 }}
            >
              All ({allDrills.length})
            </button>
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                className={`chip${categoryFilter === cat ? ' active' : ''}`}
                onClick={() => setCategoryFilter(cat === categoryFilter ? null : cat)}
                style={{ flexShrink: 0 }}
              >
                {cat} ({catCounts[cat] || 0})
              </button>
            ))}
          </div>

          {/* Drills by category */}
          {categoriesWithDrills.map(cat => {
            const catDrills = filteredDrills.filter(d => d.category === cat);
            return (
              <div key={cat} style={{ marginBottom: 20 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 10,
                }}>
                  <span style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: CATEGORY_COLORS[cat] || 'var(--accent)',
                    display: 'inline-block',
                  }} />
                  <span style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: CATEGORY_COLORS[cat] || 'var(--text)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}>
                    {cat}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>({catDrills.length})</span>
                </div>
                {catDrills.map(drill => (
                  <DrillCard
                    key={drill.id}
                    drill={drill}
                    onEdit={setEditingDrill}
                    onAdd={addToToday}
                    onDelete={deleteDrill}
                    onStartTimer={d => startTimer(d, null)}
                    compact={false}
                  />
                ))}
              </div>
            );
          })}

          {filteredDrills.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0', fontSize: 15 }}>
              No drills found
            </div>
          )}
        </div>
      )}

      {/* Calendar View */}
      {view === 'calendar' && (
        <div style={{ padding: '0 16px' }}>
          <PracticeCalendar
            calMonth={calMonth}
            setCalMonth={setCalMonth}
            schedules={schedules}
            completions={completions}
            drillsById={drillsById}
            onSelectDay={d => setSelectedDate(d)}
          />
          {/* Quick: tap today */}
          <button
            className="btn btn-secondary"
            onClick={() => setSelectedDate(today())}
            style={{ width: '100%', marginTop: 16, minHeight: 44 }}
          >
            Open Today's Planner
          </button>
        </div>
      )}

      {/* Floating + button */}
      <button
        onClick={() => setAddingCustom(true)}
        style={{
          position: 'fixed',
          bottom: timer ? 120 : 80,
          right: 20,
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'var(--accent)',
          color: '#fff',
          fontSize: 28,
          fontWeight: 700,
          border: 'none',
          cursor: 'pointer',
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(76,175,80,0.4)',
          lineHeight: 1,
        }}
        title="Add custom drill"
      >
        +
      </button>

      {/* Timer bar */}
      <TimerBar
        timer={timer}
        fallbackScheduleIds={todaySchedule}
        drillsById={drillsById}
        onUpdate={setTimer}
        onClear={() => setTimer(null)}
      />
    </div>
  );
}
