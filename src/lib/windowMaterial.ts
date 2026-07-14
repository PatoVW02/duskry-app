import { invoke } from '@tauri-apps/api/core';

export type WindowMaterialMode = 'native' | 'solid';

export function normalizeWindowMaterialMode(value: unknown): WindowMaterialMode {
  return value === 'native' ? 'native' : 'solid';
}

export async function detectWindowMaterialMode(
  query: () => Promise<unknown> = () => invoke<string>('get_window_material_mode'),
): Promise<WindowMaterialMode> {
  try {
    return normalizeWindowMaterialMode(await query());
  } catch {
    return 'solid';
  }
}

export async function applyDetectedWindowMaterial(): Promise<WindowMaterialMode> {
  const mode = await detectWindowMaterialMode();
  document.documentElement.dataset.windowMaterial = mode;
  return mode;
}
