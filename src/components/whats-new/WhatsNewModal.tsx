import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Clock3,
  Eye,
  MousePointerClick,
  SlidersHorizontal,
  Sparkles,
  Sun,
  X,
  type LucideIcon,
} from 'lucide-react';
import whatsNewData from '../../whats-new.json';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { getAppVersion } from '../../lib/appVersion';

interface WhatsNewItem {
  icon: string;
  text: string;
}

interface WhatsNewEntry {
  version: string;
  title: string;
  summary?: string;
  items: WhatsNewItem[];
}

const RELEASES = (whatsNewData as { versions: WhatsNewEntry[] }).versions;
const LAST_SEEN_KEY = 'last_seen_whats_new_version';
const ICONS: Record<string, LucideIcon> = {
  Sun,
  Clock3,
  SlidersHorizontal,
  Eye,
  MousePointerClick,
};

export function WhatsNewModal({ enabled }: { enabled: boolean }) {
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const whatsNewModalOpen = useSettingsStore((s) => s.whatsNewModalOpen);
  const closeWhatsNewModal = useSettingsStore((s) => s.closeWhatsNewModal);

  const release = useMemo(
    () => RELEASES.find((entry) => entry.version === currentVersion) ?? null,
    [currentVersion],
  );

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function check() {
      try {
        const version = await getAppVersion();
        if (cancelled) return;
        setCurrentVersion(version);

        const lastSeen = await invoke<string | null>('get_setting', { key: LAST_SEEN_KEY });
        if (cancelled) return;

        const hasEntry = RELEASES.some((entry) => entry.version === version);
        if (!hasEntry) return;

        if (lastSeen !== version) {
          setOpen(true);
        }
      } catch {
        // Non-blocking: if version/settings lookup fails, we simply skip the modal.
      }
    }

    void check();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !whatsNewModalOpen || !release) return;
    setOpen(true);
  }, [enabled, whatsNewModalOpen, release]);

  async function handleClose() {
    if (!currentVersion || dismissing) return;
    setDismissing(true);
    try {
      await invoke('set_setting', { key: LAST_SEEN_KEY, value: currentVersion });
      setOpen(false);
      closeWhatsNewModal();
    } finally {
      setDismissing(false);
    }
  }

  if (!enabled || !open || !release) return null;

  return (
    <div className="whats-new-overlay" onMouseDown={(e) => e.target === e.currentTarget && void handleClose()}>
      <div className="scene-overlay" />
      <div className="whats-new-modal glass-card">
        <button
          type="button"
          className="whats-new-close"
          onClick={() => void handleClose()}
          aria-label="Close What's New"
        >
          <X size={15} />
        </button>

        <div className="whats-new-badge">
          <Sparkles size={14} />
          What&apos;s New
        </div>

        <div className="whats-new-header">
          <div className="whats-new-version">Version {release.version}</div>
          <h2 className="whats-new-title">{release.title}</h2>
          {release.summary && <p className="whats-new-summary">{release.summary}</p>}
        </div>

        <div className="whats-new-section">
          <div className="whats-new-list">
            {release.items.map((item) => {
              const Icon = ICONS[item.icon] ?? Sparkles;
              return (
                <div key={`${item.icon}-${item.text}`} className="whats-new-item">
                  <div className="whats-new-icon-wrap">
                    <Icon size={16} />
                  </div>
                  <span>{item.text}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="whats-new-actions">
          <button
            type="button"
            className="btn-primary"
            style={{ width: 'auto', padding: '10px 22px', fontSize: 13 }}
            onClick={() => void handleClose()}
            disabled={dismissing}
          >
            {dismissing ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
