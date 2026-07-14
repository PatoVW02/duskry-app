import { describe, expect, it } from 'vitest';
import { detectMacOS, isRuleFieldSupported, supportedRuleFieldOptions } from './rulePlatform';

const OPTIONS = [
  { value: 'app', label: 'Application' },
  { value: 'url', label: 'Website hostname' },
  { value: 'path', label: 'File path' },
] as const;

describe('rule platform capabilities', () => {
  it('recognizes macOS and Windows navigator values', () => {
    expect(detectMacOS('MacIntel', 'Mozilla/5.0 (Macintosh)')).toBe(true);
    expect(detectMacOS('Win32', 'Mozilla/5.0 (Windows NT 10.0)')).toBe(false);
  });

  it('hides URL rules when native tracking cannot capture hostnames', () => {
    expect(supportedRuleFieldOptions(OPTIONS, false).map((option) => option.value)).toEqual(['app', 'path']);
    expect(supportedRuleFieldOptions(OPTIONS, true)).toEqual(OPTIONS);
    expect(isRuleFieldSupported('url', false)).toBe(false);
    expect(isRuleFieldSupported('title', false)).toBe(true);
  });
});
