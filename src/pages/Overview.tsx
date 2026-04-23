import { useEffect } from 'react';
import { isToday } from 'date-fns';
import { StatsRow } from '../components/dashboard/StatsRow';
import { Timeline } from '../components/dashboard/Timeline';
import { ProjectList } from '../components/dashboard/ProjectList';
import { AppBreakdown } from '../components/dashboard/AppBreakdown';
import { ActivityFeed } from '../components/dashboard/ActivityFeed';
import { useActivityStore } from '../stores/useActivityStore';

export function Overview() {
  const fetchToday    = useActivityStore((s) => s.fetchToday);
  const fetchForDate  = useActivityStore((s) => s.fetchForDate);
  const viewDate      = useActivityStore((s) => s.viewDate);

  useEffect(() => {
    // On mount, always load whatever viewDate is current (today by default)
    fetchForDate(viewDate);
    // Only auto-refresh when viewing today
    if (isToday(viewDate)) {
      const id = setInterval(() => fetchForDate(viewDate), 10_000);
      return () => clearInterval(id);
    }
  }, [viewDate]); // re-run whenever viewDate changes

  // keep fetchToday in dependencies only for the initial mount fallback
  void fetchToday;

  return (
    <>
      <StatsRow />
      <Timeline />
      <div className="mid-row">
        <ProjectList />
        <AppBreakdown />
      </div>
      <ActivityFeed />
    </>
  );
}
