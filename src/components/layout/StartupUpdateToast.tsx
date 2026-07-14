interface StartupUpdateToastProps {
  kind: 'available' | 'downloaded';
  version: string;
  onDismiss: () => void;
  onOpenUpdater: () => void;
}

export function StartupUpdateToast({
  kind,
  version,
  onDismiss,
  onOpenUpdater,
}: StartupUpdateToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="glass-card"
      style={{
        position: 'absolute',
        top: 18,
        right: 24,
        zIndex: 30,
        width: 320,
        padding: '14px 14px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: 'rgba(8, 18, 24, 0.82)',
        border: '1px solid rgba(45,212,191,0.22)',
        boxShadow: '0 16px 40px rgba(0,0,0,0.28)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.92)' }}>
            {kind === 'downloaded' ? 'Update Ready' : 'Update Available'}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 4, lineHeight: 1.45 }}>
            Duskry {version} {kind === 'downloaded' ? 'has already been downloaded.' : 'is available to install.'}
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss update notification"
          onClick={onDismiss}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'rgba(255,255,255,0.42)',
            cursor: 'pointer',
            padding: 0,
            boxShadow: 'none',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn-secondary"
          style={{ width: 'auto', padding: '7px 12px', fontSize: 12 }}
          onClick={onDismiss}
        >
          Later
        </button>
        <button
          type="button"
          className="btn-primary"
          style={{ width: 'auto', padding: '7px 12px', fontSize: 12 }}
          onClick={onOpenUpdater}
        >
          Open updater
        </button>
      </div>
    </div>
  );
}
