import { useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'upToDate' }
  | { state: 'available'; update: Update; version: string; message?: string }
  | { state: 'downloading'; progress: number }
  | { state: 'downloaded'; update: Update; version: string; message?: string }
  | { state: 'error'; message: string };

export type UpdateCheckResult =
  | { kind: 'upToDate' }
  | { kind: 'available'; version: string }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string };

const LAST_AUTO_UPDATE_CHECK_KEY = 'last_auto_update_check_date';
export const AUTO_UPDATE_POLL_MS = 60 * 60 * 1000; // poll hourly, but only run once per local day

function isMissingWindowsInstallerError(error: unknown) {
  const message = String(error).toLowerCase();
  const mentionsMissingAsset =
    message.includes('not found') ||
    message.includes('missing');
  const mentionsWindowsInstaller =
    message.includes('.msi') ||
    message.includes('.exe') ||
    message.includes('installer');

  return mentionsMissingAsset && mentionsWindowsInstaller;
}

export function localDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function updaterErrorMessage(error: unknown) {
  if (isMissingWindowsInstallerError(error)) {
    return 'This release does not include a compatible Windows installer. Please try again later or contact support.';
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  const message = String(error).replace(/^Error:\s*/i, '').trim();
  return message || 'The update could not be completed. Please try again.';
}

async function getStoredValue(key: string) {
  return invoke<string | null>('get_setting', { key });
}

async function setStoredValue(key: string, value: string) {
  await invoke('set_setting', { key, value });
}

async function notifyUpdateReady(version: string) {
  await invoke('notify_update_ready', { version });
}

export function useUpdater() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const activeCheckRef = useRef<Promise<UpdateCheckResult> | null>(null);
  const lastAutomaticCheckRef = useRef<string | null>(null);

  async function installReadyUpdate(update: Update, version: string) {
    setStatus({ state: 'downloading', progress: 100 });
    try {
      await update.install();
      await relaunch();
    } catch (err) {
      setStatus({ state: 'downloaded', update, version, message: updaterErrorMessage(err) });
    }
  }

  function checkForUpdates(options?: { autoDownload?: boolean }): Promise<UpdateCheckResult> {
    // Startup, Settings, and the daily background check can overlap. All callers
    // should observe the same result instead of one of them being told that the
    // app is current while another check is still running.
    if (activeCheckRef.current) return activeCheckRef.current;

    const task = (async (): Promise<UpdateCheckResult> => {
      setStatus({ state: 'checking' });
      let update: Update | null = null;
      try {
        update = await check();
      } catch (err) {
        const message = updaterErrorMessage(err);
        setStatus({ state: 'error', message });
        return { kind: 'error', message };
      }

      if (!update?.available) {
        setStatus({ state: 'upToDate' });
        return { kind: 'upToDate' };
      }

      if (!options?.autoDownload) {
        setStatus({ state: 'available', update, version: update.version });
        return { kind: 'available', version: update.version };
      }

      setStatus({ state: 'downloading', progress: 0 });
      try {
        let downloaded = 0;
        let total = 0;
        await update.download((event) => {
          if (event.event === 'Started') {
            total = event.data.contentLength ?? 0;
          } else if (event.event === 'Progress') {
            downloaded += event.data.chunkLength;
            const progress = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
            setStatus({ state: 'downloading', progress });
          }
        });
      } catch (err) {
        const message = updaterErrorMessage(err);
        setStatus({ state: 'available', update, version: update.version, message });
        return { kind: 'error', message };
      }

      setStatus({ state: 'downloaded', update, version: update.version });
      try {
        await notifyUpdateReady(update.version);
      } catch (err) {
        // Notifications are optional. A denied/broken notification must never
        // discard an update that has already downloaded successfully.
        console.warn('Could not send update-ready notification:', err);
      }
      return { kind: 'downloaded', version: update.version };
    })();

    activeCheckRef.current = task;
    void task.finally(() => {
      if (activeCheckRef.current === task) activeCheckRef.current = null;
    });
    return task;
  }

  async function runAutomaticUpdateCheck() {
    const today = localDayKey();
    if (lastAutomaticCheckRef.current === today) return;

    let lastCheck: string | null = null;
    try {
      lastCheck = await getStoredValue(LAST_AUTO_UPDATE_CHECK_KEY);
    } catch (err) {
      console.warn('Could not read the last automatic update-check date:', err);
    }
    if (lastCheck === today) {
      lastAutomaticCheckRef.current = today;
      return;
    }

    // Set the in-memory guard before any awaited work so simultaneous startup
    // effects cannot launch duplicate checks even if settings storage is down.
    lastAutomaticCheckRef.current = today;
    const result = await checkForUpdates({ autoDownload: true });
    if (result.kind === 'error') {
      // A transient network or release error should be retried on the next
      // hourly poll instead of suppressing checks for the rest of the day.
      lastAutomaticCheckRef.current = null;
      return result;
    }
    try {
      await setStoredValue(LAST_AUTO_UPDATE_CHECK_KEY, today);
    } catch (err) {
      console.warn('Could not save the automatic update-check date:', err);
    }
    return result;
  }

  async function downloadAndInstall() {
    if (status.state === 'downloaded') {
      await installReadyUpdate(status.update, status.version);
      return;
    }
    if (status.state !== 'available') return;
    const { update, version } = status;
    setStatus({ state: 'downloading', progress: 0 });
    try {
      let downloaded = 0;
      let total = 0;
      await update.download((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          const progress = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
          setStatus({ state: 'downloading', progress });
        }
      });
    } catch (err) {
      setStatus({ state: 'available', update, version, message: updaterErrorMessage(err) });
      return;
    }
    setStatus({ state: 'downloaded', update, version });
    await installReadyUpdate(update, version);
  }

  return { status, checkForUpdates, runAutomaticUpdateCheck, downloadAndInstall };
}
