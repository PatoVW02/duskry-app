import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface Project {
  id: number;
  name: string;
  color: string;
  icon: string | null;
  created_at: number | null;
}

interface ProjectStore {
  projects: Project[];
  fetchProjects: () => Promise<void>;
  createProject: (name: string, color: string) => Promise<number>;
  deleteProject: (projectId: number) => Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],

  fetchProjects: async () => {
    try {
      const data = await invoke<Project[]>('get_projects');
      set({ projects: data });
    } catch {}
  },

  createProject: async (name, color) => {
    const id = await invoke<number>('create_project', { name, color });
    const data = await invoke<Project[]>('get_projects');
    set({ projects: data });
    return id;
  },

  deleteProject: async (projectId) => {
    await invoke('delete_project', { projectId });
    const data = await invoke<Project[]>('get_projects');
    set({ projects: data });
  },
}));
