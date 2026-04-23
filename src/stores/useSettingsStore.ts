import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { SceneId } from '../components/layout/SceneBackground';

interface SettingsStore {
  scene: SceneId;
  sceneAuto: boolean;
  onboardingComplete: boolean;
  /** 0 means no focus project set */
  activeProjectId: number;
  rulesOverrideActive: boolean;
  trackingPaused: boolean;
  loadSettings: () => Promise<void>;
  setScene: (scene: SceneId) => Promise<void>;
  setSceneAuto: (auto: boolean) => Promise<void>;
  setOnboardingComplete: () => Promise<void>;
  setActiveProject: (projectId: number) => Promise<void>;
  setRulesOverrideActive: (enabled: boolean) => Promise<void>;
  setTrackingPaused: (paused: boolean) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  scene: 'night-mountains',
  sceneAuto: false,
  onboardingComplete: false,
  activeProjectId: 0,
  rulesOverrideActive: true,
  trackingPaused: false,

  loadSettings: async () => {
    try {
      const scene         = await invoke<string | null>('get_setting', { key: 'scene' });
      const sceneAuto     = await invoke<string | null>('get_setting', { key: 'scene_auto' });
      const ob            = await invoke<string | null>('get_setting', { key: 'onboarding_complete' });
      const activeProject = await invoke<number>('get_active_project');
      const rulesOverride = await invoke<boolean>('get_rules_override');
      const paused        = await invoke<boolean>('get_tracking_paused');
      set({
        scene: (scene ?? 'night-mountains') as SceneId,
        sceneAuto: sceneAuto === 'true',
        onboardingComplete: ob === 'true',
        activeProjectId: activeProject,
        rulesOverrideActive: rulesOverride,
        trackingPaused: paused,
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

  setTrackingPaused: async (paused) => {
    await invoke('set_tracking_paused', { paused });
    set({ trackingPaused: paused });
  },
}));
