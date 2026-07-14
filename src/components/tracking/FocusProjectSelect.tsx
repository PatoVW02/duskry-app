import { BriefcaseBusiness } from 'lucide-react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useSettingsStore } from '../../stores/useSettingsStore';

export function FocusProjectSelect({ compact = false }: { compact?: boolean }) {
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useSettingsStore((state) => state.activeProjectId);
  const setActiveProject = useSettingsStore((state) => state.setActiveProject);

  return (
    <label className={`focus-project-control ${compact ? 'focus-project-control--compact' : ''}`}>
      <BriefcaseBusiness size={13} aria-hidden="true" />
      <span>Focus project</span>
      <select
        value={String(activeProjectId)}
        onChange={(event) => void setActiveProject(Number(event.target.value))}
        aria-label="Focus project"
      >
        <option value="0">None</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>{project.name}</option>
        ))}
      </select>
    </label>
  );
}
