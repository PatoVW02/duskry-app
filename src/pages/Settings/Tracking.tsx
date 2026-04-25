import { useSettingsStore } from '../../stores/useSettingsStore';
import { useLicenseStore, isPro } from '../../stores/useLicenseStore';

const IDLE_OPTIONS: { label: string; value: number }[] = [
  { label: '1 min',   value: 60 },
  { label: '2 min',   value: 120 },
  { label: '5 min',   value: 300 },
  { label: '10 min',  value: 600 },
  { label: '15 min',  value: 900 },
  { label: '30 min',  value: 1800 },
  { label: 'Never',   value: 86400 }, // 24 h ≈ never in practice
];

export function Tracking({ onUpgrade }: { onUpgrade?: () => void }) {
  const {
    rulesOverrideActive,
    setRulesOverrideActive,
    autoRuleSuggestionsEnabled,
    setAutoRuleSuggestionsEnabled,
    autoCreateSuggestedRulesEnabled,
    setAutoCreateSuggestedRulesEnabled,
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
            Idle timeout is always available as a system rule. Meetings and video
            playback are detected automatically and never interrupted.
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
            App &amp; URL rules override focus project
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)', lineHeight: 1.6 }}>
            When enabled, a rule matching the active app name or browser URL takes
            priority over the focus project set from the menu bar.
            Disable this to make the menu bar focus project always win.
          </div>
        </div>
        <button
          role="switch"
          aria-checked={rulesOverrideActive}
          onClick={() => setRulesOverrideActive(!rulesOverrideActive)}
          className={`toggle-switch${rulesOverrideActive ? ' on' : ''}`}
        />
      </div>

      {/* Auto rule suggestions */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 16,
        paddingBottom: 16,
        borderBottom: '0.5px solid rgba(255,255,255,0.07)',
        marginBottom: 16,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
            Suggest rules from assignments
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)', lineHeight: 1.6 }}>
            When enabled, Duskry learns from repeated manual project assignments
            and asks before creating a matching app or domain rule after at least 3 matches.
          </div>
          {ruleSuggestionsLocked && <UpgradeNotice onUpgrade={onUpgrade} />}
        </div>
        <button
          role="switch"
          aria-checked={!ruleSuggestionsLocked && autoRuleSuggestionsEnabled}
          aria-disabled={ruleSuggestionsLocked}
          disabled={ruleSuggestionsLocked}
          onClick={() => {
            if (!ruleSuggestionsLocked) setAutoRuleSuggestionsEnabled(!autoRuleSuggestionsEnabled);
          }}
          className={`toggle-switch${!ruleSuggestionsLocked && autoRuleSuggestionsEnabled ? ' on' : ''}`}
          title={ruleSuggestionsLocked ? 'Upgrade to Pro to use rule suggestions' : undefined}
          style={ruleSuggestionsLocked ? { opacity: 0.42, cursor: 'not-allowed' } : undefined}
        />
      </div>

      {/* Auto-create suggested rules */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 16,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
            Auto-create suggested rules
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)', lineHeight: 1.6 }}>
            When enabled, matching app or domain rules are created automatically
            once repeated assignments reach the suggestion threshold and the rule is specific enough.
          </div>
          {ruleSuggestionsLocked && <UpgradeNotice onUpgrade={onUpgrade} />}
        </div>
        <button
          role="switch"
          aria-checked={!ruleSuggestionsLocked && autoCreateSuggestedRulesEnabled}
          aria-disabled={ruleSuggestionsLocked}
          disabled={ruleSuggestionsLocked}
          onClick={() => {
            if (!ruleSuggestionsLocked) setAutoCreateSuggestedRulesEnabled(!autoCreateSuggestedRulesEnabled);
          }}
          className={`toggle-switch${!ruleSuggestionsLocked && autoCreateSuggestedRulesEnabled ? ' on' : ''}`}
          title={ruleSuggestionsLocked ? 'Upgrade to Pro to auto-create suggested rules' : undefined}
          style={ruleSuggestionsLocked ? { opacity: 0.42, cursor: 'not-allowed' } : undefined}
        />
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
