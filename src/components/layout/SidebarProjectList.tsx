import { ChevronRight, Lock } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Project } from '../../stores/useProjectStore';

interface SidebarProjectListProps {
  projects: Project[];
  dropProjectIds: ReadonlySet<number>;
  isDragging: boolean;
  dragOver: number | null;
  onManage: () => void;
}

export function SidebarProjectList({
  projects,
  dropProjectIds,
  isDragging,
  dragOver,
  onManage,
}: SidebarProjectListProps) {
  return (
    <section
      className={`sidebar-projects${isDragging ? ' sidebar-projects--dragging' : ''}`}
      aria-label="Projects"
    >
      <div className="sidebar-projects__header">
        <span>{isDragging ? 'Drop to assign' : 'Projects'}</span>
        <button
          type="button"
          className="sidebar-projects__manage"
          onClick={onManage}
          aria-label="Manage projects"
          title="Manage projects"
        >
          <ChevronRight size={13} />
        </button>
      </div>

      <div className="sidebar-projects__list">
        {projects.length === 0 ? (
          <button
            type="button"
            className="sidebar-projects__empty"
            onClick={onManage}
          >
            Create a project to organize reviewed activity
          </button>
        ) : projects.map((project) => {
          const canDrop = dropProjectIds.has(project.id);
          const isOver = canDrop && dragOver === project.id;
          const isLocked = !canDrop;
          const label = isLocked
            ? `${project.name}, locked on your current plan`
            : isDragging
              ? `${project.name}, drop to assign`
              : project.name;
          return (
            <button
              key={project.id}
              type="button"
              className={`sidebar-project${isOver ? ' sidebar-project--over' : ''}${isLocked ? ' sidebar-project--locked' : ''}`}
              data-drop-project-id={canDrop ? project.id : undefined}
              onClick={onManage}
              aria-label={label}
              style={{
                '--project-color': project.color,
                '--project-drop-fill': `${project.color}30`,
                '--project-drop-border': `${project.color}90`,
                '--project-drop-ring': `${project.color}22`,
              } as CSSProperties}
            >
              <span className="sidebar-project__dot" aria-hidden="true" />
              <span className="sidebar-project__name">{project.name}</span>
              {isLocked ? (
                <Lock className="sidebar-project__status" size={10} aria-hidden="true" />
              ) : isDragging ? (
                <span className="sidebar-project__drop-label">Drop</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {!isDragging && projects.length > 0 && (
        <p className="sidebar-projects__hint">Drag Review activity here to assign it.</p>
      )}
    </section>
  );
}
