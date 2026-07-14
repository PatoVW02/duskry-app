import { describe, expect, it } from 'vitest';
import {
  BILLING_VARIANT_KEYS,
  duplicateBillingVariantIds,
  invalidBillingCheckoutUrls,
  invalidBillingVariantIds,
  isDecimalVariantId,
  isDuskryCheckoutUrl,
  productionBillingMismatches,
} from './config-validation.mjs';

describe('billing variant configuration', () => {
  it('accepts canonical positive decimal Lemon Squeezy variant IDs', () => {
    expect(isDecimalVariantId('1620886')).toBe(true);
    expect(isDecimalVariantId('1')).toBe(true);
  });

  it('rejects checkout URLs, UUIDs, zero, padding, and whitespace', () => {
    expect(isDecimalVariantId('https://duskry.lemonsqueezy.com/checkout/buy/example')).toBe(false);
    expect(isDecimalVariantId('7bfbe944-2be1-4bf6-89ef-8c58e9c8e520')).toBe(false);
    expect(isDecimalVariantId('0')).toBe(false);
    expect(isDecimalVariantId('01620886')).toBe(false);
    expect(isDecimalVariantId(' 1620886 ')).toBe(false);
  });

  it('reports every configured non-numeric variant', () => {
    const env = Object.fromEntries(BILLING_VARIANT_KEYS.map((key) => [key, '1620886']));
    env.DUSKRY_VARIANT_PROPLUS_YEARLY = 'https://example.com/checkout';

    expect(invalidBillingVariantIds(env)).toEqual(['DUSKRY_VARIANT_PROPLUS_YEARLY']);
  });

  it('requires distinct plan variant IDs', () => {
    const env = Object.fromEntries(BILLING_VARIANT_KEYS.map((key, index) => [key, String(100 + index)]));
    env.DUSKRY_VARIANT_PROPLUS_YEARLY = env.DUSKRY_VARIANT_PRO_MONTHLY;
    expect(duplicateBillingVariantIds(env)).toEqual(['DUSKRY_VARIANT_PROPLUS_YEARLY']);
  });
});

describe('billing checkout configuration', () => {
  const liveUrl = 'https://duskry.lemonsqueezy.com/checkout/buy/7bfbe944-2be1-4bf6-89ef-8c58e9c8e520';

  it('accepts only reusable HTTPS links for the Duskry Lemon Squeezy store', () => {
    expect(isDuskryCheckoutUrl(liveUrl)).toBe(true);
    expect(isDuskryCheckoutUrl('http://duskry.lemonsqueezy.com/checkout/buy/7bfbe944-2be1-4bf6-89ef-8c58e9c8e520')).toBe(false);
    expect(isDuskryCheckoutUrl('https://evil.example/checkout/buy/7bfbe944-2be1-4bf6-89ef-8c58e9c8e520')).toBe(false);
    expect(invalidBillingCheckoutUrls({ VITE_CHECKOUT_PRO_MONTHLY: 'not-a-url' })).toEqual(['VITE_CHECKOUT_PRO_MONTHLY']);
  });

  it('fails closed when a release uses anything except the verified live configuration', () => {
    expect(productionBillingMismatches({})).not.toHaveLength(0);
    expect(productionBillingMismatches({
      VITE_CHECKOUT_PRO_MONTHLY: liveUrl,
    })).toContain('DUSKRY_VARIANT_PRO_MONTHLY');
  });
});
