import { useState, useEffect, useRef, useCallback } from 'react';
import { isToday, startOfDay, format, fromUnixTime } from 'date-fns';
import { createPortal } from 'react-dom';
import { ChevronRight, ChevronDown, Globe, Folder, Trash2, X } from 'lucide-react';
import { useActivityStore, type Activity } from '../stores/useActivityStore';
import { useProjectStore, type Project } from '../stores/useProjectStore';
import { useLicenseStore, isPro } from '../stores/useLicenseStore';
import { formatDuration } from '../lib/utils';
import { openCheckout } from '../lib/checkout';
import { dragState } from '../lib/dragState';

// ── Tree types ─────────────────────────────────────────────────────────────

interface TitleGroup {
  title: string;
  activityIds: number[];
  total_s: number;
}

interface ContextGroup {
  context: string;
  contextType: 'domain' | 'folder' | 'none';
  titles: TitleGroup[];
  total_s: number;
  activityIds: number[];
}

interface AppGroup {
  appName: string;
  contexts: ContextGroup[];
  total_s: number;
  activityIds: number[];
}

interface EditTarget {
  base: Activity;
  activityIds: number[];
}

// ── Tree builder ───────────────────────────────────────────────────────────

function folderOf(fp: string | null): string | null {
  if (!fp) return null;
  const parts = fp.replace(/\\/g, '/').split('/');
  if (parts.length < 2) return null;
  parts.pop();
  const dir = parts.join('/');
  const homeMatch = dir.match(/^\/Users\/[^/]+(\/.*)?$/);
  if (homeMatch) return '~' + (homeMatch[1] ?? '');
  return dir;
}

function displayAppName(name: string): string {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function buildTree(activities: Activity[]): AppGroup[] {
  const byApp = new Map<string, Activity[]>();
  for (const a of activities) {
    if (!a.duration_s || a.duration_s < 5) continue;
    const list = byApp.get(a.app_name) ?? [];
    list.push(a);
    byApp.set(a.app_name, list);
  }

  return Array.from(byApp.entries())
    .map(([appName, acts]) => {
      const byCtx = new Map<string, Activity[]>();
      for (const a of acts) {
        const ctx = a.domain ?? folderOf(a.file_path) ?? '';
        const list = byCtx.get(ctx) ?? [];
        list.push(a);
        byCtx.set(ctx, list);
      }

      const contexts: ContextGroup[] = Array.from(byCtx.entries())
        .map(([ctx, cActs]) => {
          const byTitle = new Map<string, Activity[]>();
          for (const a of cActs) {
            const t = a.window_title?.trim() || '';
            const list = byTitle.get(t) ?? [];
            list.push(a);
            byTitle.set(t, list);
          }

          const titles: TitleGroup[] = Array.from(byTitle.entries())
            .map(([title, tActs]) => ({
              title,
              activityIds: tActs.map((a) => a.id),
              total_s: tActs.reduce((s, a) => s + (a.duration_s ?? 0), 0),
            }))
            .sort((a, b) => b.total_s - a.total_s);

          const ctxType: 'domain' | 'folder' | 'none' =
            cActs.some((a) => a.domain)     ? 'domain' :
            cActs.some((a) => a.file_path)  ? 'folder' : 'none';

          return {
            context: ctx,
            contextType: ctxType,
            titles,
            total_s: cActs.reduce((s, a) => s + (a.duration_s ?? 0), 0),
            activityIds: cActs.map((a) => a.id),
          };
        })
        .sort((a, b) => b.total_s - a.total_s);

      return {
        appName,
        contexts,
        total_s: acts.reduce((s, a) => s + (a.duration_s ?? 0), 0),
        activityIds: acts.map((a) => a.id),
      };
    })
    .sort((a, b) => b.total_s - a.total_s);
}

// ── App icon (letter-based) ────────────────────────────────────────────────

const _hueCache: Record<string, number> = {};
function appHue(name: string): number {
  if (_hueCache[name] !== undefined) return _hueCache[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 37 + name.charCodeAt(i)) & 0xffff;
  return (_hueCache[name] = h % 360);
}

function AppIcon({ name }: { name: string }) {
  const label = displayAppName(name);
  return (
    <span style={{
      width: 20, height: 20,
      borderRadius: 5,
      background: `hsl(${appHue(name)}, 44%, 36%)`,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 8.5, fontWeight: 700,
      color: 'rgba(255,255,255,0.88)',
      flexShrink: 0,
      letterSpacing: '-0.2px',
      userSelect: 'none',
    }}>
      {label.slice(0, 2).toUpperCase()}
    </span>
  );
}

// ── Pointer-drag helpers ───────────────────────────────────────────────────
// WKWebView does not fire any drag events on drop targets.
// We use pointer events + setPointerCapture instead.
// elementFromPoint works correctly during pointer events (unlike during drag events).

// Returns the shared project_id if every activity in the group shares one, else null
function unanimousProjectId(activityIds: number[], activities: Activity[]): number | null {
  const idSet = new Set(activityIds);
  const relevant = activities.filter((a) => idSet.has(a.id));
  if (relevant.length === 0) return null;
  const pid = relevant[0].project_id;
  if (!pid) return null;
  return relevant.every((a) => a.project_id === pid) ? pid : null;
}

// ── Timeline constants ─────────────────────────────────────────────────────

const HOUR_HEIGHT = 56;
const GUTTER      = 48;

function formatHour(h: number): string {
  if (h === 0)  return '12am';
  if (h < 12)   return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

interface TPos { x: number; y: number; }

function Tooltip({ activity, project, pos }: { activity: Activity; project?: Project; pos: TPos }) {
  const startStr = format(fromUnixTime(activity.started_at), 'HH:mm');
  const endStr   = activity.ended_at ? format(fromUnixTime(activity.ended_at), 'HH:mm') : 'ongoing';
  const left     = Math.min(pos.x + 12, window.innerWidth - 280);
  return createPortal(
    <div style={{
      position: 'fixed', left, top: pos.y - 12,
      transform: 'translateY(-100%)', zIndex: 2000, pointerEvents: 'none',
      minWidth: 190, maxWidth: 264,
      background: 'rgba(8,22,17,0.96)',
      backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
      border: '0.5px solid rgba(255,255,255,0.14)',
      borderRadius: 10, boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
      padding: '10px 13px',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.90)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {activity.app_name}
      </div>
      {activity.window_title && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activity.window_title}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', fontVariantNumeric: 'tabular-nums' }}>
          {startStr} – {endStr}
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(45,212,191,0.85)' }}>
          {formatDuration(activity.duration_s ?? 0)}
        </span>
      </div>
      {project && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, paddingTop: 6, borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: project.color, flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)' }}>{project.name}</span>
        </div>
      )}
    </div>,
    document.body
  );
}

// ── Edit modal ─────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)' }}>{children}</span>;
}

function EditModal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        width: 400, display: 'flex', flexDirection: 'column',
        background: 'rgba(8,22,17,0.82)',
        backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
        border: '0.5px solid rgba(255,255,255,0.13)',
        borderRadius: 18,
        boxShadow: '0 32px 72px rgba(0,0,0,0.55), inset 0 0.5px 0 rgba(255,255,255,0.09)',
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 0' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.88)' }}>Edit activity</span>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.10)', borderRadius: 8, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.45)', cursor: 'pointer' }}>
            <X size={13} />
          </button>
        </div>
        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 13 }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Title group row (with hover edit/delete) ───────────────────────────────

function TitleGroupRow({
  tg, tpro, paddingLeft, pointerDragProps, expanded, onToggle, onEdit, onDelete,
}: {
  tg: TitleGroup;
  tpro: Project | null;
  paddingLeft: number;
  pointerDragProps: (ids: number[], options?: { onPress?: () => void }) => object;
  expanded: boolean;
  onToggle?: () => void;
  onEdit?: () => void;
  onDelete: () => void;
}) {
  const isExpandable = tg.activityIds.length > 1;
  const canEdit = Boolean(onEdit) && !isExpandable;
  const rowProps = pointerDragProps(tg.activityIds, {
    onPress: isExpandable ? onToggle : onEdit,
  }) as React.HTMLAttributes<HTMLDivElement>;

  return (
    <div
      {...rowProps}
      className="activity-tree-row"
      style={{
        ...((rowProps.style as React.CSSProperties | undefined) ?? {}),
        paddingLeft,
        cursor: isExpandable || canEdit ? 'pointer' : 'grab',
        ...(tpro ? { borderLeft: `2.5px solid ${tpro.color}77` } : {}),
      }}
    >
      {isExpandable && (
        <span style={{ width: 14, flexShrink: 0, color: 'rgba(255,255,255,0.24)', display: 'flex', alignItems: 'center', marginRight: 4 }}>
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      )}
      <span style={{
        fontSize: 12,
        color: tg.title ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.22)',
        fontStyle: tg.title ? 'normal' : 'italic',
        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {tg.title || 'Untitled'}
      </span>
      <span style={{
        fontSize: 11, color: 'rgba(255,255,255,0.28)',
        flexShrink: 0, marginRight: tpro ? 6 : 8,
        fontVariantNumeric: 'tabular-nums',
        minWidth: 48, textAlign: 'right', whiteSpace: 'nowrap',
      }}>
        {formatDuration(tg.total_s)}
      </span>
      {tpro && (
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: tpro.color, flexShrink: 0, marginRight: 8 }} />
      )}
      <button
        type="button"
        data-no-drag="true"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="Delete"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,90,90,0.40)', padding: '0 3px', display: 'flex', alignItems: 'center', flexShrink: 0, marginLeft: 'auto' }}
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function ActivityLeafRow({
  activity, project, paddingLeft, pointerDragProps, onEdit, onDelete,
}: {
  activity: Activity;
  project: Project | null;
  paddingLeft: number;
  pointerDragProps: (ids: number[], options?: { onPress?: () => void }) => object;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const rowProps = pointerDragProps([activity.id], {
    onPress: onEdit,
  }) as React.HTMLAttributes<HTMLDivElement>;

  return (
    <div
      {...rowProps}
      className="activity-tree-row"
      style={{
        ...((rowProps.style as React.CSSProperties | undefined) ?? {}),
        paddingLeft,
        cursor: 'pointer',
        ...(project ? { borderLeft: `2.5px solid ${project.color}55` } : {}),
      }}
    >
      <span style={{
        fontSize: 11.5,
        color: activity.window_title ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.26)',
        fontStyle: activity.window_title ? 'normal' : 'italic',
        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {activity.window_title?.trim() || 'Untitled'}
      </span>
      <span style={{
        fontSize: 11,
        color: 'rgba(255,255,255,0.24)',
        flexShrink: 0,
        marginRight: project ? 6 : 8,
        fontVariantNumeric: 'tabular-nums',
        minWidth: 44,
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}>
        {format(fromUnixTime(activity.started_at), 'HH:mm')}
      </span>
      <span style={{
        fontSize: 11,
        color: 'rgba(255,255,255,0.28)',
        flexShrink: 0,
        marginRight: project ? 6 : 8,
        fontVariantNumeric: 'tabular-nums',
        minWidth: 48,
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}>
        {formatDuration(activity.duration_s ?? 0)}
      </span>
      {project && (
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: project.color, flexShrink: 0, marginRight: 8 }} />
      )}
      <button
        type="button"
        data-no-drag="true"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="Delete"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,90,90,0.40)', padding: '0 3px', display: 'flex', alignItems: 'center', flexShrink: 0, marginLeft: 'auto' }}
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function ActivityPage() {
  const activities      = useActivityStore((s) => s.activities);
  const viewDate        = useActivityStore((s) => s.viewDate);
  const fetchForDate    = useActivityStore((s) => s.fetchForDate);
  const assignToProject = useActivityStore((s) => s.assignToProject);
  const deleteActivity  = useActivityStore((s) => s.deleteActivity);
  const updateActivity  = useActivityStore((s) => s.updateActivity);
  const projects        = useProjectStore((s) => s.projects);
  const tier            = useLicenseStore((s) => s.tier);
  const selectedPlan    = useLicenseStore((s) => s.selectedPlan);

  const [expandedApps, setExpandedApps] = useState<Set<string>>(() => new Set());
  const [expandedCtx,  setExpandedCtx]  = useState<Set<string>>(() => new Set());
  const [expandedTitles, setExpandedTitles] = useState<Set<string>>(() => new Set());

  // ── edit state ────────────────────────────────────────────────────────
  const [editingTarget, setEditingTarget] = useState<EditTarget | null>(null);
  const [editTitle,  setEditTitle]  = useState('');
  const [editNote,   setEditNote]   = useState('');
  const [editStart,  setEditStart]  = useState('');
  const [editEnd,    setEditEnd]    = useState('');
  const [saving,     setSaving]     = useState(false);

  const openEdit = (a: Activity, activityIds: number[] = [a.id]) => {
    setEditingTarget({ base: a, activityIds });
    setEditTitle(displayAppName(a.app_name));
    setEditNote(a.window_title ?? '');
    setEditStart(format(fromUnixTime(a.started_at), 'HH:mm'));
    const endTs = a.ended_at ?? (a.started_at + (a.duration_s ?? 0));
    setEditEnd(format(fromUnixTime(endTs), 'HH:mm'));
  };

  const saveEdit = async () => {
    if (!editingTarget || saving) return;
    setSaving(true);
    try {
      if (editingTarget.activityIds.length > 1) {
        const nextAppName = editTitle.trim() || editingTarget.base.app_name;
        const nextWindowTitle = editNote.trim();
        const activityMap = new Map(activities.map((a) => [a.id, a] as const));

        await Promise.all(editingTarget.activityIds.map((id) => {
          const activity = activityMap.get(id);
          if (!activity) return Promise.resolve();
          const endTs = activity.ended_at ?? (activity.started_at + (activity.duration_s ?? 0));
          return updateActivity(id, nextAppName, nextWindowTitle, activity.started_at, endTs);
        }));
      } else {
        const base = fromUnixTime(editingTarget.base.started_at);
        const [sh, sm] = editStart.split(':').map(Number);
        const [eh, em] = editEnd.split(':').map(Number);
        const sDate = new Date(base); sDate.setHours(sh, sm, 0, 0);
        const eDate = new Date(base); eDate.setHours(eh, em, 0, 0);
        let s = Math.floor(sDate.getTime() / 1000);
        let e = Math.floor(eDate.getTime() / 1000);
        if (e < s) e += 86400;
        await updateActivity(editingTarget.base.id, editTitle.trim() || editingTarget.base.app_name, editNote.trim(), s, e);
      }
      setEditingTarget(null);
    } finally {
      setSaving(false);
    }
  };

  // Toast notification
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((projectName: string, color: string, count: number) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({
      msg: `${count} activit${count === 1 ? 'y' : 'ies'} assigned to ${projectName}`,
      color,
    });
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // Timeline state
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<Activity | null>(null);
  const [tipPos,  setTipPos]  = useState<TPos>({ x: 0, y: 0 });
  const [nowY,    setNowY]    = useState<number | null>(null);

  const dayStart = startOfDay(viewDate).getTime() / 1000;
  const tsToY    = (ts: number) => ((ts - dayStart) / 3600) * HOUR_HEIGHT;
  const hours    = Array.from({ length: 24 }, (_, i) => i);

  useEffect(() => {
    fetchForDate(viewDate);
    if (isToday(viewDate)) {
      const id = setInterval(() => fetchForDate(viewDate), 10_000);
      return () => clearInterval(id);
    }
  }, [viewDate]);

  // now-line
  useEffect(() => {
    const update = () => setNowY(isToday(viewDate) ? tsToY(Date.now() / 1000) : null);
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [viewDate]);

  // Scroll timeline to current hour on date change
  useEffect(() => {
    if (!scrollRef.current) return;
    const targetHour = isToday(viewDate) ? Math.max(0, new Date().getHours() - 3) : 8;
    scrollRef.current.scrollTop = targetHour * HOUR_HEIGHT;
  }, [viewDate]);

  // Auto-expand top apps on first load
  useEffect(() => {
    const tree = buildTree(activities);
    setExpandedApps(new Set(tree.slice(0, 5).map((a) => a.appName)));
  }, [activities.length]);

  const tree = buildTree(activities);

  const toggleApp = (name: string) =>
    setExpandedApps((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const toggleCtx = (key: string) =>
    setExpandedCtx((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleTitle = (key: string) =>
    setExpandedTitles((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const handleDrop = useCallback(async (projectId: number, ids: number[]) => {
    if (projectId < 1 || ids.length === 0) return;
    await Promise.all(ids.map((id) => assignToProject(id, projectId)));
    const proj = projects.find((p) => p.id === projectId);
    if (proj) showToast(proj.name, proj.color, ids.length);
  }, [assignToProject, projects, showToast]);

  // Ghost pill state (shown while pointer-dragging)
  const [ghost, setGhost] = useState<{ x: number; y: number; count: number } | null>(null);
  const handleDropRef = useRef(handleDrop);
  handleDropRef.current = handleDrop;

  // Track pending drag start (to distinguish click from drag)
  const dragPending = useRef<{ ids: number[]; startX: number; startY: number; pointerId: number } | null>(null);
  const dragActiveIds = useRef<number[] | null>(null);
  const DRAG_THRESHOLD = 5;

  const pointerDragProps = useCallback((ids: number[], options?: { onPress?: () => void }) => ({
    style: { cursor: 'grab' } as React.CSSProperties,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('[data-no-drag="true"], button, input, select, textarea, label, a')) return;
      dragPending.current = { ids, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId };
      dragActiveIds.current = null;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
      const p = dragPending.current;
      if (p) {
        const dx = e.clientX - p.startX;
        const dy = e.clientY - p.startY;
        if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
          dragPending.current = null;
          dragActiveIds.current = p.ids;
          e.preventDefault();
          dragState.start(p.ids);
          setGhost({ x: e.clientX, y: e.clientY, count: p.ids.length });
        }
        return;
      }
      // Drag active — update ghost position and drop target
      setGhost((g) => g ? { ...g, x: e.clientX, y: e.clientY } : null);
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const btn = el?.closest('[data-drop-project-id]');
      const pid = btn ? parseInt(btn.getAttribute('data-drop-project-id') ?? '0', 10) : null;
      dragState.setHover(pid && pid > 0 ? pid : null);
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      if (dragPending.current?.pointerId === e.pointerId) {
        dragPending.current = null;
        options?.onPress?.();
        return;
      }
      const dragIds = dragActiveIds.current ? [...dragActiveIds.current] : null;
      dragActiveIds.current = null;
      if (!dragIds) return;
      const projectId = dragState.getHover();
      setGhost(null);
      dragState.clear();
      if (projectId) void handleDropRef.current(projectId, dragIds);
    },
    onPointerCancel: () => {
      dragPending.current = null;
      dragActiveIds.current = null;
      setGhost(null);
      dragState.clear();
    },
  }), []);

  const timelineBlocks = activities.filter((a) => a.ended_at !== null && a.duration_s !== null);
  const totalSecs = activities.reduce((sum, a) => sum + (a.duration_s ?? 0), 0);
  const showTimeline = isPro(tier);

  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', height: '100%' }}>

      {/* ── Left: activity tree ─────────────────────────────────────────── */}
      <div style={{ flex: showTimeline ? '1 1 0' : '1', minWidth: 0, overflow: 'hidden' }}>
        <div
          className="glass-card"
          style={{
            padding: '14px 14px 12px',
            background: 'rgba(255,255,255,0.035)',
            border: '0.5px solid rgba(255,255,255,0.08)',
            minHeight: 160,
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
            padding: '2px 4px 8px',
            borderBottom: '0.5px solid rgba(255,255,255,0.06)',
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.68)', letterSpacing: '0.03em' }}>
              Activities
            </span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.32)', fontVariantNumeric: 'tabular-nums' }}>
              {tree.length} {tree.length === 1 ? 'app' : 'apps'}
            </span>
          </div>

          {tree.length === 0 ? (
            <div style={{
              fontSize: 13, color: 'rgba(255,255,255,0.22)',
              textAlign: 'center', paddingTop: 48,
            }}>
              No activity recorded yet
            </div>
          ) : (
            tree.map((app) => {
            const appOpen    = expandedApps.has(app.appName);
            const hasContext = app.contexts.some((c) => c.context !== '');

            return (
              <div key={app.appName} style={{ marginBottom: 2 }}>

                {/* App row */}
                {(() => {
                  const upid = unanimousProjectId(app.activityIds, activities);
                  const upro = upid ? projects.find((p) => p.id === upid) : null;
                  return (
                    <div
                      {...pointerDragProps(app.activityIds, { onPress: () => toggleApp(app.appName) })}
                      className="activity-tree-row"
                      style={upro ? { borderLeft: `2.5px solid ${upro.color}88` } : undefined}
                    >
                      <span style={{
                        width: 48, textAlign: 'right', paddingRight: 10, flexShrink: 0,
                        fontSize: 11.5, color: 'rgba(255,255,255,0.38)',
                        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                      }}>
                        {formatDuration(app.total_s)}
                      </span>
                      <span style={{ width: 14, flexShrink: 0, color: 'rgba(255,255,255,0.30)', display: 'flex', alignItems: 'center' }}>
                        {appOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                      </span>
                      <AppIcon name={app.appName} />
                      <span style={{
                        marginLeft: 7, fontSize: 13, fontWeight: 500,
                        color: 'rgba(255,255,255,0.85)',
                        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {displayAppName(app.appName)}
                      </span>
                      {upro && (
                        <span style={{
                          display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                          marginRight: 8,
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: upro.color }} />
                          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.30)', maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {upro.name}
                          </span>
                        </span>
                      )}
                      <button
                        type="button"
                        data-no-drag="true"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); app.activityIds.forEach((id) => deleteActivity(id)); }}
                        title="Delete all"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,90,90,0.40)', padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0, marginLeft: 'auto' }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })()}

                {appOpen && app.contexts.map((ctx) => {
                  const ctxKey  = `${app.appName}::${ctx.context}`;
                  const ctxOpen = expandedCtx.has(ctxKey);
                  const showCtxRow = hasContext && ctx.context !== '';

                  return (
                    <div key={ctxKey}>
                      {showCtxRow && (
                        <div
                          {...pointerDragProps(ctx.activityIds, { onPress: () => toggleCtx(ctxKey) })}
                          className="activity-tree-row"
                          style={{ paddingLeft: 62 }}
                        >
                          <span style={{ width: 14, flexShrink: 0, color: 'rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center' }}>
                            {ctxOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          </span>
                          <span style={{ color: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                            {ctx.contextType === 'domain' ? <Globe size={11} /> : <Folder size={11} />}
                          </span>
                          <span style={{
                            marginLeft: 5, fontSize: 12,
                            color: 'rgba(255,255,255,0.55)',
                            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {ctx.context}
                          </span>
                          <span style={{
                            fontSize: 11, color: 'rgba(255,255,255,0.28)',
                            flexShrink: 0, marginRight: 8,
                            fontVariantNumeric: 'tabular-nums',
                            minWidth: 48, textAlign: 'right', whiteSpace: 'nowrap',
                          }}>
                            {formatDuration(ctx.total_s)}
                          </span>
                          <button
                            type="button"
                            data-no-drag="true"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); ctx.activityIds.forEach((id) => deleteActivity(id)); }}
                            title="Delete all"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,90,90,0.40)', padding: '0 4px', display: 'flex', alignItems: 'center', flexShrink: 0, marginLeft: 'auto' }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      )}
                      {(!showCtxRow || ctxOpen) && ctx.titles.map((tg) => {
                        const titleKey = `${app.appName}::${ctx.context}::${tg.title || '__untitled__'}`;
                        const titleOpen = expandedTitles.has(titleKey);
                        const tpid = unanimousProjectId(tg.activityIds, activities);
                        const tpro = tpid ? projects.find((p) => p.id === tpid) : null;
                        const editableActivity = activities.find((a) => a.id === tg.activityIds[0]) ?? null;
                        const titleActivities = tg.activityIds
                          .map((id) => activities.find((a) => a.id === id) ?? null)
                          .filter((a): a is Activity => a !== null)
                          .sort((a, b) => a.started_at - b.started_at);
                        return (
                          <div key={titleKey}>
                            <TitleGroupRow
                              tg={tg}
                              tpro={tpro ?? null}
                              paddingLeft={showCtxRow ? 86 : 62}
                              pointerDragProps={pointerDragProps}
                              expanded={titleOpen}
                              onToggle={tg.activityIds.length > 1 ? () => toggleTitle(titleKey) : undefined}
                              onEdit={editableActivity ? () => openEdit(editableActivity, tg.activityIds) : undefined}
                              onDelete={() => Promise.all(tg.activityIds.map((id) => deleteActivity(id)))}
                            />
                            {titleOpen && titleActivities.map((activity) => {
                              const apro = activity.project_id ? projects.find((p) => p.id === activity.project_id) ?? null : null;
                              return (
                                <ActivityLeafRow
                                  key={activity.id}
                                  activity={activity}
                                  project={apro}
                                  paddingLeft={showCtxRow ? 110 : 86}
                                  pointerDragProps={pointerDragProps}
                                  onEdit={() => openEdit(activity)}
                                  onDelete={() => deleteActivity(activity.id)}
                                />
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

              </div>
            );
            })
          )}
        </div>
      </div>

      {/* ── Right: timeline (Pro only) ──────────────────────────────────── */}
      {!showTimeline ? (
        <div className="glass-card" style={{ width: 220, flexShrink: 0, padding: '28px 18px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, marginBottom: 10 }}>📅</div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Timeline</div>
          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.38)', marginBottom: 16, lineHeight: 1.5 }}>
            Visual day timeline is a Pro feature
          </div>
          <button
            className="btn-primary"
            style={{ fontSize: 11.5, padding: '6px 14px' }}
            onClick={() => openCheckout(selectedPlan === 'proPlus' ? 'proplus_monthly' : 'pro_monthly')}
          >
            Upgrade →
          </button>
        </div>
      ) : (
        <div
          className="glass-card"
          style={{
            width: 230, flexShrink: 0, padding: 0, overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            maxHeight: 'calc(100vh - 120px)',
          }}
        >
          {/* Timeline header */}
          <div style={{
            padding: '11px 14px 10px',
            borderBottom: '0.5px solid rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.45)' }}>Timeline</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(45,212,191,0.80)', fontVariantNumeric: 'tabular-nums' }}>
              {formatDuration(totalSecs)}
            </span>
          </div>

          {/* Scrollable grid */}
          <div ref={scrollRef} style={{ overflowY: 'auto', flex: 1 }}>
            <div style={{ position: 'relative', height: 24 * HOUR_HEIGHT }}>
              {hours.map((h) => (
                <div key={h} style={{
                  position: 'absolute', top: h * HOUR_HEIGHT, left: 0, right: 0,
                  height: HOUR_HEIGHT, display: 'flex', alignItems: 'flex-start',
                }}>
                  <div style={{
                    width: GUTTER, flexShrink: 0, paddingTop: 3, paddingRight: 10,
                    textAlign: 'right', fontSize: 9.5,
                    color: 'rgba(255,255,255,0.20)', fontVariantNumeric: 'tabular-nums',
                  }}>
                    {formatHour(h)}
                  </div>
                  <div style={{ flex: 1, borderTop: '0.5px solid rgba(255,255,255,0.05)', height: '100%' }} />
                </div>
              ))}

              {timelineBlocks.map((a) => {
                const top    = Math.max(0, tsToY(a.started_at));
                const height = Math.max(18, (a.duration_s! / 3600) * HOUR_HEIGHT);
                const proj   = projects.find((p) => p.id === a.project_id);
                const color  = proj?.color ?? 'rgba(255,255,255,0.18)';

                return (
                  <div
                    key={a.id}
                    onMouseEnter={(e) => { setHovered(a); setTipPos({ x: e.clientX, y: e.clientY }); }}
                    onMouseMove={(e)  => setTipPos({ x: e.clientX, y: e.clientY })}
                    onMouseLeave={()  => setHovered(null)}
                    style={{
                      position: 'absolute', top, left: GUTTER + 6, right: 8,
                      height, background: color, opacity: 0.82,
                      borderRadius: 4, cursor: 'default', overflow: 'hidden',
                      display: 'flex', flexDirection: 'column', justifyContent: 'center',
                      padding: height > 22 ? '0 6px' : undefined,
                    }}
                  >
                    {height > 20 && (
                      <span style={{
                        fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.88)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {a.app_name}
                      </span>
                    )}
                  </div>
                );
              })}

              {nowY !== null && (
                <div style={{
                  position: 'absolute', top: nowY, left: GUTTER - 4, right: 0,
                  height: 1.5, background: 'rgba(45,212,191,0.75)', pointerEvents: 'none',
                }}>
                  <div style={{
                    position: 'absolute', left: 0, top: '50%',
                    transform: 'translateY(-50%)',
                    width: 7, height: 7, borderRadius: '50%', background: 'rgba(45,212,191,0.95)',
                  }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {hovered && isPro(tier) && (
        <Tooltip
          activity={hovered}
          project={projects.find((p) => p.id === hovered.project_id)}
          pos={tipPos}
        />
      )}

      {/* Success toast */}
      {toast && createPortal(
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 4000, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 9,
          background: 'rgba(10,26,20,0.97)',
          border: `1px solid ${toast.color}55`,
          borderLeft: `3px solid ${toast.color}`,
          borderRadius: 10,
          padding: '9px 18px 9px 14px',
          backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
          minWidth: 220,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="7" fill={toast.color} opacity="0.25" />
            <path d="M4 7l2 2 4-4" stroke={toast.color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)', fontWeight: 500 }}>
            {toast.msg}
          </span>
        </div>,
        document.body
      )}

      {/* Drag ghost pill — follows cursor while pointer-dragging */}
      {ghost && createPortal(
        <div style={{
          position: 'fixed',
          left: ghost.x + 14,
          top: ghost.y - 14,
          zIndex: 5000,
          pointerEvents: 'none',
          background: 'rgba(10,26,20,0.95)',
          border: '1px solid rgba(45,212,191,0.4)',
          borderRadius: 8,
          padding: '5px 11px',
          fontSize: 12,
          color: 'rgba(255,255,255,0.75)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}>
          {ghost.count} {ghost.count === 1 ? 'activity' : 'activities'}
        </div>,
        document.body
      )}

      {/* ── Edit modal ─────────────────────────────────────────────────── */}
      {editingTarget && (
        <EditModal onClose={() => setEditingTarget(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <FieldLabel>Title</FieldLabel>
            <input className="glass-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={{ fontSize: 13 }} autoFocus />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <FieldLabel>Note (optional)</FieldLabel>
            <input className="glass-input" value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="Window title or note" style={{ fontSize: 12 }} />
          </div>
          {editingTarget.activityIds.length === 1 ? (
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
          ) : (
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.38)', lineHeight: 1.45 }}>
              Changes will be applied to all {editingTarget.activityIds.length} activities in this row. Time fields are hidden because each activity keeps its own original timing.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" onClick={saveEdit} disabled={saving || !editTitle.trim()} style={{ fontSize: 12.5 }}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </EditModal>
      )}
    </div>
  );
}
