import { useState } from 'react';
import { createPortal } from 'react-dom';
import { startOfDay, endOfDay, isToday, format, fromUnixTime } from 'date-fns';
import { useActivityStore, type Activity } from '../../stores/useActivityStore';
import { useProjectStore, type Project } from '../../stores/useProjectStore';
import { formatDuration } from '../../lib/utils';

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
      maxWidth: 260,
      background: 'rgba(8, 22, 17, 0.95)',
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

interface TimelineProps {
  highlightedProjectId?: number | null;
}

export function Timeline({ highlightedProjectId = null }: TimelineProps) {
  const activities = useActivityStore((s) => s.activities);
  const projects   = useProjectStore((s) => s.projects);
  const viewDate   = useActivityStore((s) => s.viewDate);

  const [hovered, setHovered] = useState<Activity | null>(null);
  const [tipPos,  setTipPos]  = useState<TPos>({ x: 0, y: 0 });

  const blocks = activities.filter((a) => a.ended_at !== null && a.duration_s !== null);

  // Clamp the visible range to first activity start → last activity end (with a small pad)
  const PAD = 300; // 5 min padding on each side
  const rangeStart = blocks.length > 0
    ? Math.min(...blocks.map((a) => a.started_at)) - PAD
    : startOfDay(viewDate).getTime() / 1000;
  const rangeEnd = blocks.length > 0
    ? Math.max(...blocks.map((a) => a.ended_at!)) + PAD
    : endOfDay(viewDate).getTime() / 1000;
  const totalSecs = rangeEnd - rangeStart;

  // Tick labels derived from the visible range
  const startLabel = blocks.length > 0 ? format(fromUnixTime(rangeStart + PAD), 'HH:mm') : '12am';
  const endLabel   = isToday(viewDate) ? 'Now'
    : blocks.length > 0 ? format(fromUnixTime(rangeEnd - PAD), 'HH:mm') : '11pm';
  const midTs      = rangeStart + totalSecs / 2;
  const midLabel   = format(fromUnixTime(midTs), 'HH:mm');

  const headerLabel = isToday(viewDate) ? "Today's timeline" : 'Timeline';

  return (
    <div className="tl-wrap glass-card">
      <div className="tl-header">
        <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.60)' }}>{headerLabel}</span>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'rgba(255,255,255,0.30)', flex: 1, marginLeft: 16 }}>
          <span>{startLabel}</span>
          {blocks.length > 1 && <span>{midLabel}</span>}
          <span>{endLabel}</span>
        </div>
      </div>
      <div className="tl-track">
	        {blocks.map((a) => {
	          const left  = Math.max(0, ((a.started_at - rangeStart) / totalSecs) * 100);
	          const width = Math.max(0.15, ((a.duration_s ?? 0) / totalSecs) * 100);
	          const proj = projects.find((p) => p.id === a.project_id);
	          const color = proj?.color ?? 'rgba(255,255,255,0.25)';
	          const isHovered = hovered?.id === a.id;
	          const isProjectMatch = highlightedProjectId !== null && a.project_id === highlightedProjectId;
	          const hasProjectHighlight = highlightedProjectId !== null;
	          const isDimmed = hovered ? !isHovered : hasProjectHighlight && !isProjectMatch;
	          return (
	            <div
	              key={a.id}
	              className="tl-block"
	              style={{
	                left: `${left}%`,
	                width: `${width}%`,
	                background: color,
	                opacity: isDimmed ? 0.2 : 1,
	                zIndex: isHovered ? 4 : isProjectMatch ? 3 : 1,
	                outline: isHovered
	                  ? '2px solid rgba(255,255,255,0.85)'
	                  : isProjectMatch
	                    ? '2px solid rgba(45,212,191,0.72)'
	                    : 'none',
	                outlineOffset: 1,
	                boxShadow: isHovered
	                  ? '0 0 0 4px rgba(45,212,191,0.18), 0 8px 22px rgba(0,0,0,0.28)'
	                  : isProjectMatch
	                    ? '0 0 0 3px rgba(45,212,191,0.14)'
	                    : undefined,
	                transform: isHovered ? 'scaleY(1.35)' : undefined,
	              }}
              onMouseEnter={(e) => { setHovered(a); setTipPos({ x: e.clientX, y: e.clientY }); }}
              onMouseMove={(e) => setTipPos({ x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}
      </div>
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
