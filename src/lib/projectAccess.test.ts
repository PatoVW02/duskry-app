import { describe, expect, it } from 'vitest';
import { lockedFreeProjectIds, sortProjectsByFreeEligibility } from './projectAccess';

describe('free project eligibility', () => {
  it('matches native ordering by created_at and then id', () => {
    const projects = [
      { id: 8, created_at: 20 },
      { id: 6, created_at: null },
      { id: 5, created_at: 20 },
      { id: 9, created_at: 10 },
      { id: 4, created_at: null },
    ];

    expect(sortProjectsByFreeEligibility(projects).map((project) => project.id)).toEqual([4, 6, 9, 5, 8]);
    expect([...lockedFreeProjectIds(projects)]).toEqual([5, 8]);
  });
});
