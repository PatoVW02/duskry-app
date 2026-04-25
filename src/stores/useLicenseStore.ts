import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { daysLeft } from '../lib/utils';
import { billingPlansEnabled } from '../lib/featureFlags';

export type Tier = 'free' | 'proTrial' | 'pro' | 'proPlus' | 'expired';
/** The plan the user chose during onboarding ('free' means they opted out of trial). */
export type SelectedPlan = 'free' | 'pro' | 'proPlus';

/** Feature gate helpers — use these throughout the app. */
export function isPro(tier: Tier)     { return !billingPlansEnabled || tier === 'pro' || tier === 'proPlus' || tier === 'proTrial'; }
export function isProPlus(tier: Tier) { return !billingPlansEnabled || tier === 'proPlus'; }

interface LicenseStore {
  tier: Tier;
  trialExpiresAt: number;
  trialStartedAt: number;
  trialEmail: string;
  /** The plan the user chose during onboarding (persisted). */
  selectedPlan: SelectedPlan;
  fetchTier: () => Promise<void>;
  setSelectedPlan: (plan: SelectedPlan) => Promise<void>;
  startTrial: (email: string, expiresAt: number) => Promise<void>;
  cancelTrial: () => Promise<void>;
  downgradeFree: () => Promise<void>;
  activateLicense: (key: string) => Promise<void>;
  removeLicense: () => Promise<void>;
  daysRemaining: () => number;
}

export const useLicenseStore = create<LicenseStore>((set, get) => ({
  tier: 'free',
  trialExpiresAt: 0,
  trialStartedAt: 0,
  trialEmail: '',
  selectedPlan: 'pro',

  fetchTier: async () => {
    try {
      const tier = await invoke<string>('get_license_tier');
      const expiresStr = await invoke<string | null>('get_setting', { key: 'trial_expires_at' });
      const startedStr = await invoke<string | null>('get_setting', { key: 'trial_started_at' });
      const email = await invoke<string | null>('get_setting', { key: 'trial_email' });
      const plan  = await invoke<string | null>('get_setting', { key: 'selected_plan' });
      set({
        tier: tier as Tier,
        trialExpiresAt: parseInt(expiresStr ?? '0'),
        trialStartedAt: parseInt(startedStr ?? '0'),
        trialEmail: email ?? '',
        selectedPlan: (plan ?? 'pro') as SelectedPlan,
      });
    } catch {}
  },

  setSelectedPlan: async (plan) => {
    try { await invoke('set_setting', { key: 'selected_plan', value: plan }); } catch {}
    set({ selectedPlan: plan });
  },

  startTrial: async (email, expiresAt) => {
    await invoke('start_trial', { email, expiresAt });
    set({ tier: 'proTrial', trialExpiresAt: expiresAt, trialStartedAt: Math.floor(Date.now() / 1000), trialEmail: email });
  },

  cancelTrial: async () => {
    await invoke('cancel_trial');
    set({ tier: 'expired' });
  },

  downgradeFree: async () => {
    await invoke('downgrade_to_free');
    set({ tier: 'free' });
  },

  activateLicense: async (key) => {
    const tier = await invoke<string>('validate_license', { key });
    set({ tier: tier as Tier });
  },

  removeLicense: async () => {
    const tier = await invoke<string>('remove_license');
    set({ tier: tier as Tier });
  },

  daysRemaining: () => daysLeft(get().trialExpiresAt),
}));
