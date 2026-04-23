import { createContext, useContext } from 'react';
import type { UpdateStatus } from '../hooks/useUpdater';

interface UpdaterContextValue {
  status: UpdateStatus;
  checkForUpdates: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
}

export const UpdaterContext = createContext<UpdaterContextValue>({
  status: { state: 'idle' },
  checkForUpdates: async () => {},
  downloadAndInstall: async () => {},
});

export function useUpdaterContext() {
  return useContext(UpdaterContext);
}
