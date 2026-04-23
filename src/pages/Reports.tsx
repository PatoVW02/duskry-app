import { useLicenseStore, isPro } from '../stores/useLicenseStore';
import { invoke } from '@tauri-apps/api/core';

const VARIANT_IDS: Record<string, string> = {
  pro_monthly:     'your-pro-monthly-variant-id',
  pro_yearly:      'your-pro-yearly-variant-id',
};

export function Reports() {
  const tier = useLicenseStore((s) => s.tier);
  const selectedPlan = useLicenseStore((s) => s.selectedPlan);

  if (!isPro(tier)) {
    // If they chose pro/proPlus during onboarding, send them to subscribe; otherwise generic upgrade
    const upgradeVariant = selectedPlan === 'proPlus' ? 'proplus_monthly' : 'pro_monthly';

    return (
      <div className="glass-card" style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 16 }}>📊</div>
        <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>Reports are available on Pro</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
          Upgrade to Pro to access weekly and monthly reports, export your data as CSV, and see in-depth breakdowns.
        </div>
        <button
          className="btn-primary"
          style={{ maxWidth: 200, margin: '0 auto' }}
          onClick={() => invoke('open_url', { url: `https://duskry.lemonsqueezy.com/checkout/buy/${VARIANT_IDS[upgradeVariant] ?? VARIANT_IDS.pro_monthly}` })}
        >
          Upgrade to Pro →
        </button>
      </div>
    );
  }

  return (
    <div className="glass-card" style={{ padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 16 }}>Reports</div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
        Coming soon, weekly and monthly breakdowns will appear here.
      </div>
    </div>
  );
}
