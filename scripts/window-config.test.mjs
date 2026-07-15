import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const configPath = fileURLToPath(new URL('../src-tauri/tauri.conf.json', import.meta.url));
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const mainWindow = config.app.windows[0];

describe('native window configuration', () => {
  it('hides the macOS native title while preserving window controls', () => {
    expect(mainWindow.titleBarStyle).toBe('Overlay');
    expect(mainWindow.decorations).toBe(true);
    expect(mainWindow.hiddenTitle).toBe(true);
  });
});
