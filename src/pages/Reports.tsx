import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  subWeeks, subMonths, subDays, eachDayOfInterval, format,
  startOfDay, endOfDay,
} from 'date-fns';
import { useProjectStore } from '../stores/useProjectStore';
import { useLicenseStore, isPro } from '../stores/useLicenseStore';
import { openCheckout } from '../lib/checkout';
import { formatDuration, isDeepWorkActivity } from '../lib/utils';
import type { Activity } from '../stores/useActivityStore';

// ── Range helpers ──────────────────────────────────────────────────────────

type RangeKey = 'this-week' | 'last-week' | 'this-month' | 'last-month';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'this-week',  label: 'This Week'  },
  { key: 'last-week',  label: 'Last Week'  },
  { key: 'this-month', label: 'This Month' },
  { key: 'last-month', label: 'Last Month' },
];

function getRangeBounds(key: RangeKey): { from: Date; to: Date } {
  const now = new Date();
  switch (key) {
    case 'this-week':
      return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    case 'last-week': {
      const lw = subWeeks(now, 1);
      return { from: startOfWeek(lw, { weekStartsOn: 1 }), to: endOfWeek(lw, { weekStartsOn: 1 }) };
    }
    case 'this-month':
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case 'last-month': {
      const lm = subMonths(now, 1);
      return { from: startOfMonth(lm), to: endOfMonth(lm) };
    }
  }
}

function getPrevRangeBounds(key: RangeKey): { from: Date; to: Date } {
  const now = new Date();
  switch (key) {
    case 'this-week': {
      const lw = subWeeks(now, 1);
      return { from: startOfWeek(lw, { weekStartsOn: 1 }), to: endOfWeek(lw, { weekStartsOn: 1 }) };
    }
    case 'last-week': {
      const llw = subWeeks(now, 2);
      return { from: startOfWeek(llw, { weekStartsOn: 1 }), to: endOfWeek(llw, { weekStartsOn: 1 }) };
    }
    case 'this-month': {
      const lm = subMonths(now, 1);
      return { from: startOfMonth(lm), to: endOfMonth(lm) };
    }
    case 'last-month': {
      const llm = subMonths(now, 2);
      return { from: startOfMonth(llm), to: endOfMonth(llm) };
    }
  }
}

// ── Tooltip ───────────────────────────────────────────────────────────────

interface TooltipState { text: string; x: number; y: number }

function ChartTooltip({ tip }: { tip: TooltipState | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [finalPos, setFinalPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!tip || !ref.current) { setFinalPos(null); return; }
    const { width, height } = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    let left = tip.x + 14;
    let top  = tip.y - 32;
    if (left + width > vw - margin) left = tip.x - width - 14;
    if (left < margin) left = margin;
    if (top < margin) top = tip.y + 14;
    if (top + height > vh - margin) top = tip.y - height - 8;
    setFinalPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: finalPos?.left ?? tip.x + 14,
        top: finalPos?.top ?? tip.y - 32,
        visibility: finalPos ? 'visible' : 'hidden',
        pointerEvents: 'none',
        zIndex: 9999,
        background: 'rgba(8,18,14,0.93)',
        border: '0.5px solid rgba(255,255,255,0.13)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderRadius: 7,
        padding: '5px 10px',
        fontSize: 11.5,
        color: 'rgba(255,255,255,0.85)',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      }}
    >
      {tip.text}
    </div>
  );
}

// ── Heat color ─────────────────────────────────────────────────────────────

function heatColor(secs: number): string {
  if (secs === 0)   return 'rgba(255,255,255,0.05)';
  if (secs < 1800)  return 'rgba(14,180,160,0.30)';
  if (secs < 7200)  return 'rgba(14,180,160,0.55)';
  if (secs < 14400) return 'rgba(14,180,160,0.78)';
  return 'rgba(14,180,160,0.96)';
}

// ── Delta badge ────────────────────────────────────────────────────────────

function Delta({ curr, prev }: { curr: number; prev: number }) {
  if (prev === 0) return null;
  const pct = ((curr - prev) / prev) * 100;
  const up  = pct >= 0;
  return (
    <span style={{ fontSize: 10, color: up ? 'rgba(45,212,191,0.80)' : 'rgba(251,113,133,0.80)', marginLeft: 5, fontVariantNumeric: 'tabular-nums' }}>
      {up ? '↑' : '↓'}{Math.abs(pct).toFixed(0)}%
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function Reports() {
  const tier         = useLicenseStore((s) => s.tier);
  const selectedPlan = useLicenseStore((s) => s.selectedPlan);
  const projects     = useProjectStore((s) => s.projects);

  const [range, setRange]           = useState<RangeKey>('this-week');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [prevActs, setPrevActs]     = useState<Activity[]>([]);
  const [heatActs, setHeatActs]     = useState<Activity[]>([]);
  const [loading, setLoading]       = useState(false);
  const [exportMsg, setExportMsg]   = useState<string | null>(null);
  const [tip, setTip]               = useState<TooltipState | null>(null);

  const showTip = (e: React.MouseEvent, text: string) => setTip({ text, x: e.clientX, y: e.clientY });
  const moveTip = (e: React.MouseEvent) => setTip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : null);
  const hideTip = () => setTip(null);

  useEffect(() => {
    const { from, to }         = getRangeBounds(range);
    const { from: pf, to: pt } = getPrevRangeBounds(range);
    setLoading(true);
    Promise.all([
      invoke<Activity[]>('get_activities_for_date', { fromTs: Math.floor(from.getTime() / 1000), toTs: Math.floor(to.getTime() / 1000) }),
      invoke<Activity[]>('get_activities_for_date', { fromTs: Math.floor(pf.getTime() / 1000),   toTs: Math.floor(pt.getTime() / 1000) }),
    ]).then(([curr, prev]) => { setActivities(curr); setPrevActs(prev); }).finally(() => setLoading(false));
  }, [range]);

  useEffect(() => {
    invoke<Activity[]>('get_activities_for_date', {
      fromTs: Math.floor(startOfDay(subDays(new Date(), 83)).getTime() / 1000),
      toTs:   Math.floor(endOfDay(new Date()).getTime() / 1000),
    }).then(setHeatActs);
  }, []);

  // Paywall
  if (!isPro(tier)) {
    const upgradeKey = selectedPlan === 'proPlus' ? 'proplus_monthly' : 'pro_monthly';
    return (
      <div className="glass-card" style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 16 }}>📊</div>
        <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>Reports are available on Pro</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
          Upgrade to Pro to access weekly and monthly reports, export your data as CSV or JSON, and see in-depth breakdowns.
        </div>
        <button className="btn-primary" style={{ maxWidth: 200, margin: '0 auto' }} onClick={() => openCheckout(upgradeKey)}>
          Upgrade to Pro →
        </button>
      </div>
    );
  }

  // ── Derived data ───────────────────────────────────────────────────────────

  const { from, to } = getRangeBounds(range);
  const today        = new Date();
  const effectiveTo  = to > today ? today : to;
  const days         = eachDayOfInterval({ start: from, end: effectiveTo });
  const isWeekly     = days.length <= 7;

  const totalSecs         = activities.reduce((s, a) => s + (a.duration_s ?? 0), 0);
  const prevTotalSecs     = prevActs.reduce((s, a) => s + (a.duration_s ?? 0), 0);
  const deepWorkSecs      = activities.filter(isDeepWorkActivity).reduce((s, a) => s + (a.duration_s ?? 0), 0);
  const prevDeepWorkSecs  = prevActs.filter(isDeepWorkActivity).reduce((s, a) => s + (a.duration_s ?? 0), 0);

  const secsPerDay: Record<string, number> = {};
  for (const a of activities) {
    if (!a.duration_s) continue;
    const key = format(new Date(a.started_at * 1000), 'yyyy-MM-dd');
    secsPerDay[key] = (secsPerDay[key] ?? 0) + a.duration_s;
  }
  const activeDays     = Object.keys(secsPerDay).length;
  const prevSecsPerDay: Record<string, number> = {};
  for (const a of prevActs) {
    if (!a.duration_s) continue;
    const key = format(new Date(a.started_at * 1000), 'yyyy-MM-dd');
    prevSecsPerDay[key] = (prevSecsPerDay[key] ?? 0) + a.duration_s;
  }
  const prevActiveDays = Object.keys(prevSecsPerDay).length;
  const avgDaySecs     = activeDays > 0 ? totalSecs / activeDays : 0;
  const prevAvgDaySecs = prevActiveDays > 0 ? prevTotalSecs / prevActiveDays : 0;

  // Project map
  const projectMap: Record<number, { name: string; color: string }> = {};
  for (const p of projects) projectMap[p.id] = { name: p.name, color: p.color };

  // ── Stacked bars ──────────────────────────────────────────────────────────

  const stackedDays = days.map((d) => {
    const key     = format(d, 'yyyy-MM-dd');
    const dayActs = activities.filter((a) => format(new Date(a.started_at * 1000), 'yyyy-MM-dd') === key);
    const byProj: Record<string, number> = {};
    let unassigned = 0;
    for (const a of dayActs) {
      if (!a.duration_s) continue;
      if (a.project_id && projectMap[a.project_id]) {
        byProj[String(a.project_id)] = (byProj[String(a.project_id)] ?? 0) + a.duration_s;
      } else {
        unassigned += a.duration_s;
      }
    }
    const segments = Object.entries(byProj)
      .map(([id, secs]) => ({ id, name: projectMap[Number(id)].name, color: projectMap[Number(id)].color, secs }))
      .sort((a, b) => b.secs - a.secs);
    if (unassigned > 0) segments.push({ id: 'u', name: 'Unassigned', color: 'rgba(255,255,255,0.12)', secs: unassigned });
    const total = segments.reduce((s, seg) => s + seg.secs, 0);
    return { key, date: d, total, segments };
  });
  const maxStackSecs = Math.max(...stackedDays.map((d) => d.total), 1);

  // ── Hourly distribution ───────────────────────────────────────────────────

  const hourMap = Array(24).fill(0) as number[];
  for (const a of activities) {
    if (!a.duration_s) continue;
    hourMap[new Date(a.started_at * 1000).getHours()] += a.duration_s;
  }
  const workHours   = Array.from({ length: 18 }, (_, i) => i + 5); // 5 am – 10 pm
  const maxHourSecs = Math.max(...workHours.map((h) => hourMap[h]), 1);

  // ── Day of week ───────────────────────────────────────────────────────────

  const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dowSecs    = Array(7).fill(0) as number[];
  const dowCount   = Array(7).fill(0) as number[];
  for (const d of days) {
    const secs = secsPerDay[format(d, 'yyyy-MM-dd')] ?? 0;
    dowSecs[d.getDay()]  += secs;
    dowCount[d.getDay()] += 1;
  }
  const dowAvg    = dowSecs.map((s, i) => (dowCount[i] > 0 ? Math.round(s / dowCount[i]) : 0));
  const maxDowAvg = Math.max(...dowAvg, 1);

  // ── Heatmap ───────────────────────────────────────────────────────────────

  const heatMap: Record<string, number> = {};
  for (const a of heatActs) {
    if (!a.duration_s) continue;
    const key = format(new Date(a.started_at * 1000), 'yyyy-MM-dd');
    heatMap[key] = (heatMap[key] ?? 0) + a.duration_s;
  }
  const heatStart = startOfWeek(subDays(today, 83), { weekStartsOn: 1 });
  const heatDays  = eachDayOfInterval({ start: heatStart, end: today });
  const heatWeeks: { date: string; secs: number }[][] = [];
  for (let i = 0; i < heatDays.length; i += 7) {
    const week = heatDays.slice(i, i + 7).map((d) => ({
      date: format(d, 'yyyy-MM-dd'),
      secs: heatMap[format(d, 'yyyy-MM-dd')] ?? 0,
    }));
    while (week.length < 7) week.push({ date: '', secs: 0 });
    heatWeeks.push(week);
  }

  // ── Export ────────────────────────────────────────────────────────────────

  const handleExport = async (type: 'csv' | 'json') => {
    setExportMsg(null);
    const slug    = RANGES.find((r) => r.key === range)!.label.toLowerCase().replace(' ', '-');
    const dateStr = format(today, 'yyyy-MM-dd');
    try {
      let content: string;
      let filename: string;
      if (type === 'csv') {
        const rows = activities.map((a) => [
          format(new Date(a.started_at * 1000), 'yyyy-MM-dd'),
          `"${a.app_name.replace(/"/g, '""')}"`,
          `"${(a.window_title ?? '').replace(/"/g, '""')}"`,
          new Date(a.started_at * 1000).toISOString(),
          a.ended_at ? new Date(a.ended_at * 1000).toISOString() : '',
          a.duration_s ? (a.duration_s / 60).toFixed(1) : '',
          `"${a.project_id && projectMap[a.project_id] ? projectMap[a.project_id].name : 'Unassigned'}"`,
        ].join(','));
        content  = ['Date,App,Window Title,Started At,Ended At,Duration (min),Project', ...rows].join('\n');
        filename = `duskry-${slug}-${dateStr}.csv`;
      } else {
        content  = JSON.stringify(activities.map((a) => ({
          date:        format(new Date(a.started_at * 1000), 'yyyy-MM-dd'),
          app:         a.app_name,
          windowTitle: a.window_title ?? null,
          startedAt:   a.started_at,
          endedAt:     a.ended_at ?? null,
          durationMin: a.duration_s ? +(a.duration_s / 60).toFixed(1) : null,
          project:     a.project_id && projectMap[a.project_id] ? projectMap[a.project_id].name : null,
        })), null, 2);
        filename = `duskry-${slug}-${dateStr}.json`;
      }
      const path = await invoke<string>('save_file', { content, filename });
      const parts = path.split('/');
      setExportMsg(`Saved: ${parts[parts.length - 1]}`);
    } catch {
      setExportMsg('Export failed');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Range selector + Export */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                style={{
                  padding: '5px 12px', borderRadius: 7, fontSize: 12, border: 'none', cursor: 'pointer',
                  fontWeight: range === r.key ? 500 : 400,
                  background: range === r.key ? 'rgba(45,212,191,0.18)' : 'rgba(255,255,255,0.06)',
                  color: range === r.key ? 'rgba(45,212,191,0.90)' : 'rgba(255,255,255,0.40)',
                  transition: 'all 0.15s',
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {exportMsg && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{exportMsg}</span>}
            <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => handleExport('csv')}>CSV</button>
            <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => handleExport('json')}>JSON</button>
          </div>
        </div>

        {/* Stats with period comparison */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {[
            { label: 'Total tracked', value: formatDuration(totalSecs),               curr: totalSecs,    prev: prevTotalSecs,    accent: 'rgba(45,212,191,0.85)'  },
            { label: 'Deep work',     value: formatDuration(deepWorkSecs),            curr: deepWorkSecs, prev: prevDeepWorkSecs, accent: 'rgba(56,189,248,0.85)'  },
            { label: 'Active days',   value: String(activeDays),                      curr: activeDays,   prev: prevActiveDays,   accent: 'rgba(167,139,250,0.85)' },
            { label: 'Avg / day',     value: formatDuration(Math.round(avgDaySecs)),  curr: avgDaySecs,   prev: prevAvgDaySecs,   accent: 'rgba(251,191,36,0.85)'  },
          ].map(({ label, value, curr, prev, accent }) => (
            <div key={label} className="glass-stat" style={{ padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 20, fontWeight: 600, color: accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</span>
                <Delta curr={curr} prev={prev} />
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', marginTop: 3 }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Stacked project bar chart */}
        <div className="glass-card" style={{ padding: '16px 18px' }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>
            Project composition · per day
          </div>
          {loading ? (
            <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'rgba(255,255,255,0.22)' }}>
              Loading…
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: isWeekly ? 8 : 3, height: 120 }}>
                {stackedDays.map(({ key, date, total, segments }) => {
                  const heightPct = (total / maxStackSecs) * 100;
                  return (
                    <div key={key} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
                      <div
                        style={{
                          width: '100%',
                          height: total > 0 ? `${Math.max(heightPct, 2)}%` : '2px',
                          display: 'flex',
                          flexDirection: 'column-reverse',
                          borderRadius: '3px 3px 0 0',
                          overflow: 'hidden',
                          cursor: 'default',
                        }}
                        onMouseEnter={(e) => showTip(e, `${format(date, 'EEE, MMM d')}  ${total > 0 ? formatDuration(total) : 'No activity'}`)}
                        onMouseMove={moveTip}
                        onMouseLeave={hideTip}
                      >
                        {total === 0 ? (
                          <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)' }} />
                        ) : (
                          segments.map((seg) => (
                            <div
                              key={seg.id}
                              style={{ flex: seg.secs, background: seg.color, minHeight: 2 }}
                              onMouseEnter={(e) => { e.stopPropagation(); showTip(e, `${format(date, 'MMM d')} · ${seg.name}  ${formatDuration(seg.secs)}`); }}
                              onMouseMove={moveTip}
                              onMouseLeave={(e) => { e.stopPropagation(); hideTip(); }}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* X-axis labels */}
              <div style={{ display: 'flex', gap: isWeekly ? 8 : 3 }}>
                {stackedDays.map(({ key, date }, i) => {
                  const show = isWeekly || i === 0 || (i + 1) % 7 === 0;
                  return (
                    <div key={key} style={{ flex: 1, minWidth: 0, fontSize: 9, color: 'rgba(255,255,255,0.25)', textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {show ? (isWeekly ? format(date, 'EEE') : format(date, 'd')) : ''}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* Project legend */}
          {projects.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 10 }}>
              {projects.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.40)' }}>{p.name}</span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />
                <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.40)' }}>Unassigned</span>
              </div>
            </div>
          )}
        </div>

        {/* Hourly pattern + Day of week + Heatmap */}
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 12 }}>

          {/* Hourly distribution */}
          <div className="glass-card" style={{ padding: '16px 18px' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>
              When you work
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3.5 }}>
              {workHours.map((h) => {
                const secs  = hourMap[h];
                const pct   = (secs / maxHourSecs) * 100;
                const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
                return (
                  <div
                    key={h}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'default' }}
                    onMouseEnter={(e) => showTip(e, `${label}  ${secs > 0 ? formatDuration(secs) : 'No activity'}`)}
                    onMouseMove={moveTip}
                    onMouseLeave={hideTip}
                  >
                    <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.28)', width: 28, textAlign: 'right', flexShrink: 0 }}>{label}</span>
                    <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
                      {secs > 0 && (
                        <div style={{
                          width: `${pct}%`,
                          height: '100%',
                          borderRadius: 2,
                          background: 'linear-gradient(to right, rgba(167,139,250,0.85), rgba(167,139,250,0.45))',
                          transition: 'width 0.4s ease',
                        }} />
                      )}
                    </div>
                    <span style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.28)', width: 28, flexShrink: 0 }}>
                      {secs > 0 ? formatDuration(secs) : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right column: Hours by day + Heatmap stacked */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignSelf: 'stretch' }}>

            {/* Day of week */}
            <div className="glass-card" style={{ padding: '16px 18px' }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>
                {isWeekly ? 'Hours by day' : 'Avg per day of week'}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
                {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
                  const secs = dowAvg[dow];
                  const pct  = (secs / maxDowAvg) * 100;
                  return (
                    <div key={dow} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                      <div
                        style={{
                          width: '100%',
                          height: secs > 0 ? `${Math.max(pct, 2)}%` : '2px',
                          background: secs > 0
                            ? 'linear-gradient(to top, rgba(251,191,36,0.80), rgba(251,191,36,0.38))'
                            : 'rgba(255,255,255,0.04)',
                          borderRadius: '2px 2px 0 0',
                          transition: 'height 0.4s ease',
                          cursor: 'default',
                        }}
                        onMouseEnter={(e) => showTip(e, `${DOW_LABELS[dow]}  ${secs > 0 ? formatDuration(secs) : 'No activity'}`)}
                        onMouseMove={moveTip}
                        onMouseLeave={hideTip}
                      />
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
                  <div key={dow} style={{ flex: 1, fontSize: 9, color: 'rgba(255,255,255,0.25)', textAlign: 'center' }}>
                    {DOW_LABELS[dow].charAt(0)}
                  </div>
                ))}
              </div>
            </div>

            {/* Activity heatmap */}
            <div className="glass-card" style={{ padding: '16px 18px', flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>
                Activity heatmap · last 12 weeks
              </div>
              <div style={{ display: 'flex', gap: 3, width: '100%' }}>
                {heatWeeks.map((week, wi) => (
                  <div key={wi} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {week.map((cell, di) => (
                      <div
                        key={di}
                        onMouseEnter={cell.date ? (e) => showTip(e, `${format(new Date(cell.date), 'EEE, MMM d')}  ${cell.secs > 0 ? formatDuration(cell.secs) : 'No activity'}`) : undefined}
                        onMouseMove={cell.date ? moveTip : undefined}
                        onMouseLeave={cell.date ? hideTip : undefined}
                        style={{
                          width: '100%',
                          aspectRatio: '1',
                          borderRadius: 2,
                          background: cell.date ? heatColor(cell.secs) : 'transparent',
                          cursor: cell.date ? 'default' : undefined,
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 10 }}>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginRight: 2 }}>Less</span>
                {[0, 900, 1800, 7200, 14400].map((v) => (
                  <div key={v} style={{ width: 10, height: 10, borderRadius: 2, background: heatColor(v) }} />
                ))}
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginLeft: 2 }}>More</span>
              </div>
            </div>

          </div>
        </div>

      </div>
      <ChartTooltip tip={tip} />
    </>
  );
}
