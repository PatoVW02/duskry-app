import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from './useProjectStore';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const projects = [
  { id: 1, name: 'Client Work', color: '#86EFAC', icon: 'briefcase', created_at: 123 },
  { id: 2, name: 'Personal', color: '#A78BFA', icon: null, created_at: 456 },
];
beforeEach(() => { invoke.mockReset(); useProjectStore.setState({ projects }); });

describe('editing project details', () => {
  it('updates the shared project record after persistence while preserving identity and metadata', async () => {
    invoke.mockResolvedValue(undefined);
    await useProjectStore.getState().updateProject(1, ' New Client Work ', ' #aBc ');
    expect(invoke).toHaveBeenCalledWith('update_project', { projectId: 1, name: 'New Client Work', color: '#AABBCC' });
    expect(useProjectStore.getState().projects).toEqual([
      { ...projects[0], name: 'New Client Work', color: '#AABBCC' }, projects[1],
    ]);
  });

  it('keeps the original project details when persistence fails', async () => {
    invoke.mockRejectedValue(new Error('Disk full'));
    await expect(useProjectStore.getState().updateProject(1, 'Renamed', '#123456')).rejects.toThrow('Disk full');
    expect(useProjectStore.getState().projects).toEqual(projects);
  });

  it('does not send invalid color or empty name edits to native storage', async () => {
    await expect(useProjectStore.getState().updateProject(1, 'Renamed', '#badcolor')).rejects.toThrow();
    await expect(useProjectStore.getState().updateProject(1, ' ', '#123456')).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    expect(useProjectStore.getState().projects).toEqual(projects);
  });
});
