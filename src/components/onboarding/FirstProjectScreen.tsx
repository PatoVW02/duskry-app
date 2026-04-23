import { useState } from 'react';
import { OnboardingShell } from './OnboardingShell';
import { useProjectStore } from '../../stores/useProjectStore';
import { PROJECT_COLORS } from '../../styles/tokens';

interface Props { onNext: () => void; }

export function FirstProjectScreen({ onNext }: Props) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [loading, setLoading] = useState(false);
  const { createProject } = useProjectStore();

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await createProject(name.trim(), color);
      onNext();
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
        <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Project name
        </label>
        <input
          className="glass-input"
          placeholder="e.g. My App, Client Work, Personal…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          autoFocus
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Color
        </label>
        <div className="color-picker">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              className={`color-swatch ${color === c ? 'selected' : ''}`}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
              aria-label={`Select color ${c}`}
            />
          ))}
        </div>
      </div>

      <button className="btn-primary" onClick={handleCreate} disabled={loading || !name.trim()}>
        {loading ? 'Creating…' : 'Create project →'}
      </button>
    </OnboardingShell>
  );
}
