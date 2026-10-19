import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { OnboardingShell } from './OnboardingShell';
import { CheckCircle, Bell } from 'lucide-react';

interface Props { onNext: () => void; }

export function NotificationsScreen({ onNext }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEnable = async () => {
    try {
      await invoke('request_notification_permission');
      setEnabled(true); setError(null);
    } catch (reason) { setError(String(reason)); }
  };

  return (
    <OnboardingShell step={2} total={7}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 6 }}>Know what is being tracked</div>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)', marginBottom: 16 }}>
          Duskry tells you when a project session starts or an assignment needs review.
          Confirm or correct the project, and remember its context for next time.
        </div>
      </div>

      <div className="permission-row">
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Bell size={13} style={{ color: 'rgba(45,212,191,0.7)' }} />
            Notifications
          </div>
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>
            Session alerts with a quick path to correct assignments. Change this later in Settings.
          </div>
        </div>
        {enabled ? (
          <span className="permission-status-granted">
            <CheckCircle size={14} style={{ display: 'inline', marginRight: 4 }} />Enabled
          </span>
        ) : (
          <button
            className="btn-secondary"
            style={{ width: 'auto', padding: '5px 12px', fontSize: 11.5, flexShrink: 0 }}
            onClick={handleEnable}
          >
            Enable →
          </button>
        )}
      </div>

      {error && <p role="alert">{error}</p>}
      <button className="btn-primary" onClick={onNext} style={{ marginTop: 4 }}>
        {enabled ? 'Continue →' : 'Skip for now →'}
      </button>
    </OnboardingShell>
  );
}
