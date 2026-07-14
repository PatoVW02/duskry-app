import { describe, expect, it } from 'vitest';
import type { Activity } from '../stores/useActivityStore';
import {
  filterReviewActivities,
  getNeedsReviewActivityIds,
  matchesReviewSearch,
  summarizeAssignment,
} from './reviewActivity';

function activity(
  overrides: Partial<Activity> & Pick<Activity, 'id' | 'app_name' | 'started_at'>,
): Activity {
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

const projects = [
  { id: 7, name: 'Acme Website' },
  { id: 9, name: 'Internal Operations' },
];

describe('review activity filtering', () => {
  it('derives every activity id from a work block that needs attention', () => {
    const activities = [
      activity({ id: 1, app_name: 'Figma', started_at: 100, project_id: 7 }),
      activity({ id: 2, app_name: 'Chrome', started_at: 165 }),
      activity({ id: 3, app_name: 'Terminal', started_at: 1_000, project_id: 9 }),
    ];

    expect([...getNeedsReviewActivityIds(activities)]).toEqual([1, 2]);
    expect(filterReviewActivities(activities, { filter: 'needs-review' }).map(({ id }) => id))
      .toEqual([1, 2]);
  });

  it('filters assigned and unassigned activities without changing their order', () => {
    const activities = [
      activity({ id: 3, app_name: 'Slack', started_at: 300, project_id: 9 }),
      activity({ id: 1, app_name: 'Chrome', started_at: 100 }),
      activity({ id: 2, app_name: 'Figma', started_at: 200, project_id: 7 }),
    ];

    expect(filterReviewActivities(activities, { filter: 'assigned' }).map(({ id }) => id))
      .toEqual([3, 2]);
    expect(filterReviewActivities(activities, { filter: 'unassigned' }).map(({ id }) => id))
      .toEqual([1]);
    expect(filterReviewActivities(activities, { filter: 'all' })).toEqual(activities);
  });

  it('searches app, window title, domain, file path, and project name', () => {
    const browser = activity({
      id: 1,
      app_name: 'Google Chrome',
      window_title: 'Homepage redesign',
      domain: 'staging.example.com',
      started_at: 100,
      project_id: 7,
    });
    const editor = activity({
      id: 2,
      app_name: 'Visual Studio Code',
      window_title: 'reviewActivity.ts',
      file_path: '/Users/patricio/Development/Duskry/reviewActivity.ts',
      started_at: 500,
      project_id: 9,
    });

    expect(matchesReviewSearch(browser, 'chrome acme', projects)).toBe(true);
    expect(matchesReviewSearch(browser, 'homepage', projects)).toBe(true);
    expect(matchesReviewSearch(browser, 'EXAMPLE.COM', projects)).toBe(true);
    expect(matchesReviewSearch(editor, 'development duskry', projects)).toBe(true);
    expect(matchesReviewSearch(editor, 'internal operations', projects)).toBe(true);
    expect(matchesReviewSearch(editor, 'Safari', projects)).toBe(false);
  });

  it('combines status and search filters using the same raw activity set', () => {
    const activities = [
      activity({ id: 1, app_name: 'Chrome', started_at: 100, project_id: 7 }),
      activity({ id: 2, app_name: 'Chrome', started_at: 500 }),
      activity({ id: 3, app_name: 'Figma', started_at: 1_000 }),
    ];

    expect(filterReviewActivities(activities, {
      filter: 'unassigned',
      query: 'chrome',
      projects,
    }).map(({ id }) => id)).toEqual([2]);
  });
});

describe('review assignment summary', () => {
  const activities = [
    activity({ id: 1, app_name: 'Chrome', started_at: 100 }),
    activity({ id: 2, app_name: 'Figma', started_at: 200, project_id: 7 }),
    activity({ id: 3, app_name: 'Slack', started_at: 300, project_id: 7 }),
    activity({ id: 4, app_name: 'Terminal', started_at: 400, project_id: 9 }),
  ];

  it('reports a single shared project as assigned', () => {
    expect(summarizeAssignment([2, 3], activities))
      .toEqual({ status: 'assigned', projectId: 7 });
  });

  it('reports a group with no projects as unassigned', () => {
    expect(summarizeAssignment([1], activities))
      .toEqual({ status: 'unassigned', projectId: null });
    expect(summarizeAssignment([], activities))
      .toEqual({ status: 'unassigned', projectId: null });
  });

  it('reports multiple projects or assigned and unassigned records as mixed', () => {
    expect(summarizeAssignment([2, 4], activities))
      .toEqual({ status: 'mixed', projectId: null });
    expect(summarizeAssignment([1, 2], activities))
      .toEqual({ status: 'mixed', projectId: null });
  });
});
