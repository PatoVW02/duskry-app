import { useState } from 'react';
import { Appearance } from './Appearance';
import { Tracking } from './Tracking';
import { Billing } from './Billing';
import { Palette, Info, SlidersHorizontal, CreditCard } from 'lucide-react';

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
  return (
    <div className="glass-card" style={{ padding: '24px', textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 600, color: 'rgba(45,212,191,0.9)', marginBottom: 8 }}>duskry</div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.50)', marginBottom: 4 }}>Version 0.1.0</div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)' }}>
        Automatic time tracking for Mac &amp; Windows.
      </div>
    </div>
  );
}
