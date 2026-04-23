import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { OnboardingShell } from './OnboardingShell';
import { CheckCircle } from 'lucide-react';

interface Props { onNext: () => void; }

export function PermissionsScreen({ onNext }: Props) {
  const [os, setOs] = useState<'macos' | 'windows' | 'unknown'>('unknown');
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);

  useEffect(() => {
    invoke<string>('get_os').then((o) => setOs(o as any));
  }, []);

  useEffect(() => {
    if (os !== 'macos') return;
    const id = setInterval(async () => {
      const granted = await invoke<boolean>('check_accessibility');
      setAccessibilityGranted(granted);
    }, 1000);
    return () => clearInterval(id);
  }, [os]);

  const canProceed = os === 'windows' || accessibilityGranted;

  return (
    <OnboardingShell step={1} total={7}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 6 }}>A couple of permissions</div>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)', marginBottom: 16 }}>
          Duskry needs these to track your activity. Your data never leaves your machine.
        </div>
      </div>

      {os === 'macos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PermissionRow
            title="Accessibility access"
            description="Required to read the active window title and app name."
            granted={accessibilityGranted}
            onGrant={() => invoke('request_accessibility')}
          />
          <PermissionRow
            title="Screen Recording (optional)"
            description="Only needed for file path tracking in sandboxed apps."
            granted={false}
            onGrant={() => invoke('request_screen_recording')}
            optional
          />
        </div>
      )}

      {os === 'windows' && (
        <div className="permission-row">
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Foreground window access</div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>
              Granted automatically, no action needed.
            </div>
          </div>
          <span className="permission-status-granted">
            <CheckCircle size={14} style={{ display: 'inline', marginRight: 4 }}/>Granted
          </span>
        </div>
      )}

      <button className="btn-primary" onClick={onNext} disabled={!canProceed}>
        Continue →
      </button>
      {os === 'macos' && !accessibilityGranted && (
        <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.28)' }}>
          Grant Accessibility access to continue
        </div>
      )}
    </OnboardingShell>
  );
}

function PermissionRow({
  title, description, granted, onGrant, optional
}: {
  title: string;
  description: string;
  granted: boolean;
  onGrant: () => void;
  optional?: boolean;
}) {
  return (
    <div className="permission-row">
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>
          {title}
          {optional && <span style={{ marginLeft: 6, fontSize: 10, color: 'rgba(255,255,255,0.30)' }}>optional</span>}
        </div>
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>{description}</div>
      </div>
      {granted ? (
        <span className="permission-status-granted">
          <CheckCircle size={14} style={{ display: 'inline', marginRight: 4 }}/>Granted
        </span>
      ) : (
        <button className="btn-secondary" style={{ width: 'auto', padding: '5px 12px', fontSize: 11.5 }} onClick={onGrant}>
          Grant →
        </button>
      )}
    </div>
  );
}
