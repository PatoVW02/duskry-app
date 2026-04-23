import { SceneBackground } from '../layout/SceneBackground';

interface Props {
  children: React.ReactNode;
  step: number;
  total: number;
}

export function OnboardingShell({ children, step, total }: Props) {
  return (
    <div className="onboarding-overlay">
      <SceneBackground />
      <div className="scene-overlay" />
      <div className="onboarding-card glass-card" style={{ position: 'relative', zIndex: 2 }}>
        <div className="step-dots">
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} className={`dot ${i === step ? 'active' : ''}`} />
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}
