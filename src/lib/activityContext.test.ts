import { describe, expect, it } from 'vitest';
import type { Activity } from '../stores/useActivityStore';
import { activityContextLabel, activityTitleGroupKey, hasSpecificWindowTitle } from './activityContext';

function activity(overrides: Partial<Activity> = {}): Activity {
  return { id: 1, app_name: 'ChatGPT', window_title: null, domain: null, file_path: null,
    started_at: 1_800_000_000, ended_at: 1_800_000_300, duration_s: 300, project_id: null, source: 'tracker', ...overrides };
}

describe('limited window context', () => {
  it.each([
    ['ChatGPT', null], ['ChatGPT', '  ChatGPT  '], ['Chrome', 'New tab'],
    ['Google Chrome', 'ChatGPT — Google Chrome'], ['Claude', 'New chat | Claude'],
    ['Editor', 'Untitled window'], ['Acme Editor', 'Acme Editor'],
  ])('does not treat %s / %s as a specific title', (app, title) => {
    expect(hasSpecificWindowTitle(app, title)).toBe(false);
  });

  it('retains real conversation titles and user notes', () => {
    expect(hasSpecificWindowTitle('ChatGPT', 'Duskry release checklist — ChatGPT')).toBe(true);
    expect(activityContextLabel(activity({ window_title: 'Client planning' }))).toBe('Client planning');
  });

  it('distinguishes visits with identical generic or absent titles', () => {
    for (const title of [null, 'ChatGPT']) {
      const first = activity({ window_title: title });
      const second = activity({ id: 2, window_title: title, started_at: first.started_at + 3600, ended_at: first.ended_at! + 3600 });
      expect(activityTitleGroupKey(first)).not.toBe(activityTitleGroupKey(second));
      expect(activityContextLabel(first)).not.toBe(activityContextLabel(second));
      expect(activityContextLabel(first)).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}/);
    }
  });

  it('shows an available document or website instead of an empty label', () => {
    expect(activityContextLabel(activity({ file_path: '/projects/Duskry/proposal.pdf' }))).toContain('proposal.pdf');
    expect(activityContextLabel(activity({ domain: 'example.com', ended_at: null }))).toContain('example.com');
    expect(activityContextLabel(activity({ ended_at: null }))).toContain('ongoing');
  });

  it('keeps identical specific titles grouped and protects key namespaces', () => {
    expect(activityTitleGroupKey(activity({ window_title: 'Client planning' })))
      .toBe(activityTitleGroupKey(activity({ id: 2, window_title: 'Client planning' })));
    expect(activityTitleGroupKey(activity({ window_title: 'visit:1' })))
      .not.toBe(activityTitleGroupKey(activity()));
  });
});
