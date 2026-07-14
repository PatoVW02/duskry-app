import type { Activity } from '../stores/useActivityStore';

const MAX_SWITCH_GAP_SECONDS = 2 * 60;
const LOW_CONFIDENCE_THRESHOLD = 0.72;

export interface BurstAppSummary {
  appName: string;
  durationS: number;
  percentage: number;
  activityCount: number;
}

export interface ActivityBurst {
  id: string;
  activities: Activity[];
  activityIds: number[];
  startedAt: number;
  endedAt: number;
  durationS: number;
  projectId: number | null;
  appSummaries: BurstAppSummary[];
  primaryApp: string;
  primaryTitle: string | null;
  switchCount: number;
  needsAttention: boolean;
  suggestedProjectId: number | null;
  suggestionReason: string | null;
}

/**
 * `null` means the UI may choose its initial open burst, `false` records an
 * explicit user close, and a string records an explicit user selection.
 */
export type BurstExpansionPreference = string | false | null;

export function resolveOpenBurstId(
  preference: BurstExpansionPreference,
  defaultBurstId?: string,
): string | undefined {
  return preference === null ? defaultBurstId : preference || undefined;
}

export function nextBurstExpansionPreference(
  currentOpenBurstId: string | undefined,
  toggledBurstId: string,
): string | false {
  return currentOpenBurstId === toggledBurstId ? false : toggledBurstId;
}

function activityEnd(activity: Activity): number {
  return activity.ended_at ?? activity.started_at + Math.max(activity.duration_s ?? 0, 1);
}

function confidentProjectIds(activities: Activity[]): number[] {
  return [...new Set(
    activities
      .filter((activity) => activity.project_id !== null)
      .filter((activity) => activity.assignment_confidence == null || activity.assignment_confidence >= LOW_CONFIDENCE_THRESHOLD)
      .map((activity) => activity.project_id as number),
  )];
}

function canJoinBurst(current: Activity[], next: Activity): boolean {
  if (current.length === 0) return true;
  const previous = current[current.length - 1];
  const gap = Math.max(0, next.started_at - activityEnd(previous));
  if (gap > MAX_SWITCH_GAP_SECONDS) return false;

  const knownProjects = confidentProjectIds([...current, next]);
  return knownProjects.length <= 1;
}

function inferSuggestedProject(
  activities: Activity[],
  allActivities: Activity[],
): { projectId: number | null; reason: string | null } {
  const knownProject = confidentProjectIds(activities)[0];
  if (knownProject != null) {
    return {
      projectId: knownProject,
      reason: 'Matches the other activity in this block.',
    };
  }

  const apps = new Set(activities.map((activity) => activity.app_name.toLocaleLowerCase()));
  const projectScores = new Map<number, number>();
  for (const activity of allActivities) {
    if (activity.project_id == null || !apps.has(activity.app_name.toLocaleLowerCase())) continue;
    const score = Math.max(activity.duration_s ?? 0, 1);
    projectScores.set(activity.project_id, (projectScores.get(activity.project_id) ?? 0) + score);
  }

  const suggestion = [...projectScores.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!suggestion) return { projectId: null, reason: null };

  const appNames = [...new Set(activities.map((activity) => activity.app_name))].slice(0, 2);
  return {
    projectId: suggestion[0],
    reason: `Similar ${appNames.join(' and ')} activity was assigned there today.`,
  };
}

function createBurst(activities: Activity[], allActivities: Activity[]): ActivityBurst {
  const sorted = [...activities].sort(compareActivities);
  const durations = new Map<string, { durationS: number; activityCount: number }>();
  for (const activity of sorted) {
    const summary = durations.get(activity.app_name) ?? { durationS: 0, activityCount: 0 };
    summary.durationS += Math.max(activity.duration_s ?? 0, 0);
    summary.activityCount += 1;
    durations.set(activity.app_name, summary);
  }

  const durationS = [...durations.values()].reduce((sum, summary) => sum + summary.durationS, 0);
  const denominator = Math.max(durationS, 1);
  const appSummaries = [...durations.entries()]
    .map(([appName, summary]) => ({
      appName,
      ...summary,
      percentage: Math.round((summary.durationS / denominator) * 100),
    }))
    .sort((a, b) => b.durationS - a.durationS);
  const primaryActivity = [...sorted].sort((a, b) => (b.duration_s ?? 0) - (a.duration_s ?? 0))[0];
  const projectIds = confidentProjectIds(sorted);
  const needsAttention = sorted.some((activity) =>
    activity.project_id == null
    || (activity.assignment_confidence != null && activity.assignment_confidence < LOW_CONFIDENCE_THRESHOLD),
  );
  const suggestion = needsAttention
    ? inferSuggestedProject(sorted, allActivities)
    : { projectId: null, reason: null };

  return {
    // A periodic refresh replaces every Activity object and may append another
    // quick switch to this burst. The first activity is the stable anchor that
    // lets React preserve the open block (and any local child state) while its
    // duration and members continue changing.
    id: `burst-${sorted[0].id}`,
    activities: sorted,
    activityIds: sorted.map((activity) => activity.id),
    startedAt: sorted[0].started_at,
    endedAt: Math.max(...sorted.map(activityEnd)),
    durationS,
    projectId: projectIds.length === 1 && !needsAttention ? projectIds[0] : null,
    appSummaries,
    primaryApp: appSummaries[0]?.appName ?? primaryActivity.app_name,
    primaryTitle: primaryActivity.window_title,
    switchCount: Math.max(0, sorted.length - 1),
    needsAttention,
    suggestedProjectId: suggestion.projectId,
    suggestionReason: suggestion.reason,
  };
}

/**
 * Turns rapid app switches into a small number of understandable work blocks.
 * A block only joins activity when the gap is short and the known project
 * context does not conflict, so compactness never silently merges two clients.
 */
export function groupActivitiesIntoBursts(activities: Activity[]): ActivityBurst[] {
  const sorted = [...activities]
    .filter((activity) => (activity.duration_s ?? 0) > 0)
    .sort(compareActivities);
  const groups: Activity[][] = [];

  for (const activity of sorted) {
    const current = groups[groups.length - 1];
    if (!current || !canJoinBurst(current, activity)) groups.push([activity]);
    else current.push(activity);
  }

  return groups
    .map((group) => createBurst(group, sorted))
    // Suppress isolated tracker flicker while preserving short switches that
    // belong to a longer multi-app block.
    .filter((burst) => burst.durationS >= 5);
}

export function countFocusedBlocks(bursts: ActivityBurst[]): number {
  return bursts.filter((burst) => burst.projectId !== null && burst.durationS >= 15 * 60).length;
}

function compareActivities(left: Activity, right: Activity): number {
  return left.started_at - right.started_at || left.id - right.id;
}
