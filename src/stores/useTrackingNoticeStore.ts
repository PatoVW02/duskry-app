import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../lib/utils';
import { useActivityStore } from './useActivityStore';

export interface TrackingNotice {
  activity_id: number;
  app_name: string;
  window_title: string | null;
  project_id: number | null;
  suggested_project_id: number | null;
  confidence: number | null;
  reason: string;
  created_at: number;
  can_remember?: boolean;
}

interface TrackingNoticeStore {
  notices: TrackingNotice[];
  open: boolean;
  selectedId: number | null;
  saving: boolean;
  error: string | null;
  load: () => Promise<void>;
  show: (activityId?: number) => void;
  close: () => void;
  correct: (activityId: number, projectId: number, remember: boolean) => Promise<void>;
  dismiss: (activityId: number) => Promise<void>;
}

let requestId = 0;
export const useTrackingNoticeStore = create<TrackingNoticeStore>((set, get) => ({
  notices: [], open: false, selectedId: null, saving: false, error: null,
  load: async () => {
    const currentRequest = ++requestId;
    try {
      const notices = await invoke<TrackingNotice[]>('get_tracking_notices', { activityId: get().selectedId });
      if (currentRequest === requestId) set({ notices, error: null });
    } catch (error) {
      if (currentRequest === requestId) set({ error: errorMessage(error, 'Tracking alerts could not be loaded.') });
    }
  },
  show: (activityId) => set({ open: true, selectedId: activityId ?? null, error: null }),
  close: () => set({ open: false }),
  correct: async (activityId, projectId, remember) => {
    if (get().saving) return;
    ++requestId;
    set({ saving: true, error: null });
    try {
      await invoke('correct_tracking_assignment', { activityId, projectId, remember });
      ++requestId;
      // Remove only after the native transaction succeeds. Refresh reports too.
      set((state) => ({ notices: state.notices.filter((n) => n.activity_id !== activityId), selectedId: null }));
      const activities = useActivityStore.getState();
      await activities.fetchForDate(activities.viewDate);
    } catch (error) {
      set({ error: errorMessage(error, 'The assignment could not be saved.') });
    } finally { set({ saving: false }); }
  },
  dismiss: async (activityId) => {
    if (get().saving) return;
    ++requestId;
    set({ saving: true, error: null });
    try {
      await invoke('dismiss_tracking_notice', { activityId });
      ++requestId;
      set((state) => ({ notices: state.notices.filter((n) => n.activity_id !== activityId), selectedId: null }));
    } catch (error) {
      set({ error: errorMessage(error, 'The alert could not be dismissed.') });
    } finally { set({ saving: false }); }
  },
}));
