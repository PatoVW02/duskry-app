import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StartupGate } from './StartupGate';

describe('StartupGate', () => {
  it('keeps the window draggable while settings are loading or failed', () => {
    const markup = renderToStaticMarkup(<StartupGate error="Settings unavailable" onRetry={vi.fn()} />);
    const background = markup.match(/<div class="scene-overlay"[^>]*>/)?.[0];

    expect(background).toContain('data-tauri-drag-region');
    expect(markup).toContain('Try again');
  });

  it('can offer a restart action for a database recovery failure', () => {
    const markup = renderToStaticMarkup(
      <StartupGate error="Database unavailable" actionLabel="Restart Duskry" onRetry={vi.fn()} />,
    );
    expect(markup).toContain('Restart Duskry');
  });
});
