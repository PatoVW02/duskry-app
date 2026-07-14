interface ProjectTargetRecord {
  id: number;
}

interface NamedProjectTargetRecord extends ProjectTargetRecord {
  name: string;
}

export interface ProjectTargetChoice<T extends NamedProjectTargetRecord> {
  project: T;
  label: string;
  disabled: boolean;
}

export function targetableProjects<T extends ProjectTargetRecord>(
  projects: readonly T[],
  lockedProjectIds: ReadonlySet<number>,
): T[] {
  return projects.filter((project) => !lockedProjectIds.has(project.id));
}

export function projectTargetChoices<T extends NamedProjectTargetRecord>(
  projects: readonly T[],
  lockedProjectIds: ReadonlySet<number>,
): ProjectTargetChoice<T>[] {
  return projects.map((project) => {
    const disabled = lockedProjectIds.has(project.id);
    return {
      project,
      label: `${project.name}${disabled ? ' (locked)' : ''}`,
      disabled,
    };
  });
}

export function isProjectTargetAllowed(
  projectId: number,
  projects: readonly ProjectTargetRecord[],
  lockedProjectIds: ReadonlySet<number>,
): boolean {
  return projects.some((project) =>
    project.id === projectId && !lockedProjectIds.has(project.id),
  );
}
