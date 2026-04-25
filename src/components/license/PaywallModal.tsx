import { useState } from 'react';
import { SceneBackground } from '../layout/SceneBackground';
import { useLicenseStore } from '../../stores/useLicenseStore';
import { openCheckout, openAnnualCheckout } from '../../lib/checkout';
import { usePricesStore } from '../../stores/usePricesStore';
import { errorMessage } from '../../lib/utils';
import { billingPlansEnabled } from '../../lib/featureFlags';
import { Check } from 'lucide-react';

type PlanChoice = 'free' | 'pro' | 'proPlus';

export function PaywallModal() {
  const tier = useLicenseStore((s) => s.tier);
  const selectedPlan = useLicenseStore((s) => s.selectedPlan);
  const trialEmail = useLicenseStore((s) => s.trialEmail);
  const activateLicense = useLicenseStore((s) => s.activateLicense);
  const downgradeFree = useLicenseStore((s) => s.downgradeFree);
  const prices = usePricesStore((s) => s.prices);

  const [chosen, setChosen] = useState<PlanChoice>(
    selectedPlan === 'free' ? 'pro' : selectedPlan
  );
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('yearly');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [key, setKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [keyLoading, setKeyLoading] = useState(false);
  const [downgrading, setDowngrading] = useState(false);

  if (!billingPlansEnabled || tier !== 'expired') return null;

  const handleActivate = async () => {
    if (!key.trim()) return;
    setKeyLoading(true);
    setKeyError('');
    try {
      await activateLicense(key.trim());
    } catch (e) {
      setKeyError(errorMessage(e, 'Invalid key'));
    } finally {
      setKeyLoading(false);
    }
  };

  const handleContinue = async () => {
    if (chosen === 'free') {
      setDowngrading(true);
      try { await downgradeFree(); } finally { setDowngrading(false); }
      return;
    }
    if (billing === 'yearly') {
      openAnnualCheckout(chosen === 'proPlus' ? 'proplus_yearly' : 'pro_yearly', trialEmail || undefined);
    } else {
      openCheckout(chosen === 'proPlus' ? 'proplus_monthly' : 'pro_monthly', trialEmail || undefined);
    }
  };

  const proMonthly = prices.pro_monthly;
  const proYearly = prices.pro_yearly;
  const proplusMonthly = prices.proplus_monthly;
  const proplusYearly = prices.proplus_yearly;

  const PLANS = [
    {
      id: 'free' as PlanChoice,
      name: 'Free',
      price: '$0',
      period: '',
      sub: 'Always free',
      features: ['3 projects', '7-day history', 'Basic tracking'],
    },
    {
      id: 'pro' as PlanChoice,
      name: 'Pro',
      price: billing === 'monthly' ? proMonthly : proYearly,
      period: billing === 'monthly' ? '/mo' : '/yr',
      sub: billing === 'monthly' ? `or ${proYearly}/yr` : 'billed annually',
      features: ['Unlimited projects', '90-day history', 'Auto-rules', 'Reports & exports'],
    },
    {
      id: 'proPlus' as PlanChoice,
      name: 'Pro+',
      price: billing === 'monthly' ? proplusMonthly : proplusYearly,
      period: billing === 'monthly' ? '/mo' : '/yr',
      sub: billing === 'monthly' ? `or ${proplusYearly}/yr` : 'billed annually',
      features: ['Everything in Pro', 'Unlimited history', 'Team sharing', 'Priority support'],
      featured: true,
    },
  ];

  return (
    <div className="paywall-overlay">
      <SceneBackground />
      <div className="scene-overlay" />
      <div
        className="glass-card"
        style={{
          position: 'relative', zIndex: 2,
          width: 580, padding: '32px 32px 28px',
          display: 'flex', flexDirection: 'column', gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 26, marginBottom: 10 }}>⏱</div>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>Your free trial has ended</div>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)' }}>
            Choose a plan to continue. You can upgrade anytime.
          </div>
        </div>

        {/* Billing toggle — only visible when a paid plan is selected */}
        {chosen !== 'free' && (
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 3 }}>
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
                {b === 'monthly' ? 'Monthly' : 'Yearly — Save 33%'}
              </button>
            ))}
          </div>
        )}

        {/* Plan cards */}
        <div style={{ display: 'flex', gap: 10 }}>
          {PLANS.map((plan) => {
            const active = chosen === plan.id;
            return (
              <button
                key={plan.id}
                onClick={() => setChosen(plan.id)}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', padding: '14px 12px',
                  borderRadius: 12, textAlign: 'left', cursor: 'pointer',
                  border: `1px solid ${active
                    ? plan.featured ? 'rgba(45,212,191,0.55)' : 'rgba(45,212,191,0.35)'
                    : 'rgba(255,255,255,0.09)'}`,
                  background: active
                    ? plan.featured ? 'rgba(20,80,65,0.30)' : 'rgba(45,212,191,0.07)'
                    : 'rgba(255,255,255,0.03)',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{plan.name}</span>
                  {plan.featured && (
                    <span style={{
                      fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 20,
                      background: 'rgba(251,191,36,0.12)', color: 'rgba(251,191,36,0.85)',
                      border: '0.5px solid rgba(251,191,36,0.22)',
                    }}>Best value</span>
                  )}
                </div>
                <div style={{ marginBottom: 2 }}>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>{plan.price}</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.40)', marginLeft: 2 }}>{plan.period}</span>
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', marginBottom: 10 }}>{plan.sub}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {plan.features.map((f) => (
                    <span key={f} style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Check size={9} style={{ color: plan.id === 'free' ? 'rgba(255,255,255,0.25)' : 'rgba(45,212,191,0.65)', flexShrink: 0 }} />
                      {f}
                    </span>
                  ))}
                </div>
                <div style={{
                  marginTop: 12, height: 2, borderRadius: 2,
                  background: active
                    ? plan.featured ? 'rgba(45,212,191,0.70)' : 'rgba(45,212,191,0.50)'
                    : 'rgba(255,255,255,0.07)',
                  transition: 'background 0.15s',
                }} />
              </button>
            );
          })}
        </div>

        {/* CTA */}
        <button
          className={chosen === 'free' ? 'btn-secondary' : 'btn-primary'}
          onClick={handleContinue}
          disabled={downgrading}
          style={{ fontSize: 13.5 }}
        >
          {downgrading
            ? 'Applying…'
            : chosen === 'free'
              ? 'Continue with Free'
              : `Subscribe to ${chosen === 'proPlus' ? 'Pro+' : 'Pro'} →`}
        </button>

        {/* License key */}
        {!showKeyInput ? (
          <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: -8 }}>
            Already subscribed?{' '}
            <span style={{ color: 'rgba(45,212,191,0.65)', cursor: 'pointer' }} onClick={() => setShowKeyInput(true)}>
              Enter your license key
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: -8 }}>
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
          Cancel anytime
        </p>
      </div>
    </div>
  );
}
