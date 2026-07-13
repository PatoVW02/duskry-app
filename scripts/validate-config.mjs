import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) return [];
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[match[1], value]];
  }));
}

const env = { ...loadDotEnv(path.join(root, '.env')), ...process.env };
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tauri = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const cargo = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
const cargoVersion = cargo.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1];
const errors = [];

if (pkg.version !== tauri.version || pkg.version !== cargoVersion) errors.push(`Version mismatch: package=${pkg.version}, tauri=${tauri.version}, cargo=${cargoVersion ?? 'missing'}`);

const webBilling = env.VITE_BILLING_PLANS_ENABLED ?? 'true';
const nativeBilling = env.DUSKRY_BILLING_PLANS_ENABLED ?? 'true';
if (!['true', 'false'].includes(webBilling) || !['true', 'false'].includes(nativeBilling)) errors.push('Billing feature flags must be either true or false');
if (webBilling !== nativeBilling) errors.push('VITE_BILLING_PLANS_ENABLED and DUSKRY_BILLING_PLANS_ENABLED must match');

if (webBilling === 'true') {
  for (const key of [
    'VITE_CHECKOUT_PRO_MONTHLY', 'VITE_CHECKOUT_PRO_YEARLY',
    'VITE_CHECKOUT_PROPLUS_MONTHLY', 'VITE_CHECKOUT_PROPLUS_YEARLY',
    'DUSKRY_VARIANT_PRO_MONTHLY', 'DUSKRY_VARIANT_PRO_YEARLY',
    'DUSKRY_VARIANT_PROPLUS_MONTHLY', 'DUSKRY_VARIANT_PROPLUS_YEARLY',
  ]) if (!env[key]) errors.push(`Missing required billing variable: ${key}`);
}

if (process.argv.includes('--release-mac')) {
  if (!fs.existsSync(path.join(root, 'duskry.key'))) errors.push('Missing updater private key: duskry.key');
  if (!env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) errors.push('Missing TAURI_SIGNING_PRIVATE_KEY_PASSWORD');
  const apiKeys = ['APPLE_API_ISSUER', 'APPLE_API_KEY', 'APPLE_API_KEY_PATH'];
  const appleIdKeys = ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID'];
  const apiCredentials = apiKeys.every((key) => env[key]);
  const appleIdCredentials = appleIdKeys.every((key) => env[key]);
  if (appleIdCredentials && !/^[A-Za-z0-9]{4}(?:-[A-Za-z0-9]{4}){3}$/.test(env.APPLE_PASSWORD)) {
    errors.push('APPLE_PASSWORD must be an Apple app-specific password in xxxx-xxxx-xxxx-xxxx format');
  }
  if (!apiCredentials && !appleIdCredentials) {
    const selectedKeys = appleIdKeys.some((key) => env[key]) ? appleIdKeys : apiKeys.some((key) => env[key]) ? apiKeys : null;
    if (selectedKeys) {
      selectedKeys.filter((key) => !env[key]).forEach((key) => errors.push(`Missing notarization variable: ${key}`));
    } else {
      errors.push('Set App Store Connect API credentials or APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID for notarization');
    }
  }
}

if (errors.length) {
  console.error(`Configuration validation failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`Configuration valid for Duskry ${pkg.version}${process.argv.includes('--release-mac') ? ' (macOS release)' : ''}.`);
