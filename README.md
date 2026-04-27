# Duskry

Automatic time tracking for Mac and Windows.

## What It Does

Duskry runs in the background, watches the active app and window, tracks idle time, and turns that activity into a structured timeline you can review later. You can organize entries into projects, create rules to auto-assign future activity, and use reports to understand where your time goes.

Core capabilities in the current codebase include:

- Automatic active-window and idle-time tracking
- Project-based organization with manual assignment and auto-rules
- Daily activity timeline and dashboard views
- Reports and exports
- Free, Pro, and Pro+ billing flows via Lemon Squeezy
- Built-in auto-updater for desktop releases

## Tech Stack

| Layer | Tech |
| --- | --- |
| Desktop UI | React 19, TypeScript, Tailwind CSS 4, Vite 7 |
| Desktop backend | Rust, Tauri 2, SQLite (`rusqlite`) |
| Billing | Lemon Squeezy |
| CI/CD | Local macOS release script + GitHub Actions for Windows |

## Prerequisites

- Node.js LTS
- Rust stable toolchain
- `@tauri-apps/cli` via local dev dependency, invoked with `npm run tauri`
- macOS: Xcode Command Line Tools
- Windows: Visual C++ Build Tools
- GitHub CLI (`gh`) for desktop release publishing

## Local Development

### Desktop app

```bash
cd App
cp .env.example .env
npm install
npm run tauri dev
```

Notes:

- Fill in the values in `.env` before starting the app.
- `npm run tauri dev` starts the Vite dev server and then launches the desktop app against `http://localhost:1420`.

## Releasing A New Version

This repo uses a split release flow:

- macOS artifacts are built and published locally from a Mac
- Windows artifacts are built automatically by GitHub Actions after a version tag is pushed

### 1. Bump the version

Before releasing, update the desktop app version in [package.json](/Users/patricio/Development/Personal/Apps/Duskry/App/package.json). The current version is `0.6.1`.

The macOS release script will sync that same version into [src-tauri/tauri.conf.json](/Users/patricio/Development/Personal/Apps/Duskry/App/src-tauri/tauri.conf.json) automatically, but it does not bump the version for you.

### 2. Build and publish the macOS release

Run this on a Mac from the desktop app directory:

```bash
cd App
npm run release
```

This runs [scripts/release-mac.sh](/Users/patricio/Development/Personal/Apps/Duskry/App/scripts/release-mac.sh), which:

- Loads `.env`
- Reads the updater signing password from `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Reads the private updater key from `App/duskry.key` if present
- Syncs `src-tauri/tauri.conf.json` to the version from `package.json`
- Builds macOS bundles for:
  - `aarch64-apple-darwin`
  - `x86_64-apple-darwin`
  - `universal-apple-darwin`
- Creates and pushes a Git tag like `v0.6.1`
- Creates a GitHub release
- Uploads:
  - `Duskry_arm64.dmg`
  - `Duskry_x64.dmg`
  - `Duskry_universal.dmg`
  - universal `.app.tar.gz` updater bundle
  - `mac-latest.json`
  - initial `latest.json`

### 3. Let GitHub Actions build Windows

Pushing a tag that matches `v*` triggers the Windows release workflow at [.github/workflows/release.yml](/Users/patricio/Development/Personal/Apps/Duskry/App/.github/workflows/release.yml).

That workflow:

- Runs on `windows-latest`
- Builds the Windows installers with `tauri-action`
- Uploads Windows release assets to the same GitHub release
- Downloads `mac-latest.json`
- Merges Mac and Windows updater manifests into the final `latest.json`

The merged `latest.json` is what powers the in-app auto-updater across platforms.

### Tag-only release helper

If the version is already correct and you only need to push the tag:

```bash
cd App
npm run release:tag-only
```

This command creates `v<package.json version>` and pushes it to `origin`. It does not build artifacts by itself.

## Release Requirements

### Local macOS release requirements

These are required when running `npm run release` locally on macOS:

| Item | Purpose |
| --- | --- |
| Apple signing identity in Keychain | Used by Tauri during macOS bundle/signing steps |
| `gh` authenticated | Creates the GitHub release and uploads assets |
| `App/duskry.key` | Private updater signing key used to generate updater signatures |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the updater signing key |

### GitHub Actions secrets

These are required by the Windows release workflow:

| Secret | Purpose |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Signs Windows updater bundles |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the signing key |

Note: the current Windows workflow embeds the Lemon Squeezy checkout URLs directly in the workflow file instead of reading them from GitHub Secrets.

## Environment Variables

### Desktop app: `App/.env`

Based on [.env.example](/Users/patricio/Development/Personal/Apps/Duskry/App/.env.example):

| Variable | Purpose |
| --- | --- |
| `VITE_BILLING_PLANS_ENABLED` | Enables billing UI and plan-based behavior in the Vite/React frontend |
| `DUSKRY_BILLING_PLANS_ENABLED` | Enables billing gates in the native Tauri/Rust side |
| `VITE_CHECKOUT_PRO_MONTHLY` | Lemon Squeezy checkout URL for Pro monthly |
| `VITE_CHECKOUT_PRO_YEARLY` | Lemon Squeezy checkout URL for Pro yearly |
| `VITE_CHECKOUT_PROPLUS_MONTHLY` | Lemon Squeezy checkout URL for Pro+ monthly |
| `VITE_CHECKOUT_PROPLUS_YEARLY` | Lemon Squeezy checkout URL for Pro+ yearly |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the updater signing key used during release builds |

### Landing page: `Landing/.env.local`

Based on [Landing/.env.local.example](/Users/patricio/Development/Personal/Apps/Duskry/Landing/.env.local.example):

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CHECKOUT_PRO_MONTHLY` | Lemon Squeezy checkout URL for Pro monthly |
| `NEXT_PUBLIC_CHECKOUT_PRO_YEARLY` | Lemon Squeezy checkout URL for Pro yearly |
| `NEXT_PUBLIC_CHECKOUT_PROPLUS_MONTHLY` | Lemon Squeezy checkout URL for Pro+ monthly |
| `NEXT_PUBLIC_CHECKOUT_PROPLUS_YEARLY` | Lemon Squeezy checkout URL for Pro+ yearly |
| `LEMONSQUEEZY_API_KEY` | Server-side API key for fetching live pricing and billing data |
| `LEMONSQUEEZY_VARIANT_PRO_MONTHLY` | Lemon Squeezy variant ID for Pro monthly |
| `LEMONSQUEEZY_VARIANT_PRO_YEARLY` | Lemon Squeezy variant ID for Pro yearly |
| `LEMONSQUEEZY_VARIANT_PROPLUS_MONTHLY` | Lemon Squeezy variant ID for Pro+ monthly |
| `LEMONSQUEEZY_VARIANT_PROPLUS_YEARLY` | Lemon Squeezy variant ID for Pro+ yearly |
| `GITHUB_TOKEN` | Optional token to avoid GitHub API rate limits when fetching latest release data |

## Project Links

- Desktop app repo: <https://github.com/PatoVW02/duskry-app>
- Landing repo: <https://github.com/PatoVW02/duskry-landing>
