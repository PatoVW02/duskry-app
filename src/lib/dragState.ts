/**
 * WKWebView (Tauri macOS) only fires dragstart/dragend on the source element.
 * Nothing fires on the drop target (no dragenter, dragleave, dragover, drop).
 * elementFromPoint also returns null during a native drag event.
 *
 * Solution: use pointer events with setPointerCapture instead of HTML5 drag-and-drop.
 * During pointermove (captured), elementFromPoint works correctly and returns the
 * element under the cursor regardless of capture.
 *
 * This module stores the active drag IDs and the current hovered project.
 * The Sidebar subscribes to 'duskry-drag-start', 'duskry-drag-end', and
 * 'duskry-drag-hover' window events to update its visual state.
 */

let _ids: number[] = [];
let _hoverId: number | null = null;

export const dragState = {
  start(ids: number[]) {
    _ids = ids;
    _hoverId = null;
    window.dispatchEvent(new Event('duskry-drag-start'));
  },
  setHover(id: number | null) {
    if (_hoverId === id) return;
    _hoverId = id;
    window.dispatchEvent(new CustomEvent('duskry-drag-hover', { detail: id }));
  },
  getHover(): number | null { return _hoverId; },
  getIds(): number[] { return _ids; },
  clear() {
    _ids = [];
    _hoverId = null;
    window.dispatchEvent(new Event('duskry-drag-end'));
  },
};

