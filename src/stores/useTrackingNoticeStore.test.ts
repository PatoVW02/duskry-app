import { beforeEach, describe, expect, it, vi } from 'vitest';
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
import { useTrackingNoticeStore, type TrackingNotice } from './useTrackingNoticeStore';
import { useActivityStore } from './useActivityStore';

const notice: TrackingNotice = { activity_id: 11, app_name: 'Code', window_title: 'Duskry', project_id: 1, suggested_project_id: null, confidence: 1, reason: 'Session started', created_at: 1 };
describe('tracking review persistence', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useTrackingNoticeStore.setState({ notices: [notice], open: true, selectedId: 11, saving: false, error: null });
    useActivityStore.setState({ fetchForDate: vi.fn().mockResolvedValue(undefined) });
  });
  it('keeps an alert reviewable when a correction fails', async () => {
    invokeMock.mockRejectedValueOnce('Disk is full');
    await useTrackingNoticeStore.getState().correct(11, 2, true);
    expect(useTrackingNoticeStore.getState().notices).toEqual([notice]);
    expect(useTrackingNoticeStore.getState().error).toBe('Disk is full');
    expect(useTrackingNoticeStore.getState().saving).toBe(false);
  });
  it('sends explicit remembering intent and refreshes reports after success', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await useTrackingNoticeStore.getState().correct(11, 2, true);
    expect(invokeMock).toHaveBeenCalledWith('correct_tracking_assignment', { activityId: 11, projectId: 2, remember: true });
    expect(useTrackingNoticeStore.getState().notices).toEqual([]);
    expect(useActivityStore.getState().fetchForDate).toHaveBeenCalled();
  });
  it('does not dismiss an alert until persistence succeeds', async () => {
    invokeMock.mockRejectedValueOnce('Database unavailable');
    await useTrackingNoticeStore.getState().dismiss(11);
    expect(useTrackingNoticeStore.getState().notices).toHaveLength(1);
  });
  it('ignores an older inbox fetch that resolves after a newer one', async () => {
    let finish!: (value: TrackingNotice[]) => void;
    invokeMock.mockReturnValueOnce(new Promise<TrackingNotice[]>((resolve) => { finish = resolve; })).mockResolvedValueOnce([]);
    const older = useTrackingNoticeStore.getState().load();
    await useTrackingNoticeStore.getState().load();
    finish([notice]); await older;
    expect(useTrackingNoticeStore.getState().notices).toEqual([]);
  });
  it('does not resurrect an alert from a fetch started before a correction', async () => {
    let finish!: (value: TrackingNotice[]) => void;
    invokeMock.mockReturnValueOnce(new Promise<TrackingNotice[]>((resolve) => { finish = resolve; })).mockResolvedValueOnce(undefined);
    const pending = useTrackingNoticeStore.getState().load();
    await useTrackingNoticeStore.getState().correct(11, 2, false);
    finish([notice]); await pending;
    expect(useTrackingNoticeStore.getState().notices).toEqual([]);
  });
});
