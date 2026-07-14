import { describe, expect, it } from 'vitest';
import { lockedFreeProjectIds } from './projectAccess';
import {
  isProjectTargetAllowed,
  projectTargetChoices,
  targetableProjects,
} from './projectTargets';

const projects = [
  { id: 1, name: 'One', created_at: 10 },
  { id: 2, name: 'Two', created_at: 20 },
  { id: 3, name: 'Three', created_at: 30 },
  { id: 4, name: 'Four', created_at: 40 },
  { id: 5, name: 'Five', created_at: 50 },
];

describe('project targets', () => {
  const lockedProjectIds = lockedFreeProjectIds(projects);

  it('removes locked free projects from new assignment targets', () => {
    expect(targetableProjects(projects, lockedProjectIds).map((project) => project.id))
      .toEqual([1, 2, 3]);
    expect(isProjectTargetAllowed(4, projects, lockedProjectIds)).toBe(false);
    expect(isProjectTargetAllowed(2, projects, lockedProjectIds)).toBe(true);
  });

  it('keeps locked projects visible but disabled in pickers', () => {
    expect(projectTargetChoices(projects, lockedProjectIds).map(({ project, label, disabled }) => ({
      id: project.id,
      label,
      disabled,
    }))).toEqual([
      { id: 1, label: 'One', disabled: false },
      { id: 2, label: 'Two', disabled: false },
      { id: 3, label: 'Three', disabled: false },
      { id: 4, label: 'Four (locked)', disabled: true },
      { id: 5, label: 'Five (locked)', disabled: true },
    ]);
  });

  it('allows every project when the caller supplies no locked ids', () => {
    const unlocked = new Set<number>();
    expect(targetableProjects(projects, unlocked)).toEqual(projects);
    expect(isProjectTargetAllowed(5, projects, unlocked)).toBe(true);
  });
});
