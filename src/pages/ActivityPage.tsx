import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { isToday, startOfDay, format, fromUnixTime } from 'date-fns';
import { createPortal } from 'react-dom';
import { AlertTriangle, CalendarDays, ChevronRight, ChevronDown, Check, Globe, Folder, Pencil, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { useActivityStore, type Activity } from '../stores/useActivityStore';
import { useProjectStore, type Project } from '../stores/useProjectStore';
import { useLicenseStore, isPro } from '../stores/useLicenseStore';
import { errorMessage, formatDuration } from '../lib/utils';
import { dragState } from '../lib/dragState';
import { normalizeTimelineActivities } from '../lib/activityPresentation';
import { groupActivitiesIntoBursts } from '../lib/activityBursts';
import { lockedFreeProjectIds } from '../lib/projectAccess';
import {
  filterReviewActivities,
  type ReviewAssignmentSummary,
  type ReviewFilter,
} from '../lib/reviewActivity';
import { Select } from '../components/ui/Select';
import './Review.css';

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

type SelectionState = 'none' | 'partial' | 'all';
const MIXED_PROJECT_VALUE = '__mixed__';

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

function fullActivityLabel(activity: Activity): string {
  return activity.window_title?.trim() || 'Untitled';
}

function buildTree(activities: Activity[], includeBriefActivity = false): AppGroup[] {
  const byApp = new Map<string, Activity[]>();
  for (const a of activities) {
    if (!a.duration_s || (!includeBriefActivity && a.duration_s < 5)) continue;
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

function getSelectionState(activityIds: number[], selectedIds: Set<number>): SelectionState {
  let matches = 0;
  for (const id of activityIds) {
    if (selectedIds.has(id)) matches += 1;
  }
  if (matches === 0) return 'none';
  if (matches === activityIds.length) return 'all';
  return 'partial';
}

function countDistinctApps(
  activities: readonly Activity[],
  includeBriefActivity = false,
): number {
  return new Set(
    activities
      .filter((activity) => Boolean(activity.duration_s) && (includeBriefActivity || (activity.duration_s ?? 0) >= 5))
      .map((activity) => activity.app_name),
  ).size;
}

function summarizeIndexedAssignment(
  activityIds: readonly number[],
  projectIdByActivityId: ReadonlyMap<number, number | null>,
): ReviewAssignmentSummary {
  const projectIds = new Set<number | null>();
  for (const activityId of activityIds) {
    if (projectIdByActivityId.has(activityId)) {
      projectIds.add(projectIdByActivityId.get(activityId) ?? null);
    }
  }
  if (projectIds.size === 0 || (projectIds.size === 1 && projectIds.has(null))) {
    return { status: 'unassigned', projectId: null };
  }
  if (projectIds.size === 1) {
    return { status: 'assigned', projectId: [...projectIds][0] as number };
  }
  return { status: 'mixed', projectId: null };
}

// ── Timeline constants ─────────────────────────────────────────────────────

const HOUR_HEIGHT = 88;
const GUTTER      = 48;
const MIN_TIMELINE_BLOCK_HEIGHT = 2;

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
      {activity.assignment_reason && ['learned_rule', 'manual_rule', 'focus'].includes(activity.source ?? '') && (
        <div style={{ fontSize: 10.5, color: 'rgba(45,212,191,0.55)', marginTop: 5 }}>
          Assigned by {activity.assignment_reason}
        </div>
      )}
    </div>,
    document.body
  );
}

function TextTooltip({ text, pos }: { text: string; pos: TPos }) {
  const left = Math.min(pos.x + 12, window.innerWidth - 320);
  const top = Math.max(12, pos.y - 10);
  return createPortal(
    <div style={{
      position: 'fixed',
      left,
      top,
      transform: 'translateY(-100%)',
      zIndex: 2100,
      pointerEvents: 'none',
      maxWidth: 320,
      background: 'rgba(8,22,17,0.97)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      border: '0.5px solid rgba(255,255,255,0.14)',
      borderRadius: 10,
      boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
      padding: '9px 12px',
      fontSize: 12,
      lineHeight: 1.4,
      color: 'rgba(255,255,255,0.88)',
      whiteSpace: 'normal',
      wordBreak: 'break-word',
    }}>
      {text}
    </div>,
    document.body
  );
}

function HoverText({
  text,
  style,
}: {
  text: string;
  style?: React.CSSProperties;
}) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<TPos>({ x: 0, y: 0 });
  return (
    <>
      <span
        style={style}
        onMouseEnter={(e) => {
          setHovered(true);
          setPos({ x: e.clientX, y: e.clientY });
        }}
        onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHovered(false)}
      >
        {text}
      </span>
      {hovered && <TextTooltip text={text} pos={pos} />}
    </>
  );
}

// ── Edit modal ─────────────────────────────────────────────────────────────

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)' }}>{children}</label>;
}

function EditModal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      previouslyFocusedRef.current?.focus();
    };
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
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-edit-title"
        style={{
        width: 400, display: 'flex', flexDirection: 'column',
        background: 'rgba(8,22,17,0.82)',
        backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
        border: '0.5px solid rgba(255,255,255,0.13)',
        borderRadius: 18,
        boxShadow: '0 32px 72px rgba(0,0,0,0.55), inset 0 0.5px 0 rgba(255,255,255,0.09)',
        overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 0' }}>
          <span id="review-edit-title" style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.88)' }}>Edit activity</span>
          <button type="button" aria-label="Close activity editor" onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.10)', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.45)', cursor: 'pointer' }}>
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

function SelectionToggle({
  state,
  label,
  onToggle,
}: {
  state: SelectionState;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-no-drag="true"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      style={{
        width: 24,
        height: 24,
        borderRadius: 7,
        border: `0.5px solid ${state === 'none' ? 'rgba(255,255,255,0.16)' : 'rgba(45,212,191,0.42)'}`,
        background: state === 'none' ? 'rgba(255,255,255,0.04)' : 'rgba(45,212,191,0.14)',
        color: 'rgba(45,212,191,0.92)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        cursor: 'pointer',
        marginLeft: 8,
        marginRight: 10,
      }}
      aria-label={`${state === 'all' ? 'Deselect' : 'Select'} ${label}`}
      aria-pressed={state === 'partial' ? 'mixed' : state === 'all'}
      title={`${state === 'all' ? 'Deselect' : 'Select'} ${label}`}
    >
      {state === 'all' ? (
        <Check size={11} strokeWidth={2.4} />
      ) : state === 'partial' ? (
        <span style={{ width: 8, height: 2, borderRadius: 999, background: 'currentColor' }} />
      ) : null}
    </button>
  );
}

// ── Title group row (with hover edit/delete) ───────────────────────────────

function TitleGroupRow({
  tg, tooltipText, tpro, assignmentStatus, paddingLeft, pointerDragProps, expanded, selectionState, onToggleSelect, onToggle, onEdit, onDelete, onHover, onHoverEnd,
}: {
  tg: TitleGroup;
  tooltipText: string;
  tpro: Project | null;
  assignmentStatus: 'unassigned' | 'mixed' | null;
  paddingLeft: number;
  pointerDragProps: (ids: number[], options?: { onPress?: () => void }) => object;
  expanded: boolean;
  selectionState: SelectionState;
  onToggleSelect: () => void;
  onToggle?: () => void;
  onEdit?: () => void;
  onDelete: () => void;
  onHover: () => void;
  onHoverEnd: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isExpandable = tg.activityIds.length > 1;
  const canEdit = Boolean(onEdit) && !isExpandable;
  const rowAction = isExpandable ? onToggle : onEdit;
  const rowProps = pointerDragProps(tg.activityIds, {
    onPress: rowAction,
  }) as React.HTMLAttributes<HTMLDivElement>;

  return (
    <div
      {...rowProps}
      className="activity-tree-row"
      role="group"
      aria-label={`${tooltipText} activity group`}
      onMouseEnter={onHover}
      onMouseLeave={() => { onHoverEnd(); setConfirmDelete(false); }}
      style={{
        ...((rowProps.style as React.CSSProperties | undefined) ?? {}),
        paddingLeft,
        cursor: isExpandable || canEdit ? 'pointer' : 'grab',
        background: selectionState !== 'none' ? 'rgba(45,212,191,0.07)' : undefined,
        ...(tpro ? { borderLeft: `2.5px solid ${tpro.color}77` } : {}),
      }}
    >
      <SelectionToggle state={selectionState} label={tooltipText} onToggle={onToggleSelect} />
      {isExpandable && (
        <button
          type="button"
          data-no-drag="true"
          className="review-row-disclosure"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${tooltipText}`}
          aria-expanded={expanded}
          onClick={(event) => { event.stopPropagation(); onToggle?.(); }}
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
      )}
      <button
        type="button"
        data-no-drag="true"
        className="review-row-label-button"
        onClick={(event) => { event.stopPropagation(); rowAction?.(); }}
        style={{
        fontSize: 12,
        color: tg.title ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.22)',
        fontStyle: tg.title ? 'normal' : 'italic',
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        <HoverText text={tooltipText} />
      </button>
      <span style={{
        fontSize: 11, color: 'rgba(255,255,255,0.28)',
        flexShrink: 0, marginLeft: 'auto', marginRight: 8,
        fontVariantNumeric: 'tabular-nums',
        minWidth: 48, textAlign: 'right', whiteSpace: 'nowrap',
      }}>
        {formatDuration(tg.total_s)}
      </span>
      {tpro && (
        <span className="review-row-assignment review-row-assignment--compact">
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: tpro.color }} />
          <span>{tpro.name}</span>
        </span>
      )}
      {assignmentStatus === 'unassigned' && (
        <span className="review-row-assignment review-row-assignment--compact review-row-assignment--unassigned">Unassigned</span>
      )}
      {assignmentStatus === 'mixed' && (
        <span className="review-row-assignment review-row-assignment--compact review-row-assignment--mixed">Mixed</span>
      )}
      {isExpandable && onEdit && (
        <button
          type="button"
          data-no-drag="true"
          className="review-row-edit-button"
          aria-label={`Edit all ${tg.activityIds.length} ${tooltipText} activities`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); onEdit(); }}
        >
          <Pencil size={10} />
        </button>
      )}
      <ActivityDeleteControl
        label={tooltipText}
        confirm={confirmDelete}
        onConfirmChange={setConfirmDelete}
        onDelete={onDelete}
      />
    </div>
  );
}

function ActivityLeafRow({
  activity, project, paddingLeft, pointerDragProps, selectionState, onToggleSelect, onEdit, onDelete, onHover, onHoverEnd,
}: {
  activity: Activity;
  project: Project | null;
  paddingLeft: number;
  pointerDragProps: (ids: number[], options?: { onPress?: () => void }) => object;
  selectionState: SelectionState;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onHover: () => void;
  onHoverEnd: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rowProps = pointerDragProps([activity.id], {
    onPress: onEdit,
  }) as React.HTMLAttributes<HTMLDivElement>;

  return (
    <div
      {...rowProps}
      className="activity-tree-row"
      role="group"
      aria-label={`${fullActivityLabel(activity)} activity`}
      onMouseEnter={onHover}
      onMouseLeave={() => { onHoverEnd(); setConfirmDelete(false); }}
      style={{
        ...((rowProps.style as React.CSSProperties | undefined) ?? {}),
        paddingLeft,
        cursor: 'pointer',
        background: selectionState !== 'none' ? 'rgba(45,212,191,0.07)' : undefined,
        ...(project ? { borderLeft: `2.5px solid ${project.color}55` } : {}),
      }}
    >
      <SelectionToggle state={selectionState} label={fullActivityLabel(activity)} onToggle={onToggleSelect} />
      <button
        type="button"
        data-no-drag="true"
        className="review-row-label-button"
        onClick={(event) => { event.stopPropagation(); onEdit(); }}
        style={{
        fontSize: 11.5,
        color: activity.window_title ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.26)',
        fontStyle: activity.window_title ? 'normal' : 'italic',
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        <HoverText text={fullActivityLabel(activity)} />
      </button>
      <span style={{
        fontSize: 11,
        color: 'rgba(255,255,255,0.24)',
        flexShrink: 0,
        marginLeft: 'auto',
        marginRight: 8,
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
      {project ? (
        <span className="review-row-assignment review-row-assignment--compact">
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: project.color }} />
          <span>{project.name}</span>
        </span>
      ) : (
        <span className="review-row-assignment review-row-assignment--compact review-row-assignment--unassigned">Unassigned</span>
      )}
      <ActivityDeleteControl
        label={fullActivityLabel(activity)}
        confirm={confirmDelete}
        onConfirmChange={setConfirmDelete}
        onDelete={onDelete}
      />
    </div>
  );
}

function ActivityDeleteControl({
  label,
  confirm,
  onConfirmChange,
  onDelete,
}: {
  label: string;
  confirm: boolean;
  onConfirmChange: (confirm: boolean) => void;
  onDelete: () => void;
}) {
  if (confirm) {
    return (
      <div data-no-drag="true" style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 'auto' }}>
        <button
          type="button"
          aria-label={`Confirm deletion of ${label}`}
          className="delete-confirm-button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{
            padding: '1px 7px', borderRadius: 5, cursor: 'pointer',
            border: '0.5px solid rgba(239,68,68,0.35)',
            background: 'rgba(239,68,68,0.10)', color: 'rgba(248,113,113,0.88)',
            fontSize: 10.5, fontFamily: 'Inter, sans-serif',
          }}
        >
          Delete
        </button>
        <button
          type="button"
          aria-label={`Cancel deletion of ${label}`}
          className="cancel-confirm-button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onConfirmChange(false); }}
          style={{
            padding: '1px 6px', borderRadius: 5, cursor: 'pointer',
            border: '0.5px solid rgba(255,255,255,0.10)',
            background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.42)',
            fontSize: 10.5, fontFamily: 'Inter, sans-serif',
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="icon-delete-button"
      data-no-drag="true"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onConfirmChange(true); }}
      aria-label={`Delete ${label}`}
      title={`Delete ${label}`}
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '0.5px solid rgba(255,255,255,0.08)',
        borderRadius: 5,
        cursor: 'pointer',
        color: 'rgba(255,90,90,0.40)',
        padding: '1px 3px',
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
      }}
    >
      <Trash2 size={11} />
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function ActivityPage({
  onUpgrade,
  initialFilter = 'all',
}: {
  onUpgrade: () => void;
  initialFilter?: ReviewFilter;
}) {
  const activities      = useActivityStore((s) => s.activities);
  const loading         = useActivityStore((s) => s.loading);
  const loadError       = useActivityStore((s) => s.error);
  const loadedDateKey   = useActivityStore((s) => s.loadedDateKey);
  const viewDate        = useActivityStore((s) => s.viewDate);
  const fetchForDate    = useActivityStore((s) => s.fetchForDate);
  const assignToProject = useActivityStore((s) => s.assignToProject);
  const assignActivitiesToProject = useActivityStore((s) => s.assignActivitiesToProject);
  const unassignFromProject = useActivityStore((s) => s.unassignFromProject);
  const deleteActivity  = useActivityStore((s) => s.deleteActivity);
  const updateActivity  = useActivityStore((s) => s.updateActivity);
  const projects        = useProjectStore((s) => s.projects);
  const tier            = useLicenseStore((s) => s.tier);
  const lockedProjectIds = useMemo(
    () => isPro(tier) ? new Set<number>() : lockedFreeProjectIds(projects),
    [projects, tier],
  );

  const [expandedApps, setExpandedApps] = useState<Set<string>>(() => new Set());
  const [expandedCtx,  setExpandedCtx]  = useState<Set<string>>(() => new Set());
  const [expandedTitles, setExpandedTitles] = useState<Set<string>>(() => new Set());
  const [hoveredActivityIds, setHoveredActivityIds] = useState<Set<number> | null>(null);
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);
  const [selectedActivityIds, setSelectedActivityIds] = useState<Set<number>>(() => new Set());
  const [bulkAssignProjectId, setBulkAssignProjectId] = useState<string>('');
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [viewMode, setViewMode] = useState<'summary' | 'details'>('summary');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>(initialFilter);
  const [searchQuery, setSearchQuery] = useState('');

  // ── edit state ────────────────────────────────────────────────────────
  const [editingTarget, setEditingTarget] = useState<EditTarget | null>(null);
  const [editTitle,  setEditTitle]  = useState('');
  const [editNote,   setEditNote]   = useState('');
  const [editProject, setEditProject] = useState('');
  const [editStart,  setEditStart]  = useState('');
  const [editEnd,    setEditEnd]    = useState('');
  const [saving,     setSaving]     = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const closeEdit = useCallback(() => setEditingTarget(null), []);

  const openEdit = (a: Activity, activityIds: number[] = [a.id]) => {
    setEditError(null);
    setEditingTarget({ base: a, activityIds });
    setEditTitle(displayAppName(a.app_name));
    setEditNote(a.window_title ?? '');
    const sharedProjectId = unanimousProjectId(activityIds, activities);
    if (activityIds.length === 1) {
      setEditProject(a.project_id ? String(a.project_id) : '');
    } else if (sharedProjectId) {
      setEditProject(String(sharedProjectId));
    } else {
      setEditProject(MIXED_PROJECT_VALUE);
    }
    setEditStart(format(fromUnixTime(a.started_at), 'HH:mm'));
    const endTs = a.ended_at ?? (a.started_at + (a.duration_s ?? 0));
    setEditEnd(format(fromUnixTime(endTs), 'HH:mm'));
  };

  const saveEdit = async () => {
    if (!editingTarget || saving) return;
    const requestedProjectId = editProject === MIXED_PROJECT_VALUE
      ? undefined
      : editProject
        ? parseInt(editProject, 10)
        : null;
    const currentProjectIds = new Set(editingTarget.activityIds.map((id) => {
      const currentActivity = activities.find((activity) => activity.id === id);
      return currentActivity
        ? currentActivity.project_id
        : id === editingTarget.base.id ? editingTarget.base.project_id : null;
    }));
    const assignmentChanged = requestedProjectId !== undefined
      && (currentProjectIds.size !== 1 || !currentProjectIds.has(requestedProjectId));
    if (assignmentChanged && requestedProjectId != null && lockedProjectIds.has(requestedProjectId)) {
      setEditError('This project is locked on the Free plan. Choose one of your first three projects or remove the assignment.');
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      if (editingTarget.activityIds.length > 1) {
        const nextAppName = editTitle.trim() || editingTarget.base.app_name;
        const nextWindowTitle = editNote.trim();
        const activityMap = new Map(activities.map((a) => [a.id, a] as const));

        await Promise.all(editingTarget.activityIds.map((id) => {
          const activity = activityMap.get(id);
          if (!activity) return Promise.resolve();
          const originalStart = activity.original_started_at ?? activity.started_at;
          const originalEnd = activity.original_ended_at
            ?? (originalStart + (activity.original_duration_s ?? activity.duration_s ?? 0));
          return updateActivity(id, nextAppName, nextWindowTitle, originalStart, originalEnd);
        }));
        if (assignmentChanged && requestedProjectId !== undefined) {
          if (requestedProjectId != null) {
            await assignActivitiesToProject(editingTarget.activityIds, requestedProjectId);
          } else {
            await Promise.all(editingTarget.activityIds.map((id) => unassignFromProject(id)));
          }
        }
      } else {
        let s: number;
        let e: number;
        if (editingTarget.base.time_clipped) {
          s = editingTarget.base.original_started_at ?? editingTarget.base.started_at;
          e = editingTarget.base.original_ended_at
            ?? (s + (editingTarget.base.original_duration_s ?? editingTarget.base.duration_s ?? 0));
        } else {
          const base = fromUnixTime(editingTarget.base.started_at);
          const [sh, sm] = editStart.split(':').map(Number);
          const [eh, em] = editEnd.split(':').map(Number);
          const sDate = new Date(base); sDate.setHours(sh, sm, 0, 0);
          const eDate = new Date(base); eDate.setHours(eh, em, 0, 0);
          s = Math.floor(sDate.getTime() / 1000);
          e = Math.floor(eDate.getTime() / 1000);
          if (e < s) e += 86400;
        }
        await updateActivity(editingTarget.base.id, editTitle.trim() || editingTarget.base.app_name, editNote.trim(), s, e);
        if (assignmentChanged && requestedProjectId !== undefined) {
          if (requestedProjectId != null) await assignToProject(editingTarget.base.id, requestedProjectId);
          else await unassignFromProject(editingTarget.base.id);
        }
      }
      setEditingTarget(null);
    } catch (error) {
      setEditError(errorMessage(error, 'The activity changes could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  // Toast notification
  const [toast, setToast] = useState<{ msg: string; color: string; kind: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTimedToast = useCallback((nextToast: { msg: string; color: string; kind: 'success' | 'error' }) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(nextToast);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const showToast = useCallback((projectName: string, color: string, count: number) => {
    showTimedToast({
      msg: `${count} activit${count === 1 ? 'y' : 'ies'} assigned to ${projectName}`,
      color,
      kind: 'success',
    });
  }, [showTimedToast]);

  const showErrorToast = useCallback((error: unknown, fallback: string) => {
    showTimedToast({
      msg: errorMessage(error, fallback),
      color: '#f87171',
      kind: 'error',
    });
  }, [showTimedToast]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Timeline state
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<Activity | null>(null);
  const [tipPos,  setTipPos]  = useState<TPos>({ x: 0, y: 0 });
  const [nowY,    setNowY]    = useState<number | null>(null);

  const viewDateKey = startOfDay(viewDate).getTime();
  const hasCurrentDateData = loadedDateKey === viewDateKey;
  const dayStart = viewDateKey / 1000;
  const viewingToday = isToday(viewDate);
  const tsToY = useCallback(
    (ts: number) => ((ts - dayStart) / 3600) * HOUR_HEIGHT,
    [dayStart],
  );
  const hours    = Array.from({ length: 24 }, (_, i) => i);

  useEffect(() => {
    const snapshot = useActivityStore.getState();
    const requestedDate = new Date(viewDateKey);
    if (!snapshot.loading && snapshot.loadedDateKey !== viewDateKey) {
      void fetchForDate(requestedDate);
    }
    if (viewingToday) {
      const id = setInterval(() => void fetchForDate(requestedDate), 10_000);
      return () => clearInterval(id);
    }
  }, [fetchForDate, viewDateKey, viewingToday]);

  useEffect(() => {
    setReviewFilter(initialFilter);
  }, [initialFilter]);

  useEffect(() => {
    setExpandedApps(new Set());
    setExpandedCtx(new Set());
    setExpandedTitles(new Set());
    setHoveredActivityIds(null);
    setDeleteConfirmKey(null);
    setSelectedActivityIds(new Set());
    setBulkAssignProjectId('');
    setBulkDeleteConfirm(false);
    setEditingTarget(null);
  }, [viewDateKey]);

  // now-line
  useEffect(() => {
    const update = () => setNowY(viewingToday ? tsToY(Date.now() / 1000) : null);
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [tsToY, viewingToday]);

  // Scroll timeline to current hour on date change
  useEffect(() => {
    if (!scrollRef.current) return;
    const targetHour = viewingToday ? Math.max(0, new Date().getHours() - 3) : 8;
    scrollRef.current.scrollTop = targetHour * HOUR_HEIGHT;
  }, [viewDateKey, viewingToday]);

  useEffect(() => {
    const visibleIds = new Set((hasCurrentDateData ? activities : []).map((activity) => activity.id));
    setSelectedActivityIds((current) => {
      const next = new Set(Array.from(current).filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [activities, hasCurrentDateData]);

  useEffect(() => {
    const bulkProjectId = Number(bulkAssignProjectId);
    if (
      bulkAssignProjectId
      && (selectedActivityIds.size === 0 || lockedProjectIds.has(bulkProjectId))
    ) {
      setBulkAssignProjectId('');
    }
    setBulkDeleteConfirm(false);
  }, [selectedActivityIds, bulkAssignProjectId, lockedProjectIds]);

  const currentActivities = useMemo(
    () => hasCurrentDateData ? activities : [],
    [activities, hasCurrentDateData],
  );
  const activityBursts = useMemo(
    () => groupActivitiesIntoBursts(currentActivities),
    [currentActivities],
  );
  const needsReviewActivityIds = useMemo(
    () => {
      const ids = new Set<number>();
      for (const burst of activityBursts) {
        if (burst.needsAttention) burst.activityIds.forEach((id) => ids.add(id));
      }
      return ids;
    },
    [activityBursts],
  );
  const filteredActivities = useMemo(
    () => filterReviewActivities(currentActivities, {
      filter: reviewFilter,
      query: searchQuery,
      projects,
      needsReviewActivityIds,
    }),
    [currentActivities, needsReviewActivityIds, projects, reviewFilter, searchQuery],
  );
  const tree = useMemo(
    () => buildTree(filteredActivities, reviewFilter === 'needs-review'),
    [filteredActivities, reviewFilter],
  );
  const visibleTreeActivityIds = useMemo(
    () => new Set(tree.flatMap((app) => app.activityIds)),
    [tree],
  );
  const activityById = useMemo(
    () => new Map(currentActivities.map((activity) => [activity.id, activity] as const)),
    [currentActivities],
  );
  const projectIdByActivityId = useMemo(
    () => new Map(currentActivities.map((activity) => [activity.id, activity.project_id] as const)),
    [currentActivities],
  );
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );
  const needsReviewBlockCount = useMemo(
    () => activityBursts.filter((burst) => burst.needsAttention).length,
    [activityBursts],
  );
  const assignedCount = useMemo(
    () => currentActivities.filter((activity) => activity.project_id !== null).length,
    [currentActivities],
  );
  const assignmentPercent = currentActivities.length > 0
    ? Math.round((assignedCount / currentActivities.length) * 100)
    : 0;
  const filterAppCounts = useMemo(() => ({
    all: countDistinctApps(currentActivities),
    'needs-review': countDistinctApps(
      currentActivities.filter((activity) => needsReviewActivityIds.has(activity.id)),
      true,
    ),
    unassigned: countDistinctApps(
      currentActivities.filter((activity) => activity.project_id === null),
    ),
    assigned: countDistinctApps(
      currentActivities.filter((activity) => activity.project_id !== null),
    ),
  }), [currentActivities, needsReviewActivityIds]);

  useEffect(() => {
    setSelectedActivityIds((current) => {
      const next = new Set(Array.from(current).filter((id) => visibleTreeActivityIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleTreeActivityIds]);

  const toggleApp = (name: string) =>
    setExpandedApps((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const toggleCtx = (key: string) =>
    setExpandedCtx((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleTitle = (key: string) =>
    setExpandedTitles((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const highlightActivityIds = (ids: number[]) => setHoveredActivityIds(new Set(ids));
  const clearActivityHighlight = () => setHoveredActivityIds(null);
  const toggleSelectedActivityIds = useCallback((ids: number[]) => {
    setSelectedActivityIds((current) => {
      const next = new Set(current);
      const allSelected = ids.every((id) => next.has(id));
      ids.forEach((id) => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }, []);
  const clearSelectedActivities = useCallback(() => {
    setSelectedActivityIds(new Set());
    setBulkAssignProjectId('');
    setBulkDeleteConfirm(false);
  }, []);
  const selectAllActivities = useCallback(() => {
    setSelectedActivityIds(new Set(visibleTreeActivityIds));
  }, [visibleTreeActivityIds]);
  const resolveDragIds = useCallback((ids: number[]) => {
    const selectedIds = Array.from(selectedActivityIds);
    const hasSelectedInRow = ids.some((id) => selectedActivityIds.has(id));
    if (selectedIds.length > 0 && hasSelectedInRow) {
      return selectedIds;
    }
    return ids;
  }, [selectedActivityIds]);

  const handleDrop = useCallback(async (projectId: number, ids: number[]): Promise<boolean> => {
    if (projectId < 1 || ids.length === 0) return false;
    if (lockedProjectIds.has(projectId)) {
      showErrorToast(
        'This project is locked on the Free plan.',
        'This project is locked on the Free plan.',
      );
      return false;
    }
    try {
      await assignActivitiesToProject(ids, projectId);
      const proj = projects.find((p) => p.id === projectId);
      if (proj) showToast(proj.name, proj.color, ids.length);
      if (ids.some((id) => selectedActivityIds.has(id))) {
        clearSelectedActivities();
      }
      return true;
    } catch (error) {
      showErrorToast(error, 'The activities could not be assigned.');
      return false;
    }
  }, [assignActivitiesToProject, clearSelectedActivities, lockedProjectIds, projects, selectedActivityIds, showErrorToast, showToast]);

  const handleBulkClearProject = useCallback(async () => {
    const ids = Array.from(selectedActivityIds);
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map((id) => unassignFromProject(id)));
      clearSelectedActivities();
    } catch (error) {
      showErrorToast(error, 'The project assignments could not be removed.');
    }
  }, [clearSelectedActivities, selectedActivityIds, showErrorToast, unassignFromProject]);

  const handleDeleteActivities = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map((id) => deleteActivity(id)));
      setDeleteConfirmKey(null);
    } catch (error) {
      showErrorToast(error, 'The selected activities could not be deleted.');
    }
  }, [deleteActivity, showErrorToast]);

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedActivityIds);
    if (ids.length === 0 || bulkDeleting) return;
    if (!bulkDeleteConfirm) {
      setBulkDeleteConfirm(true);
      return;
    }
    setBulkDeleting(true);
    try {
      await Promise.all(ids.map((id) => deleteActivity(id)));
      clearSelectedActivities();
    } catch (error) {
      showErrorToast(error, 'The selected activities could not be deleted.');
      setBulkDeleteConfirm(false);
    } finally {
      setBulkDeleting(false);
    }
  }, [bulkDeleteConfirm, bulkDeleting, clearSelectedActivities, deleteActivity, selectedActivityIds, showErrorToast]);

  const handleBulkAssignSelected = useCallback(async () => {
    const projectId = parseInt(bulkAssignProjectId, 10);
    const ids = Array.from(selectedActivityIds);
    if (!projectId || ids.length === 0) return;
    await handleDrop(projectId, ids);
  }, [bulkAssignProjectId, selectedActivityIds, handleDrop]);

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
      dragPending.current = {
        ids: resolveDragIds(ids),
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
      };
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
  }), [resolveDragIds]);

  const timelineBlocks = normalizeTimelineActivities(filteredActivities);
  const totalSecs = currentActivities.reduce((sum, a) => sum + (a.duration_s ?? 0), 0);
  const filteredTotalSecs = filteredActivities.reduce((sum, a) => sum + (a.duration_s ?? 0), 0);
  const showTimeline = isPro(tier);

  return (
    <div className="review-page">
      <section className="review-overview" aria-labelledby="review-page-title">
        <div className="review-overview__copy">
          <span className="review-overview__eyebrow">Organize your time</span>
          <h1 id="review-page-title">Review your activity</h1>
          <p>Confirm project assignments, correct uncertain activity, or open details when you need them.</p>
          {!showTimeline && (
            <button type="button" className="review-overview__upgrade" onClick={onUpgrade}>
              <CalendarDays size={13} /> Add the visual day timeline with Pro
            </button>
          )}
        </div>
        <div className="review-overview__stats" aria-label="Review summary">
          <div className="review-stat">
            <span>Tracked</span>
            <strong>{formatDuration(totalSecs)}</strong>
          </div>
          <div className="review-stat">
            <span>Work blocks</span>
            <strong>{activityBursts.length}</strong>
          </div>
          <div className={`review-stat ${needsReviewBlockCount > 0 ? 'review-stat--attention' : ''}`}>
            <span>Needs attention</span>
            <strong>{needsReviewBlockCount}</strong>
          </div>
          <div className="review-stat">
            <span>Assigned</span>
            <strong>{assignmentPercent}%</strong>
          </div>
        </div>
      </section>

      <div className="review-workspace">

      {/* ── Left: activity tree ─────────────────────────────────────────── */}
      <div className="review-activity-column">
        <div
          className="glass-card review-activity-panel"
        >
          <div className="review-panel-heading">
            <div>
              <h2>Activities</h2>
              <p>Select rows to assign them in bulk. Open an app for websites, windows, and individual records.</p>
            </div>
            <div className="review-panel-heading__actions">
              <div role="group" aria-label="Activity detail level" className="review-view-toggle">
                {(['summary', 'details'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={viewMode === mode}
                    onClick={() => setViewMode(mode)}
                  >
                    {mode === 'summary' ? 'Overview' : 'Details'}
                  </button>
                ))}
              </div>
              {visibleTreeActivityIds.size > 0 && selectedActivityIds.size < visibleTreeActivityIds.size && (
                <button
                  type="button"
                  className="review-select-all"
                  aria-label={`Select all ${visibleTreeActivityIds.size} visible activities`}
                  onClick={selectAllActivities}
                >
                  Select visible
                </button>
              )}
              <span className="review-app-count">
                {tree.length} {tree.length === 1 ? 'app' : 'apps'}
              </span>
            </div>
          </div>

          <div className="review-toolbar">
            <div className="review-search">
              <Search size={14} aria-hidden="true" />
              <label className="sr-only" htmlFor="review-activity-search">Search activities</label>
              <input
                id="review-activity-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search apps, titles, websites, files, or projects"
              />
              {searchQuery && (
                <button type="button" aria-label="Clear activity search" onClick={() => setSearchQuery('')}>
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="review-filters" role="group" aria-label="Filter activities by assignment status">
              {([
                ['all', 'All', filterAppCounts.all],
                ['needs-review', 'Needs attention', filterAppCounts['needs-review']],
                ['unassigned', 'Unassigned', filterAppCounts.unassigned],
                ['assigned', 'Assigned', filterAppCounts.assigned],
              ] as const).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={reviewFilter === value}
                  className={reviewFilter === value ? 'review-filter review-filter--active' : 'review-filter'}
                  onClick={() => setReviewFilter(value)}
                >
                  <span>{label}</span>
                  <strong>{count}</strong>
                </button>
              ))}
            </div>
          </div>

          {(loading && hasCurrentDateData) && (
            <div className="review-inline-status" role="status" aria-live="polite">
              <RefreshCw size={12} className="review-spin" /> Refreshing activity…
            </div>
          )}
          {(loadError && hasCurrentDateData) && (
            <div className="review-inline-status review-inline-status--error" role="alert">
              <AlertTriangle size={13} />
              <span>{loadError}</span>
              <button type="button" onClick={() => void fetchForDate(viewDate)}>Retry</button>
            </div>
          )}

          <div className="review-activity-scroll">
            {loading && !hasCurrentDateData ? (
              <div className="review-state" role="status" aria-live="polite">
                <RefreshCw size={22} className="review-spin" />
                <strong>Loading this day’s activity…</strong>
                <span>Your previous day stays hidden until this date is ready.</span>
              </div>
            ) : loadError && !hasCurrentDateData ? (
              <div className="review-state review-state--error" role="alert">
                <AlertTriangle size={24} />
                <strong>Activity could not be loaded</strong>
                <span>{loadError}</span>
                <button type="button" className="btn-secondary" onClick={() => void fetchForDate(viewDate)}>Try again</button>
              </div>
            ) : currentActivities.length === 0 ? (
              <div className="review-state">
                <CalendarDays size={24} />
                <strong>Nothing to review for this day</strong>
                <span>Tracked applications will appear here once activity is recorded.</span>
              </div>
            ) : tree.length === 0 ? (
              <div className="review-state">
                <Check size={24} />
                <strong>{reviewFilter === 'needs-review' && !searchQuery ? 'You’re all caught up' : 'No matching activity'}</strong>
                <span>{reviewFilter === 'needs-review' && !searchQuery
                  ? 'Every recorded block has a confident project assignment.'
                  : 'Try another search or assignment filter.'}</span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => { setReviewFilter('all'); setSearchQuery(''); }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              tree.map((app) => {
            const appOpen    = expandedApps.has(app.appName);
            const hasContext = app.contexts.some((c) => c.context !== '');

            return (
              <div key={app.appName} style={{ marginBottom: 2 }}>

                {/* App row */}
                {(() => {
                  const assignment = summarizeIndexedAssignment(app.activityIds, projectIdByActivityId);
                  const upro = assignment.status === 'assigned'
                    ? projectById.get(assignment.projectId) ?? null
                    : null;
                  const appNeedsReview = app.activityIds.some((id) => needsReviewActivityIds.has(id));
                  const handleAppPress = () => {
                    if (viewMode === 'details') {
                      toggleApp(app.appName);
                      return;
                    }
                    setViewMode('details');
                    setExpandedApps((current) => new Set(current).add(app.appName));
                  };
                  return (
                    <div
                      {...pointerDragProps(app.activityIds, { onPress: handleAppPress })}
                      className="activity-tree-row review-app-row"
                      role="group"
                      aria-label={`${displayAppName(app.appName)} activities`}
                      onMouseEnter={() => highlightActivityIds(app.activityIds)}
                      onMouseLeave={() => { clearActivityHighlight(); setDeleteConfirmKey(null); }}
                      style={{
                        ...(upro ? { borderLeft: `2.5px solid ${upro.color}88` } : {}),
                        ...(getSelectionState(app.activityIds, selectedActivityIds) !== 'none'
                          ? { background: 'rgba(45,212,191,0.07)' }
                          : {}),
                      }}
                    >
                      <SelectionToggle
                        state={getSelectionState(app.activityIds, selectedActivityIds)}
                        label={`${displayAppName(app.appName)} activities`}
                        onToggle={() => toggleSelectedActivityIds(app.activityIds)}
                      />
                      <span style={{
                        width: 48, textAlign: 'right', paddingRight: 10, flexShrink: 0,
                        fontSize: 11.5, color: 'rgba(255,255,255,0.38)',
                        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                      }}>
                        {formatDuration(app.total_s)}
                      </span>
                      <button
                        type="button"
                        data-no-drag="true"
                        className="review-row-disclosure"
                        aria-label={`${viewMode === 'details' && appOpen ? 'Collapse' : 'Open'} ${displayAppName(app.appName)} activity details`}
                        aria-expanded={viewMode === 'details' ? appOpen : false}
                        onClick={(event) => { event.stopPropagation(); handleAppPress(); }}
                      >
                        {viewMode === 'details' && appOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                      </button>
                      <AppIcon name={app.appName} />
                      <span style={{
                        marginLeft: 7, fontSize: 13, fontWeight: 500,
                        color: 'rgba(255,255,255,0.85)',
                        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        <HoverText text={displayAppName(app.appName)} />
                      </span>
                      <span className="review-row-count">
                        {app.activityIds.length} {app.activityIds.length === 1 ? 'record' : 'records'}
                      </span>
                      {appNeedsReview && (
                        <span className="review-row-status review-row-status--attention">Needs review</span>
                      )}
                      {upro && (
                        <span className="review-row-assignment">
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: upro.color }} />
                          <span>
                            {upro.name}
                          </span>
                        </span>
                      )}
                      {assignment.status === 'unassigned' && (
                        <span className="review-row-assignment review-row-assignment--unassigned">Unassigned</span>
                      )}
                      {assignment.status === 'mixed' && (
                        <span className="review-row-assignment review-row-assignment--mixed">Mixed projects</span>
                      )}
                      <ActivityDeleteControl
                        label={`${displayAppName(app.appName)} activities`}
                        confirm={deleteConfirmKey === `app:${app.appName}`}
                        onConfirmChange={(confirm) => setDeleteConfirmKey(confirm ? `app:${app.appName}` : null)}
                        onDelete={() => void handleDeleteActivities(app.activityIds)}
                      />
                    </div>
                  );
                })()}

                {viewMode === 'details' && appOpen && app.contexts.map((ctx) => {
                  const ctxKey  = `${app.appName}::${ctx.context}`;
                  const ctxOpen = expandedCtx.has(ctxKey);
                  const showCtxRow = hasContext && ctx.context !== '';
                  const contextAssignment = summarizeIndexedAssignment(ctx.activityIds, projectIdByActivityId);
                  const contextProject = contextAssignment.status === 'assigned'
                    ? projectById.get(contextAssignment.projectId) ?? null
                    : null;

                  return (
                    <div key={ctxKey}>
                      {showCtxRow && (
                        <div
                          {...pointerDragProps(ctx.activityIds, { onPress: () => toggleCtx(ctxKey) })}
                          className="activity-tree-row"
                          role="group"
                          aria-label={`${ctx.context} activity group`}
                          onMouseEnter={() => highlightActivityIds(ctx.activityIds)}
                          onMouseLeave={() => { clearActivityHighlight(); setDeleteConfirmKey(null); }}
                          style={{
                            paddingLeft: 62,
                            ...(getSelectionState(ctx.activityIds, selectedActivityIds) !== 'none'
                              ? { background: 'rgba(45,212,191,0.07)' }
                              : {}),
                          }}
                        >
                          <SelectionToggle
                            state={getSelectionState(ctx.activityIds, selectedActivityIds)}
                            label={`${ctx.context} activities`}
                            onToggle={() => toggleSelectedActivityIds(ctx.activityIds)}
                          />
                          <button
                            type="button"
                            data-no-drag="true"
                            className="review-row-disclosure"
                            aria-label={`${ctxOpen ? 'Collapse' : 'Expand'} ${ctx.context}`}
                            aria-expanded={ctxOpen}
                            onClick={(event) => { event.stopPropagation(); toggleCtx(ctxKey); }}
                          >
                            {ctxOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          </button>
                          <span style={{ color: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                            {ctx.contextType === 'domain' ? <Globe size={11} /> : <Folder size={11} />}
                          </span>
                          <span style={{
                            marginLeft: 5, fontSize: 12,
                            color: 'rgba(255,255,255,0.55)',
                            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            <HoverText text={ctx.context} />
                          </span>
                          <span style={{
                            fontSize: 11, color: 'rgba(255,255,255,0.28)',
                            flexShrink: 0, marginLeft: 'auto', marginRight: 8,
                            fontVariantNumeric: 'tabular-nums',
                            minWidth: 48, textAlign: 'right', whiteSpace: 'nowrap',
                          }}>
                            {formatDuration(ctx.total_s)}
                          </span>
                          {contextProject && (
                            <span className="review-row-assignment review-row-assignment--compact">
                              <span style={{ width: 5, height: 5, borderRadius: '50%', background: contextProject.color }} />
                              <span>{contextProject.name}</span>
                            </span>
                          )}
                          {contextAssignment.status === 'unassigned' && (
                            <span className="review-row-assignment review-row-assignment--compact review-row-assignment--unassigned">Unassigned</span>
                          )}
                          {contextAssignment.status === 'mixed' && (
                            <span className="review-row-assignment review-row-assignment--compact review-row-assignment--mixed">Mixed</span>
                          )}
                          <ActivityDeleteControl
                            label={`${ctx.context} activities`}
                            confirm={deleteConfirmKey === `ctx:${ctxKey}`}
                            onConfirmChange={(confirm) => setDeleteConfirmKey(confirm ? `ctx:${ctxKey}` : null)}
                            onDelete={() => void handleDeleteActivities(ctx.activityIds)}
                          />
                        </div>
                      )}
                      {(!showCtxRow || ctxOpen) && ctx.titles.map((tg) => {
                        const titleKey = `${app.appName}::${ctx.context}::${tg.title || '__untitled__'}`;
                        const titleOpen = expandedTitles.has(titleKey);
                        const titleAssignment = summarizeIndexedAssignment(tg.activityIds, projectIdByActivityId);
                        const tpro = titleAssignment.status === 'assigned'
                          ? projectById.get(titleAssignment.projectId) ?? null
                          : null;
                        const editableActivity = activityById.get(tg.activityIds[0]) ?? null;
                        const titleActivities = tg.activityIds
                          .map((id) => activityById.get(id) ?? null)
                          .filter((a): a is Activity => a !== null)
                          .sort((a, b) => a.started_at - b.started_at);
                        return (
                          <div key={titleKey}>
                            <TitleGroupRow
                              tg={tg}
                              tooltipText={
                                titleActivities[0]
                                  ? fullActivityLabel(titleActivities[0])
                                  : (tg.title || 'Untitled')
                              }
                              tpro={tpro ?? null}
                              assignmentStatus={titleAssignment.status === 'assigned' ? null : titleAssignment.status}
                              paddingLeft={showCtxRow ? 86 : 62}
                              pointerDragProps={pointerDragProps}
                              expanded={titleOpen}
                              selectionState={getSelectionState(tg.activityIds, selectedActivityIds)}
                              onToggleSelect={() => toggleSelectedActivityIds(tg.activityIds)}
                              onToggle={tg.activityIds.length > 1 ? () => toggleTitle(titleKey) : undefined}
                              onEdit={editableActivity ? () => openEdit(editableActivity, tg.activityIds) : undefined}
                              onDelete={() => void handleDeleteActivities(tg.activityIds)}
                              onHover={() => highlightActivityIds(tg.activityIds)}
                              onHoverEnd={clearActivityHighlight}
                            />
                            {titleOpen && titleActivities.map((activity) => {
                              const apro = activity.project_id ? projectById.get(activity.project_id) ?? null : null;
                              return (
                                <ActivityLeafRow
                                  key={activity.id}
                                  activity={activity}
                                  project={apro}
                                  paddingLeft={showCtxRow ? 110 : 86}
                                  pointerDragProps={pointerDragProps}
                                  selectionState={getSelectionState([activity.id], selectedActivityIds)}
                                  onToggleSelect={() => toggleSelectedActivityIds([activity.id])}
                                  onEdit={() => openEdit(activity)}
                                  onDelete={() => void handleDeleteActivities([activity.id])}
                                  onHover={() => highlightActivityIds([activity.id])}
                                  onHoverEnd={clearActivityHighlight}
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
      </div>

      {/* ── Right: timeline (Pro only) ──────────────────────────────────── */}
      {showTimeline && (
        <div
          className="glass-card review-timeline-panel"
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
              {formatDuration(filteredTotalSecs)}
            </span>
          </div>

          {/* Scrollable grid */}
          <div ref={scrollRef} style={{ overflowY: 'auto', flex: 1 }}>
            <div role="list" aria-label="Filtered activity timeline" style={{ position: 'relative', height: 24 * HOUR_HEIGHT }}>
              {hours.map((h) => (
                <div key={h} role="presentation" aria-hidden="true" style={{
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
                const height = Math.max(MIN_TIMELINE_BLOCK_HEIGHT, (a.duration_s! / 3600) * HOUR_HEIGHT);
                const proj   = a.project_id ? projectById.get(a.project_id) : undefined;
                const color  = proj?.color ?? 'rgba(255,255,255,0.18)';
                const isHighlighted = hoveredActivityIds?.has(a.id) ?? false;
                const isTimelineHovered = hovered?.id === a.id;
                const hasTreeHighlight = Boolean(hoveredActivityIds);
                const hasTimelineHover = Boolean(hovered);
                const isDimmed = (hasTreeHighlight && !isHighlighted) || (hasTimelineHover && !isTimelineHovered);
                const isEmphasized = isHighlighted || isTimelineHovered;

                return (
                  <div
                    key={a.id}
                    className="review-timeline-block"
                    role="listitem"
                    aria-label={`${displayAppName(a.app_name)}, ${format(fromUnixTime(a.started_at), 'HH:mm')}, ${formatDuration(a.duration_s ?? 0)}${proj ? `, ${proj.name}` : ', unassigned'}`}
                    onMouseEnter={(e) => { setHovered(a); setTipPos({ x: e.clientX, y: e.clientY }); }}
                    onMouseMove={(e)  => setTipPos({ x: e.clientX, y: e.clientY })}
                    onMouseLeave={()  => setHovered(null)}
                    style={{
                      position: 'absolute', top, left: GUTTER + 6, right: 8,
                      zIndex: isEmphasized ? 3 : 1,
                      height, background: color, opacity: isDimmed ? 0.28 : isEmphasized ? 0.96 : 0.88,
                      borderRadius: 4, cursor: 'default', overflow: 'hidden',
                      display: 'flex', flexDirection: 'column', justifyContent: 'center',
                      padding: '0 6px',
                      outline: isEmphasized ? '2px solid rgba(255,255,255,0.88)' : 'none',
                      outlineOffset: 1,
                      boxShadow: isEmphasized ? '0 0 0 4px rgba(45,212,191,0.18), 0 8px 22px rgba(0,0,0,0.28)' : 'none',
                      transform: isTimelineHovered ? 'scaleX(1.015)' : undefined,
                      transition: 'opacity 0.12s, outline-color 0.12s, box-shadow 0.12s, transform 0.12s',
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
                <div role="presentation" aria-hidden="true" style={{
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
      </div>

      {/* Tooltip */}
      {hovered && isPro(tier) && (
        <Tooltip
          activity={hovered}
          project={hovered.project_id ? projectById.get(hovered.project_id) : undefined}
          pos={tipPos}
        />
      )}

      {/* Success toast */}
      {toast && createPortal(
        <div role={toast.kind === 'error' ? 'alert' : 'status'} aria-live="polite" style={{
          position: 'fixed', bottom: selectedActivityIds.size > 0 ? 104 : 24, left: '50%', transform: 'translateX(-50%)',
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
            <path
              d={toast.kind === 'success' ? 'M4 7l2 2 4-4' : 'M4.5 4.5l5 5m0-5l-5 5'}
              stroke={toast.color}
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)', fontWeight: 500 }}>
            {toast.msg}
          </span>
        </div>,
        document.body
      )}

      {selectedActivityIds.size > 0 && createPortal(
        <div style={{
          position: 'fixed',
          left: '50%',
          bottom: 24,
          transform: 'translateX(-50%)',
          zIndex: 4200,
          width: 'min(680px, calc(100vw - 32px))',
          pointerEvents: 'none',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            padding: '10px 12px',
            borderRadius: 12,
            background: 'rgba(8,22,17,0.96)',
            border: '0.5px solid rgba(45,212,191,0.24)',
            boxShadow: '0 18px 40px rgba(0,0,0,0.42)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            pointerEvents: 'auto',
          }}>
            <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', flex: '1 1 140px' }}>
              {selectedActivityIds.size} {selectedActivityIds.size === 1 ? 'activity selected' : 'activities selected'}
            </span>
            <Select
              value={bulkAssignProjectId}
              onChange={setBulkAssignProjectId}
              options={[
                { value: '', label: 'Assign to…' },
                ...projects.map((p) => ({
                  value: String(p.id),
                  label: lockedProjectIds.has(p.id) ? `${p.name} (locked on Free)` : p.name,
                  disabled: lockedProjectIds.has(p.id),
                })),
              ]}
              placeholder="Assign to…"
              style={{ minWidth: 160, fontSize: 11.5 }}
            />
            <button
              className="btn-primary"
              onClick={() => void handleBulkAssignSelected()}
              disabled={!bulkAssignProjectId}
              style={{ width: 'auto', fontSize: 11.5, padding: '6px 12px' }}
            >
              Assign
            </button>
            <button
              className="btn-secondary"
              onClick={() => void handleBulkClearProject()}
              style={{ width: 'auto', fontSize: 11.5, padding: '6px 12px' }}
            >
              No project
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void handleBulkDelete()}
              disabled={bulkDeleting}
              style={{
                width: 'auto',
                fontSize: 11.5,
                padding: '6px 12px',
                color: 'rgba(248,113,113,0.92)',
                borderColor: bulkDeleteConfirm ? 'rgba(239,68,68,0.55)' : 'rgba(239,68,68,0.26)',
                background: bulkDeleteConfirm ? 'rgba(239,68,68,0.18)' : 'rgba(239,68,68,0.08)',
              }}
            >
              {bulkDeleting
                ? 'Deleting…'
                : bulkDeleteConfirm
                  ? `Confirm delete ${selectedActivityIds.size}`
                  : 'Delete'}
            </button>
            <button
              className="btn-secondary"
              onClick={clearSelectedActivities}
              style={{ width: 'auto', fontSize: 11.5, padding: '6px 12px' }}
            >
              Clear
            </button>
          </div>
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
        <EditModal onClose={closeEdit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <FieldLabel htmlFor="review-edit-application">Application</FieldLabel>
            <input id="review-edit-application" className="glass-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={{ fontSize: 13 }} autoFocus />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <FieldLabel htmlFor="review-edit-window-title">Window title or note</FieldLabel>
            <input id="review-edit-window-title" className="glass-input" value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="Optional context shown in Review" style={{ fontSize: 12 }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <FieldLabel htmlFor="review-edit-project">Project</FieldLabel>
            <Select
              id="review-edit-project"
              value={editProject}
              onChange={setEditProject}
              options={[
                ...(editingTarget.activityIds.length > 1 ? [{ value: MIXED_PROJECT_VALUE, label: 'Keep existing projects' }] : []),
                { value: '', label: 'No project' },
                ...projects.map((p) => ({
                  value: String(p.id),
                  label: lockedProjectIds.has(p.id) ? `${p.name} (locked on Free)` : p.name,
                  disabled: lockedProjectIds.has(p.id),
                })),
              ]}
              placeholder="No project"
            />
          </div>
          {editError && (
            <div role="alert" style={{ fontSize: 11.5, color: 'rgba(248,113,113,0.9)', lineHeight: 1.45 }}>
              {editError}
            </div>
          )}
          {editingTarget.activityIds.length === 1 && !editingTarget.base.time_clipped ? (
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <FieldLabel htmlFor="review-edit-start">Start</FieldLabel>
                <input id="review-edit-start" type="time" className="glass-input" value={editStart} onChange={(e) => setEditStart(e.target.value)} style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <FieldLabel htmlFor="review-edit-end">End</FieldLabel>
                <input id="review-edit-end" type="time" className="glass-input" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }} />
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.38)', lineHeight: 1.45 }}>
              {editingTarget.base.time_clipped
                ? 'This activity crosses the selected day boundary. Its original timing will be preserved while you edit its title or project.'
                : `Changes will be applied to all ${editingTarget.activityIds.length} activities in this row. Time fields are hidden because each activity keeps its own original timing.`}
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
