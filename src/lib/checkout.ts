import { invoke } from '@tauri-apps/api/core';

export const CHECKOUT_URLS = {
  pro_monthly:     import.meta.env.VITE_CHECKOUT_PRO_MONTHLY     as string,
  pro_yearly:      import.meta.env.VITE_CHECKOUT_PRO_YEARLY      as string,
  proplus_monthly: import.meta.env.VITE_CHECKOUT_PROPLUS_MONTHLY as string,
  proplus_yearly:  import.meta.env.VITE_CHECKOUT_PROPLUS_YEARLY  as string,
} as const;

export type CheckoutKey = keyof typeof CHECKOUT_URLS;

export function openCheckout(key: CheckoutKey) {
  const url = CHECKOUT_URLS[key];
  if (!url) {
    console.error(`[checkout] Missing env var for key: ${key}`);
    return;
  }
  invoke('open_url', { url });
}
