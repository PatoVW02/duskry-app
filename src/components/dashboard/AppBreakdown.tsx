import { useActivityStore } from '../../stores/useActivityStore';
import { formatDuration } from '../../lib/utils';

export function AppBreakdown() {
  const activities = useActivityStore((s) => s.activities);

  const appTotals: Record<string, number> = {};
  for (const a of activities) {
    appTotals[a.app_name] = (appTotals[a.app_name] ?? 0) + (a.duration_s ?? 0);
  }
  const sorted = Object.entries(appTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const totalSecs = sorted.reduce((sum, [, s]) => sum + s, 0) || 1;

  return (
    <div className="glass-card" style={{ padding: '14px 18px' }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.55)', marginBottom: 12 }}>
        Top apps
      </div>
      {sorted.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', textAlign: 'center', padding: '16px 0' }}>
          No activity recorded yet
        </div>
      ) : (
        sorted.map(([name, secs]) => (
          <div key={name} className="project-row">
            <div className="activity-app-icon">
              {name.charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize: 12.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name}
            </span>
            <div className="project-bar-bg" style={{ maxWidth: 60 }}>
              <div
                className="project-bar-fill"
                style={{ width: `${(secs / totalSecs) * 100}%`, background: 'rgba(56,189,248,0.7)' }}
              />
            </div>
            <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', minWidth: 36, textAlign: 'right' }}>
              {formatDuration(secs)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
