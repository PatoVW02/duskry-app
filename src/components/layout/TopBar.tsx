import { useLicenseStore } from '../../stores/useLicenseStore';
import { openCheckout } from '../../lib/checkout';
import { isToday, isYesterday, format } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';

function dateNavLabel(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEE, MMM d');
}


export interface DateNav {
  viewDate: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function TopBar({ title, dateNav }: { title: string; dateNav?: DateNav }) {
  const tier = useLicenseStore((s) => s.tier);
  const days = useLicenseStore((s) => s.daysRemaining());

  const viewing = dateNav?.viewDate ?? new Date();
  const isTodayView = isToday(viewing);

  return (
    <div className="top-bar glass-topbar" data-tauri-drag-region>
      <div data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span data-tauri-drag-region style={{ fontSize: 14, fontWeight: 500 }}>{title}</span>

        {dateNav ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={dateNav.onPrev}
              style={{
                background: 'none', border: 'none', padding: '2px 4px',
                cursor: 'pointer', color: 'rgba(255,255,255,0.55)',
                display: 'flex', alignItems: 'center', borderRadius: 4,
              }}
            >
              <ChevronLeft size={14} />
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
        {tier === 'proTrial' && (
          <div className="trial-banner">
            <span>Pro trial - {days} day{days !== 1 ? 's' : ''} remaining</span>
            <button
              onClick={() => openCheckout('pro_monthly')}
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
