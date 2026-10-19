import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dragState } from './dragState';

let documentTarget: EventTarget & { documentElement: { dataset: Record<string, string> } };
let windowTarget: EventTarget & { getSelection: ReturnType<typeof vi.fn> };
const removeAllRanges = vi.fn();
beforeEach(() => {
  documentTarget = Object.assign(new EventTarget(), { documentElement: { dataset: {} as Record<string, string> } });
  windowTarget = Object.assign(new EventTarget(), { getSelection: vi.fn(() => ({ removeAllRanges })) });
  vi.stubGlobal('document', documentTarget);
  vi.stubGlobal('window', windowTarget);
  removeAllRanges.mockClear();
});
afterEach(() => { dragState.clear(); vi.unstubAllGlobals(); });

describe('activity drag selection lifecycle', () => {
  it('blocks native selection before the pointer has crossed the drag threshold', () => {
    dragState.prepare();
    const event = new Event('selectstart', { cancelable: true });
    documentTarget.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(documentTarget.documentElement.dataset.activityDrag).toBe('pending');
    expect(dragState.getIds()).toEqual([]);
    expect(removeAllRanges).not.toHaveBeenCalled();
  });
  it('clears an existing selection once dragging begins and exposes the selected activities', () => {
    dragState.start([11, 14]);
    expect(removeAllRanges).toHaveBeenCalledOnce();
    expect(documentTarget.documentElement.dataset.activityDrag).toBe('active');
    expect(dragState.getIds()).toEqual([11, 14]);
    dragState.setHover(2);
    expect(dragState.getHover()).toBe(2);
  });
  it('restores text selection and clears the target after a drop or cancellation', () => {
    dragState.start([11]); dragState.setHover(2); dragState.clear(); dragState.clear();
    const event = new Event('selectstart', { cancelable: true });
    documentTarget.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(documentTarget.documentElement.dataset.activityDrag).toBeUndefined();
    expect(dragState.getIds()).toEqual([]);
    expect(dragState.getHover()).toBeNull();
  });
  it('also restores selection after a click that never becomes a drag', () => {
    dragState.prepare(); dragState.clear();
    const event = new Event('selectstart', { cancelable: true });
    documentTarget.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
