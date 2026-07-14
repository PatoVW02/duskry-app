import { describe, expect, it } from 'vitest';
import { historyLimitDays } from './historyAccess';

describe('history entitlements', () => {
  it('gives a Pro+ trial the unlimited history advertised during onboarding', () => {
    expect(historyLimitDays(true, 'proTrial', 'proPlus')).toBeNull();
  });

  it('keeps Pro and Pro trials at 90 days and Free at seven days', () => {
    expect(historyLimitDays(true, 'pro', 'pro')).toBe(90);
    expect(historyLimitDays(true, 'proTrial', 'pro')).toBe(90);
    expect(historyLimitDays(true, 'free', 'free')).toBe(7);
  });

  it('removes history limits when billing plans are disabled', () => {
    expect(historyLimitDays(false, 'free', 'free')).toBeNull();
  });
});
