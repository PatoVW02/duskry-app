import { LayoutDashboard, FolderOpen, Clock, BarChart2, Settings, Zap } from 'lucide-react';
import { useProjectStore } from '../../stores/useProjectStore';

type Page = 'overview' | 'projects' | 'timeline' | 'reports' | 'settings';

interface Props {
  activePage: Page;
  onNavigate: (page: Page) => void;
}

const NAV_ITEMS: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'overview',  label: 'Overview',  icon: <LayoutDashboard size={14} /> },
  { id: 'timeline',  label: 'Timeline',  icon: <Clock size={14} /> },
  { id: 'projects',  label: 'Projects',  icon: <FolderOpen size={14} /> },
  { id: 'reports',   label: 'Reports',   icon: <BarChart2 size={14} /> },
  { id: 'settings',  label: 'Settings',  icon: <Settings size={14} /> },
];


export function Sidebar({ activePage, onNavigate }: Props) {
  const projects = useProjectStore((s) => s.projects);

  return (
    <aside className="sidebar glass-sidebar">
      <div className="sidebar-logo" data-tauri-drag-region>
        <Zap size={13} style={{ display: 'inline', marginRight: 5, color: 'rgba(45,212,191,0.8)' }}/>
        duskry
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
            {projects.slice(0, 8).map((p) => (
              <button
                key={p.id}
                className="nav-item"
                onClick={() => onNavigate('projects')}
              >
                <span style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: p.color,
                  flexShrink: 0,
                }} />
                <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 130,
                }}>
                  {p.name}
                </span>
              </button>
            ))}
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.22)', textAlign: 'center' }}>
          Duskry v0.1
        </div>
      </div>
    </aside>
  );
}
