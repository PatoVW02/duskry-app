import { useSettingsStore } from '../../stores/useSettingsStore';
import { useLicenseStore, isPro } from '../../stores/useLicenseStore';
import { detectMacOS } from '../../lib/rulePlatform';

const IDLE_OPTIONS: { label: string; value: number }[] = [
  { label: '1 min',   value: 60 },
  { label: '2 min',   value: 120 },
  { label: '5 min',   value: 300 },
  { label: '10 min',  value: 600 },
  { label: '15 min',  value: 900 },
  { label: '30 min',  value: 1800 },
  { label: 'Never',   value: 86400 }, // 24 h ≈ never in practice
];

const RUNNING_ON_MACOS = typeof navigator !== 'undefined'
  && detectMacOS(navigator.platform, navigator.userAgent);

export function Tracking({ onUpgrade }: { onUpgrade?: () => void }) {
  const {
    rulesOverrideActive,
    setRulesOverrideActive,
    ruleAutomationMode,
    ruleAutomationSaving,
    setRuleAutomationMode,
    idleThresholdSecs,
    setIdleThreshold,
  } = useSettingsStore();
  const tier = useLicenseStore((s) => s.tier);
  const ruleSuggestionsLocked = !isPro(tier);

  return (
    <div className="glass-card" style={{ padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 18 }}>Tracking</div>

      {/* Idle timeout */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 16,
        paddingBottom: 16,
        borderBottom: '0.5px solid rgba(255,255,255,0.07)',
        marginBottom: 16,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
            Idle timeout
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)', lineHeight: 1.6 }}>
            After this much time with no keyboard or mouse input, the current activity
            is closed. The full elapsed time (including the idle window) is credited to
            the activity. Tracking resumes the next time you interact with your computer.
          </div>
        </div>
        <select
          aria-label="Idle timeout"
          value={idleThresholdSecs}
          onChange={(e) => setIdleThreshold(Number(e.target.value))}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 7,
            color: 'rgba(255,255,255,0.8)',
            fontSize: 12,
            padding: '5px 10px',
            cursor: 'pointer',
            flexShrink: 0,
            outline: 'none',
          }}
        >
          {IDLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} style={{ background: '#1a1a2e' }}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Rules override */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 16,
        paddingBottom: 16,
        borderBottom: '0.5px solid rgba(255,255,255,0.07)',
        marginBottom: 16,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
            Built-in system rules
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)', lineHeight: 1.6 }}>
            {RUNNING_ON_MACOS
              ? 'Idle timeout is always available as a system rule. Meetings and video playback are detected automatically and never interrupted.'
              : 'Idle timeout is the built-in system rule available on Windows.'}
          </div>
        </div>
        <span style={{
          flexShrink: 0, fontSize: 10.5, fontWeight: 500,
          padding: '2px 8px', borderRadius: 999,
          background: 'rgba(45,212,191,0.10)', color: 'rgba(45,212,191,0.65)',
          border: '0.5px solid rgba(45,212,191,0.18)',
        }}>
          built-in
        </span>
      </div>

      {/* Rules override */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 16,
        paddingBottom: 16,
        borderBottom: '0.5px solid rgba(255,255,255,0.07)',
        marginBottom: 16,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
            {RUNNING_ON_MACOS ? 'Application & URL rules override focus project' : 'Rules override focus project'}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)', lineHeight: 1.6 }}>
            {RUNNING_ON_MACOS
              ? 'When enabled, a rule matching the active application or website takes priority over the focus project set from the menu bar. '
              : 'When enabled, a rule matching the active application, window title, or file path takes priority over the focus project set from the menu bar. '}
            Disable this to make the menu bar focus project always win.
          </div>
        </div>
        <button
          role="switch"
          aria-label={RUNNING_ON_MACOS
            ? 'Allow application and website rules to override the focus project'
            : 'Allow matching rules to override the focus project'}
          aria-checked={rulesOverrideActive}
          onClick={() => setRulesOverrideActive(!rulesOverrideActive)}
          className={`toggle-switch${rulesOverrideActive ? ' on' : ''}`}
        />
      </div>

      {/* Smart rule automation */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 16,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Smart rules</span>
            <span style={{
              fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em',
              color: 'rgba(45,212,191,0.70)', border: '0.5px solid rgba(45,212,191,0.20)',
              background: 'rgba(45,212,191,0.07)', borderRadius: 999, padding: '2px 7px',
            }}>
              Local
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)', lineHeight: 1.6 }}>
            Duskry learns from your corrections and compares competing projects before acting.
            {RUNNING_ON_MACOS
              ? ' Window titles, websites, and file paths never leave this device.'
              : ' Window titles and file paths never leave this device.'}
          </div>
          {!ruleSuggestionsLocked && (
            <div style={{ fontSize: 11, color: 'rgba(45,212,191,0.62)', marginTop: 6, lineHeight: 1.5 }}>
              {ruleAutomationMode === 'off'
                ? 'Suggestions and creation are paused; corrections still keep existing rules safe.'
                : ruleAutomationMode === 'suggest'
                  ? 'Duskry will ask before using a pattern.'
                  : 'Only 90%+ patterns seen across multiple days are applied automatically.'}
            </div>
          )}
          {ruleSuggestionsLocked && <UpgradeNotice onUpgrade={onUpgrade} />}
        </div>
        <div
          role="group"
          aria-label="Smart rule automation mode"
          style={{
            display: 'flex', gap: 2, padding: 3, flexShrink: 0,
            borderRadius: 8, background: 'rgba(255,255,255,0.045)',
            border: '0.5px solid rgba(255,255,255,0.09)',
            opacity: ruleSuggestionsLocked || ruleAutomationSaving ? 0.42 : 1,
          }}
        >
          {([
            ['off', 'Off'],
            ['suggest', 'Ask me'],
            ['automatic', 'Autopilot'],
          ] as const).map(([mode, label]) => {
            const selected = !ruleSuggestionsLocked && ruleAutomationMode === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={selected}
                disabled={ruleSuggestionsLocked || ruleAutomationSaving}
                onClick={() => void setRuleAutomationMode(mode).catch(() => {})}
                style={{
                  border: 'none', borderRadius: 6, padding: '5px 9px',
                  background: selected ? 'rgba(45,212,191,0.14)' : 'transparent',
                  color: selected ? 'rgba(94,234,212,0.92)' : 'rgba(255,255,255,0.40)',
                  fontSize: 11, fontWeight: selected ? 600 : 500,
                  fontFamily: 'Inter, sans-serif', cursor: ruleSuggestionsLocked || ruleAutomationSaving ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UpgradeNotice({ onUpgrade }: { onUpgrade?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <span style={{ fontSize: 11.5, color: 'rgba(251,191,36,0.75)' }}>
        Upgrade to Pro to use learned rule automation.
      </span>
      {onUpgrade && (
        <button
          type="button"
          onClick={onUpgrade}
          style={{
            border: '0.5px solid rgba(45,212,191,0.30)',
            background: 'rgba(45,212,191,0.08)',
            color: 'rgba(45,212,191,0.80)',
            borderRadius: 6,
            padding: '3px 8px',
            fontSize: 11,
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          Upgrade
        </button>
      )}
    </div>
  );
}
