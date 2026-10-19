import { describe, expect, it } from 'vitest';
import { normalizeProjectColor, projectColorForeground, projectColorText } from './projectColor';

describe('custom project colors', () => {
  it('normalizes common pasted hex formats into opaque six-digit RGB', () => {
    expect(normalizeProjectColor(' #aBc ')).toBe('#AABBCC');
    expect(normalizeProjectColor('a855f7')).toBe('#A855F7');
    expect(normalizeProjectColor('#000000')).toBe('#000000');
    expect(normalizeProjectColor('#FFFFFF')).toBe('#FFFFFF');
  });

  it('rejects incomplete, transparent, and non-hex values', () => {
    for (const value of ['', '#', '#12', '#12345678', 'transparent', 'red', 'rgb(0,0,0)', '#GGGGGG', '##ABC']) {
      expect(normalizeProjectColor(value)).toBeNull();
    }
  });

  it('keeps labels readable on very dark and very light custom backgrounds', () => {
    expect(projectColorForeground('#000000')).toBe('#FFFFFF');
    expect(projectColorForeground('#123456')).toBe('#FFFFFF');
    expect(projectColorForeground('#FFFFFF')).toBe('#000000');
    expect(projectColorForeground('#FDE047')).toBe('#000000');
    expect(projectColorText('#000000')).toBe('#E2E8F0');
    expect(projectColorText('#86EFAC')).toBe('#86EFAC');
    expect(projectColorText('invalid')).toBe('#E2E8F0');
  });
});
