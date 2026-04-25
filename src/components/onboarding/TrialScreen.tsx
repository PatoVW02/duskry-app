import { useEffect, useState } from 'react';
import { OnboardingShell } from './OnboardingShell';
import { useLicenseStore } from '../../stores/useLicenseStore';
import { errorMessage } from '../../lib/utils';
import { billingPlansEnabled } from '../../lib/featureFlags';

interface Props { onNext: () => void; }

const TRIAL_API = 'https://duskry.app/api/trial/start';
const TRIAL_DURATION_SECS = 7 * 24 * 60 * 60;

export function TrialScreen({ onNext }: Props) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'trial' | 'key'>('trial');
  const [licenseKey, setLicenseKey] = useState('');
  const { startTrial, activateLicense, selectedPlan } = useLicenseStore();

  // Free plan - skip this screen entirely
  useEffect(() => {
    if (!billingPlansEnabled || selectedPlan === 'free') onNext();
  }, [selectedPlan, onNext]);

  const handleStartTrial = async () => {
    if (!email.includes('@')) { setError('Enter a valid email'); return; }
    setLoading(true);
    setError('');
    try {
      // Best-effort server registration - proceed even if it fails
      let expiresAt = Math.floor(Date.now() / 1000) + TRIAL_DURATION_SECS;
      try {
        const res = await fetch(TRIAL_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (res.ok) {
          const data = await res.json();
          expiresAt = Math.floor(data.expires_at / 1000);
        }
      } catch {}
      await startTrial(email, expiresAt);
      onNext();
    } catch (e) {
      setError(errorMessage(e, 'Something went wrong'));
    } finally {
      setLoading(false);
    }
  };

  const handleActivateKey = async () => {
    if (!licenseKey.trim()) { setError('Enter your license key'); return; }
    setLoading(true);
    setError('');
    try {
      await activateLicense(licenseKey.trim());
      onNext();
    } catch (e) {
      setError(errorMessage(e, 'Invalid license key'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <OnboardingShell step={4} total={7}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 6 }}>
          Start your {selectedPlan === 'proPlus' ? 'Pro+' : 'Pro'} free trial
        </div>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)' }}>
          7 days of {selectedPlan === 'proPlus' ? 'Pro+' : 'Pro'}, free. No credit card needed.
        </div>
      </div>

      {mode === 'trial' ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Email address
            </label>
            <input
              className="glass-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleStartTrial()}
            />
          </div>
          {error && <div style={{ fontSize: 12, color: '#f87171' }}>{error}</div>}
          <button className="btn-primary" onClick={handleStartTrial} disabled={loading || !email}>
            {loading ? 'Starting…' : 'Start free trial →'}
          </button>
          <button
            className="btn-secondary"
            onClick={() => { setMode('key'); setError(''); }}
          >
            Already have a license key?
          </button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              License key
            </label>
            <input
              className="glass-input"
              placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
            />
          </div>
          {error && <div style={{ fontSize: 12, color: '#f87171' }}>{error}</div>}
          <button className="btn-primary" onClick={handleActivateKey} disabled={loading || !licenseKey}>
            {loading ? 'Validating…' : 'Activate →'}
          </button>
          <button className="btn-secondary" onClick={() => { setMode('trial'); setError(''); }}>
            ← Back to trial
          </button>
        </>
      )}
    </OnboardingShell>
  );
}
