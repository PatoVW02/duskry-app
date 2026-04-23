import { OnboardingShell } from './OnboardingShell';

interface Props { onNext: () => void; }

export function WelcomeScreen({ onNext }: Props) {
  return (
    <OnboardingShell step={0} total={7}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-1px', color: 'rgba(45,212,191,0.9)' }}>
          duskry
        </div>
        <div style={{ fontSize: 20, fontWeight: 300, color: 'rgba(255,255,255,0.85)', letterSpacing: '-0.3px' }}>
          Know where your time<br/>actually goes.
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
          Automatic time tracking. No timers. No manual input.
        </div>
      </div>
      <button className="btn-primary" onClick={onNext} style={{ marginTop: 8 }}>
        Get started →
      </button>
    </OnboardingShell>
  );
}
