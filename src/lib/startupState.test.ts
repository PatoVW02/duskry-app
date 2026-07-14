import { describe, expect, it } from 'vitest';
import { resolveAppStartupState } from './startupState';

describe('resolveAppStartupState', () => {
  it('waits for settings before deciding whether to show onboarding', () => {
    expect(resolveAppStartupState(false, null)).toBe('loading');
    expect(resolveAppStartupState(false, false)).toBe('loading');
    expect(resolveAppStartupState(false, true)).toBe('loading');
  });

  it('shows a recoverable error if onboarding status could not be loaded', () => {
    expect(resolveAppStartupState(true, null)).toBe('error');
  });

  it('routes only a confirmed new user into onboarding', () => {
    expect(resolveAppStartupState(true, false)).toBe('onboarding');
    expect(resolveAppStartupState(true, true)).toBe('ready');
  });
});
