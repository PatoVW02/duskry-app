import { useState } from 'react';
import { OnboardingShell } from './OnboardingShell';
import { useProjectStore } from '../../stores/useProjectStore';
import { PROJECT_COLORS } from '../../styles/tokens';
import { ProjectColorPicker } from '../projects/ProjectColorPicker';
import { normalizeProjectColor } from '../../lib/projectColor';
import { errorMessage } from '../../lib/utils';

interface Props { onNext: () => void; }

export function FirstProjectScreen({ onNext }: Props) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { createProject } = useProjectStore();

  const handleCreate = async () => {
    const normalizedColor = normalizeProjectColor(color);
    if (!name.trim() || !normalizedColor || loading) return;
    setLoading(true);
    setError(null);
    try {
      await createProject(name.trim(), normalizedColor);
      onNext();
    } catch (failure) {
      setError(errorMessage(failure, 'The project could not be created. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <OnboardingShell step={5} total={7}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 500, marginBottom: 6 }}>Create your first project</div>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)' }}>
          Projects group your activities together. You can always add more later.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label htmlFor="first-project-name" style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Project name
        </label>
        <input
          id="first-project-name"
          className="glass-input"
          placeholder="e.g. My App, Client Work, Personal…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          autoFocus
          disabled={loading}
        />
      </div>

      <ProjectColorPicker value={color} onChange={setColor} disabled={loading} />
      {error && <p role="alert" className="project-editor-error">{error}</p>}

      <button className="btn-primary" onClick={handleCreate} disabled={loading || !name.trim() || !normalizeProjectColor(color)}>
        {loading ? 'Creating…' : 'Create project →'}
      </button>
    </OnboardingShell>
  );
}
