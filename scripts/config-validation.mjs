export const BILLING_VARIANT_KEYS = Object.freeze([
  'DUSKRY_VARIANT_PRO_MONTHLY',
  'DUSKRY_VARIANT_PRO_YEARLY',
  'DUSKRY_VARIANT_PROPLUS_MONTHLY',
  'DUSKRY_VARIANT_PROPLUS_YEARLY',
]);

export const BILLING_CHECKOUT_KEYS = Object.freeze([
  'VITE_CHECKOUT_PRO_MONTHLY',
  'VITE_CHECKOUT_PRO_YEARLY',
  'VITE_CHECKOUT_PROPLUS_MONTHLY',
  'VITE_CHECKOUT_PROPLUS_YEARLY',
]);

export const PRODUCTION_BILLING_CONFIG = Object.freeze({
  VITE_CHECKOUT_PRO_MONTHLY: 'https://duskry.lemonsqueezy.com/checkout/buy/7bfbe944-2be1-4bf6-89ef-8c58e9c8e520',
  VITE_CHECKOUT_PRO_YEARLY: 'https://duskry.lemonsqueezy.com/checkout/buy/f507c59b-4bd2-4290-a9b4-0a99dd4d5b9f',
  VITE_CHECKOUT_PROPLUS_MONTHLY: 'https://duskry.lemonsqueezy.com/checkout/buy/6d141a61-7629-45fa-a6c9-e2a3aac25717',
  VITE_CHECKOUT_PROPLUS_YEARLY: 'https://duskry.lemonsqueezy.com/checkout/buy/c77a2394-ad5c-40f3-ae9e-cd8f73761d98',
  DUSKRY_VARIANT_PRO_MONTHLY: '1620886',
  DUSKRY_VARIANT_PRO_YEARLY: '1620885',
  DUSKRY_VARIANT_PROPLUS_MONTHLY: '1620890',
  DUSKRY_VARIANT_PROPLUS_YEARLY: '1620889',
});

/**
 * Lemon Squeezy returns `variant_id` as an unsigned integer. Keep the build-time
 * value in the same canonical decimal form so native string comparisons cannot
 * silently fall back to a checkout URL, UUID, or zero-padded value.
 */
export function isDecimalVariantId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

export function invalidBillingVariantIds(env) {
  return BILLING_VARIANT_KEYS.filter((key) => env[key] && !isDecimalVariantId(env[key]));
}

export function duplicateBillingVariantIds(env) {
  const seen = new Set();
  return BILLING_VARIANT_KEYS.filter((key) => {
    const value = env[key];
    if (!value) return false;
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  });
}

export function isDuskryCheckoutUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'duskry.lemonsqueezy.com'
      && /^\/checkout\/buy\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/?$/i.test(url.pathname)
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

export function invalidBillingCheckoutUrls(env) {
  return BILLING_CHECKOUT_KEYS.filter((key) => env[key] && !isDuskryCheckoutUrl(env[key]));
}

export function productionBillingMismatches(env) {
  return Object.entries(PRODUCTION_BILLING_CONFIG)
    .filter(([key, value]) => env[key] !== value)
    .map(([key]) => key);
}
