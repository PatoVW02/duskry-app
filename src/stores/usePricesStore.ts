import { create } from 'zustand';

interface Prices {
  pro_monthly: string;
  pro_yearly: string;
  proplus_monthly: string;
  proplus_yearly: string;
}

const FALLBACK: Prices = {
  pro_monthly: '$5.99',
  pro_yearly: '$49.99',
  proplus_monthly: '$9.99',
  proplus_yearly: '$99.99',
};

interface PricesStore {
  prices: Prices;
  fetchPrices: () => Promise<void>;
}

export const usePricesStore = create<PricesStore>((set) => ({
  prices: FALLBACK,

  fetchPrices: async () => {
    try {
      const res = await fetch('https://duskry.app/api/prices');
      if (!res.ok) return;
      const data = await res.json();
      set({ prices: data });
    } catch {
      // keep fallback
    }
  },
}));
