import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [version, outputPath] = process.argv.slice(2);

if (!version || !outputPath) {
  throw new Error('Usage: node scripts/render-release-notes.mjs <version> <output-path>');
}

const whatsNewPath = path.join(root, 'src', 'whats-new.json');
const whatsNew = JSON.parse(fs.readFileSync(whatsNewPath, 'utf8'));
const release = whatsNew.versions?.find((entry) => entry.version === version);

if (!release) {
  throw new Error(`No What's New entry found for version ${version}`);
}

const notes = [
  "## What's new",
  '',
  `### ${release.title}`,
  '',
  release.summary,
  '',
  ...release.items.map((item) => `- ${item.text}`),
  '',
  '### Downloads',
  '',
  '**macOS**: Download the signed and notarized `.dmg` file for your chip.',
  '',
  '**Windows**: Download the `.msi` or `.exe` installer.',
  '',
].join('\n');

fs.writeFileSync(outputPath, notes);
