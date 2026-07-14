import type { SelectedPlan, Tier } from '../stores/useLicenseStore';

export function historyLimitDays(
  billingEnabled: boolean,
  tier: Tier,
  selectedPlan: SelectedPlan,
): number | null {
  if (!billingEnabled) return null;
  if (tier === 'proPlus' || (tier === 'proTrial' && selectedPlan === 'proPlus')) return null;
  if (tier === 'pro' || tier === 'proTrial') return 90;
  return 7;
}
