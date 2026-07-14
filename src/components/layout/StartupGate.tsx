import { SceneBackground } from './SceneBackground';

interface StartupGateProps {
  error: string | null;
  onRetry: () => void;
  actionLabel?: string;
}

export function StartupGate({ error, onRetry, actionLabel = 'Try again' }: StartupGateProps) {
  const failed = error != null;

  return (
    <div className="app-shell">
      <SceneBackground />
      <div className="scene-overlay" data-tauri-drag-region />
      <div
        role={failed ? 'alert' : 'status'}
        aria-live="polite"
        className="glass-card"
        style={{
          position: 'relative',
          zIndex: 2,
          width: 'min(360px, calc(100vw - 40px))',
          margin: 'auto',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
          {failed ? 'Duskry could not load your settings' : 'Opening Duskry…'}
        </div>
        {failed && (
          <>
            <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.55, color: 'rgba(255,255,255,0.5)' }}>
              {error}
            </div>
            <button
              type="button"
              className="btn-primary"
              style={{ width: 'auto', margin: '18px auto 0', padding: '8px 16px' }}
              onClick={onRetry}
            >
              {actionLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
