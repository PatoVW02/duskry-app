import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const macRelease = fs.readFileSync(path.join(root, 'scripts', 'release-mac.sh'), 'utf8');
const windowsRelease = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
const dependabot = fs.readFileSync(path.join(root, '.github', 'dependabot.yml'), 'utf8');

describe('atomic cross-platform release flow', () => {
  it('stages macOS assets in a draft without uploading a partial latest manifest', () => {
    expect(macRelease).toContain('gh release create "${TAG}"');
    expect(macRelease).toContain('--draft');
    expect(macRelease).toContain('--verify-tag');
    expect(macRelease).toContain('Refusing to publish a release that cannot update existing Mac users.');
    expect(macRelease).not.toContain('"${TMP}/latest.json"');
    expect(macRelease).not.toContain('release ${TAG} published');
  });

  it('keeps Windows uploads draft until manifests and notes are complete', () => {
    const draftIndex = windowsRelease.indexOf('releaseDraft: true');
    const mergeIndex = windowsRelease.indexOf('- name: Merge Mac + Windows updater manifests');
    const notesIndex = windowsRelease.indexOf('- name: Upload version-specific release notes');
    const publishIndex = windowsRelease.indexOf('- name: Publish completed release');

    expect(draftIndex).toBeGreaterThan(-1);
    expect(mergeIndex).toBeGreaterThan(draftIndex);
    expect(notesIndex).toBeGreaterThan(mergeIndex);
    expect(publishIndex).toBeGreaterThan(notesIndex);
    expect(windowsRelease.slice(publishIndex)).toContain('{draft: false, make_latest: "true"}');
    expect(windowsRelease).not.toContain('releaseDraft: false');
    expect(windowsRelease).toContain('npm run check:config -- --production');
  });

  it('allows explicitly unsigned Windows installers but rejects partial signing configuration', () => {
    expect(windowsRelease).toContain('secrets.WINDOWS_CERTIFICATE');
    expect(windowsRelease).toContain('secrets.WINDOWS_CERTIFICATE_PASSWORD');
    expect(windowsRelease).toContain('vars.WINDOWS_TIMESTAMP_URL');
    expect(windowsRelease).toContain('Import-PfxCertificate');
    expect(windowsRelease).toContain('certificateThumbprint = $certificate.Thumbprint');
    expect(windowsRelease).toContain('All Windows code-signing inputs are absent. Building explicitly unsigned installers.');
    expect(windowsRelease).toContain('Windows signing is partially configured. Missing:');
    expect(windowsRelease).toContain('- name: Mark Windows installers as unsigned');
    expect(windowsRelease).toContain('The Windows installers in this release are not Authenticode-signed yet.');
  });

  it('fails closed unless every updater platform is present', () => {
    expect(windowsRelease).toContain('if [ ! -f mac-latest.json ]');
    expect(windowsRelease).toContain('has("darwin-aarch64")');
    expect(windowsRelease).toContain('has("darwin-x86_64")');
    expect(windowsRelease).toContain('has("windows-x86_64")');
    expect(windowsRelease).not.toContain('latest.json will be Windows-only');
  });
});

describe('dependency update coverage', () => {
  it.each(['npm', 'cargo', 'github-actions'])('tracks %s dependencies', (ecosystem) => {
    expect(dependabot).toContain(`package-ecosystem: ${ecosystem}`);
  });
});
