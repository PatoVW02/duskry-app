interface ProjectEligibilityRecord {
  id: number;
  created_at: number | null;
}

export function sortProjectsByFreeEligibility<T extends ProjectEligibilityRecord>(projects: readonly T[]): T[] {
  return [...projects].sort((left, right) =>
    (left.created_at ?? 0) - (right.created_at ?? 0)
    || left.id - right.id,
  );
}

export function lockedFreeProjectIds<T extends ProjectEligibilityRecord>(
  projects: readonly T[],
  limit = 3,
): Set<number> {
  const eligibleCount = Math.max(0, limit);
  return new Set(
    sortProjectsByFreeEligibility(projects)
      .slice(eligibleCount)
      .map((project) => project.id),
  );
}
