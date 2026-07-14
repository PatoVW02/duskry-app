import { useId, useMemo, useState } from 'react';
import { BriefcaseBusiness } from 'lucide-react';
import { lockedFreeProjectIds } from '../../lib/projectAccess';
import { isProjectTargetAllowed, projectTargetChoices } from '../../lib/projectTargets';
import { errorMessage } from '../../lib/utils';
import { isPro, useLicenseStore } from '../../stores/useLicenseStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useSettingsStore } from '../../stores/useSettingsStore';

export function FocusProjectSelect({ compact = false }: { compact?: boolean }) {
  const projects = useProjectStore((state) => state.projects);
  const tier = useLicenseStore((state) => state.tier);
  const activeProjectId = useSettingsStore((state) => state.activeProjectId);
  const setActiveProject = useSettingsStore((state) => state.setActiveProject);
  const [saving, setSaving] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);
  const errorId = useId();
  const lockedProjectIds = useMemo(
    () => isPro(tier) ? new Set<number>() : lockedFreeProjectIds(projects),
    [projects, tier],
  );
  const projectChoices = useMemo(
    () => projectTargetChoices(projects, lockedProjectIds),
    [lockedProjectIds, projects],
  );

  const updateFocusProject = async (projectId: number) => {
    if (saving) return;
    if (projectId !== 0 && !isProjectTargetAllowed(projectId, projects, lockedProjectIds)) {
      setFocusError('That project is locked on the current plan. Choose an available project or clear focus.');
      return;
    }

    setSaving(true);
    setFocusError(null);
    try {
      await setActiveProject(projectId);
    } catch (error) {
      setFocusError(errorMessage(error, 'The focus project could not be updated.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <label className={`focus-project-control ${compact ? 'focus-project-control--compact' : ''}`}>
      <BriefcaseBusiness size={13} aria-hidden="true" />
      <span>Focus project</span>
      <select
        value={String(activeProjectId)}
        onChange={(event) => void updateFocusProject(Number(event.target.value))}
        disabled={saving}
        aria-label="Focus project"
        aria-describedby={focusError ? errorId : undefined}
        aria-invalid={focusError ? true : undefined}
      >
        <option value="0">None</option>
        {projectChoices.map(({ project, label, disabled }) => (
          <option
            key={project.id}
            value={project.id}
            disabled={disabled}
          >
            {label}
          </option>
        ))}
      </select>
      {focusError && (
        <span
          id={errorId}
          role="alert"
          title={focusError}
          style={{
            display: 'inline-flex',
            maxWidth: compact ? 18 : 190,
            overflow: 'hidden',
            color: 'rgba(248,113,113,0.92)',
            fontSize: compact ? 12 : 10.5,
            fontWeight: 600,
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {compact ? '!' : focusError}
        </span>
      )}
    </label>
  );
}
