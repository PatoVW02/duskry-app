import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { LayoutDashboard, FolderOpen, BarChart2, Settings, List } from 'lucide-react';
import logo from '../../assets/logo.png';
import { useProjectStore } from '../../stores/useProjectStore';
import { useActivityStore } from '../../stores/useActivityStore';
import { formatDuration } from '../../lib/utils';
// dragState window events ('duskry-drag-start', 'duskry-drag-end', 'duskry-drag-hover')
// are used in useEffect below to drive isDragging / dragOver state.

type Page = 'overview' | 'activity' | 'projects' | 'reports' | 'settings';

interface Props {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

const NAV_ITEMS: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'overview',  label: 'Overview',  icon: <LayoutDashboard size={14} /> },
  { id: 'activity',  label: 'Activity',  icon: <List size={14} /> },
  { id: 'projects',  label: 'Projects',  icon: <FolderOpen size={14} /> },
  { id: 'reports',   label: 'Reports',   icon: <BarChart2 size={14} /> },
  { id: 'settings',  label: 'Settings',  icon: <Settings size={14} /> },
];

export function Sidebar({ activePage, onNavigate }: Props) {
  const projects    = useProjectStore((s) => s.projects);
  const activities  = useActivityStore((s) => s.activities);
  const [dragOver,      setDragOver]      = useState<number | null>(null);
  const [isDragging,    setIsDragging]    = useState(false);
  const [appVersion,    setAppVersion]    = useState<string>('');

  useEffect(() => { getVersion().then(setAppVersion); }, []);

  // React to drag lifecycle events fired by dragState
  useEffect(() => {
    const onStart = () => setIsDragging(true);
    const onEnd   = () => { setIsDragging(false); setDragOver(null); };
    const onHover = (e: Event) => setDragOver((e as CustomEvent<number | null>).detail);
    window.addEventListener('duskry-drag-start', onStart);
    window.addEventListener('duskry-drag-end',   onEnd);
    window.addEventListener('duskry-drag-hover', onHover);
    return () => {
      window.removeEventListener('duskry-drag-start', onStart);
      window.removeEventListener('duskry-drag-end',   onEnd);
      window.removeEventListener('duskry-drag-hover', onHover);
    };
  }, []);

  // Per-project seconds from today's activities
  const projectSecs = new Map<number, number>();
  for (const a of activities) {
    if (a.project_id && a.duration_s)
      projectSecs.set(a.project_id, (projectSecs.get(a.project_id) ?? 0) + a.duration_s);
  }

  // dropProps no longer needed — hover is tracked via duskry-drag-hover window event
  // The data-drop-project-id attribute is used by ActivityPage's elementFromPoint check

  return (
    <aside className="sidebar glass-sidebar">
      <div className="sidebar-logo" data-tauri-drag-region>
        <img src={logo} alt="Duskry" style={{ width: 20, height: 20, marginRight: 7, flexShrink: 0 }} />
        Duskry
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${activePage === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}

        {projects.length > 0 && (
          <>
            <div className="nav-section-label">Projects</div>
            {projects.slice(0, 8).map((p) => {
              const secs   = projectSecs.get(p.id) ?? 0;
              const isOver = dragOver === p.id;
              return (
                <button
                  key={p.id}
                  className="nav-item"
                  data-drop-project-id={p.id}
                  onClick={() => onNavigate('projects')}
                  style={{
                    // drag-over: strong colored fill + bright border
                    // dragging (not over): subtle pulsing target indicator
                    // idle: no override (CSS handles normal hover)
                    background: isOver
                      ? `${p.color}30`
                      : isDragging
                        ? 'rgba(255,255,255,0.04)'
                        : undefined,
                    border: isOver
                      ? `1px solid ${p.color}90`
                      : isDragging
                        ? '1px dashed rgba(255,255,255,0.18)'
                        : '1px solid transparent',
                    boxShadow: isOver ? `0 0 0 3px ${p.color}22` : undefined,
                    transform: isOver ? 'scale(1.01)' : undefined,
                    transition: 'background 0.1s, border 0.1s, box-shadow 0.1s, transform 0.08s',
                  }}
                >
                  <span style={{
                    width: isOver ? 9 : 7,
                    height: isOver ? 9 : 7,
                    borderRadius: '50%',
                    background: p.color,
                    flexShrink: 0,
                    transition: 'width 0.1s, height 0.1s',
                    boxShadow: isOver ? `0 0 6px ${p.color}88` : undefined,
                  }} />
                  <span style={{
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap', flex: 1,
                  }}>
                    {p.name}
                  </span>
                  {secs > 0 && (
                    <span style={{
                      fontSize: 9.5, fontVariantNumeric: 'tabular-nums',
                      color: 'rgba(255,255,255,0.35)',
                      background: 'rgba(255,255,255,0.07)',
                      padding: '1px 5px', borderRadius: 3,
                      flexShrink: 0,
                    }}>
                      {formatDuration(secs)}
                    </span>
                  )}
                </button>
              );
            })}
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.22)', textAlign: 'center' }}>
          {appVersion ? `Duskry v${appVersion}` : 'Duskry'}
        </div>
      </div>
    </aside>
  );
}
