import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from './useActivityStore';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

import { useActivityStore } from './useActivityStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function activity(id: number, appName: string): Activity {
  return {
    id,
    app_name: appName,
    window_title: null,
    file_path: null,
    domain: null,
    started_at: 1_700_000_000 + id,
    ended_at: 1_700_000_060 + id,
    duration_s: 60,
    project_id: null,
    source: 'tracker',
  };
}

describe('useActivityStore date requests', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useActivityStore.setState({
      activities: [],
      loading: false,
      error: null,
      viewDate: new Date(2026, 6, 14),
    });
  });

  it('keeps the newest date when an older request resolves last', async () => {
    const older = deferred<Activity[]>();
    const newer = deferred<Activity[]>();
    invokeMock
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    const firstRequest = useActivityStore.getState().fetchForDate(new Date(2026, 6, 13));
    const secondRequest = useActivityStore.getState().fetchForDate(new Date(2026, 6, 14));

    newer.resolve([activity(2, 'Newest')]);
    await secondRequest;
    older.resolve([activity(1, 'Stale')]);
    await firstRequest;

    expect(useActivityStore.getState()).toMatchObject({
      activities: [expect.objectContaining({ id: 2, app_name: 'Newest' })],
      loading: false,
      error: null,
    });
  });

  it('ignores a stale failure after the newest date has loaded', async () => {
    const older = deferred<Activity[]>();
    const newer = deferred<Activity[]>();
    invokeMock
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    const firstRequest = useActivityStore.getState().fetchForDate(new Date(2026, 6, 13));
    const secondRequest = useActivityStore.getState().fetchForDate(new Date(2026, 6, 14));

    newer.resolve([activity(3, 'Current')]);
    await secondRequest;
    older.reject(new Error('Old request failed'));
    await firstRequest;

    expect(useActivityStore.getState()).toMatchObject({
      activities: [expect.objectContaining({ id: 3, app_name: 'Current' })],
      loading: false,
      error: null,
    });
  });
});
