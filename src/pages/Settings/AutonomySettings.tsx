import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Bell, Check, FolderKanban, Power } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../lib/utils';
import { isPro, useLicenseStore } from '../../stores/useLicenseStore';
import { RadioGroup } from '../../components/ui/RadioGroup';
import { Switch } from '../../components/ui/Switch';
import { Select } from '../../components/ui/Select';
import { Field } from '../../components/ui/Field';

const DEFAULTS = { uncertain_assignment_mode: 'ask', tracking_notification_mode: 'sessions', startup_page: 'today', notifications_enabled: 'false' };
type Preference = keyof typeof DEFAULTS;

export function AutonomySettings({ children }: { children?: ReactNode }) {
  const automationUnlocked = isPro(useLicenseStore((state) => state.tier));
  const [values, setValues] = useState(DEFAULTS);
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    const [settings, login] = await Promise.allSettled([
      Promise.all(Object.keys(DEFAULTS).map(async (key) => [key, await invoke<string | null>('get_setting', { key })] as const)),
      invoke<boolean>('get_launch_at_login'),
    ]);
    if (settings.status === 'fulfilled') {
      setValues({ ...DEFAULTS, ...Object.fromEntries(settings.value.filter(([, value]) => value != null)) });
      setLoaded(true);
    } else { setError(errorMessage(settings.reason, 'Tracking preferences could not be loaded.')); }
    setLaunchAtLogin(login.status === 'fulfilled' ? login.value : null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const change = async (operation: () => Promise<void>) => {
    setSaving(true); setError(null); setSaved(false);
    try { await operation(); setSaved(true); }
    catch (reason) { setError(errorMessage(reason, 'This preference could not be saved.')); }
    finally { setSaving(false); }
  };
  const update = (key: Preference, value: string) => change(async () => {
    await invoke('set_setting', { key, value });
    setValues((previous) => ({ ...previous, [key]: value }));
  });
  const disabled = saving || !loaded;
  return <>
    <div className="tracking-save-status" role="status" aria-live="polite">{saving ? 'Saving…' : saved ? <><Check size={13} /> Changes saved</> : 'Preferences save automatically'}</div>
    {error && <div className="tracking-feedback tracking-feedback--error" role="alert">{error}{!loaded && <button type="button" onClick={() => void load()}>Try again</button>}</div>}
    <section className="glass-card tracking-section" aria-labelledby="tracking-assignment-title">
      <header className="tracking-section__header"><FolderKanban size={18} aria-hidden="true" /><div><h2 id="tracking-assignment-title">Project assignments</h2><p>Choose how much Duskry does for you.</p></div></header>
      <RadioGroup label="When Duskry has a suggestion but no matching rule" value={values.uncertain_assignment_mode}
        disabled={disabled || !automationUnlocked} onChange={(value) => void update('uncertain_assignment_mode', value)} orientation="horizontal" className="tracking-assignment-options"
        options={[{value:'ask',label:'Ask me first',description:'Leave the activity unassigned until I confirm its project.'}, {value:'best_guess',label:'Assign the best suggestion',description:'Assign it automatically. Let me review and correct it afterward.'}]} />
      <p className="tracking-context-note">{automationUnlocked ? 'Suggestions come from your previous confirmations. Activity without enough evidence stays unassigned.' : 'Automatic suggestions require Pro. You can still assign activity manually in Review.'}</p>
      {children}
    </section>
    <section className="glass-card tracking-section" aria-labelledby="tracking-notification-title">
      <header className="tracking-section__header"><Bell size={18} aria-hidden="true" /><div><h2 id="tracking-notification-title">Notifications</h2><p>Stay informed without checking the app.</p></div></header>
      <Field label="Create an alert for" optionalLabel="" description="Sessions must stay active for 20 seconds. Alerts are limited to one per minute.">
        {(props) => <Select {...props} aria-label="Tracking alerts" disabled={disabled} value={values.tracking_notification_mode} onChange={(value) => void update('tracking_notification_mode', value)}
          options={[{value:'sessions',label:'New project sessions and assignments to review'}, {value:'uncertain',label:'Only assignments that need review'}, {value:'off',label:'No tracking alerts'}]} />}
      </Field>
      <Switch label="Show desktop notifications" description="Alerts also stay in the Assignment inbox. Your system settings control banner delivery."
        disabled={disabled} checked={values.notifications_enabled === 'true'} onCheckedChange={(enabled) => {
          if (!enabled) { void update('notifications_enabled', 'false'); return; }
          void change(async () => { await invoke('request_notification_permission'); setValues((v) => ({ ...v, notifications_enabled:'true' })); });
        }} />
    </section>
    <section className="glass-card tracking-section" aria-labelledby="tracking-background-title">
      <header className="tracking-section__header"><Power size={18} aria-hidden="true" /><div><h2 id="tracking-background-title">Background & reports</h2><p>Set it up once, then return for the results.</p></div></header>
      <Switch label="Launch at login" description={launchAtLogin == null && loaded ? 'Login settings could not be read. Other preferences are still available.' : 'Start Duskry quietly in the background when you sign in.'}
        disabled={disabled || launchAtLogin == null} checked={launchAtLogin ?? false} onCheckedChange={(enabled) => void change(async () => { await invoke('set_launch_at_login', { enabled }); setLaunchAtLogin(enabled); })} />
      <Field label="When I open Duskry, show" optionalLabel="" description="Choose Reports if you mainly want to review your results.">
        {(props) => <Select {...props} aria-label="Open Duskry to" disabled={disabled} value={values.startup_page} onChange={(value) => void update('startup_page', value)} options={[{value:'today',label:'Today — live activity'}, {value:'reports',label:'Reports — time by project'}]} />}
      </Field>
    </section>
  </>;
}
