import { useSettingsStore } from '../../stores/useSettingsStore';

const IDLE_OPTIONS: { label: string; value: number }[] = [
  { label: '1 min',   value: 60 },
  { label: '2 min',   value: 120 },
  { label: '5 min',   value: 300 },
  { label: '10 min',  value: 600 },
  { label: '15 min',  value: 900 },
  { label: '30 min',  value: 1800 },
  { label: 'Never',   value: 86400 }, // 24 h ≈ never in practice
];

export function Tracking() {
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
        </div>
        <button
          role="switch"
          aria-checked={autoRuleSuggestionsEnabled}
          onClick={() => setAutoRuleSuggestionsEnabled(!autoRuleSuggestionsEnabled)}
          className={`toggle-switch${autoRuleSuggestionsEnabled ? ' on' : ''}`}
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
        </div>
        <button
          role="switch"
          aria-checked={autoCreateSuggestedRulesEnabled}
          onClick={() => setAutoCreateSuggestedRulesEnabled(!autoCreateSuggestedRulesEnabled)}
          className={`toggle-switch${autoCreateSuggestedRulesEnabled ? ' on' : ''}`}
        />
      </div>
    </div>
  );
}
