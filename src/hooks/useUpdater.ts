import { useRef, useState } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'upToDate' }
  | { state: 'available'; update: Update; version: string }
  | { state: 'downloading'; progress: number }
  | { state: 'error'; message: string };

export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export function useUpdater() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const checkingRef = useRef(false);

  async function checkForUpdates() {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setStatus({ state: 'checking' });
    try {
      const update = await check();
      if (update?.available) {
        setStatus({ state: 'available', update, version: update.version });
      } else {
        setStatus({ state: 'upToDate' });
      }
    } catch (err) {
      setStatus({ state: 'error', message: String(err) });
    } finally {
      checkingRef.current = false;
    }
  }

  async function downloadAndInstall() {
    if (status.state !== 'available') return;
    const { update } = status;
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
      setStatus({ state: 'error', message: String(err) });
    }
  }

  return { status, checkForUpdates, downloadAndInstall };
}
