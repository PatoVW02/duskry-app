import { useState } from 'react';
import { OnboardingShell } from './OnboardingShell';
import { useLicenseStore, type SelectedPlan } from '../../stores/useLicenseStore';
import { usePricesStore } from '../../stores/usePricesStore';
import { Check } from 'lucide-react';

interface Props { onNext: () => void; }

interface PlanDef {
  id: SelectedPlan;
  name: string;
  price: string;
  period: string;
  yearly: string;
  features: string[];
  featured?: boolean;
  cta: string;
  trialLabel: string | null;
}

function buildPlans(prices: ReturnType<typeof usePricesStore.getState>['prices']): PlanDef[] {
  return [
    {
      id: 'free',
      name: 'Free',
      price: '$0',
      period: '',
      yearly: 'Always free',
      features: ['3 projects', '7-day history', 'Basic tracking'],
      cta: 'Continue free',
      trialLabel: null,
    },
    {
      id: 'pro',
      name: 'Pro',
      price: prices.pro_monthly,
      period: '/mo',
      yearly: `or ${prices.pro_yearly}/yr`,
      features: ['Unlimited projects', '90-day history', 'Auto-rules', 'Reports & exports', '2 devices'],
      cta: 'Start 7-day trial',
      trialLabel: '7 days free',
    },
    {
      id: 'proPlus',
      name: 'Pro+',
      price: prices.proplus_monthly,
      period: '/mo',
      yearly: `or ${prices.proplus_yearly}/yr`,
      features: ['Everything in Pro', 'Unlimited history', '3 devices', 'Team sharing', 'Priority support'],
      featured: true,
      cta: 'Start 7-day trial',
      trialLabel: '7 days free',
    },
  ];
}

export function PlanPickerScreen({ onNext }: Props) {
  const { selectedPlan, setSelectedPlan } = useLicenseStore();
  const prices = usePricesStore((s) => s.prices);
  const [chosen, setChosen] = useState<SelectedPlan>(selectedPlan);
  const PLANS = buildPlans(prices);

  const handleContinue = async () => {
    await setSelectedPlan(chosen);
    onNext();
  };

  return (
    <OnboardingShell step={3} total={7} cardStyle={{ width: 700 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 5 }}>Choose your plan</div>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)' }}>
          Pro and Pro+ plans include a 7-day free trial. No credit card required.
        </div>
      </div>

      {/* Horizontal 3-column plan cards */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 10 }}>
        {PLANS.map((plan) => {
          const active = chosen === plan.id;
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => setChosen(plan.id)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 0,
                padding: '16px 14px',
                borderRadius: 12,
                border: `1px solid ${active
                  ? plan.featured
                    ? 'rgba(45,212,191,0.55)'
                    : 'rgba(45,212,191,0.35)'
                  : 'rgba(255,255,255,0.09)'}`,
                background: active
                  ? plan.featured
                    ? 'rgba(20,80,65,0.30)'
                    : 'rgba(45,212,191,0.07)'
                  : 'rgba(255,255,255,0.03)',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'border-color 0.15s, background 0.15s',
                position: 'relative',
              }}
            >
              {/* Plan name + badges */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{plan.name}</span>
                {plan.featured && (
                  <span style={{
                    fontSize: 9.5, fontWeight: 600, padding: '2px 6px', borderRadius: 20,
                    background: 'rgba(251,191,36,0.12)', color: 'rgba(251,191,36,0.85)',
                    border: '0.5px solid rgba(251,191,36,0.22)',
                  }}>
                    Best value
                  </span>
                )}
              </div>

              {/* Price */}
              <div style={{ marginBottom: 2 }}>
                <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.5px' }}>{plan.price}</span>
                <span style={{ fontSize: 11, fontWeight: 400, color: 'rgba(255,255,255,0.45)', marginLeft: 2 }}>{plan.period}</span>
              </div>
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.30)', marginBottom: 12 }}>
                {plan.yearly}
              </div>

              {/* Trial badge */}
              {plan.trialLabel && (
                <div style={{ marginBottom: 12 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                    background: 'rgba(45,212,191,0.12)', color: 'rgba(45,212,191,0.85)',
                    border: '0.5px solid rgba(45,212,191,0.25)',
                  }}>
                    {plan.trialLabel} free
                  </span>
                </div>
              )}

              {/* Feature list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                {plan.features.map((f) => (
                  <span key={f} style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.60)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Check size={10} style={{ color: plan.id === 'free' ? 'rgba(255,255,255,0.30)' : 'rgba(45,212,191,0.70)', flexShrink: 0 }} />
                    {f}
                  </span>
                ))}
              </div>

              {/* Selected indicator */}
              <div style={{
                marginTop: 14,
                width: '100%',
                height: 3,
                borderRadius: 2,
                background: active
                  ? plan.featured ? 'rgba(45,212,191,0.70)' : 'rgba(45,212,191,0.50)'
                  : 'rgba(255,255,255,0.08)',
                transition: 'background 0.15s',
              }} />
            </button>
          );
        })}
      </div>

      <button className="btn-primary" onClick={handleContinue} style={{ marginTop: 4 }}>
        {chosen === 'free' ? 'Continue with Free →' : `Start ${PLANS.find((p) => p.id === chosen)!.name} trial →`}
      </button>
    </OnboardingShell>
  );
}
