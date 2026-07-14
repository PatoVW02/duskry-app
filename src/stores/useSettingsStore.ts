import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_AUTO_SCENE_SCHEDULE, SCENE_IDS, type AutoSceneSlot, type SceneId } from '../lib/sceneConfig';
import { errorMessage, normalizeAutoSceneSchedule } from '../lib/utils';

export type RuleAutomationMode = 'off' | 'suggest' | 'automatic';

interface SettingsStore {
  scene: SceneId;
  sceneAuto: boolean;
  autoSceneSchedule: AutoSceneSlot[];
  scenePreviewMode: boolean;
  scenePreviewScene: SceneId | null;
  whatsNewModalOpen: boolean;
  onboardingComplete: boolean | null;
  settingsHydrated: boolean;
  settingsError: string | null;
  /** 0 means no focus project set */
  activeProjectId: number;
  rulesOverrideActive: boolean;
  autoRuleSuggestionsEnabled: boolean;
  autoCreateSuggestedRulesEnabled: boolean;
  ruleAutomationMode: RuleAutomationMode;
  ruleAutomationSaving: boolean;
  trackingPaused: boolean;
  idleThresholdSecs: number;
  loadSettings: () => Promise<void>;
  setScene: (scene: SceneId) => Promise<void>;
  setSceneAuto: (auto: boolean) => Promise<void>;
  setAutoSceneSchedule: (schedule: AutoSceneSlot[]) => Promise<void>;
  openScenePreview: (scene: SceneId) => void;
  closeScenePreview: () => void;
  openWhatsNewModal: () => void;
  closeWhatsNewModal: () => void;
  setOnboardingComplete: () => Promise<void>;
  setActiveProject: (projectId: number) => Promise<void>;
  setRulesOverrideActive: (enabled: boolean) => Promise<void>;
  setAutoRuleSuggestionsEnabled: (enabled: boolean) => Promise<void>;
  setAutoCreateSuggestedRulesEnabled: (enabled: boolean) => Promise<void>;
  setRuleAutomationMode: (mode: RuleAutomationMode) => Promise<void>;
  setTrackingPaused: (paused: boolean) => Promise<void>;
  setIdleThreshold: (secs: number) => Promise<void>;
}

type SettledResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

function settle<T>(promise: Promise<T>): Promise<SettledResult<T>> {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );
}

function parseBooleanSetting(value: string | null, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected true or false, received ${JSON.stringify(value)}`);
}

function isSceneId(value: unknown): value is SceneId {
  return typeof value === 'string' && SCENE_IDS.includes(value as SceneId);
}

function parseSceneSchedule(value: string | null): AutoSceneSlot[] {
  if (value == null) return normalizeAutoSceneSchedule(DEFAULT_AUTO_SCENE_SCHEDULE);
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Expected a non-empty schedule');
  }
  const valid = parsed.every((slot: unknown) => {
    if (!slot || typeof slot !== 'object') return false;
    const candidate = slot as { startMinutes?: unknown; scene?: unknown };
    return typeof candidate.startMinutes === 'number'
      && Number.isFinite(candidate.startMinutes)
      && candidate.startMinutes >= 0
      && candidate.startMinutes < 24 * 60
      && isSceneId(candidate.scene);
  });
  if (!valid) throw new Error('Schedule contains an invalid time or scene');
  return normalizeAutoSceneSchedule(parsed as AutoSceneSlot[]);
}

let latestSettingsRequestId = 0;

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  scene: 'night-mountains',
  sceneAuto: true,
  autoSceneSchedule: DEFAULT_AUTO_SCENE_SCHEDULE,
  scenePreviewMode: false,
  scenePreviewScene: null,
  whatsNewModalOpen: false,
  onboardingComplete: null,
  settingsHydrated: false,
  settingsError: null,
  activeProjectId: 0,
  rulesOverrideActive: true,
  autoRuleSuggestionsEnabled: true,
  autoCreateSuggestedRulesEnabled: false,
  ruleAutomationMode: 'suggest',
  ruleAutomationSaving: false,
  trackingPaused: false,
  idleThresholdSecs: 300,

  loadSettings: async () => {
    const requestId = ++latestSettingsRequestId;
    const [
      sceneResult,
      sceneAutoResult,
      scheduleResult,
      onboardingResult,
      activeProjectResult,
      rulesOverrideResult,
      autoRuleSuggestionsResult,
      autoCreateSuggestedRulesResult,
      trackingPausedResult,
      idleThresholdResult,
      databaseStartupErrorResult,
    ] = await Promise.all([
      settle(invoke<string | null>('get_setting', { key: 'scene' })),
      settle(invoke<string | null>('get_setting', { key: 'scene_auto' })),
      settle(invoke<string | null>('get_setting', { key: 'scene_auto_schedule' })),
      settle(invoke<string | null>('get_setting', { key: 'onboarding_complete' })),
      settle(invoke<number>('get_active_project')),
      settle(invoke<boolean>('get_rules_override')),
      settle(invoke<string | null>('get_setting', { key: 'auto_rule_suggestions_enabled' })),
      settle(invoke<string | null>('get_setting', { key: 'auto_create_suggested_rules_enabled' })),
      settle(invoke<boolean>('get_tracking_paused')),
      settle(invoke<number>('get_idle_threshold')),
      settle(invoke<string | null>('get_database_startup_error')),
    ]);

    if (requestId !== latestSettingsRequestId) return;

    const current = get();
    const next: Partial<SettingsStore> = { settingsHydrated: true };
    const errors: string[] = [];
    const recordFailure = (setting: string, error: unknown) => {
      errors.push(`${setting}: ${errorMessage(error, 'could not be loaded')}`);
    };

    if (sceneResult.ok) {
      if (sceneResult.value == null) next.scene = 'night-mountains';
      else if (isSceneId(sceneResult.value)) next.scene = sceneResult.value;
      else recordFailure('Scene', new Error('Unknown scene'));
    } else {
      recordFailure('Scene', sceneResult.error);
    }

    if (sceneAutoResult.ok) {
      try {
        next.sceneAuto = parseBooleanSetting(sceneAutoResult.value, true);
      } catch (error) {
        recordFailure('Automatic scene', error);
      }
    } else {
      recordFailure('Automatic scene', sceneAutoResult.error);
    }

    if (scheduleResult.ok) {
      try {
        next.autoSceneSchedule = parseSceneSchedule(scheduleResult.value);
      } catch (error) {
        next.autoSceneSchedule = normalizeAutoSceneSchedule(DEFAULT_AUTO_SCENE_SCHEDULE);
        recordFailure('Automatic scene schedule', error);
      }
    } else {
      recordFailure('Automatic scene schedule', scheduleResult.error);
    }

    if (onboardingResult.ok) {
      try {
        next.onboardingComplete = parseBooleanSetting(onboardingResult.value, false);
      } catch (error) {
        recordFailure('Onboarding status', error);
      }
    } else {
      recordFailure('Onboarding status', onboardingResult.error);
    }

    if (activeProjectResult.ok) {
      if (Number.isSafeInteger(activeProjectResult.value) && activeProjectResult.value >= 0) {
        next.activeProjectId = activeProjectResult.value;
      } else {
        recordFailure('Active project', new Error('Invalid project identifier'));
      }
    } else {
      recordFailure('Active project', activeProjectResult.error);
    }

    if (rulesOverrideResult.ok) {
      if (typeof rulesOverrideResult.value === 'boolean') next.rulesOverrideActive = rulesOverrideResult.value;
      else recordFailure('System rules', new Error('Invalid rules state'));
    } else {
      recordFailure('System rules', rulesOverrideResult.error);
    }

    let configuredSuggestionsEnabled = current.autoRuleSuggestionsEnabled;
    if (autoRuleSuggestionsResult.ok) {
      try {
        configuredSuggestionsEnabled = parseBooleanSetting(autoRuleSuggestionsResult.value, true);
      } catch (error) {
        recordFailure('Rule suggestions', error);
      }
    } else {
      recordFailure('Rule suggestions', autoRuleSuggestionsResult.error);
    }

    let automaticEnabled = current.autoCreateSuggestedRulesEnabled;
    if (autoCreateSuggestedRulesResult.ok) {
      try {
        automaticEnabled = parseBooleanSetting(autoCreateSuggestedRulesResult.value, false);
      } catch (error) {
        recordFailure('Automatic rules', error);
      }
    } else {
      recordFailure('Automatic rules', autoCreateSuggestedRulesResult.error);
    }
    const suggestionsEnabled = automaticEnabled || configuredSuggestionsEnabled;
    next.autoRuleSuggestionsEnabled = suggestionsEnabled;
    next.autoCreateSuggestedRulesEnabled = automaticEnabled;
    next.ruleAutomationMode = automaticEnabled ? 'automatic' : suggestionsEnabled ? 'suggest' : 'off';

    if (trackingPausedResult.ok) {
      if (typeof trackingPausedResult.value === 'boolean') next.trackingPaused = trackingPausedResult.value;
      else recordFailure('Tracking state', new Error('Invalid tracking state'));
    } else {
      recordFailure('Tracking state', trackingPausedResult.error);
    }

    if (idleThresholdResult.ok) {
      if (Number.isSafeInteger(idleThresholdResult.value) && idleThresholdResult.value >= 30) {
        next.idleThresholdSecs = idleThresholdResult.value;
      } else {
        recordFailure('Idle timeout', new Error('Invalid idle timeout'));
      }
    } else {
      recordFailure('Idle timeout', idleThresholdResult.error);
    }

    if (databaseStartupErrorResult.ok) {
      if (databaseStartupErrorResult.value) {
        next.onboardingComplete = null;
        recordFailure('Local database', databaseStartupErrorResult.value);
      }
    } else {
      next.onboardingComplete = null;
      recordFailure('Local database', databaseStartupErrorResult.error);
    }

    next.settingsError = errors.length > 0
      ? `Some settings could not be loaded. ${errors.join('; ')}`
      : null;
    set(next);
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

  openWhatsNewModal: () => {
    set({ whatsNewModalOpen: true });
  },

  closeWhatsNewModal: () => {
    set({ whatsNewModalOpen: false });
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
    const mode = enabled
      ? get().autoCreateSuggestedRulesEnabled ? 'automatic' : 'suggest'
      : 'off';
    await get().setRuleAutomationMode(mode);
  },

  setAutoCreateSuggestedRulesEnabled: async (enabled) => {
    const mode = enabled ? 'automatic' : get().autoRuleSuggestionsEnabled ? 'suggest' : 'off';
    await get().setRuleAutomationMode(mode);
  },

  setRuleAutomationMode: async (mode) => {
    if (get().ruleAutomationSaving) return;
    const suggestionsEnabled = mode !== 'off';
    const automaticEnabled = mode === 'automatic';
    set({ ruleAutomationSaving: true });
    try {
      await invoke('set_rule_automation_mode', { mode });
      set({
        autoRuleSuggestionsEnabled: suggestionsEnabled,
        autoCreateSuggestedRulesEnabled: automaticEnabled,
        ruleAutomationMode: mode,
      });
    } finally {
      set({ ruleAutomationSaving: false });
    }
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
