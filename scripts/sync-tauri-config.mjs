import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const packageJsonPath = path.join(rootDir, 'package.json');
const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const publicKeyPath = path.join(rootDir, 'duskry.key.pub');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));

if (!fs.existsSync(publicKeyPath)) {
  console.error(`Missing updater public key at ${publicKeyPath}`);
  process.exit(1);
}

const publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim();
if (!publicKey) {
  console.error(`Updater public key file is empty: ${publicKeyPath}`);
  process.exit(1);
}

tauriConfig.version = packageJson.version;
tauriConfig.plugins ??= {};
tauriConfig.plugins.updater ??= {};
tauriConfig.plugins.updater.pubkey = publicKey;

fs.writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);

console.log(`Synced tauri.conf.json version -> ${packageJson.version}`);
console.log('Synced tauri.conf.json updater pubkey -> duskry.key.pub');
