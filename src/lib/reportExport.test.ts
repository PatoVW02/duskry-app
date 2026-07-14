import { describe, expect, it } from 'vitest';
import { activitySecondsByHour, safeCsvCell } from './reportExport';

describe('safeCsvCell', () => {
  it('quotes text and escapes embedded quotes', () => {
    expect(safeCsvCell('Project "Alpha"')).toBe('"Project ""Alpha"""');
  });

  it('neutralizes spreadsheet formula prefixes', () => {
    expect(safeCsvCell('=HYPERLINK("https://example.com")')).toBe(
      '"\'=HYPERLINK(""https://example.com"")"',
    );
    expect(safeCsvCell('  +SUM(1,2)')).toBe('"\'  +SUM(1,2)"');
    expect(safeCsvCell('\t@SUM(1,2)')).toBe('"\'\t@SUM(1,2)"');
  });
});

describe('activitySecondsByHour', () => {
  it('allocates a long activity across every local hour it overlaps', () => {
    const start = Math.floor(new Date(2026, 6, 14, 9, 30, 0).getTime() / 1000);
    const hours = activitySecondsByHour([{ started_at: start, duration_s: 2 * 3600 }]);

    expect(hours[9]).toBe(1800);
    expect(hours[10]).toBe(3600);
    expect(hours[11]).toBe(1800);
    expect(hours.reduce((sum, value) => sum + value, 0)).toBe(7200);
  });
});
