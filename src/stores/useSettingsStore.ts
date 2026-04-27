import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_AUTO_SCENE_SCHEDULE, type AutoSceneSlot, type SceneId } from '../lib/sceneConfig';
import { normalizeAutoSceneSchedule } from '../lib/utils';

interface SettingsStore {
  scene: SceneId;
  sceneAuto: boolean;
  autoSceneSchedule: AutoSceneSlot[];
  scenePreviewMode: boolean;
  scenePreviewScene: SceneId | null;
  onboardingComplete: boolean;
  /** 0 means no focus project set */
  activeProjectId: number;
  rulesOverrideActive: boolean;
  autoRuleSuggestionsEnabled: boolean;
  autoCreateSuggestedRulesEnabled: boolean;
  trackingPaused: boolean;
  idleThresholdSecs: number;
  loadSettings: () => Promise<void>;
  setScene: (scene: SceneId) => Promise<void>;
  setSceneAuto: (auto: boolean) => Promise<void>;
  setAutoSceneSchedule: (schedule: AutoSceneSlot[]) => Promise<void>;
  openScenePreview: (scene: SceneId) => void;
  closeScenePreview: () => void;
  setOnboardingComplete: () => Promise<void>;
  setActiveProject: (projectId: number) => Promise<void>;
  setRulesOverrideActive: (enabled: boolean) => Promise<void>;
  setAutoRuleSuggestionsEnabled: (enabled: boolean) => Promise<void>;
  setAutoCreateSuggestedRulesEnabled: (enabled: boolean) => Promise<void>;
  setTrackingPaused: (paused: boolean) => Promise<void>;
  setIdleThreshold: (secs: number) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  scene: 'night-mountains',
  sceneAuto: true,
  autoSceneSchedule: DEFAULT_AUTO_SCENE_SCHEDULE,
  scenePreviewMode: false,
  scenePreviewScene: null,
  onboardingComplete: false,
  activeProjectId: 0,
  rulesOverrideActive: true,
  autoRuleSuggestionsEnabled: true,
  autoCreateSuggestedRulesEnabled: false,
  trackingPaused: false,
  idleThresholdSecs: 300,

  loadSettings: async () => {
    try {
      const scene         = await invoke<string | null>('get_setting', { key: 'scene' });
      const sceneAuto     = await invoke<string | null>('get_setting', { key: 'scene_auto' });
      const autoSceneSchedule = await invoke<string | null>('get_setting', { key: 'scene_auto_schedule' });
      const ob            = await invoke<string | null>('get_setting', { key: 'onboarding_complete' });
      const activeProject = await invoke<number>('get_active_project');
      const rulesOverride = await invoke<boolean>('get_rules_override');
      const autoRuleSuggestions = await invoke<string | null>('get_setting', { key: 'auto_rule_suggestions_enabled' });
      const autoCreateSuggestedRules = await invoke<string | null>('get_setting', { key: 'auto_create_suggested_rules_enabled' });
      const paused        = await invoke<boolean>('get_tracking_paused');
      const idleThreshold = await invoke<number>('get_idle_threshold');
      const parsedSchedule = autoSceneSchedule
        ? normalizeAutoSceneSchedule(JSON.parse(autoSceneSchedule) as AutoSceneSlot[])
        : DEFAULT_AUTO_SCENE_SCHEDULE;
      set({
        scene: (scene ?? 'night-mountains') as SceneId,
        sceneAuto: sceneAuto == null ? true : sceneAuto === 'true',
        autoSceneSchedule: parsedSchedule,
        onboardingComplete: ob === 'true',
        activeProjectId: activeProject,
        rulesOverrideActive: rulesOverride,
        autoRuleSuggestionsEnabled: autoRuleSuggestions == null ? true : autoRuleSuggestions === 'true',
        autoCreateSuggestedRulesEnabled: autoCreateSuggestedRules === 'true',
        trackingPaused: paused,
        idleThresholdSecs: idleThreshold,
      });
    } catch {}
  },

  setScene: async (scene) => {
    await invoke('set_setting', { key: 'scene', value: scene });
    set({ scene });
  },

  setSceneAuto: async (auto) => {
    await invoke('set_setting', { key: 'scene_auto', value: String(auto) });
    set({ sceneAuto: auto });
  },

  setAutoSceneSchedule: async (schedule) => {
    const normalized = normalizeAutoSceneSchedule(schedule);
    await invoke('set_setting', {
      key: 'scene_auto_schedule',
      value: JSON.stringify(normalized),
    });
    set({ autoSceneSchedule: normalized });
  },

  openScenePreview: (scene) => {
    set({ scenePreviewMode: true, scenePreviewScene: scene });
  },

  closeScenePreview: () => {
    set({ scenePreviewMode: false, scenePreviewScene: null });
  },

  setOnboardingComplete: async () => {
    await invoke('set_setting', { key: 'onboarding_complete', value: 'true' });
    set({ onboardingComplete: true });
  },

  setActiveProject: async (projectId) => {
    await invoke('set_active_project', { projectId });
    set({ activeProjectId: projectId });
  },

  setRulesOverrideActive: async (enabled) => {
    await invoke('set_rules_override', { enabled });
    set({ rulesOverrideActive: enabled });
  },

  setAutoRuleSuggestionsEnabled: async (enabled) => {
    await invoke('set_setting', { key: 'auto_rule_suggestions_enabled', value: String(enabled) });
    set({ autoRuleSuggestionsEnabled: enabled });
  },

  setAutoCreateSuggestedRulesEnabled: async (enabled) => {
    await invoke('set_setting', { key: 'auto_create_suggested_rules_enabled', value: String(enabled) });
    set({ autoCreateSuggestedRulesEnabled: enabled });
  },

  setTrackingPaused: async (paused) => {
    await invoke('set_tracking_paused', { paused });
    set({ trackingPaused: paused });
  },

  setIdleThreshold: async (secs) => {
    await invoke('set_idle_threshold', { secs });
    set({ idleThresholdSecs: secs });
  },
}));
