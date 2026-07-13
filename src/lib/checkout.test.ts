import { describe, expect, it } from 'vitest';
import { buildCheckoutUrl } from './checkout';

describe('buildCheckoutUrl', () => {
  it('preserves parameters and safely encodes email', () => {
    const url = new URL(buildCheckoutUrl('https://example.com/buy?discount=launch', 'a+b@example.com'));
    expect(url.searchParams.get('discount')).toBe('launch');
    expect(url.searchParams.get('checkout[email]')).toBe('a+b@example.com');
  });
});
