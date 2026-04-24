import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { startOfDay, endOfDay, isToday } from 'date-fns';

export interface Activity {
  id: number;
  app_name: string;
  window_title: string | null;
  file_path: string | null;
  domain: string | null;
  started_at: number;
  ended_at: number | null;
  duration_s: number | null;
  project_id: number | null;
  source: string | null;
}

export interface RuleSuggestion {
  project_id: number;
  project_name: string;
  project_color: string;
  field: string;
  operator: string;
  value: string;
  count: number;
  label: string;
}

interface ActivityStore {
  activities: Activity[];
  loading: boolean;
  viewDate: Date;
  fetchToday: () => Promise<void>;
  fetchForDate: (date: Date) => Promise<void>;
  setViewDate: (date: Date) => void;
  stepDate: (delta: -1 | 1) => void;
  goToToday: () => void;
  assignToProject: (activityId: number, projectId: number) => Promise<RuleSuggestion | null>;
  assignAllUnassignedToday: (projectId: number) => Promise<void>;
  deleteActivity: (activityId: number) => Promise<void>;
  updateActivity: (activityId: number, appName: string, windowTitle: string, startedAt: number, endedAt: number) => Promise<void>;
  createManualActivity: (title: string, note: string, projectId: number | null, startedAt: number, durationS: number) => Promise<void>;
  totalTrackedSecs: () => number;
}

export const useActivityStore = create<ActivityStore>((set, get) => ({
  activities: [],
  loading: false,
  viewDate: new Date(),

  fetchForDate: async (date: Date) => {
    set({ loading: true });
    try {
      const fromTs = Math.floor(startOfDay(date).getTime() / 1000);
      const toTs   = Math.floor(endOfDay(date).getTime() / 1000);
      const data = await invoke<Activity[]>('get_activities_for_date', { fromTs, toTs });
      set({ activities: data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchToday: async () => {
    const today = new Date();
    set({ viewDate: today });
    await get().fetchForDate(today);
  },

  setViewDate: (date: Date) => {
    set({ viewDate: date });
    get().fetchForDate(date);
  },

  stepDate: (delta: -1 | 1) => {
    const current = get().viewDate;
    const next = new Date(current);
    next.setDate(next.getDate() + delta);
    // Don't allow navigating to the future
    if (delta === 1 && isToday(current)) return;
    set({ viewDate: next });
    get().fetchForDate(next);
  },

  goToToday: () => {
    const today = new Date();
    set({ viewDate: today });
    get().fetchForDate(today);
  },

  assignToProject: async (activityId, projectId) => {
    const suggestion = await invoke<RuleSuggestion | null>('assign_activity', { activityId, projectId });
    await get().fetchForDate(get().viewDate);
    return suggestion;
  },

  assignAllUnassignedToday: async (projectId) => {
    await invoke('assign_all_unassigned_today', { projectId });
    await get().fetchForDate(get().viewDate);
  },

  deleteActivity: async (activityId) => {
    await invoke('delete_activity', { activityId });
    await get().fetchForDate(get().viewDate);
  },

  updateActivity: async (activityId, appName, windowTitle, startedAt, endedAt) => {
    await invoke('update_activity', { activityId, appName, windowTitle, startedAt, endedAt });
    await get().fetchForDate(get().viewDate);
  },

  createManualActivity: async (title, note, projectId, startedAt, durationS) => {
    await invoke('create_manual_activity', { title, note, projectId, startedAt, durationS });
    await get().fetchForDate(get().viewDate);
  },

  totalTrackedSecs: () => {
    return get().activities.reduce((sum, a) => sum + (a.duration_s ?? 0), 0);
  },
}));
