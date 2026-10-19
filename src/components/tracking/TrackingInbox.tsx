import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppWindow, Bell, CheckCircle2, ChevronRight, X } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useTrackingNoticeStore, type TrackingNotice } from '../../stores/useTrackingNoticeStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useLicenseStore, isPro } from '../../stores/useLicenseStore';
import { lockedFreeProjectIds } from '../../lib/projectAccess';
import { hasSpecificWindowTitle } from '../../lib/activityContext';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { Switch } from '../ui/Switch';
import './TrackingInbox.css';

export function TrackingInbox() {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const { notices, open, selectedId, error, load, show, close } = useTrackingNoticeStore();
  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const checkTarget = async () => {
      try {
        const target = await invoke<number>('take_notification_activity');
        if (!disposed && target > 0) { show(target); await load(); }
      } catch { /* The inbox remains available if the OS cannot report a click. */ }
    };
    const refresh = () => { void load(); void checkTarget(); };
    const register = async () => {
      for (const event of ['tracking-notices-changed', 'tracking-notice-open']) {
        try {
          const unlisten = await listen<number>(event, ({ payload }) => {
            if (event === 'tracking-notice-open') show(payload);
            refresh();
          });
          if (disposed) unlisten(); else cleanups.push(unlisten);
        } catch { /* Polling and window focus also refresh durable notices. */ }
      }
      if (!disposed) refresh();
    };
    void register();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [load, show]);

  useEffect(() => {
    if (!open) return;
    void load();
    panelRef.current?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target) && !target.closest('[role="listbox"]')) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="listbox"]')) { event.preventDefault(); close(); triggerRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open, close, load]);

  const selected = selectedId == null ? notices[0] : notices.find((n) => n.activity_id === selectedId);
  const closeInbox = () => { close(); triggerRef.current?.focus(); };
  return <div className="tracking-inbox">
    <button ref={triggerRef} type="button" className={`tracking-inbox__trigger${open ? ' is-open' : ''}`} onClick={() => open ? closeInbox() : show()}
      aria-label={`Assignment inbox, ${notices.length} pending`} aria-expanded={open} aria-controls="tracking-inbox-panel">
      <Bell size={16} aria-hidden="true" /><span>Assignment inbox</span>{notices.length > 0 && <strong aria-hidden="true">{notices.length}</strong>}
    </button>
    {open && createPortal(<section ref={panelRef} tabIndex={-1} id="tracking-inbox-panel" className="tracking-inbox__panel" aria-label="Assignment inbox">
      <header className="tracking-inbox__header"><div><h2>Assignment inbox</h2><p>{notices.length ? `${notices.length} ${notices.length === 1 ? 'activity' : 'activities'} to review` : 'You’re up to date'}</p></div><button type="button" aria-label="Close assignment inbox" onClick={closeInbox}><X size={17} /></button></header>
      {error && <div role="alert" className="tracking-inbox__error"><p>{error}</p><button type="button" onClick={() => void load()}>Reload inbox</button></div>}
      {selected ? <AssignmentReview key={`${selected.activity_id}:${selected.project_id}:${selected.suggested_project_id}`} notice={selected} /> : <div className="tracking-inbox__empty"><CheckCircle2 size={28} /><h3>{selectedId == null ? 'All caught up' : 'Already reviewed'}</h3><p>Tracking continues in the background. New project sessions and assignments to review will appear here.</p></div>}
      {notices.some((n) => n.activity_id !== selected?.activity_id) && <nav aria-label="Other assignments to review" className="tracking-inbox__list"><h3>Next to review</h3>
        {notices.filter((n) => n.activity_id !== selected?.activity_id).map((n) => <button type="button" key={n.activity_id} onClick={() => show(n.activity_id)}><strong>{n.app_name}</strong><span>{n.window_title || 'Untitled window'}</span><ChevronRight size={14} aria-hidden="true" /></button>)}
      </nav>}
    </section>, document.body)}
  </div>;
}

function AssignmentReview({ notice }: { notice: TrackingNotice }) {
  const projects = useProjectStore((s) => s.projects);
  const tier = useLicenseStore((s) => s.tier);
  const { saving, correct, dismiss } = useTrackingNoticeStore();
  const locked = isPro(tier) ? new Set<number>() : lockedFreeProjectIds(projects);
  const eligible = projects.filter((p) => !locked.has(p.id));
  const [projectId, setProjectId] = useState(notice.project_id ?? notice.suggested_project_id ?? 0);
  const canRemember = notice.can_remember ?? hasSpecificWindowTitle(notice.app_name, notice.window_title);
  const [remember, setRemember] = useState(canRemember && isPro(tier));
  const selectedProject = eligible.find((p) => p.id === projectId);
  const currentProject = projects.find((p) => p.id === notice.project_id);
  return <div className="tracking-inbox__review">
    <div className="tracking-inbox__activity"><span className="tracking-inbox__app-icon"><AppWindow size={19} /></span><div><strong>{notice.app_name}</strong><p>{notice.window_title || 'Untitled window'}</p></div></div>
    <div className="tracking-inbox__current"><span>Currently assigned to</span><strong style={{color:currentProject?.color}}>{currentProject?.name ?? 'No project yet'}</strong></div>
    <p className="tracking-inbox__prompt">{notice.project_id ? 'Is this activity in the right project?' : 'Which project does this activity belong to?'}</p>
    <Field label="Project" optionalLabel="" description="This updates the activity shown above.">
      {(props) => <Select {...props} aria-label="Project" value={String(projectId || '')} disabled={saving} placeholder="Choose a project" onChange={(value) => setProjectId(Number(value))}
        options={eligible.map((p) => ({value:String(p.id),label:p.name}))} />}
    </Field>
    {notice.confidence != null && notice.confidence < 1 && <details className="tracking-inbox__evidence"><summary>Why this suggestion?</summary><p>{Math.round(notice.confidence * 100)}% of matching confirmations support this suggestion. You can choose a different project.</p></details>}
    {isPro(tier) && <div className="tracking-inbox__remember"><Switch label="Remember this assignment" checked={remember && canRemember} disabled={saving || !canRemember} onCheckedChange={setRemember}
      description={canRemember ? 'Use the same app and window or file to assign future activity.' : 'This app shared no specific window or document. Assign this visit, or use a Focus project for future work.'} /></div>}
    <p className="tracking-inbox__privacy">Your confirmations help Duskry learn on this device.</p>
    <div className="tracking-inbox__actions"><button type="button" className="btn-secondary" disabled={saving} title="Keep the activity unchanged and dismiss this alert" onClick={() => void dismiss(notice.activity_id)}>Dismiss alert</button>
      <button type="button" className="btn-primary" disabled={saving || !selectedProject} onClick={() => void correct(notice.activity_id, projectId, remember && canRemember)}>{saving ? 'Saving…' : projectId !== notice.project_id && selectedProject ? `Assign to ${selectedProject.name}` : 'Confirm assignment'}</button></div>
  </div>;
}
