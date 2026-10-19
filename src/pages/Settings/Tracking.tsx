import { useState } from 'react';
import { Clock3, ShieldCheck } from 'lucide-react';
import { AutonomySettings } from './AutonomySettings';
import { Select } from '../../components/ui/Select';
import { Switch } from '../../components/ui/Switch';
import { Disclosure } from '../../components/ui/Disclosure';
import { Field } from '../../components/ui/Field';
import { useSettingsStore, type RuleAutomationMode } from '../../stores/useSettingsStore';
import { useLicenseStore, isPro } from '../../stores/useLicenseStore';
import { detectMacOS } from '../../lib/rulePlatform';
import { errorMessage } from '../../lib/utils';
import './Tracking.css';

const IDLE_OPTIONS = [
  { label: '1 minute', value: '60' }, { label: '2 minutes', value: '120' },
  { label: '5 minutes', value: '300' }, { label: '10 minutes', value: '600' },
  { label: '15 minutes', value: '900' }, { label: '30 minutes', value: '1800' },
  { label: '24 hours', value: '86400' },
];
const RUNNING_ON_MACOS = typeof navigator !== 'undefined' && detectMacOS(navigator.platform, navigator.userAgent);

export function Tracking({ onUpgrade }: { onUpgrade?: () => void }) {
  const { rulesOverrideActive, setRulesOverrideActive, ruleAutomationMode, ruleAutomationSaving,
    setRuleAutomationMode, idleThresholdSecs, setIdleThreshold } = useSettingsStore();
  const unlocked = isPro(useLicenseStore((s) => s.tier));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (operation: () => Promise<void>) => {
    setSaving(true); setError(null);
    try { await operation(); }
    catch (reason) { setError(errorMessage(reason, 'This preference could not be saved.')); }
    finally { setSaving(false); }
  };

  return <div className="tracking-settings">
    <AutonomySettings>
      <div className="tracking-learning">
        <Field label="Learn rules from my corrections" optionalLabel="" description={ruleAutomationMode === 'automatic'
          ? 'Autopilot creates rules only after repeated, high-confidence confirmations across multiple days.'
          : ruleAutomationMode === 'suggest' ? 'Review a suggested rule before Duskry uses it for future activity.' : 'New rule suggestions are paused. Your existing rules still apply.'}>
          {(props) => <Select {...props} value={ruleAutomationMode} aria-label="Learn rules from my corrections"
            disabled={!unlocked || saving || ruleAutomationSaving} onChange={(value) => void save(() => setRuleAutomationMode(value as RuleAutomationMode))}
            options={[{value:'off',label:'Off — keep existing rules'}, {value:'suggest',label:'Ask me before creating a rule'}, {value:'automatic',label:'Autopilot — create reliable rules automatically'}]} />}
        </Field>
        {!unlocked && <div className="tracking-upgrade"><span>Rule learning is available with Pro.</span>{onUpgrade && <button type="button" onClick={onUpgrade}>View plans</button>}</div>}
        <Disclosure title="Assignment priority" summary={rulesOverrideActive ? 'Matching rules take priority over your focus project' : 'Your focus project takes priority over rules'}>
          <Switch label="Let matching rules override my focus project" checked={rulesOverrideActive}
            disabled={saving} onCheckedChange={(enabled) => void save(() => setRulesOverrideActive(enabled))}
            description="Turn this off when you want all activity assigned to the project you selected for today." />
        </Disclosure>
        {error && <p className="tracking-feedback tracking-feedback--error" role="alert">{error}</p>}
      </div>
    </AutonomySettings>
    <Disclosure title="Activity capture" summary={`Idle timeout: ${IDLE_OPTIONS.find((o) => Number(o.value) === idleThresholdSecs)?.label ?? `${idleThresholdSecs} seconds`}`} icon={<Clock3 size={16} />}>
      <Field label="Stop recording after inactivity" optionalLabel="" description="Duskry closes the activity after this much time without keyboard or mouse input. Tracking resumes when you return. The time up to the timeout stays in that activity.">
        {(props) => <Select {...props} aria-label="Idle timeout" value={String(idleThresholdSecs)} options={IDLE_OPTIONS} disabled={saving}
          onChange={(value) => void save(() => setIdleThreshold(Number(value)))} />}
      </Field>
      <p className="tracking-system-note"><ShieldCheck size={15} aria-hidden="true" />{RUNNING_ON_MACOS
        ? 'Detected calls and video playback can keep a session active while you watch or listen.'
        : 'Windows tracks app and window names. Website and document-path rules are unavailable.'}</p>
    </Disclosure>
  </div>;
}
