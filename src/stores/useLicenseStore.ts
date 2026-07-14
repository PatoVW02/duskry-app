import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { daysLeft } from '../lib/utils';
import { billingPlansEnabled } from '../lib/featureFlags';

export type Tier = 'free' | 'proTrial' | 'pro' | 'proPlus' | 'expired';
export type EntitlementVerificationState =
  | 'loading'
  | 'active'
  | 'offline-grace'
  | 'verification-needed'
  | 'invalid';
/** The plan the user chose during onboarding ('free' means they opted out of trial). */
export type SelectedPlan = 'free' | 'pro' | 'proPlus';

interface LicenseStatus {
  tier: Tier;
  verificationState: Exclude<EntitlementVerificationState, 'loading'>;
  lastVerifiedAt: number | null;
  offlineGraceUntil: number | null;
  message: string | null;
}

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
  verificationState: EntitlementVerificationState;
  lastVerifiedAt: number | null;
  offlineGraceUntil: number | null;
  verificationMessage: string | null;
  refreshing: boolean;
  lastError: string | null;
  fetchTier: () => Promise<void>;
  setSelectedPlan: (plan: SelectedPlan) => Promise<void>;
  startTrial: (email: string) => Promise<void>;
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
  verificationState: 'loading',
  lastVerifiedAt: null,
  offlineGraceUntil: null,
  verificationMessage: null,
  refreshing: false,
  lastError: null,

  fetchTier: async () => {
    set({ refreshing: true, lastError: null });
    try {
      // Restore the authenticated local entitlement before waiting on the
      // network, so a paid user never flashes as Free during a slow refresh.
      const localStatus = await invoke<LicenseStatus>('get_license_status');
      set({
        tier: localStatus.tier,
        verificationState: localStatus.verificationState,
        lastVerifiedAt: localStatus.lastVerifiedAt,
        offlineGraceUntil: localStatus.offlineGraceUntil,
        verificationMessage: localStatus.message,
      });

      const [status, expiresStr, startedStr, email, plan] = await Promise.all([
        invoke<LicenseStatus>('refresh_license_status'),
        invoke<string | null>('get_setting', { key: 'trial_expires_at' }),
        invoke<string | null>('get_setting', { key: 'trial_started_at' }),
        invoke<string | null>('get_setting', { key: 'trial_email' }),
        invoke<string | null>('get_setting', { key: 'selected_plan' }),
      ]);
      set({
        tier: status.tier,
        verificationState: status.verificationState,
        lastVerifiedAt: status.lastVerifiedAt,
        offlineGraceUntil: status.offlineGraceUntil,
        verificationMessage: status.message,
        trialExpiresAt: parseInt(expiresStr ?? '0'),
        trialStartedAt: parseInt(startedStr ?? '0'),
        trialEmail: email ?? '',
        selectedPlan: (plan ?? 'pro') as SelectedPlan,
        refreshing: false,
      });
    } catch (error) {
      console.error('[license] Could not load entitlement state.', error);
      // A bridge/database failure is not evidence that a paid entitlement is
      // invalid. Preserve the last known tier and make the uncertainty clear.
      set((state) => ({
        refreshing: false,
        verificationState:
          state.tier === 'pro' || state.tier === 'proPlus'
            ? 'verification-needed'
            : state.verificationState === 'loading'
              ? 'verification-needed'
              : state.verificationState,
        verificationMessage: 'Duskry could not check the subscription status. Your last known plan has been preserved.',
        lastError: String(error),
      }));
    }
  },

  setSelectedPlan: async (plan) => {
    try { await invoke('set_setting', { key: 'selected_plan', value: plan }); } catch {}
    set({ selectedPlan: plan });
  },

  startTrial: async (email) => {
    const expiresAt = await invoke<number>('start_trial', { email });
    set({
      tier: 'proTrial',
      verificationState: 'active',
      verificationMessage: null,
      trialExpiresAt: expiresAt,
      trialStartedAt: Math.floor(Date.now() / 1000),
      trialEmail: email,
    });
  },

  cancelTrial: async () => {
    await invoke('cancel_trial');
    set({ tier: 'free', verificationState: 'active', verificationMessage: null });
  },

  downgradeFree: async () => {
    await invoke('downgrade_to_free');
    set({ tier: 'free', verificationState: 'active', verificationMessage: null });
  },

  activateLicense: async (key) => {
    const tier = await invoke<Tier>('validate_license', { key });
    const status = await invoke<LicenseStatus>('get_license_status');
    set({
      tier,
      verificationState: status.verificationState,
      lastVerifiedAt: status.lastVerifiedAt,
      offlineGraceUntil: status.offlineGraceUntil,
      verificationMessage: status.message,
      lastError: null,
    });
  },

  removeLicense: async () => {
    const tier = await invoke<Tier>('remove_license');
    set({
      tier,
      verificationState: 'active',
      lastVerifiedAt: null,
      offlineGraceUntil: null,
      verificationMessage: null,
      lastError: null,
    });
  },

  daysRemaining: () => daysLeft(get().trialExpiresAt),
}));
