import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLicenseStore, type SelectedPlan } from '../../stores/useLicenseStore';
import { format, fromUnixTime } from 'date-fns';
import { Check, ExternalLink } from 'lucide-react';

const VARIANT_IDS: Record<string, string> = {
  pro_monthly:     'your-pro-monthly-variant-id',
  pro_yearly:      'your-pro-yearly-variant-id',
  proplus_monthly: 'your-proplus-monthly-variant-id',
  proplus_yearly:  'your-proplus-yearly-variant-id',
};

function openCheckout(variant: string) {
  invoke('open_url', { url: `https://duskry.lemonsqueezy.com/checkout/buy/${VARIANT_IDS[variant]}` });
}
function openPortal() {
  invoke('open_url', { url: 'https://app.lemonsqueezy.com/my-orders' });
}

const PLAN_FEATURES: Record<SelectedPlan, string[]> = {
  free:    ['3 projects', '7-day history', 'Basic tracking'],
  pro:     ['Unlimited projects', '90-day history', 'Auto-rules', 'Reports & exports', '2 devices'],
  proPlus: ['Everything in Pro', 'Unlimited history', '3 devices', 'Team sharing', 'Priority support'],
};

const PLAN_LABEL: Record<SelectedPlan, string> = {
  free: 'Free', pro: 'Pro', proPlus: 'Pro+',
};

type CellVal = string | boolean;
const COMPARISON_ROWS: { label: string; free: CellVal; pro: CellVal; proPlus: CellVal }[] = [
  { label: 'Projects',         free: '3',       pro: 'Unlimited', proPlus: 'Unlimited' },
  { label: 'Activity history', free: '7 days',  pro: '90 days',   proPlus: 'Unlimited' },
  { label: 'Auto-rules',       free: false,     pro: true,        proPlus: true },
  { label: 'Reports & exports',free: false,     pro: true,        proPlus: true },
  { label: 'Devices',          free: '1',       pro: '2',         proPlus: '3' },
  { label: 'Team sharing',     free: false,     pro: false,       proPlus: true },
  { label: 'Priority support', free: false,     pro: false,       proPlus: true },
];

export function Billing() {
  const tier = useLicenseStore((s) => s.tier);
  const trialExpiresAt = useLicenseStore((s) => s.trialExpiresAt);
  const trialEmail = useLicenseStore((s) => s.trialEmail);
  const selectedPlan = useLicenseStore((s) => s.selectedPlan);
  const daysRemaining = useLicenseStore((s) => s.daysRemaining());
  const activateLicense = useLicenseStore((s) => s.activateLicense);

  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState('');
  const [keyLoading, setKeyLoading] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');

  const handleActivate = async () => {
    if (!keyInput.trim()) return;
    setKeyLoading(true);
    setKeyError('');
    try {
      await activateLicense(keyInput.trim());
      setShowKey(false);
      setKeyInput('');
    } catch (e: any) {
      setKeyError(e.message ?? 'Invalid license key');
    } finally {
      setKeyLoading(false);
    }
  };

  // ── Active subscription ─────────────────────────────────────────────────
  if (tier === 'pro' || tier === 'proPlus') {
    const planName = tier === 'proPlus' ? 'Pro+' : 'Pro';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Status card */}
        <div className="glass-card" style={{ padding: '20px 22px' }}>
          <SectionLabel>Current plan</SectionLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'rgba(45,212,191,0.12)',
              border: '0.5px solid rgba(45,212,191,0.28)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16,
            }}>
              ✦
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{planName}</div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.40)', marginTop: 2 }}>
                Active subscription
              </div>
            </div>
            <span style={{
              marginLeft: 'auto', fontSize: 10.5, fontWeight: 600, padding: '3px 10px',
              borderRadius: 20, background: 'rgba(45,212,191,0.10)', color: 'rgba(45,212,191,0.85)',
              border: '0.5px solid rgba(45,212,191,0.22)',
            }}>
              Active
            </span>
          </div>

          <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.07)', marginTop: 16, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {PLAN_FEATURES[tier === 'proPlus' ? 'proPlus' : 'pro'].map((f) => (
              <span key={f} style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.60)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Check size={11} style={{ color: 'rgba(45,212,191,0.65)', flexShrink: 0 }} />
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Manage */}
        <div className="glass-card" style={{ padding: '20px 22px' }}>
          <SectionLabel>Manage subscription</SectionLabel>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ActionRow
              label="Billing portal"
              description="View invoices, update payment method, cancel subscription"
              buttonLabel="Open billing portal"
              onAction={openPortal}
              icon={<ExternalLink size={11} />}
            />
            {tier === 'pro' && (
              <ActionRow
                label="Upgrade to Pro+"
                description="Unlimited history, team sharing, priority support"
                buttonLabel="Upgrade →"
                onAction={() => openCheckout('proplus_monthly')}
                highlight
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Trial active ────────────────────────────────────────────────────────
  if (tier === 'proTrial') {
    const expiresFormatted = trialExpiresAt
      ? format(fromUnixTime(trialExpiresAt), 'MMM d, yyyy')
      : '-';
    const planKey = selectedPlan === 'free' ? 'pro' : selectedPlan;
    const planLabel = PLAN_LABEL[planKey as SelectedPlan];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Trial status */}
        <div className="glass-card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'rgba(251,191,36,0.10)', border: '0.5px solid rgba(251,191,36,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
            }}>⏱</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{planLabel} - Free Trial</div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.40)', marginTop: 2 }}>
                {trialEmail && <>Registered as <strong style={{ color: 'rgba(255,255,255,0.55)' }}>{trialEmail}</strong> · </>}
                Expires {expiresFormatted}
              </div>
            </div>
            <span style={{
              marginLeft: 'auto', fontSize: 10.5, fontWeight: 600, padding: '3px 10px',
              borderRadius: 20, background: 'rgba(251,191,36,0.10)', color: 'rgba(251,191,36,0.85)',
              border: '0.5px solid rgba(251,191,36,0.22)',
            }}>
              {daysRemaining}d left
            </span>
          </div>
        </div>

        {/* Plan comparison + subscribe - all 3 plans so the trial value is clear */}
        <div className="glass-card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <SectionLabel>Compare plans</SectionLabel>
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 7, padding: 2 }}>
              {(['monthly', 'yearly'] as const).map((b) => (
                <button key={b} onClick={() => setBilling(b)} style={{
                  padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                  fontSize: 11, fontFamily: 'Inter, sans-serif', fontWeight: billing === b ? 500 : 400,
                  background: billing === b ? 'rgba(45,212,191,0.16)' : 'transparent',
                  color: billing === b ? 'rgba(45,212,191,0.90)' : 'rgba(255,255,255,0.38)',
                  transition: 'all 0.13s',
                }}>
                  {b === 'monthly' ? 'Monthly' : 'Yearly −33%'}
                </button>
              ))}
            </div>
          </div>

          {/* Column headers: Free | Pro (trial) | Pro+ */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px 96px 96px', gap: 0, marginBottom: 10 }}>
            <div />
            {[
              { name: 'Free', sub: 'not active', dim: true, teal: false },
              { name: planLabel, sub: 'your trial', dim: false, teal: true },
              { name: 'Pro+', sub: billing === 'monthly' ? '$9.99/mo' : '$6.66/mo', dim: false, teal: false },
            ].map((col) => (
              <div key={col.name} style={{ textAlign: 'center', paddingBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: col.teal ? 'rgba(45,212,191,0.85)' : col.dim ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.70)' }}>
                  {col.name}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', marginTop: 1 }}>{col.sub}</div>
              </div>
            ))}
          </div>

          {/* Feature rows */}
          {COMPARISON_ROWS.map((row, i) => {
            const trialVal = planKey === 'pro' ? row.pro : row.proPlus;
            const plusDiffers = JSON.stringify(trialVal) !== JSON.stringify(row.proPlus);
            return (
              <div key={row.label} style={{
                display: 'grid', gridTemplateColumns: '1fr 72px 96px 96px',
                alignItems: 'center', padding: '7px 0',
                borderTop: i === 0 ? '0.5px solid rgba(255,255,255,0.07)' : '0.5px solid rgba(255,255,255,0.05)',
              }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.60)' }}>{row.label}</div>
                <FeatureCell val={row.free} dimIfSame />
                <FeatureCell val={trialVal} highlight />
                <FeatureCell val={row.proPlus} highlight={plusDiffers} dimIfSame={!plusDiffers} />
              </div>
            );
          })}

          {/* CTA row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px 96px 96px', gap: 6, marginTop: 16 }}>
            <div />
            <div />
            <button
              className="btn-primary"
              onClick={() => openCheckout(billing === 'monthly'
                ? (planKey === 'proPlus' ? 'proplus_monthly' : 'pro_monthly')
                : (planKey === 'proPlus' ? 'proplus_yearly' : 'pro_yearly')
              )}
              style={{ fontSize: 11.5, padding: '6px 0' }}
            >
              Subscribe →
            </button>
            <button
              onClick={() => openCheckout(billing === 'monthly' ? 'proplus_monthly' : 'proplus_yearly')}
              style={{
                padding: '6px 0', borderRadius: 7, border: '0.5px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.65)',
                fontSize: 11.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              }}
            >
              Upgrade →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Free / expired ──────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {tier === 'expired' && (
        <div style={{
          padding: '12px 16px', borderRadius: 10,
          background: 'rgba(239,68,68,0.08)', border: '0.5px solid rgba(239,68,68,0.25)',
          fontSize: 12.5, color: 'rgba(239,68,68,0.85)',
        }}>
          Your trial has ended. Subscribe below to regain full access.
        </div>
      )}

      {/* Plan comparison table */}
      <div className="glass-card" style={{ padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <SectionLabel>Compare plans</SectionLabel>
          {/* Billing toggle */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 7, padding: 2 }}>
            {(['monthly', 'yearly'] as const).map((b) => (
              <button
                key={b}
                onClick={() => setBilling(b)}
                style={{
                  padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                  fontSize: 11, fontFamily: 'Inter, sans-serif', fontWeight: billing === b ? 500 : 400,
                  background: billing === b ? 'rgba(45,212,191,0.16)' : 'transparent',
                  color: billing === b ? 'rgba(45,212,191,0.90)' : 'rgba(255,255,255,0.38)',
                  transition: 'all 0.13s',
                }}
              >
                {b === 'monthly' ? 'Monthly' : 'Yearly −33%'}
              </button>
            ))}
          </div>
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 88px', gap: 0, marginBottom: 10 }}>
          <div />
          {[
            { name: 'Free', current: true },
            { name: 'Pro', current: false },
            { name: 'Pro+', current: false, featured: true },
          ].map((col) => (
            <div key={col.name} style={{ textAlign: 'center', paddingBottom: 6 }}>
              <div style={{
                fontSize: 11, fontWeight: 600,
                color: col.featured ? 'rgba(45,212,191,0.85)' : col.current ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.75)',
              }}>
                {col.name}
              </div>
              {col.current ? (
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)', marginTop: 1 }}>current</div>
              ) : (
                <div style={{ fontSize: 11, fontWeight: 600, color: col.featured ? 'rgba(45,212,191,0.70)' : 'rgba(255,255,255,0.55)', marginTop: 1 }}>
                  {billing === 'monthly'
                    ? (col.featured ? '$9.99' : '$5.99')
                    : (col.featured ? '$6.66' : '$3.99')}
                  <span style={{ fontSize: 9, fontWeight: 400, color: 'rgba(255,255,255,0.35)' }}>/mo</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Feature rows */}
        {COMPARISON_ROWS.map((row, i) => (
          <div
            key={row.label}
            style={{
              display: 'grid', gridTemplateColumns: '1fr 80px 80px 88px',
              alignItems: 'center', gap: 0,
              padding: '7px 0',
              borderTop: i === 0 ? '0.5px solid rgba(255,255,255,0.07)' : '0.5px solid rgba(255,255,255,0.05)',
            }}
          >
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.60)' }}>{row.label}</div>
            {([row.free, row.pro, row.proPlus] as const).map((val, ci) => (
              <FeatureCell key={ci} val={val} highlight={ci > 0} dimIfSame={ci === 0} />
            ))}
          </div>
        ))}

        {/* CTA row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 88px', gap: 0, marginTop: 14 }}>
          <div />
          <div style={{ textAlign: 'center', paddingRight: 4 }}>
            <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.30)' }}>
              {tier === 'expired' ? 'Expired' : 'Active'}
            </span>
          </div>
          <div style={{ paddingRight: 4 }}>
            <button
              onClick={() => openCheckout(billing === 'monthly' ? 'pro_monthly' : 'pro_yearly')}
              style={{
                width: '100%', padding: '5px 0', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.70)',
                fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              }}
            >
              Try free
            </button>
          </div>
          <div>
            <button
              onClick={() => openCheckout(billing === 'monthly' ? 'proplus_monthly' : 'proplus_yearly')}
              style={{
                width: '100%', padding: '5px 0', borderRadius: 6,
                border: '0.5px solid rgba(45,212,191,0.40)',
                background: 'rgba(45,212,191,0.14)', color: 'rgba(45,212,191,0.90)',
                fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              }}
            >
              Try free
            </button>
          </div>
        </div>
      </div>

      {/* License key entry */}
      <div className="glass-card" style={{ padding: '20px 22px' }}>
        <SectionLabel>Activate license</SectionLabel>
        {!showKey ? (
          <button
            style={{
              marginTop: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontSize: 12.5, color: 'rgba(45,212,191,0.70)',
            }}
            onClick={() => setShowKey(true)}
          >
            Enter your license key →
          </button>
        ) : (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              className="glass-input"
              placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              autoFocus
            />
            {keyError && <div style={{ fontSize: 12, color: '#f87171' }}>{keyError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" onClick={handleActivate} disabled={keyLoading || !keyInput.trim()} style={{ fontSize: 12.5 }}>
                {keyLoading ? 'Validating…' : 'Activate'}
              </button>
              <button className="btn-secondary" style={{ maxWidth: 90 }} onClick={() => { setShowKey(false); setKeyError(''); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {children}
    </div>
  );
}

function FeatureCell({ val, highlight, dimIfSame }: { val: string | boolean; highlight?: boolean; dimIfSame?: boolean }) {
  const opacity = dimIfSame ? 0.35 : 1;
  if (val === true) return (
    <div style={{ textAlign: 'center', opacity }}>
      <Check size={13} style={{ color: highlight ? 'rgba(45,212,191,0.80)' : 'rgba(255,255,255,0.40)', margin: '0 auto' }} />
    </div>
  );
  if (val === false) return (
    <div style={{ textAlign: 'center' }}>
      <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.15)', lineHeight: 1 }}>–</span>
    </div>
  );
  return (
    <div style={{ textAlign: 'center', opacity }}>
      <span style={{ fontSize: 11, fontWeight: highlight ? 500 : 400, color: highlight ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.45)' }}>
        {val}
      </span>
    </div>
  );
}

function ActionRow({
  label, description, buttonLabel, onAction, icon, highlight,
}: {
  label: string;
  description: string;
  buttonLabel: string;
  onAction: () => void;
  icon?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 12px', borderRadius: 8,
      background: highlight ? 'rgba(45,212,191,0.05)' : 'rgba(255,255,255,0.03)',
      border: `0.5px solid ${highlight ? 'rgba(45,212,191,0.18)' : 'rgba(255,255,255,0.07)'}`,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.40)' }}>{description}</div>
      </div>
      <button
        onClick={onAction}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 12px', borderRadius: 6, border: `0.5px solid ${highlight ? 'rgba(45,212,191,0.35)' : 'rgba(255,255,255,0.14)'}`,
          background: highlight ? 'rgba(45,212,191,0.12)' : 'rgba(255,255,255,0.05)',
          color: highlight ? 'rgba(45,212,191,0.85)' : 'rgba(255,255,255,0.65)',
          fontSize: 12, cursor: 'pointer', fontFamily: 'Inter, sans-serif', flexShrink: 0,
        }}
      >
        {buttonLabel}
        {icon}
      </button>
    </div>
  );
}
