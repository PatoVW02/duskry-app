import { useState } from 'react';
import { SceneBackground } from '../layout/SceneBackground';
import { useLicenseStore } from '../../stores/useLicenseStore';
import { invoke } from '@tauri-apps/api/core';
import { Check } from 'lucide-react';

const VARIANT_IDS: Record<string, string> = {
  pro_monthly:     'your-pro-monthly-variant-id',
  pro_yearly:      'your-pro-yearly-variant-id',
  proplus_monthly: 'your-proplus-monthly-variant-id',
  proplus_yearly:  'your-proplus-yearly-variant-id',
};

function openCheckout(variant: string) {
  const id = VARIANT_IDS[variant];
  invoke('open_url', { url: `https://duskry.lemonsqueezy.com/checkout/buy/${id}` });
}

const PLAN_COPY = {
  pro: {
    name: 'Pro',
    monthly: '$5.99',
    yearly: '$47.99',
    yearlySaving: 'Save 33%',
    features: ['Unlimited projects', '90-day history', 'Auto-rules', 'Reports & exports', '2 devices'],
    variantMonthly: 'pro_monthly',
    variantYearly: 'pro_yearly',
  },
  proPlus: {
    name: 'Pro+',
    monthly: '$9.99',
    yearly: '$79.99',
    yearlySaving: 'Save 33%',
    features: ['Everything in Pro', 'Unlimited history', '3 devices', 'Team sharing', 'Priority support'],
    variantMonthly: 'proplus_monthly',
    variantYearly: 'proplus_yearly',
  },
};

export function PaywallModal() {
  const tier = useLicenseStore((s) => s.tier);
  const selectedPlan = useLicenseStore((s) => s.selectedPlan);
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [key, setKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [keyLoading, setKeyLoading] = useState(false);
  const activateLicense = useLicenseStore((s) => s.activateLicense);

  if (tier !== 'expired') return null;

  // Paywall only makes sense for pro/proPlus plan choices. If somehow free, just hide.
  const plan = selectedPlan === 'free' ? 'pro' : selectedPlan;
  const copy = PLAN_COPY[plan as 'pro' | 'proPlus'];

  const handleActivate = async () => {
    if (!key.trim()) return;
    setKeyLoading(true);
    setKeyError('');
    try {
      await activateLicense(key.trim());
    } catch (e: any) {
      setKeyError(e.message ?? 'Invalid key');
    } finally {
      setKeyLoading(false);
    }
  };

  return (
    <div className="paywall-overlay">
      <SceneBackground />
      <div className="scene-overlay" />
      <div
        className="glass-card"
        style={{
          position: 'relative', zIndex: 2,
          width: 420, padding: '32px 32px 28px',
          display: 'flex', flexDirection: 'column', gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 26, marginBottom: 10 }}>⏱</div>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Your free trial has ended</div>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)' }}>
            Subscribe to {copy.name} to keep tracking your time and access your history.
          </div>
        </div>

        {/* Billing toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 3 }}>
          {(['monthly', 'yearly'] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBilling(b)}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12,
                fontFamily: 'Inter, sans-serif', fontWeight: billing === b ? 500 : 400,
                background: billing === b ? 'rgba(45,212,191,0.15)' : 'transparent',
                color: billing === b ? 'rgba(45,212,191,0.90)' : 'rgba(255,255,255,0.45)',
                transition: 'all 0.13s',
              }}
            >
              {b === 'monthly' ? 'Monthly' : `Yearly - ${copy.yearlySaving}`}
            </button>
          ))}
        </div>

        {/* Plan card */}
        <div style={{
          padding: '18px 20px',
          borderRadius: 12,
          border: '0.5px solid rgba(45,212,191,0.35)',
          background: 'rgba(20,80,65,0.22)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.5px' }}>
              {billing === 'monthly' ? copy.monthly : copy.yearly}
            </span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)' }}>
              /{billing === 'monthly' ? 'mo' : 'yr'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 14 }}>
            {billing === 'monthly'
              ? `Switch to yearly and save 33% - ${copy.yearly}/yr`
              : `Billed as ${copy.yearly} once per year`}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {copy.features.map((f) => (
              <span key={f} style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Check size={11} style={{ color: 'rgba(45,212,191,0.70)', flexShrink: 0 }} />
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* CTA */}
        <button
          className="btn-primary"
          onClick={() => openCheckout(billing === 'monthly' ? copy.variantMonthly : copy.variantYearly)}
          style={{ fontSize: 13.5 }}
        >
          Subscribe to {copy.name} →
        </button>

        {/* Downgrade option */}
        {plan === 'proPlus' && (
          <div style={{ textAlign: 'center', fontSize: 11.5, color: 'rgba(255,255,255,0.35)' }}>
            Just need the basics?{' '}
            <span
              style={{ color: 'rgba(45,212,191,0.65)', cursor: 'pointer' }}
              onClick={() => openCheckout('pro_monthly')}
            >
              Subscribe to Pro instead
            </span>
          </div>
        )}

        {/* License key */}
        {!showKeyInput ? (
          <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: -4 }}>
            Already subscribed?{' '}
            <span
              style={{ color: 'rgba(45,212,191,0.65)', cursor: 'pointer' }}
              onClick={() => setShowKeyInput(true)}
            >
              Enter your license key
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: -4 }}>
            <input
              className="glass-input"
              placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            {keyError && <div style={{ fontSize: 12, color: '#f87171' }}>{keyError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" onClick={handleActivate} disabled={keyLoading || !key.trim()}>
                {keyLoading ? 'Validating…' : 'Activate'}
              </button>
              <button className="btn-secondary" style={{ maxWidth: 100 }} onClick={() => setShowKeyInput(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)', textAlign: 'center', margin: 0 }}>
          Cancel anytime. Your data is kept for 30 days after cancellation.
        </p>
      </div>
    </div>
  );
}
