import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format, fromUnixTime } from 'date-fns';
import {
  AppWindow,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  FilePenLine,
  Globe2,
  ListChecks,
  MessageSquare,
  Plus,
  Terminal,
  X,
} from 'lucide-react';
import { FocusProjectSelect } from '../components/tracking/FocusProjectSelect';
import { TrackerHealth } from '../components/tracking/TrackerHealth';
import {
  countFocusedBlocks,
  groupActivitiesIntoBursts,
  nextBurstExpansionPreference,
  resolveOpenBurstId,
  type ActivityBurst,
  type BurstExpansionPreference,
} from '../lib/activityBursts';
import { formatDuration } from '../lib/utils';
import { useActivityStore } from '../stores/useActivityStore';
import { useProjectStore, type Project } from '../stores/useProjectStore';
import './Today.css';

interface TodayProps {
  onReview: () => void;
  onOpenPermissions: () => void;
}

function timeRange(burst: ActivityBurst): string {
  return `${format(fromUnixTime(burst.startedAt), 'h:mm a')} – ${format(fromUnixTime(burst.endedAt), 'h:mm a')}`;
}

function appIcon(appName: string) {
  const app = appName.toLocaleLowerCase();
  if (app.includes('chrome') || app.includes('safari') || app.includes('edge') || app.includes('firefox')) return <Globe2 size={15} />;
  if (app.includes('figma') || app.includes('sketch')) return <FilePenLine size={15} />;
  if (app.includes('slack') || app.includes('teams') || app.includes('discord')) return <MessageSquare size={15} />;
  if (app.includes('code') || app.includes('xcode')) return <Code2 size={15} />;
  if (app.includes('terminal') || app.includes('iterm')) return <Terminal size={15} />;
  return <AppWindow size={15} />;
}

function projectFor(projects: Project[], id: number | null): Project | undefined {
  return id == null ? undefined : projects.find((project) => project.id === id);
}

function TimelineBlock({
  burst,
  projects,
  expanded,
  onToggle,
}: {
  burst: ActivityBurst;
  projects: Project[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const project = projectFor(projects, burst.projectId);
  const multiApp = burst.appSummaries.length > 1;
  const blockTitle = project?.name ?? (burst.needsAttention ? 'Unassigned' : burst.primaryApp);
  const summaryContent = (
    <>
      <span className="timeline-block__time">
        <span>{format(fromUnixTime(burst.startedAt), 'h:mm a')}</span>
        <span>– {format(fromUnixTime(burst.endedAt), 'h:mm a')}</span>
      </span>
      <span className="timeline-block__icon" aria-hidden="true">{appIcon(burst.primaryApp)}</span>
      <span className="timeline-block__copy">
        <strong>{blockTitle}</strong>
        <span className="timeline-block__apps">
          {burst.appSummaries.slice(0, 3).map((summary) => (
            <span key={summary.appName}>{appIcon(summary.appName)} {summary.appName}</span>
          ))}
          {burst.appSummaries.length > 3 && <span>+{burst.appSummaries.length - 3}</span>}
        </span>
      </span>
      <span className="timeline-block__meta">
        {burst.needsAttention ? (
          <span className="attention-chip">Review assignment</span>
        ) : multiApp ? (
          <span className="timeline-block__switches">{burst.switchCount} switches</span>
        ) : null}
        <span className="timeline-block__duration" style={{ color: project?.color }}>{formatDuration(burst.durationS)}</span>
        {multiApp && (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
      </span>
    </>
  );

  return (
    <article
      className={`timeline-block ${expanded ? 'timeline-block--expanded' : ''}`}
      style={{ '--burst-color': project?.color ?? (burst.needsAttention ? '#FBBF24' : '#5EEAD4') } as React.CSSProperties}
    >
      <span className="timeline-block__node" aria-hidden="true" />
      {multiApp ? (
        <button type="button" className="timeline-block__summary" onClick={onToggle} aria-expanded={expanded}>
          {summaryContent}
        </button>
      ) : (
        <div className="timeline-block__summary">{summaryContent}</div>
      )}

      {expanded && multiApp && (
        <div className="app-mix" aria-label="Application mix">
          <div className="app-mix__heading">
            <span>Application mix</span>
            <span>{burst.switchCount} switches collapsed</span>
          </div>
          {burst.appSummaries.map((summary) => (
            <div className="app-mix__row" key={summary.appName}>
              <span className="app-mix__icon" aria-hidden="true">{appIcon(summary.appName)}</span>
              <span className="app-mix__name">{summary.appName}</span>
              <span className="app-mix__bar"><span style={{ width: `${Math.max(summary.percentage, 4)}%` }} /></span>
              <span className="app-mix__duration">{formatDuration(summary.durationS)}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function AttentionCard({
  burst,
  projects,
}: {
  burst: ActivityBurst;
  projects: Project[];
}) {
  const assignActivities = useActivityStore((state) => state.assignActivitiesToProject);
  const [choosing, setChoosing] = useState(burst.suggestedProjectId == null);
  const [selection, setSelection] = useState(String(burst.suggestedProjectId ?? ''));
  const [saving, setSaving] = useState(false);
  const suggested = projectFor(projects, burst.suggestedProjectId);

  const assign = async (projectId: number) => {
    setSaving(true);
    try {
      await assignActivities(burst.activityIds, projectId);
    } finally {
      setSaving(false);
    }
  };

  return (
    <article
      className="attention-card"
      style={{ '--suggested-color': suggested?.color ?? '#5EEAD4' } as React.CSSProperties}
    >
      <div className="attention-card__eyebrow">
        <span>{timeRange(burst)}</span>
        <span>{formatDuration(burst.durationS)}</span>
      </div>
      <h3>{burst.appSummaries.map((summary) => summary.appName).slice(0, 2).join(' + ')}</h3>
      <p>{burst.primaryTitle || `${burst.switchCount} quick app switches need a project.`}</p>

      {suggested && !choosing && (
        <div className="attention-card__suggestion">
          <span className="attention-card__suggestion-label">Suggested project</span>
          <strong><span style={{ background: suggested.color }} />{suggested.name}</strong>
          {burst.suggestionReason && <small>{burst.suggestionReason}</small>}
        </div>
      )}

      {choosing && (
        <label className="attention-card__picker">
          <span>Choose project</span>
          <select value={selection} onChange={(event) => setSelection(event.target.value)} autoFocus>
            <option value="">Select a project…</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
      )}

      <div className="attention-card__actions">
        <button
          type="button"
          className="today-button today-button--primary"
          disabled={saving || (!selection && choosing)}
          onClick={() => {
            const projectId = Number(choosing ? selection : burst.suggestedProjectId);
            if (projectId) void assign(projectId);
          }}
        >
          <Check size={13} /> {saving ? 'Assigning…' : 'Assign'}
        </button>
        <button type="button" className="today-button today-button--quiet" onClick={() => setChoosing((value) => !value)}>
          {choosing && suggested ? 'Use suggestion' : 'Choose another'}
        </button>
      </div>
    </article>
  );
}

function LogTimeDialog({ projects, onClose }: { projects: Project[]; onClose: () => void }) {
  const createManualActivity = useActivityStore((state) => state.createManualActivity);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [projectId, setProjectId] = useState('');
  const [start, setStart] = useState(format(new Date(), 'HH:mm'));
  const [minutes, setMinutes] = useState(30);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const save = async () => {
    if (!title.trim() || minutes < 1 || saving) return;
    const [hours, mins] = start.split(':').map(Number);
    const startedAt = new Date();
    startedAt.setHours(hours, mins, 0, 0);
    setSaving(true);
    try {
      await createManualActivity(
        title.trim(),
        note.trim(),
        projectId ? Number(projectId) : null,
        Math.floor(startedAt.getTime() / 1000),
        minutes * 60,
      );
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="today-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} className="today-dialog" role="dialog" aria-modal="true" aria-labelledby="log-time-title">
        <div className="today-dialog__header">
          <div>
            <h2 id="log-time-title">Log time</h2>
            <p>Add work the tracker could not capture.</p>
          </div>
          <button type="button" className="today-icon-button" onClick={onClose} aria-label="Close log time dialog"><X size={15} /></button>
        </div>
        <label>
          <span>What were you working on?</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus placeholder="e.g. Client planning call" />
        </label>
        <label>
          <span>Note <small>Optional</small></span>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add useful context" />
        </label>
        <div className="today-dialog__row">
          <label>
            <span>Project</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">No project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>
            <span>Start time</span>
            <input type="time" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label>
            <span>Minutes</span>
            <input type="number" min={1} max={1440} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} />
          </label>
        </div>
        <div className="today-dialog__actions">
          <button type="button" className="today-button today-button--quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="today-button today-button--primary" onClick={() => void save()} disabled={!title.trim() || minutes < 1 || saving}>
            {saving ? 'Saving…' : 'Log time'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function Today({ onReview, onOpenPermissions }: TodayProps) {
  const activities = useActivityStore((state) => state.activities);
  const loading = useActivityStore((state) => state.loading);
  const error = useActivityStore((state) => state.error);
  const fetchToday = useActivityStore((state) => state.fetchToday);
  const projects = useProjectStore((state) => state.projects);
  const [openBurstId, setOpenBurstId] = useState<BurstExpansionPreference>(null);
  const [showLogTime, setShowLogTime] = useState(false);

  useEffect(() => {
    void fetchToday();
    const interval = window.setInterval(() => void fetchToday(), 10_000);
    return () => window.clearInterval(interval);
  }, [fetchToday]);

  const bursts = useMemo(() => groupActivitiesIntoBursts(activities), [activities]);
  const timeline = useMemo(() => [...bursts].reverse(), [bursts]);
  const attention = useMemo(() => timeline.filter((burst) => burst.needsAttention), [timeline]);
  const firstMultiAppId = timeline.find((burst) => burst.appSummaries.length > 1)?.id;
  const effectiveOpenBurstId = resolveOpenBurstId(openBurstId, firstMultiAppId);
  const trackedSeconds = bursts.reduce((sum, burst) => sum + burst.durationS, 0);

  return (
    <div className="today-page">
      <header className="today-tracking-bar" data-tauri-drag-region>
        <TrackerHealth onOpenPermissions={onOpenPermissions} />
        <span className="today-tracking-bar__date">{format(new Date(), 'EEEE, MMMM d')}</span>
        <FocusProjectSelect />
      </header>

      <section className="today-overview-header">
        <div className="today-overview-header__title">
          <span className="today-overview-header__eyebrow">Your day at a glance</span>
          <div><h1>Today</h1><span>{format(new Date(), 'EEEE, MMMM d, yyyy')}</span></div>
        </div>
        <div className="today-stats" aria-label="Today summary">
          <div><small>Tracked</small><strong>{formatDuration(trackedSeconds)}</strong></div>
          <div><small>Focused blocks</small><strong>{countFocusedBlocks(bursts)}</strong></div>
          <button type="button" onClick={onReview}><small>Needs attention</small><strong>{attention.length}</strong></button>
        </div>
        <div className="today-overview-header__actions">
          <button type="button" className="today-button today-button--primary" onClick={onReview}><ListChecks size={14} /> Review activity <ChevronRight size={13} /></button>
          <button type="button" className="today-button today-button--quiet" onClick={() => setShowLogTime(true)}><Plus size={14} /> Log time</button>
        </div>
      </section>

      <div className="today-workspace">
        <main className="today-timeline-panel" aria-labelledby="today-timeline-title">
          <div className="today-section-heading">
            <div><span>Chronological view</span><h2 id="today-timeline-title">Timeline</h2></div>
            <small>Quick app switches are grouped automatically</small>
          </div>

          {loading && activities.length === 0 ? (
            <div className="today-state" role="status"><span className="today-state__spinner" />Loading today’s activity…</div>
          ) : error && activities.length === 0 ? (
            <div className="today-state today-state--error" role="alert">
              <Clock3 size={22} />
              <strong>Activity is temporarily unavailable</strong>
              <span>{error}</span>
              <button type="button" className="today-button today-button--quiet" onClick={() => void fetchToday()}>Try again</button>
            </div>
          ) : timeline.length === 0 ? (
            <div className="today-state today-state--empty">
              <Clock3 size={22} />
              <strong>Your timeline is ready</strong>
              <span>Use your Mac normally. Duskry will group activity into clear work blocks here.</span>
            </div>
          ) : (
            <div className="today-timeline">
              {timeline.map((burst) => (
                <TimelineBlock
                  key={burst.id}
                  burst={burst}
                  projects={projects}
                  expanded={effectiveOpenBurstId === burst.id}
                  onToggle={() => {
                    if (burst.appSummaries.length < 2) return;
                    setOpenBurstId(nextBurstExpansionPreference(effectiveOpenBurstId, burst.id));
                  }}
                />
              ))}
            </div>
          )}
        </main>

        <aside className="attention-panel" aria-labelledby="attention-title">
          <div className="attention-panel__heading">
            <div><span>Review queue</span><h2 id="attention-title">Needs attention</h2></div>
            {attention.length > 0 && <strong>{attention.length} group{attention.length === 1 ? '' : 's'}</strong>}
          </div>
          {attention.length === 0 ? (
            <div className="attention-panel__empty"><Check size={18} /><strong>All caught up</strong><span>Every work block has a project.</span></div>
          ) : (
            <>
              <div className="attention-panel__intro">
                <p>Review uncertain groups to keep reports accurate.</p>
                <button type="button" className="today-button today-button--primary" onClick={onReview}>Review all ({attention.length}) <ChevronRight size={13} /></button>
              </div>
              <div className="attention-panel__list">
                {attention.slice(0, 2).map((burst) => <AttentionCard key={burst.id} burst={burst} projects={projects} />)}
              </div>
              <div className="attention-panel__footer">
                {attention.length > 2
                  ? `${attention.length - 2} more group${attention.length - 2 === 1 ? '' : 's'} to review`
                  : 'Nothing else needs your attention.'}
              </div>
            </>
          )}
        </aside>
      </div>

      {showLogTime && <LogTimeDialog projects={projects} onClose={() => setShowLogTime(false)} />}
    </div>
  );
}
