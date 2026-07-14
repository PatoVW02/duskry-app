import { describe, expect, it } from 'vitest';
import type { Activity } from '../stores/useActivityStore';
import { groupActivitiesIntoBursts } from './activityBursts';

function activity(overrides: Partial<Activity> & Pick<Activity, 'id' | 'app_name' | 'started_at'>): Activity {
  return {
    window_title: null,
    file_path: null,
    domain: null,
    ended_at: overrides.started_at + (overrides.duration_s ?? 60),
    duration_s: 60,
    project_id: null,
    source: 'tracker',
    ...overrides,
  };
}

describe('groupActivitiesIntoBursts', () => {
  it('groups rapid app switching into one compact block', () => {
    const bursts = groupActivitiesIntoBursts([
      activity({ id: 1, app_name: 'Figma', started_at: 100, duration_s: 70 }),
      activity({ id: 2, app_name: 'Chrome', started_at: 175, duration_s: 80 }),
      activity({ id: 3, app_name: 'Figma', started_at: 260, duration_s: 50 }),
    ]);

    expect(bursts).toHaveLength(1);
    expect(bursts[0].appSummaries.map((summary) => summary.appName)).toEqual(['Figma', 'Chrome']);
    expect(bursts[0].switchCount).toBe(2);
    expect(bursts[0].needsAttention).toBe(true);
  });

  it('does not merge activities assigned to conflicting projects', () => {
    const bursts = groupActivitiesIntoBursts([
      activity({ id: 1, app_name: 'Figma', started_at: 100, project_id: 4 }),
      activity({ id: 2, app_name: 'Chrome', started_at: 165, project_id: 9 }),
    ]);

    expect(bursts).toHaveLength(2);
  });

  it('suggests the project previously used for matching apps', () => {
    const bursts = groupActivitiesIntoBursts([
      activity({ id: 1, app_name: 'Chrome', started_at: 100, project_id: 7, duration_s: 600 }),
      activity({ id: 2, app_name: 'Slack', started_at: 1_000, duration_s: 120 }),
      activity({ id: 3, app_name: 'Chrome', started_at: 1_130, duration_s: 90 }),
    ]);

    expect(bursts[1].suggestedProjectId).toBe(7);
    expect(bursts[1].suggestionReason).toContain('Chrome');
  });
});
