import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CirclePause, CirclePlay, ShieldAlert } from 'lucide-react';
import { useSettingsStore } from '../../stores/useSettingsStore';

interface CurrentWindow {
  app_name: string;
  window_title: string;
}

export function TrackerHealth({
  onOpenPermissions,
  compact = false,
}: {
  onOpenPermissions: () => void;
  compact?: boolean;
}) {
  const trackingPaused = useSettingsStore((state) => state.trackingPaused);
  const setTrackingPaused = useSettingsStore((state) => state.setTrackingPaused);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [currentWindow, setCurrentWindow] = useState<CurrentWindow | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [permission, current] = await Promise.all([
        invoke<boolean>('check_accessibility'),
        invoke<CurrentWindow | null>('get_current_window'),
      ]);
      setPermissionGranted(permission);
      setCurrentWindow(current);
    } catch {
      setPermissionGranted(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const checking = permissionGranted === null;
  const permissionMissing = permissionGranted === false;
  const label = 'Tracking';
  const detail = checking
    ? 'Checking…'
    : permissionMissing
      ? 'Permission needed'
      : trackingPaused
        ? 'Paused'
        : `Active${currentWindow?.app_name ? ` · ${currentWindow.app_name}` : ''}`;

  const handleClick = async () => {
    if (checking) return;
    if (permissionMissing) {
      onOpenPermissions();
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      await setTrackingPaused(!trackingPaused);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      className={`tracker-health tracker-health--${checking ? 'checking' : permissionMissing ? 'warning' : trackingPaused ? 'paused' : 'active'} ${compact ? 'tracker-health--compact' : ''}`}
      onClick={handleClick}
      disabled={saving || checking}
      aria-busy={checking}
      aria-label={`${label} ${detail}${permissionMissing ? '. Open permissions' : trackingPaused ? '. Click to resume' : '. Click to pause'}`}
      title={`${label} · ${detail}`}
    >
      {permissionMissing
        ? <ShieldAlert size={14} aria-hidden="true" />
        : trackingPaused
          ? <CirclePlay size={14} aria-hidden="true" />
          : <CirclePause size={14} aria-hidden="true" />}
      <span className="tracker-health__dot" aria-hidden="true" />
      <span className="tracker-health__copy">
        <strong>{label}</strong>
        {!compact && <small>{detail}</small>}
      </span>
    </button>
  );
}
