import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { normalizeProjectColor } from '../lib/projectColor';

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
  updateProject: (projectId: number, name: string, color: string) => Promise<void>;
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
    const normalized = normalizeProjectColor(color);
    if (!name.trim() || !normalized) throw new Error('Enter a project name and a valid hex color.');
    const id = await invoke<number>('create_project', { name: name.trim(), color: normalized });
    const data = await invoke<Project[]>('get_projects');
    set({ projects: data });
    return id;
  },

  updateProject: async (projectId, name, color) => {
    const normalized = normalizeProjectColor(color);
    if (!name.trim() || !normalized) throw new Error('Enter a project name and a valid hex color.');
    await invoke('update_project', { projectId, name: name.trim(), color: normalized });
    set((state) => ({ projects: state.projects.map((project) => project.id === projectId
      ? { ...project, name: name.trim(), color: normalized }
      : project) }));
  },

  deleteProject: async (projectId) => {
    await invoke('delete_project', { projectId });
    const data = await invoke<Project[]>('get_projects');
    set({ projects: data });
  },
}));
