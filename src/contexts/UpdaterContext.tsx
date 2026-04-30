import { createContext, useContext } from 'react';
import type { UpdateCheckResult, UpdateStatus } from '../hooks/useUpdater';

interface UpdaterContextValue {
  status: UpdateStatus;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  downloadAndInstall: () => Promise<void>;
}

export const UpdaterContext = createContext<UpdaterContextValue>({
  status: { state: 'idle' },
  checkForUpdates: async () => ({ kind: 'upToDate' }),
  downloadAndInstall: async () => {},
});

export function useUpdaterContext() {
  return useContext(UpdaterContext);
}
