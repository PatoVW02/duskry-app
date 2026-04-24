import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { isToday } from 'date-fns';
import { useActivityStore, type Activity } from '../../stores/useActivityStore';
import { useProjectStore, type Project } from '../../stores/useProjectStore';
import { formatDuration } from '../../lib/utils';
import { format, fromUnixTime } from 'date-fns';
import { Trash2, Plus, X } from 'lucide-react';
import { Select } from '../ui/Select';
import { Stepper } from '../ui/Stepper';

// ── helpers ────────────────────────────────────────────────────────────────
function tsToHHMM(ts: number) {
  return format(fromUnixTime(ts), 'HH:mm');
}
function hhmmToTs(baseTs: number, hhmm: string): number {
  const base = fromUnixTime(baseTs);
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function displayAppName(name: string): string {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ── overlay modal shell ────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          width: 400,
          display: 'flex', flexDirection: 'column',
          background: 'rgba(8, 22, 17, 0.82)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          border: '0.5px solid rgba(255, 255, 255, 0.13)',
          borderRadius: 18,
          boxShadow: '0 32px 72px rgba(0,0,0,0.55), inset 0 0.5px 0 rgba(255,255,255,0.09)',
          overflow: 'hidden',
        }}
      >
        {/* header bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px 0',
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.88)' }}>{title}</span>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.10)',
              borderRadius: 8, width: 26, height: 26,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.45)', cursor: 'pointer',
            }}
          >
            <X size={13} />
          </button>
        </div>
        {/* body */}
        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 13 }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)' }}>{children}</span>;
}

// ── main component ─────────────────────────────────────────────────────────
export function ActivityFeed() {
  const activities      = useActivityStore((s) => s.activities).slice(0, 50);
  const viewDate        = useActivityStore((s) => s.viewDate);
  const assignToProject = useActivityStore((s) => s.assignToProject);
  const assignAllUnassignedToday = useActivityStore((s) => s.assignAllUnassignedToday);
  const deleteActivity  = useActivityStore((s) => s.deleteActivity);
  const updateActivity  = useActivityStore((s) => s.updateActivity);
  const createManualActivity = useActivityStore((s) => s.createManualActivity);
  const projects        = useProjectStore((s) => s.projects);

  const isTodayView = isToday(viewDate);
  const unassigned = activities.filter((a) => !a.project_id);

  // ── edit state ─────────────────────────────────────────────────────────
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [editTitle,  setEditTitle]  = useState('');
  const [editNote,   setEditNote]   = useState('');
  const [editStart,  setEditStart]  = useState('');
  const [editEnd,    setEditEnd]    = useState('');

  // ── log time state ──────────────────────────────────────────────────────
  const [showLog,    setShowLog]    = useState(false);
  const [logTitle,   setLogTitle]   = useState('');
  const [logNote,    setLogNote]    = useState('');
  const [logProject, setLogProject] = useState<number | null>(null);
  const [logStart,   setLogStart]   = useState('');
  const [logHours,   setLogHours]   = useState(0);
  const [logMins,    setLogMins]    = useState(30);

  // ── bulk-assign state ───────────────────────────────────────────────────
  const [bulkOpen,  setBulkOpen]  = useState(false);
  const [bulkPid,   setBulkPid]   = useState<number | null>(null);

  const [saving, setSaving] = useState(false);

  // ── edit handlers ───────────────────────────────────────────────────────
  const openEdit = (a: Activity) => {
    setEditingActivity(a);
    setEditTitle(displayAppName(a.app_name));
    setEditNote(a.window_title ?? '');
    setEditStart(tsToHHMM(a.started_at));
    const endTs = a.ended_at ?? (a.started_at + (a.duration_s ?? 0));
    setEditEnd(tsToHHMM(endTs));
  };

  const saveEdit = async () => {
    if (!editingActivity || saving) return;
    setSaving(true);
    const s = hhmmToTs(editingActivity.started_at, editStart);
    let   e = hhmmToTs(editingActivity.started_at, editEnd);
    if (e < s) e += 86400;
    await updateActivity(editingActivity.id, editTitle.trim() || editingActivity.app_name, editNote.trim(), s, e);
    setEditingActivity(null);
    setSaving(false);
  };

  // ── log time handlers ───────────────────────────────────────────────────
  const openLog = () => {
    setLogTitle(''); setLogNote(''); setLogProject(null);
    setLogStart(format(new Date(), 'HH:mm'));
    setLogHours(0); setLogMins(30);
    setShowLog(true);
  };

  const saveLog = async () => {
    if (!logTitle.trim() || saving) return;
    const durationS = logHours * 3600 + logMins * 60;
    if (durationS < 60) return;
    setSaving(true);
    const today = new Date();
    const [h, m] = logStart.split(':').map(Number);
    today.setHours(h, m, 0, 0);
    await createManualActivity(logTitle.trim(), logNote.trim(), logProject, Math.floor(today.getTime() / 1000), durationS);
    setShowLog(false);
    setSaving(false);
  };

  // ── bulk-assign handler ─────────────────────────────────────────────────
  const doBulkAssign = async () => {
    if (!bulkPid || saving) return;
    setSaving(true);
    await assignAllUnassignedToday(bulkPid);
    setBulkOpen(false);
    setBulkPid(null);
    setSaving(false);
  };

  return (
    <div className="glass-card logs-card" style={{ padding: '14px 18px' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.55)' }}>
          Recent activity
        </div>
        <button
          onClick={openLog}
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(45,212,191,0.10)', border: '0.5px solid rgba(45,212,191,0.25)', borderRadius: 6, padding: '4px 10px', color: 'rgba(45,212,191,0.80)', fontSize: 11.5, cursor: 'pointer' }}
        >
          <Plus size={11} /> Log time
        </button>
      </div>

      {/* ── Bulk-assign bar (today only) ─────────────────────────────────── */}
      {isTodayView && unassigned.length > 0 && (
        <div style={{ marginBottom: 10, padding: '7px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '0.5px dashed rgba(255,255,255,0.11)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.38)', flex: 1 }}>
            {unassigned.length} unassigned
          </span>
          {bulkOpen ? (
          <>
              <Select
                value={String(bulkPid ?? '')}
                onChange={(v) => setBulkPid(v ? parseInt(v) : null)}
                options={projects.map((p) => ({ value: String(p.id!), label: p.name }))}
                placeholder="Pick project…"
                style={{ fontSize: 11.5 }}
              />
              <button
                onClick={doBulkAssign}
                disabled={!bulkPid || saving}
                style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 6, background: bulkPid ? 'rgba(45,212,191,0.15)' : 'rgba(255,255,255,0.05)', border: `0.5px solid ${bulkPid ? 'rgba(45,212,191,0.30)' : 'rgba(255,255,255,0.10)'}`, color: bulkPid ? 'rgba(45,212,191,0.85)' : 'rgba(255,255,255,0.30)', cursor: bulkPid ? 'pointer' : 'default' }}
              >
                {saving ? 'Assigning…' : 'Assign all'}
              </button>
              <button
                onClick={() => { setBulkOpen(false); setBulkPid(null); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.28)', fontSize: 11, padding: '2px 4px' }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setBulkOpen(true)}
              style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.50)', cursor: 'pointer' }}
            >
              Assign all →
            </button>
          )}
        </div>
      )}

      {/* ── Activity list ───────────────────────────────────────────────── */}
      {activities.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', textAlign: 'center', padding: '24px 0' }}>
          Tracking will appear here automatically
        </div>
      ) : (
        activities.map((a) => (
          <ActivityRow
            key={a.id}
            activity={a}
            projects={projects}
            onAssign={(pid) => assignToProject(a.id, pid)}
            onEdit={() => openEdit(a)}
            onDelete={() => deleteActivity(a.id)}
          />
        ))
      )}

      {/* ── Edit modal ─────────────────────────────────────────────────── */}
      {editingActivity && (
        <Modal title="Edit activity" onClose={() => setEditingActivity(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <FieldLabel>Title</FieldLabel>
            <input className="glass-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={{ fontSize: 13 }} autoFocus />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <FieldLabel>Note (optional)</FieldLabel>
            <input className="glass-input" value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="Window title or note" style={{ fontSize: 12 }} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <FieldLabel>Start</FieldLabel>
              <input type="time" className="glass-input" value={editStart} onChange={(e) => setEditStart(e.target.value)} style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <FieldLabel>End</FieldLabel>
              <input type="time" className="glass-input" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" onClick={saveEdit} disabled={saving || !editTitle.trim()} style={{ fontSize: 12.5 }}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Log time modal ─────────────────────────────────────────────── */}
      {showLog && (
        <Modal title="Log time" onClose={() => !saving && setShowLog(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <FieldLabel>What were you working on?</FieldLabel>
            <input className="glass-input" value={logTitle} onChange={(e) => setLogTitle(e.target.value)} placeholder="Title" autoFocus style={{ fontSize: 13 }} onKeyDown={(e) => e.key === 'Enter' && saveLog()} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <FieldLabel>Note (optional)</FieldLabel>
            <input className="glass-input" value={logNote} onChange={(e) => setLogNote(e.target.value)} placeholder="Details…" style={{ fontSize: 12 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <FieldLabel>Project (optional)</FieldLabel>
            <Select
              value={String(logProject ?? '')}
              onChange={(v) => setLogProject(v ? parseInt(v) : null)}
              options={[
                { value: '', label: 'No project' },
                ...projects.map((p) => ({ value: String(p.id!), label: p.name })),
              ]}
              placeholder="No project"
            />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <FieldLabel>Start time</FieldLabel>
              <input type="time" className="glass-input" value={logStart} onChange={(e) => setLogStart(e.target.value)} style={{ fontSize: 13 }} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <FieldLabel>Duration</FieldLabel>
              <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                <Stepper value={logHours} onChange={setLogHours} min={0} max={23} />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>h</span>
                <Stepper value={logMins} onChange={setLogMins} min={0} max={59} />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>m</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" onClick={saveLog} disabled={saving || !logTitle.trim() || (logHours === 0 && logMins < 1)} style={{ fontSize: 12.5 }}>
              {saving ? 'Saving…' : 'Log time'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── ActivityRow ────────────────────────────────────────────────────────────
function ActivityRow({
  activity: a,
  projects,
  onAssign,
  onEdit,
  onDelete,
}: {
  activity: Activity;
  projects: Project[];
  onAssign: (pid: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const proj = projects.find((p: Project) => p.id === a.project_id);
  const time = format(fromUnixTime(a.started_at), 'HH:mm');
  const projectOptions = projects.map((p: Project) => ({ value: String(p.id!), label: p.name }));

  return (
    <div
      className="activity-row"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-no-edit="true"]')) return;
        const selection = window.getSelection()?.toString().trim();
        if (selection) return;
        onEdit();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative', cursor: 'pointer', userSelect: 'text', WebkitUserSelect: 'text' }}
    >
      <div className="activity-app-icon">{displayAppName(a.app_name).charAt(0).toUpperCase()}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayAppName(a.app_name)}
        </div>
        {a.window_title && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {a.window_title}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <div data-no-edit="true" onClick={(e) => e.stopPropagation()}>
          <Select
            value={a.project_id ? String(a.project_id) : ''}
            onChange={(v) => { if (v) onAssign(parseInt(v)); }}
            options={projectOptions}
            placeholder="Assign…"
            style={{
              fontSize: 11,
              padding: '2px 8px',
              flex: 'none',
              minWidth: proj ? 92 : 70,
              borderRadius: 999,
              background: proj ? `${proj.color}18` : 'rgba(255, 255, 255, 0.07)',
              border: `0.5px solid ${proj ? `${proj.color}55` : 'rgba(255, 255, 255, 0.15)'}`,
              color: proj ? proj.color : 'rgba(255, 255, 255, 0.38)',
            }}
          />
        </div>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', fontVariantNumeric: 'tabular-nums' }}>
          {time}
        </span>
        {a.duration_s !== null && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', minWidth: 32, textAlign: 'right' }}>
            {formatDuration(a.duration_s)}
          </span>
        )}
        {hovered && (
          <button
            type="button"
            data-no-edit="true"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title="Delete"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,90,90,0.50)', padding: 2, display: 'flex', alignItems: 'center' }}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
