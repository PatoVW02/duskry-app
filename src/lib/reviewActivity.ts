import { groupActivitiesIntoBursts } from './activityBursts';
import type { Activity } from '../stores/useActivityStore';

export type ReviewFilter = 'all' | 'needs-review' | 'unassigned' | 'assigned';

export interface ReviewProjectRecord {
  id: number;
  name: string;
}

export interface ReviewActivityFilterOptions {
  filter?: ReviewFilter;
  query?: string;
  projects?: readonly ReviewProjectRecord[];
  needsReviewActivityIds?: ReadonlySet<number>;
}

export type ReviewAssignmentSummary =
  | { status: 'assigned'; projectId: number }
  | { status: 'unassigned'; projectId: null }
  | { status: 'mixed'; projectId: null };

/** Returns every activity contained in a work block that needs attention. */
export function getNeedsReviewActivityIds(
  activities: readonly Activity[],
): Set<number> {
  const ids = new Set<number>();
  for (const burst of groupActivitiesIntoBursts([...activities])) {
    if (!burst.needsAttention) continue;
    burst.activityIds.forEach((id) => ids.add(id));
  }
  return ids;
}

/**
 * Matches all query words across the fields a user can recognize in Review.
 * A query such as "Chrome Acme" may therefore match the app and project name.
 */
export function matchesReviewSearch(
  activity: Activity,
  query: string,
  projects: readonly ReviewProjectRecord[] = [],
): boolean {
  const terms = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return true;

  const projectName = activity.project_id == null
    ? ''
    : projects.find((project) => project.id === activity.project_id)?.name ?? '';
  const searchableText = [
    activity.app_name,
    activity.window_title,
    activity.domain,
    activity.file_path,
    projectName,
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n')
    .toLocaleLowerCase();

  return terms.every((term) => searchableText.includes(term));
}

/** Applies status and text filtering to raw activities before the review tree is built. */
export function filterReviewActivities(
  activities: readonly Activity[],
  {
    filter = 'all',
    query = '',
    projects = [],
    needsReviewActivityIds,
  }: ReviewActivityFilterOptions = {},
): Activity[] {
  const reviewIds = filter === 'needs-review'
    ? needsReviewActivityIds ?? getNeedsReviewActivityIds(activities)
    : needsReviewActivityIds;

  return activities.filter((activity) => {
    const matchesFilter = filter === 'all'
      || (filter === 'needs-review' && reviewIds?.has(activity.id) === true)
      || (filter === 'unassigned' && activity.project_id == null)
      || (filter === 'assigned' && activity.project_id != null);

    return matchesFilter && matchesReviewSearch(activity, query, projects);
  });
}

/** Describes whether a visible group has one project, no project, or mixed assignments. */
export function summarizeAssignment(
  activityIds: readonly number[],
  activities: readonly Activity[],
): ReviewAssignmentSummary {
  const ids = new Set(activityIds);
  const projectIds = new Set<number | null>();
  for (const activity of activities) {
    if (ids.has(activity.id)) projectIds.add(activity.project_id);
  }

  if (projectIds.size === 0 || (projectIds.size === 1 && projectIds.has(null))) {
    return { status: 'unassigned', projectId: null };
  }
  if (projectIds.size === 1) {
    return { status: 'assigned', projectId: [...projectIds][0] as number };
  }
  return { status: 'mixed', projectId: null };
}
