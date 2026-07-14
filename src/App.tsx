import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { relaunch } from '@tauri-apps/plugin-process';
import './index.css';
import { useUpdater, AUTO_UPDATE_POLL_MS } from './hooks/useUpdater';
import { UpdaterContext } from './contexts/UpdaterContext';

import { SceneBackground } from './components/layout/SceneBackground';
import { StartupGate } from './components/layout/StartupGate';
import { StartupUpdateToast } from './components/layout/StartupUpdateToast';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { PaywallModal } from './components/license/PaywallModal';
import { WhatsNewModal } from './components/whats-new/WhatsNewModal';
import { SmartRuleNotice } from './components/rules/SmartRuleNotice';

import { WelcomeScreen } from './components/onboarding/WelcomeScreen';
import { PermissionsScreen } from './components/onboarding/PermissionsScreen';
import { NotificationsScreen } from './components/onboarding/NotificationsScreen';
import { PlanPickerScreen } from './components/onboarding/PlanPickerScreen';
import { TrialScreen } from './components/onboarding/TrialScreen';
import { FirstProjectScreen } from './components/onboarding/FirstProjectScreen';
import { AllSetScreen } from './components/onboarding/AllSetScreen';

import { Today } from './pages/Today';
import { ActivityPage } from './pages/ActivityPage';
import { Projects } from './pages/Projects';
import { Rules } from './pages/Rules';
import { Reports } from './pages/Reports';
import { Settings, type SettingsTab } from './pages/Settings';

import { useSettingsStore } from './stores/useSettingsStore';
import { useLicenseStore, isPro } from './stores/useLicenseStore';
import { useProjectStore } from './stores/useProjectStore';
import { useActivityStore } from './stores/useActivityStore';
import { usePricesStore } from './stores/usePricesStore';
import { billingPlansEnabled } from './lib/featureFlags';
import { historyLimitDays } from './lib/historyAccess';
import type { ReviewFilter } from './lib/reviewActivity';
import { resolveAppStartupState } from './lib/startupState';

type Page = 'today' | 'review' | 'projects' | 'rules' | 'reports' | 'settings';
type OnboardingStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const PAGE_TITLES: Record<Page, string> = {
  today:     'Today',
  review:    'Review',
  projects:  'Projects',
  rules:     'Rules',
  reports:   'Reports',
  settings:  'Settings',
};

function App() {
  const [page, setPage] = useState<Page>('today');
  const [reviewIntent, setReviewIntent] = useState<{ filter: ReviewFilter; key: number }>({
    filter: 'all',
    key: 0,
  });
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance');
  const [obStep, setObStep] = useState<OnboardingStep>(0);
  const [startupUpdateToast, setStartupUpdateToast] = useState<null | { kind: 'available' | 'downloaded'; version: string }>(null);
  const updater = useUpdater();
  const updaterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updaterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { onboardingComplete, settingsHydrated, settingsError, loadSettings } = useSettingsStore();
  const scenePreviewMode = useSettingsStore((s) => s.scenePreviewMode);
  const scenePreviewScene = useSettingsStore((s) => s.scenePreviewScene);
  const closeScenePreview = useSettingsStore((s) => s.closeScenePreview);
  const ruleAutomationMode = useSettingsStore((s) => s.ruleAutomationMode);
  const setScene = useSettingsStore((s) => s.setScene);
  const setSceneAuto = useSettingsStore((s) => s.setSceneAuto);
  const tier = useLicenseStore((s) => s.tier);
  const selectedPlan = useLicenseStore((s) => s.selectedPlan);
  const fetchTier = useLicenseStore((s) => s.fetchTier);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const fetchPrices = usePricesStore((s) => s.fetchPrices);
  const viewDate = useActivityStore((s) => s.viewDate);
  const stepDate = useActivityStore((s) => s.stepDate);
  const goToToday = useActivityStore((s) => s.goToToday);
  const clearPendingRuleSuggestions = useActivityStore((s) => s.clearPendingRuleSuggestions);

  // History retention cutoff: Free=7d, Pro=90d, Pro+=unlimited. A local
  // Pro+ trial must receive the same history entitlement advertised during
  // onboarding even though both trial plans share the `proTrial` native tier.
  const historyDays = historyLimitDays(billingPlansEnabled, tier, selectedPlan);
  const historyLimitDate = historyDays
    ? new Date(Date.now() - historyDays * 24 * 60 * 60 * 1000)
    : null;
  const canGoBack = !historyLimitDate || viewDate > historyLimitDate;
  const appStartupState = resolveAppStartupState(settingsHydrated, onboardingComplete);

  const openBillingSettings = () => {
    if (!billingPlansEnabled) {
      setSettingsTab('appearance');
      setPage('settings');
      return;
    }
    setSettingsTab('billing');
    setPage('settings');
  };

  const openAboutSettings = async () => {
    setSettingsTab('about');
    setPage('settings');
    const window = getCurrentWindow();
    try {
      await window.show();
    } catch {}
    try {
      await window.unminimize();
    } catch {}
    try {
      await window.setFocus();
    } catch {}
  };

  const openPermissionSettings = () => {
    setSettingsTab('permissions');
    setPage('settings');
  };

  const openReview = (filter: ReviewFilter) => {
    setReviewIntent((current) => ({ filter, key: current.key + 1 }));
    setPage('review');
  };

  const navigateToPage = (nextPage: Page) => {
    if (nextPage === 'review') {
      openReview('all');
      return;
    }
    setPage(nextPage);
  };

  useEffect(() => {
    loadSettings();
    fetchTier();
    fetchProjects();
    fetchPrices();
  }, [loadSettings, fetchTier, fetchProjects, fetchPrices]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen('settings-changed', () => void loadSettings()).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loadSettings]);

  useEffect(() => {
    if (ruleAutomationMode !== 'suggest' || !isPro(tier)) {
      clearPendingRuleSuggestions();
    }
  }, [clearPendingRuleSuggestions, ruleAutomationMode, tier]);

  useEffect(() => {
    const refresh = () => void fetchTier();
    const interval = window.setInterval(refresh, 6 * 60 * 60 * 1000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [fetchTier]);

  // Start tracking loop for returning users (new users start it in AllSetScreen)
  const prevOnboardingComplete = useRef<boolean | null>(null);
  useEffect(() => {
    // Only invoke on the initial load when already complete (returning user).
    // Skip when it just flipped true (AllSetScreen already called start_tracking).
    if (onboardingComplete === true && prevOnboardingComplete.current === null) {
      void invoke('start_tracking').catch(() => {});
    }
    prevOnboardingComplete.current = onboardingComplete;
  }, [onboardingComplete]);

  // Show an in-app toast on startup if an update is available.
  useEffect(() => {
    updaterTimerRef.current = setTimeout(() => {
      void updater.checkForUpdates().then((result) => {
        if (result.kind === 'available' || result.kind === 'downloaded') {
          setStartupUpdateToast({ kind: result.kind, version: result.version });
        }
      });
    }, 3000);
    return () => {
      if (updaterTimerRef.current) clearTimeout(updaterTimerRef.current);
    };
  }, []);

  // Background auto-check runs separately and only once per local day.
  useEffect(() => {
    void updater.runAutomaticUpdateCheck();
    updaterIntervalRef.current = setInterval(() => {
      void updater.runAutomaticUpdateCheck();
    }, AUTO_UPDATE_POLL_MS);
    return () => {
      if (updaterIntervalRef.current) clearInterval(updaterIntervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Onboarding ──────────────────────────────────────────────
  if (appStartupState === 'loading') {
    return <StartupGate error={null} onRetry={() => void loadSettings()} />;
  }

  if (appStartupState === 'error') {
    const databaseStartupFailed = settingsError?.includes('Local database:') ?? false;
    return (
      <StartupGate
        error={settingsError ?? 'The onboarding status is unavailable. Please try again.'}
        actionLabel={databaseStartupFailed ? 'Restart Duskry' : 'Try again'}
        onRetry={() => {
          if (databaseStartupFailed) void relaunch();
          else void loadSettings();
        }}
      />
    );
  }

  if (appStartupState === 'onboarding') {
    const next = () => setObStep((s) => Math.min(s + 1, 6) as OnboardingStep);
    switch (obStep) {
      case 0: return <WelcomeScreen onNext={next} />;
      case 1: return <PermissionsScreen onNext={next} />;
      case 2: return <NotificationsScreen onNext={next} />;
      case 3: return billingPlansEnabled ? <PlanPickerScreen onNext={next} /> : <FirstProjectScreen onNext={() => setObStep(6)} />;
      case 4: return <TrialScreen onNext={next} />;
      case 5: return <FirstProjectScreen onNext={next} />;
      case 6: return <AllSetScreen onDone={() => {}} />;
    }
  }

  // ── Paywall ──────────────────────────────────────────────────
  if (billingPlansEnabled && tier === 'expired') {
    return <PaywallModal />;
  }

  // ── Main app ─────────────────────────────────────────────────
  return (
    <UpdaterContext.Provider value={updater}>
    <div className="app-shell">
      <SceneBackground />
      <div className="scene-overlay" />
      <WhatsNewModal enabled={onboardingComplete === true} />
      <SmartRuleNotice onReview={() => setPage('rules')} />
      <div className="app-content">
        <Sidebar activePage={page} onNavigate={navigateToPage} />
        <div className={`main-area ${scenePreviewMode ? 'main-area--scene-preview' : ''}`}>
          {startupUpdateToast && (
            <StartupUpdateToast
              kind={startupUpdateToast.kind}
              version={startupUpdateToast.version}
              onDismiss={() => setStartupUpdateToast(null)}
              onOpenUpdater={() => {
                setStartupUpdateToast(null);
                void openAboutSettings();
              }}
            />
          )}
          {scenePreviewMode ? (
            <div className="scene-preview-panel">
              <div className="scene-preview-actions">
                <button
                  type="button"
                  className="scene-preview-btn scene-preview-btn--primary"
                  onClick={() => {
                    if (!scenePreviewScene) return;
                    void setScene(scenePreviewScene).then(() => setSceneAuto(false)).then(() => closeScenePreview());
                  }}
                >
                  Set
                </button>
                <button
                  type="button"
                  className="scene-preview-btn"
                  onClick={closeScenePreview}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            page === 'today' ? (
              <Today onReview={openReview} onOpenPermissions={openPermissionSettings} />
            ) : (
            <>
              <TopBar
                title={PAGE_TITLES[page]}
                onUpgrade={openBillingSettings}
                onOpenPermissions={openPermissionSettings}
                dateNav={page === 'review' || page === 'projects' ? {
                  viewDate,
                  onPrev:  canGoBack ? () => stepDate(-1) : undefined,
                  onNext:  () => stepDate(1),
                  onToday: goToToday,
                  historyLocked: !canGoBack,
                } : undefined}
              />
              <div className={`page-content ${page === 'review' ? 'page-content--activity' : ''}`}>
                {page === 'review'    && (
                  <ActivityPage
                    key={reviewIntent.key}
                    onUpgrade={openBillingSettings}
                    initialFilter={reviewIntent.filter}
                  />
                )}
                {page === 'projects'  && <Projects onUpgrade={openBillingSettings} />}
                {page === 'rules'     && <Rules onUpgrade={openBillingSettings} onOpenProjects={() => setPage('projects')} />}
                {page === 'reports'   && <Reports onUpgrade={openBillingSettings} />}
                {page === 'settings'  && <Settings activeTab={settingsTab} onTabChange={setSettingsTab} onUpgrade={openBillingSettings} />}
              </div>
            </>
          ))}
        </div>
      </div>
    </div>
    </UpdaterContext.Provider>
  );
}

export default App;
