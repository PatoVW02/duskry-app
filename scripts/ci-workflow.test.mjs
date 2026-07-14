import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

describe('CI dependency security gate', () => {
  it('runs a locked, pinned RustSec audit against the application lockfile', () => {
    expect(ci).toContain('cargo install cargo-audit --version 0.22.2 --locked');
    expect(ci).toContain('cargo audit --file src-tauri/Cargo.lock');
  });
});
