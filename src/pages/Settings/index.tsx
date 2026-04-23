import { useState } from 'react';
import { Appearance } from './Appearance';
import { Tracking } from './Tracking';
import { Billing } from './Billing';
import { Palette, Info, SlidersHorizontal, CreditCard, RefreshCw, Download, CheckCircle, AlertCircle } from 'lucide-react';
import { useUpdater } from '../../hooks/useUpdater';

type SettingsTab = 'appearance' | 'tracking' | 'billing' | 'about';

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'appearance', label: 'Appearance',  icon: <Palette size={13} /> },
  { id: 'tracking',   label: 'Tracking',    icon: <SlidersHorizontal size={13} /> },
  { id: 'billing',    label: 'Billing',     icon: <CreditCard size={13} /> },
  { id: 'about',      label: 'About',       icon: <Info size={13} /> },
];

export function Settings() {
  const [tab, setTab] = useState<SettingsTab>('appearance');

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <div style={{ width: 160, flexShrink: 0 }}>
        <div className="glass-card" style={{ padding: '8px' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`nav-item ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {tab === 'appearance' && <Appearance />}
        {tab === 'tracking'   && <Tracking />}
        {tab === 'billing'    && <Billing />}
        {tab === 'about'      && <AboutTab />}
      </div>
    </div>
  );
}

function AboutTab() {
  const { status, checkForUpdates, downloadAndInstall } = useUpdater();

  const isChecking = status.state === 'checking';
  const isDownloading = status.state === 'downloading';
  const hasUpdate = status.state === 'available';
  const isUpToDate = status.state === 'upToDate';
  const hasError = status.state === 'error';

  return (
    <div className="glass-card" style={{ padding: '24px' }}>
      {/* App identity */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 22, fontWeight: 600, color: 'rgba(45,212,191,0.9)', marginBottom: 8 }}>duskry</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.50)', marginBottom: 4 }}>Version 0.1.0</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)' }}>
          Automatic time tracking for Mac &amp; Windows.
        </div>
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
        {hasUpdate ? (
          <button
            className="btn-primary"
            style={{ alignSelf: 'flex-start', fontSize: 13 }}
            onClick={downloadAndInstall}
            disabled={isDownloading}
          >
            <Download size={13} />
            Install &amp; Restart
          </button>
        ) : (
          <button
            className="btn-secondary"
            style={{ alignSelf: 'flex-start', fontSize: 13 }}
            onClick={checkForUpdates}
            disabled={isChecking || isDownloading}
          >
            <RefreshCw size={13} style={isChecking ? { animation: 'spin 1s linear infinite' } : undefined} />
            {isChecking ? 'Checking…' : 'Check for updates'}
          </button>
        )}
      </div>
    </div>
  );
}
