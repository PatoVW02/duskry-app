import { getVersion } from '@tauri-apps/api/app';
import packageJson from '../../package.json';

const PACKAGE_VERSION = (packageJson as { version?: string }).version ?? '0.0.0';

export async function getAppVersion(): Promise<string> {
  try {
    const tauriVersion = await getVersion();
    // In local development, package.json is usually the source of truth and may
    // be ahead of tauri.conf.json until release sync runs.
    if (import.meta.env.DEV && PACKAGE_VERSION) {
      return PACKAGE_VERSION;
    }
    return tauriVersion || PACKAGE_VERSION;
  } catch {
    return PACKAGE_VERSION;
  }
}

export function getPackageVersion(): string {
  return PACKAGE_VERSION;
}
