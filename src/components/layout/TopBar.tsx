import { useLicenseStore } from '../../stores/useLicenseStore';
import { billingPlansEnabled } from '../../lib/featureFlags';
import { isToday, isYesterday, format } from 'date-fns';
import { ChevronLeft, ChevronRight, Lock, Zap } from 'lucide-react';

function dateNavLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEE, MMM d');
}


export interface DateNav {
  viewDate: Date;
  onPrev: (() => void) | undefined;
  onNext: () => void;
  onToday: () => void;
  historyLocked?: boolean;
}

export function TopBar({ title, dateNav, onUpgrade }: { title: string; dateNav?: DateNav; onUpgrade?: () => void }) {
  const tier = useLicenseStore((s) => s.tier);
  const trialStartedAt = useLicenseStore((s) => s.trialStartedAt);
  const days = useLicenseStore((s) => s.daysRemaining());

  const viewing = dateNav?.viewDate ?? new Date();
  const isTodayView = isToday(viewing);
  const historyLocked = dateNav?.historyLocked ?? false;

  const showUpgradeBadge = billingPlansEnabled && (tier === 'free' || tier === 'expired');
  const canStartFreeTrial = billingPlansEnabled && tier === 'free' && trialStartedAt <= 0;

  return (
    <div className="top-bar glass-topbar" data-tauri-drag-region>
      <div data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {showUpgradeBadge && (
          <button
            onClick={onUpgrade}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 9px', borderRadius: 20, cursor: 'pointer',
              border: '0.5px solid rgba(45,212,191,0.35)',
              background: 'rgba(45,212,191,0.10)', color: 'rgba(45,212,191,0.85)',
              fontSize: 11, fontWeight: 500, fontFamily: 'Inter, sans-serif',
            }}
          >
            <Zap size={10} />
            {canStartFreeTrial ? 'Get free trial' : 'Upgrade'}
          </button>
        )}
        <span data-tauri-drag-region style={{ fontSize: 14, fontWeight: 500 }}>{title}</span>

        {dateNav ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={dateNav.onPrev}
              disabled={historyLocked}
              title={historyLocked ? 'Upgrade to view older history' : undefined}
              style={{
                background: 'none', border: 'none', padding: '2px 4px',
                cursor: historyLocked ? 'default' : 'pointer',
                color: historyLocked ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.55)',
                display: 'flex', alignItems: 'center', borderRadius: 4,
              }}
            >
              {historyLocked ? <Lock size={12} /> : <ChevronLeft size={14} />}
            </button>
            <span className="date-pill">{dateNavLabel(dateNav.viewDate)}</span>
            <button
              onClick={dateNav.onNext}
              disabled={isTodayView}
              style={{
                background: 'none', border: 'none', padding: '2px 4px',
                cursor: isTodayView ? 'default' : 'pointer',
                color: isTodayView ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.55)',
                display: 'flex', alignItems: 'center', borderRadius: 4,
              }}
            >
              <ChevronRight size={14} />
            </button>
            {!isTodayView && (
              <button
                onClick={dateNav.onToday}
                style={{
                  background: 'rgba(20,184,166,0.18)', border: '1px solid rgba(20,184,166,0.35)',
                  borderRadius: 10, padding: '2px 9px', fontSize: 11,
                  color: 'rgba(20,184,166,0.9)', cursor: 'pointer',
                }}
              >
                Return to today
              </button>
            )}
          </div>
        ) : null}
      </div>

      <div data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {billingPlansEnabled && tier === 'proTrial' && (
          <div className="trial-banner">
            <span>Pro trial - {days} day{days !== 1 ? 's' : ''} remaining</span>
            <button
              onClick={onUpgrade}
              style={{
                background: 'rgba(251,191,36,0.20)', border: 'none', borderRadius: 12,
                padding: '2px 8px', fontSize: 11, color: 'rgba(251,191,36,0.9)', cursor: 'pointer',
              }}
            >
              Subscribe
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
