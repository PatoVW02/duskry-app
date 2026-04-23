import { useActivityStore } from '../../stores/useActivityStore';
import { formatDuration } from '../../lib/utils';

export function StatsRow() {
  const activities = useActivityStore((s) => s.activities);
  const totalSecs = useActivityStore((s) => s.totalTrackedSecs)();
  const deepWorkSecs = activities
    .filter((a) => a.project_id !== null && (a.duration_s ?? 0) >= 300)
    .reduce((sum, a) => sum + (a.duration_s ?? 0), 0);
  const unassignedCount = activities.filter((a) => !a.project_id).length;

  return (
    <div className="stats-row">
      <StatCard label="Tracked today" value={formatDuration(totalSecs)} accent="rgba(45,212,191,0.8)" />
      <StatCard label="Deep work" value={formatDuration(deepWorkSecs)} accent="rgba(56,189,248,0.8)" />
      <StatCard label="Unassigned" value={String(unassignedCount)} accent="rgba(251,191,36,0.8)" />
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="stat-card glass-stat">
      <div className="stat-value" style={{ color: accent }}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
