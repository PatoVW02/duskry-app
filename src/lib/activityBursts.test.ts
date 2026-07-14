import { describe, expect, it } from 'vitest';
import type { Activity } from '../stores/useActivityStore';
import {
  groupActivitiesIntoBursts,
  nextBurstExpansionPreference,
  resolveOpenBurstId,
} from './activityBursts';

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

  it('keeps a burst identity stable when a refresh replaces objects and appends a switch', () => {
    const initialActivities = [
      activity({ id: 11, app_name: 'Figma', started_at: 100, duration_s: 70 }),
      activity({ id: 12, app_name: 'Chrome', started_at: 175, duration_s: 80 }),
    ];
    const initial = groupActivitiesIntoBursts(initialActivities);
    const refreshed = groupActivitiesIntoBursts([
      ...initialActivities.map((item) => ({ ...item, duration_s: (item.duration_s ?? 0) + 10 })),
      activity({ id: 13, app_name: 'Slack', started_at: 260, duration_s: 45 }),
    ]);

    expect(initial[0].id).toBe('burst-11');
    expect(refreshed[0].id).toBe(initial[0].id);
    expect(refreshed[0].activityIds).toEqual([11, 12, 13]);
  });

  it('uses the activity id as a deterministic tie-breaker for a burst anchor', () => {
    const first = groupActivitiesIntoBursts([
      activity({ id: 22, app_name: 'Chrome', started_at: 100 }),
      activity({ id: 21, app_name: 'Figma', started_at: 100 }),
    ]);
    const refreshed = groupActivitiesIntoBursts([
      activity({ id: 21, app_name: 'Figma', started_at: 100 }),
      activity({ id: 22, app_name: 'Chrome', started_at: 100 }),
    ]);

    expect(first[0].id).toBe('burst-21');
    expect(refreshed[0].id).toBe(first[0].id);
  });
});

describe('Today burst expansion preference', () => {
  it('retains an explicitly opened burst when the default changes', () => {
    expect(resolveOpenBurstId('burst-4', 'burst-9')).toBe('burst-4');
  });

  it('retains an explicit close when refreshed bursts provide a new default', () => {
    expect(resolveOpenBurstId(false, 'burst-9')).toBeUndefined();
    expect(nextBurstExpansionPreference('burst-9', 'burst-9')).toBe(false);
  });

  it('uses the default only until the user makes an explicit choice', () => {
    expect(resolveOpenBurstId(null, 'burst-9')).toBe('burst-9');
    expect(nextBurstExpansionPreference(undefined, 'burst-4')).toBe('burst-4');
  });
});
