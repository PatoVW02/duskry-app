import { useSettingsStore } from '../../stores/useSettingsStore';

export function Tracking() {
  const { rulesOverrideActive, setRulesOverrideActive } = useSettingsStore();

  return (
    <div className="glass-card" style={{ padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 18 }}>Tracking</div>

      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 16,
        paddingBottom: 16,
        borderBottom: '0.5px solid rgba(255,255,255,0.07)',
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
    </div>
  );
}
