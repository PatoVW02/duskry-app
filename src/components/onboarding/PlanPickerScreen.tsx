import { useState } from 'react';
import { OnboardingShell } from './OnboardingShell';
import { useLicenseStore, type SelectedPlan } from '../../stores/useLicenseStore';
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

const PLANS: PlanDef[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '',
    yearly: 'Always free',
    features: [
      '3 projects',
      '7-day history',
      'Basic tracking',
    ],
    cta: 'Continue free',
    trialLabel: null,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$5.99',
    period: '/mo',
    yearly: 'or $47.99/yr - save 33%',
    features: [
      'Unlimited projects',
      '90-day history',
      'Auto-rules',
      'Reports & exports',
      '2 devices',
    ],
    cta: 'Start 7-day trial',
    trialLabel: '7 days free',
  },
  {
    id: 'proPlus',
    name: 'Pro+',
    price: '$9.99',
    period: '/mo',
    yearly: 'or $79.99/yr - save 33%',
    features: [
      'Everything in Pro',
      'Unlimited history',
      '3 devices',
      'Team sharing',
      'Priority support',
    ],
    featured: true,
    cta: 'Start 7-day trial',
    trialLabel: '7 days free',
  },
];

export function PlanPickerScreen({ onNext }: Props) {
  const { selectedPlan, setSelectedPlan } = useLicenseStore();
  const [chosen, setChosen] = useState<SelectedPlan>(selectedPlan);

  const handleContinue = async () => {
    await setSelectedPlan(chosen);
    onNext();
  };

  return (
    <OnboardingShell step={3} total={7}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 5 }}>Choose your plan</div>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)' }}>
          Pro and Pro+ plans include a 7-day free trial. No credit card required.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {PLANS.map((plan) => {
          const active = chosen === plan.id;
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => setChosen(plan.id)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 14px',
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
              {/* Radio dot */}
              <span style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                border: `2px solid ${active ? 'rgba(45,212,191,0.85)' : 'rgba(255,255,255,0.25)'}`,
                background: active ? 'rgba(45,212,191,0.20)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.13s',
              }}>
                {active && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(45,212,191,0.90)' }} />}
              </span>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{plan.name}</span>
                  {plan.trialLabel && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
                      background: 'rgba(45,212,191,0.12)', color: 'rgba(45,212,191,0.85)',
                      border: '0.5px solid rgba(45,212,191,0.25)',
                    }}>
                      {plan.trialLabel}
                    </span>
                  )}
                  {plan.featured && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
                      background: 'rgba(251,191,36,0.12)', color: 'rgba(251,191,36,0.85)',
                      border: '0.5px solid rgba(251,191,36,0.22)',
                    }}>
                      Best value
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 600 }}>
                    {plan.price}<span style={{ fontSize: 11, fontWeight: 400, color: 'rgba(255,255,255,0.45)' }}>{plan.period}</span>
                  </span>
                </div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', marginBottom: 6 }}>
                  {plan.yearly}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {plan.features.map((f) => (
                    <span key={f} style={{ fontSize: 12, color: 'rgba(255,255,255,0.60)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Check size={10} style={{ color: plan.id === 'free' ? 'rgba(255,255,255,0.30)' : 'rgba(45,212,191,0.70)', flexShrink: 0 }} />
                      {f}
                    </span>
                  ))}
                </div>
              </div>
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
