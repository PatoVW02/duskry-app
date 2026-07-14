export type AppStartupState = 'loading' | 'error' | 'onboarding' | 'ready';

export function resolveAppStartupState(
  settingsHydrated: boolean,
  onboardingComplete: boolean | null,
): AppStartupState {
  if (!settingsHydrated) return 'loading';
  if (onboardingComplete == null) return 'error';
  return onboardingComplete ? 'ready' : 'onboarding';
}
