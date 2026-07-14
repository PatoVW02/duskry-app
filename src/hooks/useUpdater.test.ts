import { describe, expect, it } from 'vitest';
import { localDayKey, updaterErrorMessage } from './useUpdater';

describe('updater helpers', () => {
  it('uses the local calendar day instead of UTC for the daily check key', () => {
    const nearMidnightLocal = new Date(2026, 6, 14, 23, 59, 0);
    expect(localDayKey(nearMidnightLocal)).toBe('2026-07-14');
  });

  it('reports missing Windows release assets as an error', () => {
    expect(updaterErrorMessage(new Error('installer .msi not found'))).toContain(
      'does not include a compatible Windows installer',
    );
  });

  it('normalizes ordinary updater errors for display', () => {
    expect(updaterErrorMessage(new Error('Network unavailable'))).toBe('Network unavailable');
    expect(updaterErrorMessage('Error: Signature rejected')).toBe('Signature rejected');
  });
});
