import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { OnboardingShell } from './OnboardingShell';
import { formatDurationLong } from '../../lib/utils';
import { useSettingsStore } from '../../stores/useSettingsStore';

interface Props { onDone: () => void; }

interface CurrentWindow { app_name: string; window_title: string; }

export function AllSetScreen({ onDone }: Props) {
  const [current, setCurrent] = useState<CurrentWindow | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const { setOnboardingComplete } = useSettingsStore();

  useEffect(() => {
    // Start tracking so the live preview works immediately
    invoke('start_tracking');
    const id = setInterval(async () => {
      try {
        const w = await invoke<CurrentWindow | null>('get_current_window');
        setCurrent(w);
        setElapsed((e) => e + 1);
      } catch {}
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const handleDone = async () => {
    await setOnboardingComplete();
    onDone();
  };

  return (
    <OnboardingShell step={6} total={7}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 6 }}>You're all set.</div>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)' }}>
          Duskry is now tracking in the background.
        </div>
      </div>

      <div style={{
        padding: '14px 16px',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.04)',
        border: '0.5px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Live now
        </div>
        {current ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="live-dot" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{current.app_name}</div>
              {current.window_title && (
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.40)', marginTop: 1 }}>
                  {current.window_title.length > 50
                    ? current.window_title.slice(0, 50) + '…'
                    : current.window_title}
                </div>
              )}
            </div>
            <div style={{ marginLeft: 'auto', fontSize: 12, color: 'rgba(255,255,255,0.40)', fontVariantNumeric: 'tabular-nums' }}>
              {formatDurationLong(elapsed)}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
            Switch to another app to see tracking start…
          </div>
        )}
      </div>

      <button className="btn-primary" onClick={handleDone}>
        Open dashboard →
      </button>
    </OnboardingShell>
  );
}
