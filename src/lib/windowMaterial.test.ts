import { describe, expect, it } from 'vitest';
import { detectWindowMaterialMode, normalizeWindowMaterialMode } from './windowMaterial';

describe('window material detection', () => {
  it('only accepts an explicit native capability', () => {
    expect(normalizeWindowMaterialMode('native')).toBe('native');
    expect(normalizeWindowMaterialMode('solid')).toBe('solid');
    expect(normalizeWindowMaterialMode('mica')).toBe('solid');
    expect(normalizeWindowMaterialMode(undefined)).toBe('solid');
  });

  it('keeps the solid fallback when capability detection fails', async () => {
    await expect(detectWindowMaterialMode(async () => 'native')).resolves.toBe('native');
    await expect(detectWindowMaterialMode(async () => {
      throw new Error('IPC unavailable');
    })).resolves.toBe('solid');
  });
});
