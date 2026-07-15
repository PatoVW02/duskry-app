import { useEffect, useMemo, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { BarChart3, CalendarDays, FolderOpen, ListChecks, Settings, WandSparkles } from 'lucide-react';
import logo from '../../assets/logo.png';
import { lockedFreeProjectIds } from '../../lib/projectAccess';
import { targetableProjects } from '../../lib/projectTargets';
import { isPro, useLicenseStore } from '../../stores/useLicenseStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { SidebarProjectList } from './SidebarProjectList';
// dragState window events ('duskry-drag-start', 'duskry-drag-end', 'duskry-drag-hover')
// are used in useEffect below to drive isDragging / dragOver state.

type Page = 'today' | 'review' | 'projects' | 'rules' | 'reports' | 'settings';

interface Props {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

const NAV_ITEMS: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'today',     label: 'Today',     icon: <CalendarDays size={14} /> },
  { id: 'review',    label: 'Review',    icon: <ListChecks size={14} /> },
  { id: 'projects',  label: 'Projects',  icon: <FolderOpen size={14} /> },
  { id: 'rules',     label: 'Rules',     icon: <WandSparkles size={14} /> },
  { id: 'reports',   label: 'Reports',   icon: <BarChart3 size={14} /> },
  { id: 'settings',  label: 'Settings',  icon: <Settings size={14} /> },
];

export function Sidebar({ activePage, onNavigate }: Props) {
  const projects    = useProjectStore((s) => s.projects);
  const tier        = useLicenseStore((s) => s.tier);
  const [dragOver,      setDragOver]      = useState<number | null>(null);
  const [isDragging,    setIsDragging]    = useState(false);
  const [appVersion,    setAppVersion]    = useState<string>('');
  const lockedProjectIds = useMemo(
    () => isPro(tier) ? new Set<number>() : lockedFreeProjectIds(projects),
    [projects, tier],
  );
  const dropProjectIds = useMemo(
    () => new Set(targetableProjects(projects, lockedProjectIds).map((project) => project.id)),
    [lockedProjectIds, projects],
  );

  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => setAppVersion(''));
  }, []);

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
            type="button"
            className={`nav-item ${activePage === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            aria-current={activePage === item.id ? 'page' : undefined}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      <SidebarProjectList
        projects={projects}
        dropProjectIds={dropProjectIds}
        isDragging={isDragging}
        dragOver={dragOver}
        onManage={() => onNavigate('projects')}
      />

      <div className="sidebar-footer">
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.22)', textAlign: 'center' }}>
          {appVersion ? `Duskry v${appVersion}` : 'Duskry'}
        </div>
      </div>
    </aside>
  );
}
