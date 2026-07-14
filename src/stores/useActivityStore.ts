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
  original_started_at?: number | null;
  original_ended_at?: number | null;
  original_duration_s?: number | null;
  time_clipped?: boolean;
  project_id: number | null;
  source: string | null;
  rule_id?: number | null;
  assignment_confidence?: number | null;
  assignment_reason?: string | null;
}

export interface RuleSuggestion {
  rule_id: number | null;
  project_id: number;
  project_name: string;
  project_color: string;
  field: string;
  operator: string;
  value: string;
  count: number;
  total_count: number;
  day_count: number;
  confidence: number;
  auto_created: boolean;
  label: string;
}

interface ActivityStore {
  activities: Activity[];
  ruleNotices: RuleSuggestion[];
  loading: boolean;
  error: string | null;
  viewDate: Date;
  fetchToday: () => Promise<void>;
  fetchForDate: (date: Date) => Promise<void>;
  setViewDate: (date: Date) => void;
  stepDate: (delta: -1 | 1) => void;
  goToToday: () => void;
  assignToProject: (activityId: number, projectId: number) => Promise<RuleSuggestion | null>;
  assignActivitiesToProject: (activityIds: number[], projectId: number) => Promise<RuleSuggestion[]>;
  dismissRuleNotice: () => void;
  clearPendingRuleSuggestions: () => void;
  unassignFromProject: (activityId: number) => Promise<void>;
  assignAllUnassignedToday: (projectId: number) => Promise<void>;
  deleteActivity: (activityId: number) => Promise<void>;
  updateActivity: (activityId: number, appName: string, windowTitle: string, startedAt: number, endedAt: number) => Promise<void>;
  createManualActivity: (title: string, note: string, projectId: number | null, startedAt: number, durationS: number) => Promise<void>;
  totalTrackedSecs: () => number;
}

// Every screen reads through the same activity store. Date navigation and the
// 10-second live refresh can overlap, so only the newest request is allowed to
// publish data or loading/error state.
let latestActivityRequestId = 0;

function rulePatternKey(notice: RuleSuggestion): string {
  return `${notice.project_id}:${notice.field}:${notice.operator}:${notice.value.toLocaleLowerCase()}`;
}

function appendRuleNotices(
  current: RuleSuggestion[],
  incoming: Array<RuleSuggestion | null>,
): RuleSuggestion[] {
  const next = [...current];
  for (const notice of incoming) {
    if (!notice) continue;
    const patternKey = rulePatternKey(notice);
    const existingIndex = next.findIndex((queued) => rulePatternKey(queued) === patternKey);
    if (existingIndex < 0) {
      next.push(notice);
    } else if (notice.auto_created || !next[existingIndex].auto_created) {
      // An Autopilot result supersedes a still-queued Ask-mode suggestion for
      // the same pattern. Never let stale UI convert or dismiss an active rule.
      next[existingIndex] = notice;
    }
  }
  return next;
}

export const useActivityStore = create<ActivityStore>((set, get) => ({
  activities: [],
  ruleNotices: [],
  loading: false,
  error: null,
  viewDate: new Date(),

  fetchForDate: async (date: Date) => {
    const requestId = ++latestActivityRequestId;
    set({ loading: true, error: null });
    try {
      const fromTs = Math.floor(startOfDay(date).getTime() / 1000);
      const toTs   = Math.floor(endOfDay(date).getTime() / 1000);
      const data = await invoke<Activity[]>('get_activities_for_date', { fromTs, toTs });
      if (requestId !== latestActivityRequestId) return;
      set({ activities: data, loading: false, error: null });
    } catch (error) {
      if (requestId !== latestActivityRequestId) return;
      set({
        loading: false,
        error: typeof error === 'string'
          ? error
          : error instanceof Error
            ? error.message
            : 'Today’s activity could not be loaded.',
      });
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
    if (suggestion) {
      set((state) => ({ ruleNotices: appendRuleNotices(state.ruleNotices, [suggestion]) }));
    }
    await get().fetchForDate(get().viewDate);
    return suggestion;
  },

  assignActivitiesToProject: async (activityIds, projectId) => {
    if (activityIds.length === 0) return [];
    const suggestions = await invoke<RuleSuggestion[]>('assign_activities', { activityIds, projectId });
    if (suggestions.length > 0) {
      set((state) => ({ ruleNotices: appendRuleNotices(state.ruleNotices, suggestions) }));
    }
    await get().fetchForDate(get().viewDate);
    return suggestions;
  },

  dismissRuleNotice: () => {
    set((state) => ({ ruleNotices: state.ruleNotices.slice(1) }));
  },

  clearPendingRuleSuggestions: () => {
    set((state) => ({
      ruleNotices: state.ruleNotices.filter((notice) => notice.auto_created),
    }));
  },

  unassignFromProject: async (activityId) => {
    await invoke('unassign_activity', { activityId });
    await get().fetchForDate(get().viewDate);
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
