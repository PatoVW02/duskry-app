import { useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'upToDate' }
  | { state: 'available'; update: Update; version: string }
  | { state: 'downloading'; progress: number }
  | { state: 'downloaded'; update: Update; version: string }
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

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function getStoredValue(key: string) {
  return invoke<string | null>('get_setting', { key });
}

async function setStoredValue(key: string, value: string) {
  await invoke('set_setting', { key, value });
}

async function ensureNotificationPermission() {
  if (await isPermissionGranted()) return true;
  const permission = await requestPermission();
  return permission === 'granted';
}

async function notifyUpdateReady(version: string) {
  if (!(await ensureNotificationPermission())) return;
  sendNotification({
    title: `Duskry ${version} is ready`,
    body: 'Click to open Settings > About and restart when you are ready.',
    autoCancel: true,
    extra: {
      kind: 'update-ready',
      version,
    },
  });
}

export function useUpdater() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const checkingRef = useRef(false);

  async function installReadyUpdate(update: Update, version: string) {
    setStatus({ state: 'downloading', progress: 100 });
    try {
      await update.install();
      await relaunch();
    } catch (err) {
      if (isMissingWindowsInstallerError(err)) {
        setStatus({ state: 'upToDate' });
      } else {
        setStatus({ state: 'error', message: String(err) });
        setStatus({ state: 'downloaded', update, version });
      }
    }
  }

  async function checkForUpdates(options?: { autoDownload?: boolean }): Promise<UpdateCheckResult> {
    if (checkingRef.current) return { kind: 'upToDate' };
    checkingRef.current = true;
    setStatus({ state: 'checking' });
    try {
      const update = await check();
      if (update?.available) {
        if (options?.autoDownload) {
          setStatus({ state: 'downloading', progress: 0 });
          let downloaded = 0;
          let total = 0;
          await update.download((event) => {
            if (event.event === 'Started') {
              total = event.data.contentLength ?? 0;
            } else if (event.event === 'Progress') {
              downloaded += event.data.chunkLength;
              const progress = total > 0 ? Math.round((downloaded / total) * 100) : 0;
              setStatus({ state: 'downloading', progress });
            } else if (event.event === 'Finished') {
              setStatus({ state: 'downloaded', update, version: update.version });
            }
          });
          setStatus({ state: 'downloaded', update, version: update.version });
          await notifyUpdateReady(update.version);
          return { kind: 'downloaded', version: update.version };
        } else {
          setStatus({ state: 'available', update, version: update.version });
          return { kind: 'available', version: update.version };
        }
      } else {
        setStatus({ state: 'upToDate' });
        return { kind: 'upToDate' };
      }
    } catch (err) {
      if (isMissingWindowsInstallerError(err)) {
        setStatus({ state: 'upToDate' });
        return { kind: 'upToDate' };
      } else {
        const message = String(err);
        setStatus({ state: 'error', message });
        return { kind: 'error', message };
      }
    } finally {
      checkingRef.current = false;
    }

    return { kind: 'upToDate' };
  }

  async function runAutomaticUpdateCheck() {
    const today = todayKey();
    const lastCheck = await getStoredValue(LAST_AUTO_UPDATE_CHECK_KEY);
    if (lastCheck === today) return;

    await setStoredValue(LAST_AUTO_UPDATE_CHECK_KEY, today);
    await checkForUpdates({ autoDownload: true });
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
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          const progress = total > 0 ? Math.round((downloaded / total) * 100) : 0;
          setStatus({ state: 'downloading', progress });
        }
      });
      await relaunch();
    } catch (err) {
      if (isMissingWindowsInstallerError(err)) {
        setStatus({ state: 'upToDate' });
      } else {
        setStatus({ state: 'error', message: String(err) });
        setStatus({ state: 'available', update, version });
      }
    }
  }

  return { status, checkForUpdates, runAutomaticUpdateCheck, downloadAndInstall };
}
