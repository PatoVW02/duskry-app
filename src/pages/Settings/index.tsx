import { useState, useEffect } from 'react';
import { Appearance } from './Appearance';
import { Tracking } from './Tracking';
import { Billing } from './Billing';
import { Permissions } from './Permissions';
import { TrackerLog } from './TrackerLog';
import { Palette, Info, SlidersHorizontal, CreditCard, ShieldCheck, RefreshCw, Download, CheckCircle, AlertCircle, ScrollText, Sparkles, type LucideIcon } from 'lucide-react';
import { useUpdaterContext } from '../../contexts/UpdaterContext';
import { billingPlansEnabled } from '../../lib/featureFlags';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { getAppVersion } from '../../lib/appVersion';
import './Settings.css';

export type SettingsTab = 'appearance' | 'tracking' | 'permissions' | 'billing' | 'log' | 'about';

type SettingsGroup = 'Experience' | 'Tracking' | 'Account & help';

interface SettingsTabDefinition {
  id: SettingsTab;
  label: string;
  shortDescription: string;
  summary: string;
  group: SettingsGroup;
  icon: LucideIcon;
}

const GROUPS: SettingsGroup[] = ['Experience', 'Tracking', 'Account & help'];

const TABS: SettingsTabDefinition[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    shortDescription: 'Backgrounds & scenes',
    summary: 'Choose how Duskry looks and when each background scene appears.',
    group: 'Experience',
    icon: Palette,
  },
  {
    id: 'tracking',
    label: 'Tracking behavior',
    shortDescription: 'Idle time & automation',
    summary: 'Control how time is captured and how project rules behave while you work.',
    group: 'Tracking',
    icon: SlidersHorizontal,
  },
  {
    id: 'permissions',
    label: 'Permissions',
    shortDescription: 'Required system access',
    summary: 'See exactly which system permissions Duskry needs and fix missing access.',
    group: 'Tracking',
    icon: ShieldCheck,
  },
  {
    id: 'billing',
    label: 'Plan & billing',
    shortDescription: 'Subscription & license',
    summary: 'Review your plan, verify access, and manage billing or this device license.',
    group: 'Account & help',
    icon: CreditCard,
  },
  {
    id: 'log',
    label: 'Diagnostics',
    shortDescription: 'Live tracker log',
    summary: 'Inspect recent tracker events when you need to understand or troubleshoot activity capture.',
    group: 'Account & help',
    icon: ScrollText,
  },
  {
    id: 'about',
    label: 'Updates & about',
    shortDescription: 'Version & release notes',
    summary: 'Check for updates, revisit what changed, and confirm the installed Duskry version.',
    group: 'Account & help',
    icon: Info,
  },
];

export function Settings({
  activeTab = 'appearance',
  onTabChange,
  onUpgrade,
}: {
  activeTab?: SettingsTab;
  onTabChange?: (tab: SettingsTab) => void;
  onUpgrade?: () => void;
}) {
  const visibleTabs = billingPlansEnabled ? TABS : TABS.filter((t) => t.id !== 'billing');
  const normalizedActiveTab = !billingPlansEnabled && activeTab === 'billing' ? 'appearance' : activeTab;
  const [tab, setTab] = useState<SettingsTab>(normalizedActiveTab);

  useEffect(() => {
    setTab(normalizedActiveTab);
  }, [normalizedActiveTab]);

  const selectTab = (nextTab: SettingsTab) => {
    setTab(nextTab);
    onTabChange?.(nextTab);
  };

  const activeDefinition = visibleTabs.find((item) => item.id === tab)
    ?? visibleTabs[0];
  const ActiveIcon = activeDefinition.icon;

  return (
    <section className="settings-shell">
      <aside className="settings-navigation glass-card">
        <div className="settings-navigation__intro">
          <span>Preferences</span>
          <h2>Make Duskry yours</h2>
          <p>Everything is grouped by what you want to change.</p>
        </div>

        <nav className="settings-navigation__groups" aria-label="Settings categories">
          {GROUPS.map((group) => {
            const groupTabs = visibleTabs.filter((item) => item.group === group);
            if (groupTabs.length === 0) return null;
            const groupId = `settings-group-${group.toLowerCase().replace(/[^a-z]+/g, '-')}`;
            return (
              <div className="settings-navigation__group" key={group} role="group" aria-labelledby={groupId}>
                <div className="settings-navigation__group-label" id={groupId}>{group}</div>
                {groupTabs.map((item) => {
                  const Icon = item.icon;
                  const isActive = tab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`settings-navigation__item${isActive ? ' settings-navigation__item--active' : ''}`}
                      onClick={() => selectTab(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <span className="settings-navigation__icon"><Icon size={14} /></span>
                      <span className="settings-navigation__copy">
                        <strong>{item.label}</strong>
                        <small>{item.shortDescription}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>

      <main className="settings-main" aria-labelledby="settings-content-title">
        <header className="settings-content-header glass-card">
          <div className="settings-content-header__icon"><ActiveIcon size={18} /></div>
          <div>
            <span>{activeDefinition.group}</span>
            <h1 id="settings-content-title">{activeDefinition.label}</h1>
            <p>{activeDefinition.summary}</p>
          </div>
        </header>

        <div className="settings-content">
        {tab === 'appearance'  && <Appearance />}
        {tab === 'tracking'    && <Tracking onUpgrade={onUpgrade} />}
        {tab === 'permissions' && <Permissions />}
        {billingPlansEnabled && tab === 'billing' && <Billing />}
        {tab === 'log'         && <TrackerLog />}
        {tab === 'about'       && <AboutTab />}
      </div>
      </main>
    </section>
  );
}

function AboutTab() {
  const { status, checkForUpdates, downloadAndInstall } = useUpdaterContext();
  const openWhatsNewModal = useSettingsStore((s) => s.openWhatsNewModal);
  const [version, setVersion] = useState<string>('...');

  useEffect(() => {
    getAppVersion().then(setVersion);
  }, []);

  const isChecking = status.state === 'checking';
  const isDownloading = status.state === 'downloading';
  const hasUpdate = status.state === 'available';
  const hasDownloadedUpdate = status.state === 'downloaded';
  const isUpToDate = status.state === 'upToDate';
  const hasError = status.state === 'error';
  const retryMessage = status.state === 'available' || status.state === 'downloaded'
    ? status.message
    : undefined;

  return (
    <div className="glass-card" style={{ padding: '24px' }}>
      {/* App identity */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 600, color: 'rgba(45,212,191,0.9)', marginBottom: 8 }}>duskry</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.50)', marginBottom: 4 }}>Version {version}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)' }}>
          Automatic time tracking for Mac &amp; Windows.
        </div>
        <button
          className="btn-secondary"
          style={{ marginTop: 16, width: 'auto', padding: '8px 14px', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 7 }}
          onClick={openWhatsNewModal}
        >
          <Sparkles size={13} />
          Open What&apos;s New
        </button>
      </div>

      {/* Updater section */}
      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.08)',
        paddingTop: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Updates
        </div>

        {/* Status row */}
        {isUpToDate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(45,212,191,0.8)' }}>
            <CheckCircle size={14} />
            You're on the latest version
          </div>
        )}
        {hasError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,100,100,0.8)' }}>
            <AlertCircle size={14} />
            {(status as { state: 'error'; message: string }).message}
          </div>
        )}
        {hasUpdate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
            <Download size={14} style={{ color: 'rgba(45,212,191,0.8)' }} />
            Version {(status as { state: 'available'; version: string }).version} is available
          </div>
        )}
        {hasDownloadedUpdate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(45,212,191,0.8)' }}>
            <CheckCircle size={14} />
            Version {(status as { state: 'downloaded'; version: string }).version} is downloaded and ready to install
          </div>
        )}
        {retryMessage && (
          <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: 1.45, color: 'rgba(255,120,120,0.9)' }}>
            <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>{retryMessage} You can retry below.</span>
          </div>
        )}
        {isDownloading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
              Downloading… {(status as { state: 'downloading'; progress: number }).progress}%
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.10)', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                borderRadius: 2,
                background: 'rgba(45,212,191,0.8)',
                width: `${(status as { state: 'downloading'; progress: number }).progress}%`,
                transition: 'width 0.2s ease',
              }} />
            </div>
          </div>
        )}

        {/* Action button */}
        {hasUpdate || hasDownloadedUpdate ? (
          <button
            className="btn-primary"
            style={{ alignSelf: 'flex-start', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, width: 'auto', padding: '8px 16px' }}
            onClick={downloadAndInstall}
            disabled={isDownloading}
          >
            <Download size={13} />
            {hasDownloadedUpdate ? 'Restart to Update' : 'Install & Restart'}
          </button>
        ) : (
          <button
            className="btn-update"
            onClick={checkForUpdates}
            disabled={isChecking || isDownloading}
          >
            <RefreshCw size={13} className={isChecking ? 'icon-spin' : ''} />
            {isChecking ? 'Checking…' : 'Check for updates'}
          </button>
        )}
      </div>
    </div>
  );
}
