import type { Activity } from '../stores/useActivityStore';

const QUICK_SWITCH_SECONDS = 15;

/** Combines adjacent short switches for display without changing raw records. */
export function normalizeTimelineActivities(activities: Activity[]): Activity[] {
  const sorted = activities
    .filter((activity) => activity.ended_at !== null && activity.duration_s !== null)
    .slice()
    .sort((a, b) => a.started_at - b.started_at);
  const result: Activity[] = [];

  for (let index = 0; index < sorted.length;) {
    const first = sorted[index];
    if ((first.duration_s ?? Infinity) > QUICK_SWITCH_SECONDS) {
      result.push(first);
      index += 1;
      continue;
    }
    const run = [first];
    let cursor = index + 1;
    while (cursor < sorted.length) {
      const previous = run[run.length - 1];
      const next = sorted[cursor];
      const gap = next.started_at - (previous.ended_at ?? previous.started_at);
      if ((next.duration_s ?? Infinity) > QUICK_SWITCH_SECONDS || gap > 5) break;
      run.push(next);
      cursor += 1;
    }
    if (run.length < 2) {
      result.push(first);
      index += 1;
      continue;
    }
    const apps = [...new Set(run.map((activity) => activity.app_name))];
    const endedAt = run[run.length - 1].ended_at!;
    result.push({
      ...first,
      id: -first.id,
      app_name: 'Quick switches',
      window_title: `${run.length} switches · ${apps.join(', ')}`,
      ended_at: endedAt,
      duration_s: Math.max(1, endedAt - first.started_at),
      project_id: run.every((activity) => activity.project_id === first.project_id) ? first.project_id : null,
      source: 'presentation',
    });
    index = cursor;
  }
  return result;
}
