import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle, XCircle, HelpCircle } from 'lucide-react';

type PermissionState = 'granted' | 'denied' | 'unknown';

interface PermissionStatus {
  accessibility: PermissionState;
  screenRecording: PermissionState;
  notifications: PermissionState;
}

export function Permissions() {
  const [os, setOs] = useState<string>('unknown');
  const [status, setStatus] = useState<PermissionStatus>({
    accessibility: 'unknown',
    screenRecording: 'unknown',
    notifications: 'unknown',
  });

  const refresh = async () => {
    const [accessibility, screenRecording, notifications] = await Promise.all([
      invoke<boolean>('check_accessibility').then((v) => (v ? 'granted' : 'denied') as PermissionState),
      invoke<boolean>('check_screen_recording').then((v) => (v ? 'granted' : 'denied') as PermissionState),
      invoke<boolean>('get_notifications_enabled').then((v) => (v ? 'granted' : 'denied') as PermissionState),
    ]);
    setStatus({ accessibility, screenRecording, notifications });
  };

  useEffect(() => {
    invoke<string>('get_os').then(setOs);
    refresh();
    // Re-check every 2 seconds so the UI updates when user grants a permission
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="glass-card" style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 500 }}>Permissions</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.30)' }}>
          Status refreshes automatically
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <PermRow
          title="Accessibility"
          description="Required to read the active app name and window title for tracking."
          state={status.accessibility}
          onGrant={() => invoke('request_accessibility')}
          required
        />

        {os === 'macos' && (
          <PermRow
            title="Screen Recording"
            description="Optional. Needed for file path tracking in sandboxed or protected apps."
            state={status.screenRecording}
            onGrant={() => invoke('request_screen_recording')}
          />
        )}

        <PermRow
          title="Notifications"
          description="Optional. Enables morning focus reminders to set your project for the day."
          state={status.notifications}
          onGrant={async () => {
            await invoke('request_notification_permission');
            await refresh();
          }}
        />
      </div>

      {os === 'macos' && status.accessibility === 'denied' && (
        <div style={{
          marginTop: 16,
          padding: '10px 14px',
          borderRadius: 8,
          background: 'rgba(239,68,68,0.08)',
          border: '0.5px solid rgba(239,68,68,0.20)',
          fontSize: 12,
          color: 'rgba(255,255,255,0.55)',
          lineHeight: 1.6,
        }}>
          Accessibility is required for tracking to work. Click <strong style={{ color: 'rgba(255,255,255,0.8)' }}>Grant →</strong> to open System Settings, then toggle Duskry on.
        </div>
      )}
    </div>
  );
}

function PermRow({
  title,
  description,
  state,
  onGrant,
  required,
}: {
  title: string;
  description: string;
  state: PermissionState;
  onGrant: () => void;
  required?: boolean;
}) {
  return (
    <div className="permission-row">
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
          {title}
          {!required && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)' }}>optional</span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.42)', marginTop: 3, lineHeight: 1.5 }}>
          {description}
        </div>
      </div>

      {state === 'granted' ? (
        <span className="permission-status-granted" style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          <CheckCircle size={13} /> Granted
        </span>
      ) : state === 'denied' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'rgba(239,68,68,0.8)', whiteSpace: 'nowrap' }}>
            <XCircle size={13} /> Not granted
          </span>
          <button
            className="btn-secondary"
            style={{ width: 'auto', padding: '5px 12px', fontSize: 11.5 }}
            onClick={onGrant}
          >
            Grant →
          </button>
        </div>
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' }}>
          <HelpCircle size={13} /> Unknown
        </span>
      )}
    </div>
  );
}
