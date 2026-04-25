import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isToday, startOfDay, format, fromUnixTime } from 'date-fns';
import { useActivityStore, type Activity } from '../stores/useActivityStore';
import { useProjectStore, type Project } from '../stores/useProjectStore';
import { useLicenseStore, isPro } from '../stores/useLicenseStore';
import { formatDuration } from '../lib/utils';
import { CalendarDays } from 'lucide-react';

const HOUR_HEIGHT = 60; // px per hour
const GUTTER      = 54; // px width for hour labels

function formatHour(h: number): string {
  if (h === 0)  return '12am';
  if (h < 12)   return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

interface TPos { x: number; y: number; }

function Tooltip({ activity, project, pos }: { activity: Activity; project?: Project; pos: TPos }) {
  const startStr = format(fromUnixTime(activity.started_at), 'HH:mm');
  const endStr   = activity.ended_at ? format(fromUnixTime(activity.ended_at), 'HH:mm') : 'ongoing';
  const left     = Math.min(pos.x, window.innerWidth - 280);

  return createPortal(
    <div style={{
      position: 'fixed',
      left,
      top: pos.y - 12,
      transform: 'translateY(-100%)',
      zIndex: 2000,
      pointerEvents: 'none',
      minWidth: 190,
      maxWidth: 264,
      background: 'rgba(8, 22, 17, 0.96)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      border: '0.5px solid rgba(255,255,255,0.14)',
      borderRadius: 10,
      boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
      padding: '10px 13px',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.90)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {activity.app_name}
      </div>
      {activity.window_title && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activity.window_title}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', fontVariantNumeric: 'tabular-nums' }}>
          {startStr} – {endStr}
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(45,212,191,0.85)' }}>
          {formatDuration(activity.duration_s ?? 0)}
        </span>
      </div>
      {project && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, paddingTop: 6, borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: project.color, flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)' }}>{project.name}</span>
        </div>
      )}
    </div>,
    document.body
  );
}

export function TimelinePage({ onUpgrade }: { onUpgrade: () => void }) {
  const tier = useLicenseStore((s) => s.tier);

  if (!isPro(tier)) {
    return (
      <div className="glass-card" style={{ padding: '40px', textAlign: 'center' }}>
        <CalendarDays size={30} strokeWidth={1.7} style={{ color: 'rgba(45,212,191,0.78)', margin: '0 auto 16px' }} />
        <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>Full timeline is a Pro feature</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
          Upgrade to Pro to see a full day-by-day timeline, navigate past days, and explore your complete activity history.
        </div>
        <button
          className="btn-primary"
          style={{ maxWidth: 200, margin: '0 auto' }}
          onClick={onUpgrade}
        >
          Upgrade to Pro →
        </button>
      </div>
    );
  }

  return <TimelineContent />;
}

function TimelineContent() {
  const activities   = useActivityStore((s) => s.activities);
  const fetchForDate = useActivityStore((s) => s.fetchForDate);
  const viewDate     = useActivityStore((s) => s.viewDate);
  const projects     = useProjectStore((s) => s.projects);

  const scrollRef = useRef<HTMLDivElement>(null);

  const [hovered, setHovered] = useState<Activity | null>(null);
  const [tipPos,  setTipPos]  = useState<TPos>({ x: 0, y: 0 });
  const [nowY,    setNowY]    = useState<number | null>(null);

  const dayStart = startOfDay(viewDate).getTime() / 1000;
  const tsToY    = (ts: number) => ((ts - dayStart) / 3600) * HOUR_HEIGHT;

  // Fetch data when viewDate changes (Timeline page manages its own fetching)
  useEffect(() => {
    fetchForDate(viewDate);
    if (!isToday(viewDate)) return;
    const id = setInterval(() => fetchForDate(viewDate), 10_000);
    return () => clearInterval(id);
  }, [viewDate]);

  // Update the now-line every minute
  useEffect(() => {
    const update = () => {
      setNowY(isToday(viewDate) ? tsToY(Date.now() / 1000) : null);
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [viewDate]);

  // Scroll to a sensible starting position when viewDate changes
  useEffect(() => {
    if (!scrollRef.current) return;
    const targetHour = isToday(viewDate)
      ? Math.max(0, new Date().getHours() - 3)
      : 8;
    scrollRef.current.scrollTop = targetHour * HOUR_HEIGHT;
  }, [viewDate]);

  const hours  = Array.from({ length: 24 }, (_, i) => i);
  const blocks = activities.filter((a) => a.ended_at !== null && a.duration_s !== null);
  const totalSecs = activities.reduce((sum, a) => sum + (a.duration_s ?? 0), 0);

  return (
    <div
      className="glass-card"
      style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        padding: '14px 18px 12px',
        borderBottom: '0.5px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.55)' }}>
          Daily timeline
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(45,212,191,0.80)' }}>
          {formatDuration(totalSecs)} tracked
        </span>
      </div>

      {/* ── Scrollable grid ───────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        style={{ overflowY: 'auto', flex: 1 }}
      >
        <div style={{ position: 'relative', height: 24 * HOUR_HEIGHT }}>

          {/* Hour rows (grid lines + labels) */}
          {hours.map((h) => (
            <div
              key={h}
              style={{
                position: 'absolute',
                top: h * HOUR_HEIGHT,
                left: 0,
                right: 0,
                height: HOUR_HEIGHT,
                display: 'flex',
                alignItems: 'flex-start',
              }}
            >
              <div style={{
                width: GUTTER, flexShrink: 0,
                paddingTop: 4, paddingRight: 14,
                textAlign: 'right',
                fontSize: 10.5,
                color: 'rgba(255,255,255,0.22)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {formatHour(h)}
              </div>
              <div style={{ flex: 1, borderTop: '0.5px solid rgba(255,255,255,0.05)', height: '100%' }} />
            </div>
          ))}

          {/* Activity blocks */}
          {blocks.map((a) => {
            const top    = Math.max(0, tsToY(a.started_at));
            const height = Math.max(22, (a.duration_s! / 3600) * HOUR_HEIGHT);
            const proj   = projects.find((p) => p.id === a.project_id);
            const color  = proj?.color ?? 'rgba(255,255,255,0.18)';

            return (
              <div
                key={a.id}
                onMouseEnter={(e) => { setHovered(a); setTipPos({ x: e.clientX, y: e.clientY }); }}
                onMouseMove={(e)  => setTipPos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={()  => setHovered(null)}
                style={{
                  position: 'absolute',
                  top,
                  left: GUTTER + 8,
                  right: 14,
                  height,
                  background: color,
                  opacity: 0.82,
                  borderRadius: 5,
                  cursor: 'default',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  padding: height > 26 ? '0 8px' : undefined,
                  transition: 'opacity 0.12s',
                }}
              >
                {height > 22 && (
                  <span style={{
                    fontSize: 11, fontWeight: 500,
                    color: 'rgba(255,255,255,0.88)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {a.app_name}
                  </span>
                )}
                {height > 42 && a.window_title && (
                  <span style={{
                    fontSize: 10,
                    color: 'rgba(255,255,255,0.52)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    marginTop: 1,
                  }}>
                    {a.window_title}
                  </span>
                )}
              </div>
            );
          })}

          {/* Current-time indicator */}
          {nowY !== null && (
            <div style={{
              position: 'absolute',
              top: nowY,
              left: GUTTER - 4,
              right: 0,
              height: 1.5,
              background: 'rgba(45,212,191,0.75)',
              pointerEvents: 'none',
            }}>
              <div style={{
                position: 'absolute',
                left: 0, top: '50%',
                transform: 'translateY(-50%)',
                width: 8, height: 8,
                borderRadius: '50%',
                background: 'rgba(45,212,191,0.95)',
              }} />
            </div>
          )}
        </div>
      </div>

      {/* Tooltip via portal */}
      {hovered && (
        <Tooltip
          activity={hovered}
          project={projects.find((p) => p.id === hovered.project_id)}
          pos={tipPos}
        />
      )}
    </div>
  );
}
