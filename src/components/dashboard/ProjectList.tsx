import { useActivityStore } from '../../stores/useActivityStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { formatDuration } from '../../lib/utils';

interface ProjectListProps {
  selectedProjectId?: number | null;
  onSelectProject?: (projectId: number) => void;
}

export function ProjectList({ selectedProjectId = null, onSelectProject }: ProjectListProps) {
  const activities = useActivityStore((s) => s.activities);
  const projects = useProjectStore((s) => s.projects);

  const totalSecs = activities.reduce((sum, a) => sum + (a.duration_s ?? 0), 0) || 1;

  const projectTotals = projects.map((p) => {
    const secs = activities
      .filter((a) => a.project_id === p.id)
      .reduce((sum, a) => sum + (a.duration_s ?? 0), 0);
    return { ...p, secs };
  }).filter((p) => p.secs > 0).sort((a, b) => b.secs - a.secs);

  return (
    <div className="glass-card" style={{ padding: '14px 18px' }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>
        Projects
      </div>
      {projectTotals.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', textAlign: 'center', padding: '16px 0' }}>
          No activity assigned yet
        </div>
      ) : (
        projectTotals.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`project-row project-row-button${selectedProjectId === p.id ? ' is-selected' : ''}`}
            onClick={() => p.id && onSelectProject?.(p.id)}
            title={`Highlight ${p.name} activities in the timeline`}
          >
            <span className="project-dot" style={{ background: p.color }} />
            <span style={{ fontSize: 12.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.name}
            </span>
            <div className="project-bar-bg" style={{ maxWidth: 80 }}>
              <div
                className="project-bar-fill"
                style={{ width: `${(p.secs / totalSecs) * 100}%`, background: p.color }}
              />
            </div>
            <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', minWidth: 36, textAlign: 'right' }}>
              {formatDuration(p.secs)}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
