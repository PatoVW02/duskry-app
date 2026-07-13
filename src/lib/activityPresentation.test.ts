import { describe, expect, it } from 'vitest';
import { normalizeTimelineActivities } from './activityPresentation';
import type { Activity } from '../stores/useActivityStore';

const item = (id: number, app: string, start: number, duration: number): Activity => ({
  id, app_name: app, window_title: null, file_path: null, domain: null,
  started_at: start, ended_at: start + duration, duration_s: duration,
  project_id: null, source: null,
});

describe('normalizeTimelineActivities', () => {
  it('collapses adjacent A-B-A switches without mutating raw data', () => {
    const raw = [item(1, 'A', 100, 5), item(2, 'B', 105, 6), item(3, 'A', 111, 4)];
    expect(normalizeTimelineActivities(raw)[0]).toMatchObject({ app_name: 'Quick switches', started_at: 100, ended_at: 115 });
    expect(raw[0].app_name).toBe('A');
  });

  it('keeps an isolated short activity and chronological order', () => {
    const normalized = normalizeTimelineActivities([item(2, 'Long', 200, 30), item(1, 'Short', 100, 5)]);
    expect(normalized.map((activity) => activity.app_name)).toEqual(['Short', 'Long']);
  });
});
