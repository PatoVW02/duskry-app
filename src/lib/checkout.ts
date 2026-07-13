import { invoke } from '@tauri-apps/api/core';

export const CHECKOUT_URLS = {
  pro_monthly:     import.meta.env.VITE_CHECKOUT_PRO_MONTHLY     as string,
  pro_yearly:      import.meta.env.VITE_CHECKOUT_PRO_YEARLY      as string,
  proplus_monthly: import.meta.env.VITE_CHECKOUT_PROPLUS_MONTHLY as string,
  proplus_yearly:  import.meta.env.VITE_CHECKOUT_PROPLUS_YEARLY  as string,
} as const;

export type CheckoutKey = keyof typeof CHECKOUT_URLS;
export type YearlyCheckoutKey = 'pro_yearly' | 'proplus_yearly';

/** Open a LemonSqueezy checkout. Optionally pre-fills the customer email via query param. */
export function buildCheckoutUrl(rawUrl: string, email?: string): string {
  const url = new URL(rawUrl);
  if (email) url.searchParams.set('checkout[email]', email);
  return url.toString();
}

export async function openCheckout(key: CheckoutKey, email?: string): Promise<void> {
  const rawUrl = CHECKOUT_URLS[key];
  if (!rawUrl) throw new Error(`Checkout is not configured for ${key.replace(/_/g, ' ')}.`);
  await invoke('open_url', { url: buildCheckoutUrl(rawUrl, email) });
}

/** Alias for annual plan checkouts — same as openCheckout but typed to yearly keys only. */
export async function openAnnualCheckout(key: YearlyCheckoutKey, email?: string): Promise<void> {
  await openCheckout(key, email);
}
