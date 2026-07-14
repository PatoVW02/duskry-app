import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BILLING_CHECKOUT_KEYS,
  BILLING_VARIANT_KEYS,
  duplicateBillingVariantIds,
  invalidBillingCheckoutUrls,
  invalidBillingVariantIds,
  productionBillingMismatches,
} from './config-validation.mjs';

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
const whatsNew = JSON.parse(fs.readFileSync(path.join(root, 'src', 'whats-new.json'), 'utf8'));
const cargo = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
const cargoVersion = cargo.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1];
const errors = [];

if (pkg.version !== tauri.version || pkg.version !== cargoVersion) errors.push(`Version mismatch: package=${pkg.version}, tauri=${tauri.version}, cargo=${cargoVersion ?? 'missing'}`);

const currentWhatsNew = Array.isArray(whatsNew.versions)
  ? whatsNew.versions.find((entry) => entry?.version === pkg.version)
  : null;
if (!currentWhatsNew) {
  errors.push(`Missing What's New entry for version ${pkg.version}`);
} else {
  if (!currentWhatsNew.title?.trim()) errors.push(`What's New title is empty for version ${pkg.version}`);
  if (!currentWhatsNew.summary?.trim()) errors.push(`What's New summary is empty for version ${pkg.version}`);
  if (!Array.isArray(currentWhatsNew.items) || currentWhatsNew.items.length === 0) {
    errors.push(`What's New items are empty for version ${pkg.version}`);
  } else if (currentWhatsNew.items.some((item) => !item?.icon?.trim() || !item?.text?.trim())) {
    errors.push(`What's New contains an incomplete item for version ${pkg.version}`);
  }
}

const webBilling = env.VITE_BILLING_PLANS_ENABLED ?? 'true';
const nativeBilling = env.DUSKRY_BILLING_PLANS_ENABLED ?? 'true';
if (!['true', 'false'].includes(webBilling) || !['true', 'false'].includes(nativeBilling)) errors.push('Billing feature flags must be either true or false');
if (webBilling !== nativeBilling) errors.push('VITE_BILLING_PLANS_ENABLED and DUSKRY_BILLING_PLANS_ENABLED must match');

if (webBilling === 'true') {
  for (const key of [
    ...BILLING_CHECKOUT_KEYS,
    ...BILLING_VARIANT_KEYS,
  ]) if (!env[key]) errors.push(`Missing required billing variable: ${key}`);

  for (const key of invalidBillingVariantIds(env)) {
    errors.push(`${key} must be a positive decimal Lemon Squeezy variant ID, not a checkout URL or UUID`);
  }
  for (const key of duplicateBillingVariantIds(env)) {
    errors.push(`${key} duplicates another plan variant ID`);
  }
  for (const key of invalidBillingCheckoutUrls(env)) {
    errors.push(`${key} must be a reusable HTTPS checkout URL for the duskry.lemonsqueezy.com store`);
  }

  const productionBuild = process.argv.includes('--production') || process.argv.includes('--release-mac');
  if (productionBuild) {
    for (const key of productionBillingMismatches(env)) {
      errors.push(`${key} does not match the verified live production billing configuration`);
    }
  }
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
