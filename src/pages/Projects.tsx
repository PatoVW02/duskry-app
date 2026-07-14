import { useEffect, useState } from 'react';
import { format, fromUnixTime, isToday } from 'date-fns';
import { useProjectStore } from '../stores/useProjectStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useActivityStore, type Activity } from '../stores/useActivityStore';
import { useLicenseStore, isPro } from '../stores/useLicenseStore';
import { PROJECT_COLORS } from '../styles/tokens';
import { Plus, ChevronDown, ChevronRight, X, Target, Lock, Trash2 } from 'lucide-react';
import { formatDuration } from '../lib/utils';

interface ActivityGroup {
  key: string;
  label: string;
  activities: Activity[];
  total_s: number;
  started_at: number;
}

interface AppActivityGroup {
  key: string;
  appName: string;
  groups: ActivityGroup[];
  activities: Activity[];
  total_s: number;
  started_at: number;
}


function displayAppName(name: string): string {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function activitySubtitle(activity: Activity): string {
  return activity.domain ?? activity.file_path ?? activity.window_title ?? 'No context';
}

function activityGroupLabel(activity: Activity): string {
  return activity.domain ?? activity.window_title?.trim() ?? activity.file_path ?? 'No context';
}

function buildActivityGroups(activities: Activity[]): AppActivityGroup[] {
  const byApp = new Map<string, Activity[]>();
  for (const activity of activities) {
    const list = byApp.get(activity.app_name) ?? [];
    list.push(activity);
    byApp.set(activity.app_name, list);
  }

  return Array.from(byApp.entries())
    .map(([appName, appActivities]) => {
      const byContext = new Map<string, Activity[]>();
      for (const activity of appActivities) {
        const label = activityGroupLabel(activity);
        const list = byContext.get(label) ?? [];
        list.push(activity);
        byContext.set(label, list);
      }
      const groups = Array.from(byContext.entries())
        .map(([label, items]) => {
          const sorted = [...items].sort((a, b) => b.started_at - a.started_at);
          return {
            key: `${appName}::${label}`,
            label,
            activities: sorted,
            total_s: sorted.reduce((sum, activity) => sum + (activity.duration_s ?? 0), 0),
            started_at: Math.min(...sorted.map((activity) => activity.started_at)),
          };
        })
        .sort((a, b) => b.total_s - a.total_s || b.started_at - a.started_at);
      const sortedActivities = [...appActivities].sort((a, b) => b.started_at - a.started_at);
      return {
        key: appName,
        appName,
        groups,
        activities: sortedActivities,
        total_s: sortedActivities.reduce((sum, activity) => sum + (activity.duration_s ?? 0), 0),
        started_at: Math.min(...sortedActivities.map((activity) => activity.started_at)),
      };
    })
    .sort((a, b) => b.total_s - a.total_s || b.started_at - a.started_at);
}

export function Projects({ onUpgrade }: { onUpgrade: () => void }) {
  const projects = useProjectStore((s) => s.projects);
  const createProject = useProjectStore((s) => s.createProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const { activeProjectId, setActiveProject } = useSettingsStore();
  const { tier } = useLicenseStore();
  const activities = useActivityStore((s) => s.activities);
  const viewDate = useActivityStore((s) => s.viewDate);
  const fetchForDate = useActivityStore((s) => s.fetchForDate);

  const activeProject = projects.find((p) => (p.id as number) === activeProjectId) ?? null;

  // Projects beyond the free-tier limit (3) are locked — oldest 3 stay active.
  const lockedProjectIds = (() => {
    if (isPro(tier)) return new Set<number>();
    const sorted = [...projects].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
    return new Set(sorted.slice(3).map((p) => p.id as number));
  })();

  // Clear active focus project if it became locked after a downgrade.
  useEffect(() => {
    if (activeProjectId && lockedProjectIds.has(activeProjectId)) {
      setActiveProject(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier, activeProjectId]);

  // ── project creation ───────────────────────────────
  const [showForm, setShowForm]   = useState(false);
  const [name, setName]           = useState('');
  const [color, setColor]         = useState(PROJECT_COLORS[0]);
  const [creating, setCreating]   = useState(false);

  const [expandedActivitiesId, setExpandedActivitiesId] = useState<number | null>(null);
  const [expandedActivityGroups, setExpandedActivityGroups] = useState<Set<string>>(() => new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<number | null>(null);

  useEffect(() => {
    fetchForDate(viewDate);
    if (isToday(viewDate)) {
      const id = setInterval(() => fetchForDate(viewDate), 10_000);
      return () => clearInterval(id);
    }
  }, [viewDate, fetchForDate]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    await createProject(name.trim(), color);
    setName('');
    setColor(PROJECT_COLORS[0]);
    setShowForm(false);
    setCreating(false);
  };

  const handleDeleteProject = async (projectId: number) => {
    setDeletingProjectId(projectId);
    try {
      await deleteProject(projectId);
      if (activeProjectId === projectId) await setActiveProject(0);
      if (expandedActivitiesId === projectId) setExpandedActivitiesId(null);
      await fetchForDate(viewDate);
    } finally {
      setDeletingProjectId(null);
      setDeleteConfirmId(null);
    }
  };

  const toggleActivities = (projectId: number) => {
    setExpandedActivitiesId((id) => id === projectId ? null : projectId);
  };

  const toggleActivityGroup = (key: string) => {
    setExpandedActivityGroups((groups) => {
      const next = new Set(groups);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Today's Focus ────────────────────────────── */}
      <div className="glass-card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
          <Target size={12} style={{ color: 'rgba(45,212,191,0.65)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Today's Focus
          </span>
        </div>

        {/* Active project indicator */}
        {activeProject ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.10)' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: activeProject.color, flexShrink: 0 }} />
            <span style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>{activeProject.name}</span>
            <button
              onClick={() => setActiveProject(0)}
              title="Clear focus"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.28)', display: 'flex', padding: 2 }}
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '0.5px dashed rgba(255,255,255,0.10)' }}>
            No focus project set, select one below or from the menu bar.
          </div>
        )}

        {/* Project selector pills */}
        {projects.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {projects
              .filter((p) => !lockedProjectIds.has(p.id as number))
              .map((p) => {
              const pid = p.id as number;
              const isActive = pid === activeProjectId;
              return (
                <button
                  key={pid}
                  onClick={() => setActiveProject(isActive ? 0 : pid)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
                    fontSize: 12, fontWeight: isActive ? 500 : 400,
                    background: isActive ? `${p.color}22` : 'rgba(255,255,255,0.05)',
                    border: `0.5px solid ${isActive ? p.color + '55' : 'rgba(255,255,255,0.10)'}`,
                    color: isActive ? p.color : 'rgba(255,255,255,0.65)',
                    transition: 'all 0.12s',
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Projects ──────────────────────────────────── */}
      <div className="glass-card" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Projects</div>
            {!isPro(tier) && (
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                {projects.length - lockedProjectIds.size}/3
              </span>
            )}
          </div>
          {!isPro(tier) && projects.length >= 3 ? (
            <button
              onClick={onUpgrade}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                border: '0.5px solid rgba(45,212,191,0.35)',
                background: 'rgba(45,212,191,0.08)', color: 'rgba(45,212,191,0.85)',
                fontSize: 12, fontFamily: 'Inter, sans-serif',
              }}
            >
              <Lock size={11} />
              Upgrade for unlimited
            </button>
          ) : (
            <button className="btn-primary" style={{ width: 'auto', padding: '6px 14px', fontSize: 12 }}
              onClick={() => setShowForm(!showForm)}>
              <Plus size={12} style={{ display: 'inline', marginRight: 5 }} />
              New project
            </button>
          )}
        </div>

        {showForm && (
          <div style={{
            padding: '16px', borderRadius: 10, marginBottom: 16,
            background: 'rgba(255,255,255,0.04)',
            border: '0.5px solid rgba(255,255,255,0.10)',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <input
              className="glass-input"
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <div className="color-picker">
              {PROJECT_COLORS.map((c) => (
                <button key={c} className={`color-swatch ${color === c ? 'selected' : ''}`}
                  style={{ backgroundColor: c }} onClick={() => setColor(c)} aria-label={c} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" onClick={handleCreate} disabled={creating || !name.trim()}>
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button className="btn-secondary" style={{ maxWidth: 100 }} onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {projects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'rgba(255,255,255,0.28)', fontSize: 13 }}>
            No projects yet. Create one to start categorizing your time.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {projects.map((p) => {
              const pid = p.id as number;
              const isLocked = lockedProjectIds.has(pid);
              const activitiesOpen = expandedActivitiesId === pid;
              const assignedActivities = activities
                .filter((activity) => activity.project_id === pid)
                .sort((a, b) => b.started_at - a.started_at);
              const activityGroups = buildActivityGroups(assignedActivities);
              const projectTotalSecs = assignedActivities.reduce((sum, activity) => sum + (activity.duration_s ?? 0), 0);

              return (
                <div key={pid} style={{ borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
                  {/* project row */}
                  <div
                    className={`project-row project-page-row${activitiesOpen && !isLocked ? ' is-open' : ''}`}
                    onClick={() => !isLocked && toggleActivities(pid)}
                    style={{
                      padding: '11px 0',
                      borderBottom: 'none',
                      cursor: isLocked ? 'default' : 'pointer',
                      opacity: isLocked ? 0.45 : 1,
                    }}
                  >
                    {isLocked ? (
                      <Lock size={13} style={{ color: 'rgba(255,255,255,0.30)', flexShrink: 0 }} />
                    ) : activitiesOpen ? (
                      <ChevronDown size={13} style={{ color: 'rgba(255,255,255,0.30)', flexShrink: 0 }} />
                    ) : (
                      <ChevronRight size={13} style={{ color: 'rgba(255,255,255,0.22)', flexShrink: 0 }} />
                    )}
                    <span className="project-dot" style={{ background: p.color, width: 10, height: 10 }} />
                    <span style={{ fontSize: 13.5, flex: 1 }}>{p.name}</span>
                    {isLocked ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); onUpgrade(); }}
                        style={{
                          padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
                          border: '0.5px solid rgba(45,212,191,0.30)',
                          background: 'rgba(45,212,191,0.08)', color: 'rgba(45,212,191,0.75)',
                          fontSize: 11, fontFamily: 'Inter, sans-serif',
                        }}
                      >
                        Upgrade to unlock →
                      </button>
                    ) : (
                      <>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginRight: 6 }}>
                          {assignedActivities.length} activit{assignedActivities.length === 1 ? 'y' : 'ies'}
                        </span>
                        {projectTotalSecs > 0 && (
                          <span style={{ fontSize: 11, color: p.color, fontVariantNumeric: 'tabular-nums', marginRight: 8 }}>
                            {formatDuration(projectTotalSecs)}
                          </span>
                        )}
                        {deleteConfirmId === pid ? (
                          <>
                            <button
                              className="delete-confirm-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteProject(pid);
                              }}
                              disabled={deletingProjectId === pid}
                              style={{
                                padding: '3px 9px', borderRadius: 5, cursor: deletingProjectId === pid ? 'default' : 'pointer',
                                border: '0.5px solid rgba(239,68,68,0.35)',
                                background: 'rgba(239,68,68,0.10)', color: 'rgba(248,113,113,0.88)',
                                fontSize: 11, fontFamily: 'Inter, sans-serif',
                              }}
                            >
                              {deletingProjectId === pid ? 'Deleting…' : 'Delete'}
                            </button>
                            <button
                              className="cancel-confirm-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmId(null);
                              }}
                              style={{
                                padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
                                border: '0.5px solid rgba(255,255,255,0.12)',
                                background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.45)',
                                fontSize: 11, fontFamily: 'Inter, sans-serif',
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className="icon-delete-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(pid);
                            }}
                            title="Delete project"
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
                              border: '0.5px solid rgba(255,255,255,0.08)',
                              background: 'rgba(255,255,255,0.03)', color: 'rgba(255,90,90,0.50)',
                              flexShrink: 0,
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* assigned activities panel */}
                  {activitiesOpen && (
                    <div style={{
                      marginLeft: 20,
                      marginBottom: 12,
                      borderLeft: `2px solid ${p.color}30`,
                      paddingLeft: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}>
                      {assignedActivities.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', padding: '4px 0 8px' }}>
                          No activities assigned to this project for this day.
                        </div>
                      ) : (
                        activityGroups.map((appGroup) => {
                          const appGroupKey = `${pid}::app::${appGroup.key}`;
                          const appGroupOpen = expandedActivityGroups.has(appGroupKey);
                          return (
                            <div key={appGroupKey} style={{ borderBottom: '0.5px solid rgba(255,255,255,0.05)' }}>
                              <div
                                onClick={() => toggleActivityGroup(appGroupKey)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '7px 0',
                                  minWidth: 0,
                                  cursor: 'pointer',
                                }}
                              >
                                {appGroupOpen ? (
                                  <ChevronDown size={12} style={{ color: 'rgba(255,255,255,0.32)', flexShrink: 0 }} />
                                ) : (
                                  <ChevronRight size={12} style={{ color: 'rgba(255,255,255,0.24)', flexShrink: 0 }} />
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{
                                    fontSize: 12.5,
                                    fontWeight: 500,
                                    color: 'rgba(255,255,255,0.78)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}>
                                    {displayAppName(appGroup.appName)}
                                  </div>
                                  <div style={{
                                    fontSize: 11,
                                    color: 'rgba(255,255,255,0.32)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    marginTop: 1,
                                  }}>
                                    {appGroup.groups.length} context{appGroup.groups.length === 1 ? '' : 's'}
                                  </div>
                                </div>
                                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', flexShrink: 0 }}>
                                  {appGroup.activities.length} activit{appGroup.activities.length === 1 ? 'y' : 'ies'}
                                </span>
                                <span style={{
                                  fontSize: 11,
                                  color: 'rgba(255,255,255,0.38)',
                                  fontVariantNumeric: 'tabular-nums',
                                  flexShrink: 0,
                                  minWidth: 54,
                                  textAlign: 'right',
                                }}>
                                  {formatDuration(appGroup.total_s)}
                                </span>
                              </div>

                              {appGroupOpen && (
                                <div style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column' }}>
                                  {appGroup.groups.map((group) => {
                                    const groupKey = `${pid}::ctx::${group.key}`;
                                    const groupOpen = expandedActivityGroups.has(groupKey);
                                    return (
                                      <div key={groupKey} style={{ borderTop: '0.5px solid rgba(255,255,255,0.035)' }}>
                                        <div
                                          onClick={() => toggleActivityGroup(groupKey)}
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            padding: '6px 0',
                                            minWidth: 0,
                                            cursor: 'pointer',
                                          }}
                                        >
                                          {groupOpen ? (
                                            <ChevronDown size={11} style={{ color: 'rgba(255,255,255,0.30)', flexShrink: 0 }} />
                                          ) : (
                                            <ChevronRight size={11} style={{ color: 'rgba(255,255,255,0.22)', flexShrink: 0 }} />
                                          )}
                                          <div style={{
                                            flex: 1,
                                            minWidth: 0,
                                            fontSize: 11.5,
                                            color: 'rgba(255,255,255,0.48)',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                          }}>
                                            {group.label}
                                          </div>
                                          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.26)', flexShrink: 0 }}>
                                            {group.activities.length}
                                          </span>
                                          <span style={{
                                            fontSize: 10.5,
                                            color: 'rgba(255,255,255,0.34)',
                                            fontVariantNumeric: 'tabular-nums',
                                            flexShrink: 0,
                                            minWidth: 50,
                                            textAlign: 'right',
                                          }}>
                                            {formatDuration(group.total_s)}
                                          </span>
                                        </div>

                                        {groupOpen && group.activities.map((activity) => (
                                          <div
                                            key={activity.id}
                                            style={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: 10,
                                              padding: '6px 0 6px 20px',
                                              borderTop: '0.5px solid rgba(255,255,255,0.025)',
                                              minWidth: 0,
                                            }}
                                          >
                                            <span style={{
                                              fontSize: 11,
                                              color: 'rgba(255,255,255,0.30)',
                                              width: 46,
                                              flexShrink: 0,
                                              fontVariantNumeric: 'tabular-nums',
                                            }}>
                                              {format(fromUnixTime(activity.started_at), 'HH:mm')}
                                            </span>
                                            <div style={{
                                              flex: 1,
                                              minWidth: 0,
                                              fontSize: 11.5,
                                              color: 'rgba(255,255,255,0.48)',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                              whiteSpace: 'nowrap',
                                            }}>
                                              {activitySubtitle(activity)}
                                            </div>
                                            <span style={{
                                              fontSize: 11,
                                              color: 'rgba(255,255,255,0.32)',
                                              fontVariantNumeric: 'tabular-nums',
                                              flexShrink: 0,
                                            }}>
                                              {formatDuration(activity.duration_s ?? 0)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
