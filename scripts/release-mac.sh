#!/bin/bash
# Builds and publishes all three Mac architecture targets to GitHub.
# Run this locally on your Mac — uses the Apple Development cert from your Keychain automatically.
#
# Resulting GitHub release assets:
#   Duskry_arm64.dmg      — Apple Silicon
#   Duskry_x64.dmg        — Intel
#   Duskry_universal.dmg  — Universal (both)

set -e

# ── Load env vars ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load VITE_ vars from .env
if [ -f "$ROOT_DIR/.env" ]; then
  set -a; source "$ROOT_DIR/.env"; set +a
fi

# Load updater signing key (needed for .sig files used by auto-updater)
KEY_FILE="/private/tmp/duskry_update.key"
if [ -f "$KEY_FILE" ]; then
  export TAURI_SIGNING_PRIVATE_KEY=$(cat "$KEY_FILE")
else
  echo "Warning: signing key not found at $KEY_FILE — updater signatures will be skipped"
fi

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
TMP=$(mktemp -d)
trap 'rm -rf "${TMP}"' EXIT

echo "▶ Building Duskry ${TAG} for macOS"

# ── arm64 ──────────────────────────────────────────────────────────────────
echo "▶ Building arm64"
npm run tauri build -- --target aarch64-apple-darwin
DMG=$(find src-tauri/target/aarch64-apple-darwin/release/bundle/dmg -name "*.dmg" | head -1)
cp "$DMG" "${TMP}/Duskry_arm64.dmg"
echo "  arm64 DMG: ${DMG}"

# ── x64 ────────────────────────────────────────────────────────────────────
echo "▶ Building x64"
npm run tauri build -- --target x86_64-apple-darwin
DMG=$(find src-tauri/target/x86_64-apple-darwin/release/bundle/dmg -name "*.dmg" | head -1)
cp "$DMG" "${TMP}/Duskry_x64.dmg"
echo "  x64 DMG: ${DMG}"

# ── universal ──────────────────────────────────────────────────────────────
echo "▶ Building universal"
npm run tauri build -- --target universal-apple-darwin
DMG=$(find src-tauri/target/universal-apple-darwin/release/bundle/dmg -name "*.dmg" | head -1)
cp "$DMG" "${TMP}/Duskry_universal.dmg"
echo "  universal DMG: ${DMG}"

# ── Generate updater manifest (latest.json) from universal build ────────────
UNIVERSAL_BUNDLE="src-tauri/target/universal-apple-darwin/release/bundle/macos"
APP_TAR=$(find "$UNIVERSAL_BUNDLE" -name "*.app.tar.gz" ! -name "*.sig" | head -1)
APP_SIG=$(find "$UNIVERSAL_BUNDLE" -name "*.app.tar.gz.sig" | head -1)

if [ -n "$APP_TAR" ] && [ -n "$APP_SIG" ]; then
  FILENAME=$(basename "$APP_TAR")
  SIGNATURE=$(cat "$APP_SIG")
  PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  DOWNLOAD_URL="https://github.com/PatoVW02/duskry-app/releases/download/${TAG}/${FILENAME}"

  cat > "${TMP}/mac-latest.json" <<JSONEOF
{
  "version": "${VERSION}",
  "notes": "See release page for details.",
  "pub_date": "${PUB_DATE}",
  "platforms": {
    "darwin-aarch64": {
      "signature": "${SIGNATURE}",
      "url": "${DOWNLOAD_URL}"
    },
    "darwin-x86_64": {
      "signature": "${SIGNATURE}",
      "url": "${DOWNLOAD_URL}"
    }
  }
}
JSONEOF
  cp "${TMP}/mac-latest.json" "${TMP}/latest.json"
  echo "  Updater manifest generated: ${FILENAME}"
else
  echo "  Warning: .app.tar.gz.sig not found — TAURI_SIGNING_PRIVATE_KEY may not be set."
  echo "  Auto-updater will not work for Mac users on this release."
fi

# ── Tag & create release, upload all Mac assets ─────────────────────────────
echo "▶ Tagging ${TAG} and creating GitHub release"
git tag "${TAG}"
git push origin "${TAG}"

gh release create "${TAG}" \
  --title "Duskry ${TAG}" \
  --notes "## What's new

See the assets below to download and install Duskry.

**macOS**: Download the \`.dmg\` file for your chip
> If macOS shows a security warning, go to **System Settings → Privacy & Security → Open Anyway**

**Windows**: Download the \`.msi\` or \`.exe\` installer (built by CI)"

echo "▶ Uploading Mac assets"
gh release upload "${TAG}" "${TMP}/Duskry_arm64.dmg" --clobber
gh release upload "${TAG}" "${TMP}/Duskry_x64.dmg" --clobber
gh release upload "${TAG}" "${TMP}/Duskry_universal.dmg" --clobber

if [ -f "${TMP}/mac-latest.json" ]; then
  # Upload .app.tar.gz for the updater to download
  gh release upload "${TAG}" "$APP_TAR" --clobber
  # Upload mac-only manifest (CI will merge Windows into it)
  gh release upload "${TAG}" "${TMP}/mac-latest.json" --clobber
  # Upload initial latest.json (Mac only — CI will merge Windows entry in)
  gh release upload "${TAG}" "${TMP}/latest.json" --clobber
fi

echo ""
echo "✓ macOS release ${TAG} published"
echo "  Duskry_arm64.dmg     → Apple Silicon"
echo "  Duskry_x64.dmg       → Intel"
echo "  Duskry_universal.dmg → Universal"
echo ""
echo "  Windows build + updater merge will be done by GitHub Actions CI."
