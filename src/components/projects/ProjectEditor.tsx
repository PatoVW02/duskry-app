import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Project } from '../../stores/useProjectStore';
import { PROJECT_COLORS } from '../../styles/tokens';
import { normalizeProjectColor } from '../../lib/projectColor';
import { errorMessage } from '../../lib/utils';
import { ProjectColorPicker } from './ProjectColorPicker';
import './ProjectEditor.css';

interface Props {
  project?: Project;
  onSave: (name: string, color: string) => Promise<unknown>;
  onCancel: () => void;
}

export function ProjectEditor({ project, onSave, onCancel }: Props) {
  const id = useId();
  const [name, setName] = useState(project?.name ?? '');
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const normalizedColor = normalizeProjectColor(color);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !normalizedColor || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), normalizedColor);
      if (mounted.current) onCancel();
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure, 'The project could not be saved. Please try again.'));
    } finally { if (mounted.current) setSaving(false); }
  };

  return (
    <form className="project-editor" aria-label={project ? `Edit ${project.name}` : 'Create project'} onSubmit={(event) => void submit(event)}>
      <h3>{project ? 'Edit project' : 'New project'}</h3>
      <label className="project-editor-name" htmlFor={`${id}-name`}>Project name</label>
      <input id={`${id}-name`} className="glass-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Project name" autoFocus disabled={saving} required />
      <ProjectColorPicker value={color} onChange={setColor} disabled={saving} />
      <div className="project-editor-preview" role="group" aria-label="Project preview">
        <span className="project-dot" style={{ backgroundColor: normalizedColor ?? 'transparent' }} />
        <span>{name.trim() || 'Your project'}</span>
        <code>{normalizedColor ?? 'Choose a valid color'}</code>
      </div>
      {error && <p role="alert" className="project-editor-error">{error}</p>}
      <div className="project-editor-actions">
        <button type="submit" className="btn-primary" disabled={saving || !name.trim() || !normalizedColor}>{saving ? 'Saving…' : project ? 'Save changes' : 'Create project'}</button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}
