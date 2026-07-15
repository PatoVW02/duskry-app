import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UpdaterContext } from '../../contexts/UpdaterContext';
import type { UpdateStatus } from '../../hooks/useUpdater';
import { Settings } from './index';

vi.mock('../../stores/useSettingsStore', () => ({
  useSettingsStore: () => vi.fn(),
}));

describe('Settings updater', () => {
  it('groups settings by user goal and explains each destination', () => {
    const markup = renderToStaticMarkup(
      <UpdaterContext.Provider
        value={{
          status: { state: 'idle' },
          checkForUpdates: async () => ({ kind: 'upToDate' }),
          downloadAndInstall: async () => {},
        }}
      >
        <Settings activeTab="about" />
      </UpdaterContext.Provider>,
    );

    expect(markup).toContain('Everything is grouped by what you want to change.');
    expect(markup).toContain('Backgrounds &amp; scenes');
    expect(markup).toContain('Version &amp; release notes');
    expect(markup).toContain('Updates &amp; about');
    expect(markup).toContain('aria-current="page"');
  });

  it('renders the install action with an ampersand instead of an escaped entity', () => {
    const status = {
      state: 'available',
      update: {},
      version: '1.1.2',
    } as UpdateStatus;

    const markup = renderToStaticMarkup(
      <UpdaterContext.Provider
        value={{
          status,
          checkForUpdates: async () => ({ kind: 'upToDate' }),
          downloadAndInstall: async () => {},
        }}
      >
        <Settings activeTab="about" />
      </UpdaterContext.Provider>,
    );

    expect(markup).toContain('Install &amp; Restart');
    expect(markup).not.toContain('Install &amp;amp; Restart');
  });

  it('keeps a failed install visible and retryable', () => {
    const status = {
      state: 'downloaded',
      update: {},
      version: '1.1.2',
      message: 'Signature rejected',
    } as UpdateStatus;

    const markup = renderToStaticMarkup(
      <UpdaterContext.Provider
        value={{
          status,
          checkForUpdates: async () => ({ kind: 'upToDate' }),
          downloadAndInstall: async () => {},
        }}
      >
        <Settings activeTab="about" />
      </UpdaterContext.Provider>,
    );

    expect(markup).toContain('Signature rejected');
    expect(markup).toContain('You can retry below.');
    expect(markup).toContain('Restart to Update');
  });
});
