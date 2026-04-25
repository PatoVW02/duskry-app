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
export function openCheckout(key: CheckoutKey, email?: string) {
  let url = CHECKOUT_URLS[key];
  if (!url) {
    console.error(`[checkout] Missing env var for key: ${key}`);
    return;
  }
  if (email) {
    url = `${url}?checkout[email]=${email}`;
  }
  invoke('open_url', { url });
}

/** Alias for annual plan checkouts — same as openCheckout but typed to yearly keys only. */
export function openAnnualCheckout(key: YearlyCheckoutKey, email?: string) {
  openCheckout(key, email);
}
