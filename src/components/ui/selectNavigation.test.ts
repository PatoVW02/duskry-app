import { describe, expect, it } from 'vitest';
import { findTypeaheadMatch, getNextEnabledIndex } from './selectNavigation';

const options = [
  { label: 'Alpha' },
  { label: 'Beta', disabled: true },
  { label: 'Bravo' },
  { label: 'Charlie' },
];

describe('select keyboard navigation', () => {
  it('wraps and skips disabled options in either direction', () => {
    expect(getNextEnabledIndex(options, 0, 1)).toBe(2);
    expect(getNextEnabledIndex(options, 0, -1)).toBe(3);
    expect(getNextEnabledIndex(options, 3, 1)).toBe(0);
  });

  it('returns -1 when no enabled option exists', () => {
    expect(getNextEnabledIndex([{ label: 'Unavailable', disabled: true }], -1, 1)).toBe(-1);
  });

  it('finds the next enabled prefix match for typeahead', () => {
    expect(findTypeaheadMatch(options, 'b', 0)).toBe(2);
    expect(findTypeaheadMatch(options, 'AL', 3)).toBe(0);
    expect(findTypeaheadMatch(options, 'missing', 0)).toBe(-1);
  });
});
