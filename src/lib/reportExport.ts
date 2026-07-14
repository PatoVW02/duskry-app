const CSV_FORMULA_PREFIX = /^[\t\r]|^\s*[=+\-@]/;

/** Quote a user-controlled CSV field and prevent spreadsheet formula execution. */
export function safeCsvCell(value: string): string {
  const safeValue = CSV_FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

interface TimedActivity {
  started_at: number;
  duration_s: number | null;
}

/** Allocate activity seconds across the local clock hours they overlap. */
export function activitySecondsByHour(activities: readonly TimedActivity[]): number[] {
  const seconds = Array(24).fill(0) as number[];
  for (const activity of activities) {
    let cursor = activity.started_at;
    const end = cursor + Math.max(0, activity.duration_s ?? 0);
    let guard = 0;
    while (cursor < end && guard < 10_000) {
      const cursorDate = new Date(cursor * 1000);
      const nextHour = new Date(cursorDate);
      nextHour.setMinutes(0, 0, 0);
      nextHour.setHours(nextHour.getHours() + 1);
      const boundary = Math.max(cursor + 1, Math.floor(nextHour.getTime() / 1000));
      const sliceEnd = Math.min(end, boundary);
      seconds[cursorDate.getHours()] += sliceEnd - cursor;
      cursor = sliceEnd;
      guard += 1;
    }
  }
  return seconds;
}
