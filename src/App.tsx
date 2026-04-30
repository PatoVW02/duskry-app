import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { onAction } from '@tauri-apps/plugin-notification';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './index.css';
import { useUpdater, AUTO_UPDATE_POLL_MS } from './hooks/useUpdater';
import { UpdaterContext } from './contexts/UpdaterContext';

import { SceneBackground } from './components/layout/SceneBackground';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { PaywallModal } from './components/license/PaywallModal';
import { WhatsNewModal } from './components/whats-new/WhatsNewModal';

import { WelcomeScreen } from './components/onboarding/WelcomeScreen';
import { PermissionsScreen } from './components/onboarding/PermissionsScreen';
import { NotificationsScreen } from './components/onboarding/NotificationsScreen';
import { PlanPickerScreen } from './components/onboarding/PlanPickerScreen';
import { TrialScreen } from './components/onboarding/TrialScreen';
import { FirstProjectScreen } from './components/onboarding/FirstProjectScreen';
import { AllSetScreen } from './components/onboarding/AllSetScreen';

import { Overview } from './pages/Overview';
import { ActivityPage } from './pages/ActivityPage';
import { Projects } from './pages/Projects';
import { Reports } from './pages/Reports';
import { Settings, type SettingsTab } from './pages/Settings';

import { useSettingsStore } from './stores/useSettingsStore';
import { useLicenseStore } from './stores/useLicenseStore';
import { useProjectStore } from './stores/useProjectStore';
import { useActivityStore } from './stores/useActivityStore';
import { usePricesStore } from './stores/usePricesStore';
import { billingPlansEnabled } from './lib/featureFlags';

type Page = 'overview' | 'activity' | 'projects' | 'reports' | 'settings';
type OnboardingStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const PAGE_TITLES: Record<Page, string> = {
  overview:  'Overview',
  activity:  'Activity',
  projects:  'Projects',
  reports:   'Reports',
  settings:  'Settings',
};

function App() {
  const [page, setPage] = useState<Page>('overview');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance');
  const [obStep, setObStep] = useState<OnboardingStep>(0);
  const [startupUpdateToast, setStartupUpdateToast] = useState<null | { kind: 'available' | 'downloaded'; version: string }>(null);
  const updater = useUpdater();
  const updaterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updaterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { onboardingComplete, loadSettings } = useSettingsStore();
  const scenePreviewMode = useSettingsStore((s) => s.scenePreviewMode);
  const scenePreviewScene = useSettingsStore((s) => s.scenePreviewScene);
  const closeScenePreview = useSettingsStore((s) => s.closeScenePreview);
  const setScene = useSettingsStore((s) => s.setScene);
  const setSceneAuto = useSettingsStore((s) => s.setSceneAuto);
  const { tier, fetchTier } = useLicenseStore();
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const fetchPrices = usePricesStore((s) => s.fetchPrices);
  const viewDate = useActivityStore((s) => s.viewDate);
  const stepDate = useActivityStore((s) => s.stepDate);
  const goToToday = useActivityStore((s) => s.goToToday);

  // History retention cutoff: free=7d, pro/trial=90d, proPlus=unlimited
  const historyLimitDays = !billingPlansEnabled ? null : tier === 'proPlus' ? null : tier === 'pro' || tier === 'proTrial' ? 90 : 7;
  const historyLimitDate = historyLimitDays
    ? new Date(Date.now() - historyLimitDays * 24 * 60 * 60 * 1000)
    : null;
  const canGoBack = !historyLimitDate || viewDate > historyLimitDate;

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

  useEffect(() => {
    loadSettings();
    fetchTier();
    fetchProjects();
    fetchPrices();
  }, [loadSettings, fetchTier, fetchProjects, fetchPrices]);

  // Start tracking loop for returning users (new users start it in AllSetScreen)
  const prevOnboardingComplete = useRef(onboardingComplete);
  useEffect(() => {
    // Only invoke on the initial load when already complete (returning user).
    // Skip when it just flipped true (AllSetScreen already called start_tracking).
    if (onboardingComplete && prevOnboardingComplete.current) {
      invoke('start_tracking');
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

  useEffect(() => {
    let mounted = true;
    const unlistenPromise = onAction(async (notification) => {
      if (!mounted) return;
      if (notification.extra?.kind !== 'update-ready') return;
      await openAboutSettings();
    });

    return () => {
      mounted = false;
      void unlistenPromise.then((listener) => listener.unregister());
    };
  }, []);

  // ── Onboarding ──────────────────────────────────────────────
  if (!onboardingComplete) {
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
      <WhatsNewModal enabled={onboardingComplete} />
      <div className="app-content">
        <Sidebar activePage={page} onNavigate={setPage} />
        <div className={`main-area ${scenePreviewMode ? 'main-area--scene-preview' : ''}`}>
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
            <>
              <TopBar
                title={PAGE_TITLES[page]}
                onUpgrade={openBillingSettings}
                dateNav={page === 'overview' || page === 'activity' || page === 'projects' ? {
                  viewDate,
                  onPrev:  canGoBack ? () => stepDate(-1) : undefined,
                  onNext:  () => stepDate(1),
                  onToday: goToToday,
                  historyLocked: !canGoBack,
                } : undefined}
              />
              {startupUpdateToast && (
                <div
                  className="glass-card"
                  style={{
                    position: 'absolute',
                    top: 18,
                    right: 24,
                    zIndex: 30,
                    width: 320,
                    padding: '14px 14px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    background: 'rgba(8, 18, 24, 0.82)',
                    border: '1px solid rgba(45,212,191,0.22)',
                    boxShadow: '0 16px 40px rgba(0,0,0,0.28)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.92)' }}>
                        {startupUpdateToast.kind === 'downloaded' ? 'Update Ready' : 'Update Available'}
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 4, lineHeight: 1.45 }}>
                        Duskry {startupUpdateToast.version} {startupUpdateToast.kind === 'downloaded' ? 'has already been downloaded.' : 'is available to install.'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStartupUpdateToast(null)}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'rgba(255,255,255,0.42)',
                        cursor: 'pointer',
                        padding: 0,
                        boxShadow: 'none',
                        fontSize: 16,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      className="btn-secondary"
                      style={{ width: 'auto', padding: '7px 12px', fontSize: 12 }}
                      onClick={() => setStartupUpdateToast(null)}
                    >
                      Later
                    </button>
                    <button
                      className="btn-primary"
                      style={{ width: 'auto', padding: '7px 12px', fontSize: 12 }}
                      onClick={() => {
                        setStartupUpdateToast(null);
                        void openAboutSettings();
                      }}
                    >
                      Open updater
                    </button>
                  </div>
                </div>
              )}
              <div className={`page-content ${page === 'activity' ? 'page-content--activity' : ''}`}>
                {page === 'overview'  && <Overview />}
                {page === 'activity'  && <ActivityPage onUpgrade={openBillingSettings} />}
                {page === 'projects'  && <Projects onUpgrade={openBillingSettings} />}
                {page === 'reports'   && <Reports onUpgrade={openBillingSettings} />}
                {page === 'settings'  && <Settings activeTab={settingsTab} onTabChange={setSettingsTab} onUpgrade={openBillingSettings} />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    </UpdaterContext.Provider>
  );
}

export default App;
