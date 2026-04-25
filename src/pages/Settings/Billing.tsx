import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLicenseStore, type SelectedPlan } from '../../stores/useLicenseStore';
import { format, fromUnixTime } from 'date-fns';
import { Check, ExternalLink } from 'lucide-react';
import { openCheckout, openAnnualCheckout } from '../../lib/checkout';
import { usePricesStore } from '../../stores/usePricesStore';
import { errorMessage } from '../../lib/utils';

function openPortal() {
  invoke('open_url', { url: 'https://duskry.lemonsqueezy.com/billing' });
}

const PLAN_FEATURES: Record<SelectedPlan, string[]> = {
  free:    ['3 projects', '7-day history', 'Basic tracking'],
  pro:     ['Unlimited projects', '90-day history', 'Auto-rules', 'Reports & exports', '2 devices'],
  proPlus: ['Everything in Pro', 'Unlimited history', '3 devices', 'Team sharing', 'Priority support'],
};

const PLAN_LABEL: Record<SelectedPlan, string> = {
  free: 'Free', pro: 'Pro', proPlus: 'Pro+',
};

const TRIAL_DURATION_DAYS = 7;
const TRIAL_DURATION_SECS = TRIAL_DURATION_DAYS * 24 * 60 * 60;

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
  const trialStartedAt = useLicenseStore((s) => s.trialStartedAt);
  const trialEmail = useLicenseStore((s) => s.trialEmail);
  const selectedPlan = useLicenseStore((s) => s.selectedPlan);
  const daysRemaining = useLicenseStore((s) => s.daysRemaining());
  const activateLicense = useLicenseStore((s) => s.activateLicense);
  const removeLicense = useLicenseStore((s) => s.removeLicense);
  const cancelTrial = useLicenseStore((s) => s.cancelTrial);
  const startTrial = useLicenseStore((s) => s.startTrial);
  const setSelectedPlan = useLicenseStore((s) => s.setSelectedPlan);

  const prices = usePricesStore((s) => s.prices);

  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState('');
  const [keyLoading, setKeyLoading] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('yearly');
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [canDeactivateLicense, setCanDeactivateLicense] = useState<boolean | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [trialPlan, setTrialPlan] = useState<'pro' | 'proPlus'>(
    selectedPlan === 'proPlus' ? 'proPlus' : 'pro'
  );
  const [trialLoading, setTrialLoading] = useState(false);
  const [trialError, setTrialError] = useState('');

  useEffect(() => {
    if (tier !== 'pro' && tier !== 'proPlus') {
      setCanDeactivateLicense(null);
      return;
    }
    invoke<boolean>('can_deactivate_license')
      .then(setCanDeactivateLicense)
      .catch(() => setCanDeactivateLicense(false));
  }, [tier]);

  const handleActivate = async () => {
    if (!keyInput.trim()) return;
    setKeyLoading(true);
    setKeyError('');
    try {
      await activateLicense(keyInput.trim());
      setShowKey(false);
      setKeyInput('');
    } catch (e) {
      setKeyError(errorMessage(e, 'Invalid license key'));
    } finally {
      setKeyLoading(false);
    }
  };

  const handleCancelTrial = async () => {
    setCancelLoading(true);
    try {
      await cancelTrial();
    } finally {
      setCancelLoading(false);
      setCancelConfirm(false);
    }
  };

  const handleCheckout = (plan: 'pro' | 'proPlus', period: 'monthly' | 'yearly') => {
    if (period === 'yearly') {
      openAnnualCheckout(plan === 'proPlus' ? 'proplus_yearly' : 'pro_yearly', trialEmail || undefined);
    } else {
      openCheckout(plan === 'proPlus' ? 'proplus_monthly' : 'pro_monthly', trialEmail || undefined);
    }
  };

  const handleRemoveLicense = async () => {
    setRemoveLoading(true);
    setRemoveError('');
    try {
      await removeLicense();
    } catch (e) {
      setRemoveError(errorMessage(e, 'Could not remove license. Please try again.'));
    } finally {
      setRemoveLoading(false);
      setRemoveConfirm(false);
    }
  };

  const handleStartFreeTrial = async () => {
    setTrialLoading(true);
    setTrialError('');
    try {
      await setSelectedPlan(trialPlan);
      const expiresAt = Math.floor(Date.now() / 1000) + TRIAL_DURATION_SECS;
      await startTrial(trialEmail, expiresAt);
    } catch (e) {
      setTrialError(errorMessage(e, 'Could not start free trial.'));
    } finally {
      setTrialLoading(false);
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
              label="Change plan or billing period"
              description="Switch Pro/Pro+, monthly/annual, or manage proration in Lemon Squeezy"
              buttonLabel="Open portal"
              onAction={openPortal}
              icon={<ExternalLink size={11} />}
              highlight
            />
            <ActionRow
              label="Payment, invoices, or cancellation"
              description="Update payment method, view billing history, pause, resume, or cancel"
              buttonLabel="Open portal"
              onAction={openPortal}
              icon={<ExternalLink size={11} />}
            />
          </div>
        </div>

        {/* Local license */}
        <div className="glass-card" style={{ padding: '20px 22px' }}>
          <SectionLabel>License on this device</SectionLabel>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
              {canDeactivateLicense === false
                ? 'This app was activated before device deactivation tracking was added. Removing it clears the local license, but cannot release the Lemon Squeezy activation for this device.'
                : 'Remove this license from the app and release this device activation in Lemon Squeezy.'}
            </div>
            {removeError && <div style={{ fontSize: 12, color: '#f87171' }}>{removeError}</div>}
            {!removeConfirm ? (
              <button
                className="billing-button billing-button-danger"
                onClick={() => setRemoveConfirm(true)}
                style={{
                  alignSelf: 'flex-start', padding: '6px 12px', borderRadius: 6,
                  border: '0.5px solid rgba(239,68,68,0.35)',
                  background: 'rgba(239,68,68,0.08)', color: 'rgba(248,113,113,0.85)',
                  fontSize: 12, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                }}
              >
                Remove license from this app
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>Remove the license from this device?</span>
                <button
                  className="billing-button billing-button-danger"
                  onClick={handleRemoveLicense}
                  disabled={removeLoading}
                  style={{
                    padding: '3px 10px', borderRadius: 5, border: '0.5px solid rgba(239,68,68,0.35)',
                    background: 'rgba(239,68,68,0.10)', color: 'rgba(239,68,68,0.80)',
                    fontSize: 11.5, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                  }}
                >
                  {removeLoading ? 'Removing…' : 'Yes, remove'}
                </button>
                <button
                  className="billing-button billing-button-ghost"
                  onClick={() => setRemoveConfirm(false)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: 'rgba(255,255,255,0.35)' }}
                >
                  Keep license
                </button>
              </div>
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
              <div style={{ fontSize: 15, fontWeight: 600 }}>{planLabel} (Free Trial)</div>
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

          {/* Cancel trial */}
          <div style={{ marginTop: 14, borderTop: '0.5px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
            {!cancelConfirm ? (
              <button
                className="billing-button billing-button-ghost"
                onClick={() => setCancelConfirm(true)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: 'rgba(255,255,255,0.28)' }}
              >
                Cancel trial
              </button>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>Cancel trial and lose access?</span>
                <button
                  className="billing-button billing-button-danger"
                  onClick={handleCancelTrial}
                  disabled={cancelLoading}
                  style={{
                    padding: '3px 10px', borderRadius: 5, border: '0.5px solid rgba(239,68,68,0.35)',
                    background: 'rgba(239,68,68,0.10)', color: 'rgba(239,68,68,0.80)',
                    fontSize: 11.5, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                  }}
                >
                  {cancelLoading ? 'Cancelling…' : 'Yes, cancel'}
                </button>
                <button
                  className="billing-button billing-button-ghost"
                  onClick={() => setCancelConfirm(false)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: 'rgba(255,255,255,0.35)' }}
                >
                  Keep trial
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Plan comparison + subscribe */}
        <div className="glass-card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <SectionLabel>Compare plans</SectionLabel>
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 7, padding: 2 }}>
              {(['monthly', 'yearly'] as const).map((b) => (
                <button key={b} className="billing-button" onClick={() => setBilling(b)} style={{
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
              { name: 'Pro+', sub: billing === 'monthly' ? `${prices.proplus_monthly}/mo` : `${prices.proplus_yearly}/yr`, dim: false, teal: false },
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
              className="btn-primary billing-button"
              onClick={() => handleCheckout(planKey === 'proPlus' ? 'proPlus' : 'pro', billing)}
              style={{ fontSize: 11.5, padding: '6px 0' }}
            >
              Subscribe →
            </button>
            {planKey === 'pro' ? (
              <button
                className="billing-button"
                onClick={() => handleCheckout('proPlus', billing)}
                style={{
                  padding: '6px 0', borderRadius: 7, border: '0.5px solid rgba(255,255,255,0.15)',
                  background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.65)',
                  fontSize: 11.5, fontWeight: 500, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                }}
              >
                Upgrade →
              </button>
            ) : <div />}
          </div>
        </div>

        {/* License key entry — available during trial so users can activate immediately after purchase */}
        <div className="glass-card" style={{ padding: '20px 22px' }}>
          <SectionLabel>Already purchased?</SectionLabel>
          {!showKey ? (
            <button
              className="billing-button billing-button-link"
              style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12.5, color: 'rgba(45,212,191,0.70)' }}
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
                <button className="btn-primary billing-button" onClick={handleActivate} disabled={keyLoading || !keyInput.trim()} style={{ fontSize: 12.5 }}>
                  {keyLoading ? 'Validating…' : 'Activate'}
                </button>
                <button className="btn-secondary billing-button" style={{ maxWidth: 90 }} onClick={() => { setShowKey(false); setKeyError(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Free / expired ──────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {tier === 'free' && trialStartedAt <= 0 && (
        <div className="glass-card" style={{ padding: '20px 22px' }}>
          <SectionLabel>Free trial</SectionLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'rgba(45,212,191,0.12)',
              border: '0.5px solid rgba(45,212,191,0.28)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700, color: 'rgba(45,212,191,0.9)',
            }}>
              {TRIAL_DURATION_DAYS}d
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Try {PLAN_LABEL[trialPlan]} free for {TRIAL_DURATION_DAYS} days</div>
              <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.40)', marginTop: 2 }}>
                Choose a plan for your one-time trial on this computer.
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 16 }}>
            {(['pro', 'proPlus'] as const).map((plan) => {
              const active = trialPlan === plan;
              return (
                <button
                  key={plan}
                  className="billing-button"
                  onClick={() => setTrialPlan(plan)}
                  style={{
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: `0.5px solid ${active ? 'rgba(45,212,191,0.40)' : 'rgba(255,255,255,0.10)'}`,
                    background: active ? 'rgba(45,212,191,0.10)' : 'rgba(255,255,255,0.04)',
                    color: 'rgba(255,255,255,0.78)',
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{PLAN_LABEL[plan]}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)' }}>
                    {plan === 'pro' ? '90-day history, reports, auto-rules' : 'Unlimited history, team sharing, priority support'}
                  </div>
                </button>
              );
            })}
          </div>

          {trialError && <div style={{ marginTop: 10, fontSize: 12, color: '#f87171' }}>{trialError}</div>}
          <button
            className="btn-primary billing-button"
            onClick={handleStartFreeTrial}
            disabled={trialLoading}
            style={{ marginTop: 14, fontSize: 12.5 }}
          >
            {trialLoading ? 'Starting trial…' : `Start ${PLAN_LABEL[trialPlan]} free trial`}
          </button>
        </div>
      )}

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
                className="billing-button"
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
                    ? (col.featured ? prices.proplus_monthly : prices.pro_monthly)
                    : (col.featured ? prices.proplus_yearly : prices.pro_yearly)}
                  {billing === 'monthly' && <span style={{ fontSize: 9, fontWeight: 400, color: 'rgba(255,255,255,0.35)' }}>/mo</span>}
                  {billing === 'yearly' && <span style={{ fontSize: 9, fontWeight: 400, color: 'rgba(255,255,255,0.35)' }}>/yr</span>}
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
              className="billing-button"
              onClick={() => handleCheckout('pro', billing)}
              style={{
                width: '100%', padding: '5px 0', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.70)',
                fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              }}
            >
              Subscribe
            </button>
          </div>
          <div>
            <button
              className="billing-button"
              onClick={() => handleCheckout('proPlus', billing)}
              style={{
                width: '100%', padding: '5px 0', borderRadius: 6,
                border: '0.5px solid rgba(45,212,191,0.40)',
                background: 'rgba(45,212,191,0.14)', color: 'rgba(45,212,191,0.90)',
                fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
              }}
            >
              Subscribe
            </button>
          </div>
        </div>
      </div>

      {/* License key entry */}
      <div className="glass-card" style={{ padding: '20px 22px' }}>
        <SectionLabel>Activate license</SectionLabel>
        {!showKey ? (
          <button
            className="billing-button billing-button-link"
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
              <button className="btn-primary billing-button" onClick={handleActivate} disabled={keyLoading || !keyInput.trim()} style={{ fontSize: 12.5 }}>
                {keyLoading ? 'Validating…' : 'Activate'}
              </button>
              <button className="btn-secondary billing-button" style={{ maxWidth: 90 }} onClick={() => { setShowKey(false); setKeyError(''); }}>
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
        className="billing-button"
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
