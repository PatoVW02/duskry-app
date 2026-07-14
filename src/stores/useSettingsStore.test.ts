import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUTO_SCENE_SCHEDULE } from '../lib/sceneConfig';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

import { useSettingsStore } from './useSettingsStore';

const DEFAULT_RESPONSES: Record<string, unknown> = {
  'get_setting:scene': 'forest-dawn',
  'get_setting:scene_auto': 'false',
  'get_setting:scene_auto_schedule': null,
  'get_setting:onboarding_complete': 'true',
  get_active_project: 42,
  get_rules_override: false,
  'get_setting:auto_rule_suggestions_enabled': 'true',
  'get_setting:auto_create_suggested_rules_enabled': 'false',
  get_tracking_paused: true,
  get_idle_threshold: 600,
  get_database_startup_error: null,
};

function mockSettings(overrides: Record<string, unknown> = {}) {
  const responses = { ...DEFAULT_RESPONSES, ...overrides };
  invokeMock.mockImplementation((command: string, args?: { key?: string }) => {
    const lookupKey = command === 'get_setting' ? `${command}:${args?.key}` : command;
    const response = responses[lookupKey];
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  });
}

describe('useSettingsStore hydration', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useSettingsStore.setState({
      scene: 'night-mountains',
      sceneAuto: true,
      autoSceneSchedule: [...DEFAULT_AUTO_SCENE_SCHEDULE],
      onboardingComplete: null,
      settingsHydrated: false,
      settingsError: null,
      activeProjectId: 0,
      rulesOverrideActive: true,
      autoRuleSuggestionsEnabled: true,
      autoCreateSuggestedRulesEnabled: false,
      ruleAutomationMode: 'suggest',
      trackingPaused: false,
      idleThresholdSecs: 300,
    });
  });

  it('falls back from a corrupt schedule without losing other settings', async () => {
    mockSettings({
      'get_setting:scene_auto_schedule': '{not-json',
      'get_setting:auto_create_suggested_rules_enabled': 'true',
    });

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState()).toMatchObject({
      scene: 'forest-dawn',
      sceneAuto: false,
      autoSceneSchedule: DEFAULT_AUTO_SCENE_SCHEDULE,
      onboardingComplete: true,
      settingsHydrated: true,
      activeProjectId: 42,
      rulesOverrideActive: false,
      autoRuleSuggestionsEnabled: true,
      autoCreateSuggestedRulesEnabled: true,
      ruleAutomationMode: 'automatic',
      trackingPaused: true,
      idleThresholdSecs: 600,
    });
    expect(useSettingsStore.getState().settingsError).toContain('Automatic scene schedule');
  });

  it('preserves one failed setting while hydrating every successful setting', async () => {
    useSettingsStore.setState({ activeProjectId: 17 });
    mockSettings({ get_active_project: new Error('database temporarily unavailable') });

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState()).toMatchObject({
      scene: 'forest-dawn',
      onboardingComplete: true,
      settingsHydrated: true,
      activeProjectId: 17,
      trackingPaused: true,
      idleThresholdSecs: 600,
    });
    expect(useSettingsStore.getState().settingsError).toContain('Active project');
    expect(useSettingsStore.getState().settingsError).toContain('database temporarily unavailable');
  });

  it('does not mistake an onboarding lookup failure for a new user', async () => {
    mockSettings({
      'get_setting:onboarding_complete': new Error('onboarding status unavailable'),
    });

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState()).toMatchObject({
      onboardingComplete: null,
      settingsHydrated: true,
    });
    expect(useSettingsStore.getState().settingsError).toContain('Onboarding status');
  });

  it('blocks onboarding when the native database is in non-destructive recovery mode', async () => {
    mockSettings({
      get_database_startup_error: 'The local database could not be opened. No data was changed.',
    });

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState()).toMatchObject({
      onboardingComplete: null,
      settingsHydrated: true,
    });
    expect(useSettingsStore.getState().settingsError).toContain('Local database');
    expect(useSettingsStore.getState().settingsError).toContain('No data was changed');
  });
});
