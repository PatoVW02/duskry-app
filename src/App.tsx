import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './index.css';
import { useUpdater, CHECK_INTERVAL_MS } from './hooks/useUpdater';
import { UpdaterContext } from './contexts/UpdaterContext';

import { SceneBackground } from './components/layout/SceneBackground';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { PaywallModal } from './components/license/PaywallModal';

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
import { Settings } from './pages/Settings';

import { useSettingsStore } from './stores/useSettingsStore';
import { useLicenseStore } from './stores/useLicenseStore';
import { useProjectStore } from './stores/useProjectStore';
import { useActivityStore } from './stores/useActivityStore';

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
  const [obStep, setObStep] = useState<OnboardingStep>(0);
  const updater = useUpdater();
  const updaterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updaterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { onboardingComplete, loadSettings } = useSettingsStore();
  const { tier, fetchTier } = useLicenseStore();
  const fetchProjects = useProjectStore((s) => s.fetchProjects);
  const viewDate = useActivityStore((s) => s.viewDate);
  const stepDate = useActivityStore((s) => s.stepDate);
  const goToToday = useActivityStore((s) => s.goToToday);

  useEffect(() => {
    loadSettings();
    fetchTier();
    fetchProjects();
  }, [loadSettings, fetchTier, fetchProjects]);

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

  // Auto-check for updates once on startup, then every 4 hours
  useEffect(() => {
    updaterTimerRef.current = setTimeout(updater.checkForUpdates, 3000);
    updaterIntervalRef.current = setInterval(updater.checkForUpdates, CHECK_INTERVAL_MS);
    return () => {
      if (updaterTimerRef.current) clearTimeout(updaterTimerRef.current);
      if (updaterIntervalRef.current) clearInterval(updaterIntervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Onboarding ──────────────────────────────────────────────
  if (!onboardingComplete) {
    const next = () => setObStep((s) => Math.min(s + 1, 6) as OnboardingStep);
    switch (obStep) {
      case 0: return <WelcomeScreen onNext={next} />;
      case 1: return <PermissionsScreen onNext={next} />;
      case 2: return <NotificationsScreen onNext={next} />;
      case 3: return <PlanPickerScreen onNext={next} />;
      case 4: return <TrialScreen onNext={next} />;
      case 5: return <FirstProjectScreen onNext={next} />;
      case 6: return <AllSetScreen onDone={() => {}} />;
    }
  }

  // ── Paywall ──────────────────────────────────────────────────
  if (tier === 'expired') {
    return <PaywallModal />;
  }

  // ── Main app ─────────────────────────────────────────────────
  return (
    <UpdaterContext.Provider value={updater}>
    <div className="app-shell">
      <SceneBackground />
      <div className="scene-overlay" />
      <div className="app-content">
        <Sidebar activePage={page} onNavigate={setPage} />
        <div className="main-area">
          <TopBar
            title={PAGE_TITLES[page]}
            dateNav={page === 'overview' || page === 'activity' ? {
              viewDate,
              onPrev:  () => stepDate(-1),
              onNext:  () => stepDate(1),
              onToday: goToToday,
            } : undefined}
          />
          <div className="page-content">
            {page === 'overview'  && <Overview />}
            {page === 'activity'  && <ActivityPage />}
            {page === 'projects'  && <Projects />}
            {page === 'reports'   && <Reports />}
            {page === 'settings'  && <Settings />}
          </div>
        </div>
      </div>
    </div>
    </UpdaterContext.Provider>
  );
}

export default App;
