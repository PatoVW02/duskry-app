#!/bin/bash
# Builds and publishes all three Mac architecture targets to GitHub.
# Requires a Developer ID Application certificate and notarization credentials.
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
# Private key lives at App/duskry.key (gitignored)
# Password is read from .env as TAURI_SIGNING_PRIVATE_KEY_PASSWORD (already sourced above)
KEY_FILE="${ROOT_DIR}/duskry.key"
if [ -f "$KEY_FILE" ]; then
  export TAURI_SIGNING_PRIVATE_KEY=$(cat "$KEY_FILE")
else
  echo "Warning: signing key not found at $KEY_FILE — updater signatures will be skipped"
fi

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
TMP=$(mktemp -d)
trap 'rm -rf "${TMP}"' EXIT

node scripts/sync-tauri-config.mjs
node scripts/validate-config.mjs --release-mac

if [ -n "$(git status --porcelain)" ]; then
  echo "Error: the release worktree is not clean. Commit the complete release changes before publishing."
  git status --short
  exit 1
fi
if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "Error: tag ${TAG} already exists. Bump the package version before releasing."
  exit 1
fi

IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
if [ -z "$IDENTITY" ]; then
  IDENTITY=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' | head -1)
fi
if [[ "$IDENTITY" != Developer\ ID\ Application:* ]]; then
  echo "Error: install a Developer ID Application certificate or set APPLE_SIGNING_IDENTITY."
  exit 1
fi
if ! security find-identity -v -p codesigning | grep -Fq "$IDENTITY"; then
  echo "Error: the configured Developer ID identity is not available in this keychain."
  exit 1
fi
export APPLE_SIGNING_IDENTITY="$IDENTITY"
echo "Using signing identity: $APPLE_SIGNING_IDENTITY"

CERT_TEAM_ID=$(printf '%s' "$APPLE_SIGNING_IDENTITY" | sed -n 's/.*(\([A-Z0-9]\{10\}\))$/\1/p')
if [ -n "${APPLE_TEAM_ID:-}" ] && [ -n "$CERT_TEAM_ID" ] && [ "$APPLE_TEAM_ID" != "$CERT_TEAM_ID" ]; then
  echo "Error: APPLE_TEAM_ID (${APPLE_TEAM_ID}) does not match the Developer ID certificate team (${CERT_TEAM_ID})."
  exit 1
fi

validate_bundle() {
  local target="$1"
  local app
  local dmg
  app=$(find "src-tauri/target/${target}/release/bundle/macos" -name "*.app" | head -1)
  dmg=$(find "src-tauri/target/${target}/release/bundle/dmg" -name "*.dmg" | head -1)
  codesign --verify --deep --strict --verbose=2 "$app"
  xcrun stapler validate "$app"

  echo "Submitting $(basename "$dmg") for DMG notarization"
  if [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
    xcrun notarytool submit "$dmg" \
      --issuer "$APPLE_API_ISSUER" \
      --key-id "$APPLE_API_KEY" \
      --key "$APPLE_API_KEY_PATH" \
      --wait
  else
    xcrun notarytool submit "$dmg" \
      --apple-id "$APPLE_ID" \
      --password "$APPLE_PASSWORD" \
      --team-id "$APPLE_TEAM_ID" \
      --wait
  fi
  xcrun stapler staple "$dmg"
  xcrun stapler validate "$dmg"
  spctl --assess --type execute --verbose=2 "$app"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"
}

echo "▶ Building Duskry ${TAG} for macOS"

# ── arm64 ──────────────────────────────────────────────────────────────────
echo "▶ Building arm64"
npm run tauri build -- --target aarch64-apple-darwin
validate_bundle aarch64-apple-darwin
DMG=$(find src-tauri/target/aarch64-apple-darwin/release/bundle/dmg -name "*.dmg" | head -1)
cp "$DMG" "${TMP}/Duskry_arm64.dmg"
echo "  arm64 DMG: ${DMG}"

# ── x64 ────────────────────────────────────────────────────────────────────
echo "▶ Building x64"
npm run tauri build -- --target x86_64-apple-darwin
validate_bundle x86_64-apple-darwin
DMG=$(find src-tauri/target/x86_64-apple-darwin/release/bundle/dmg -name "*.dmg" | head -1)
cp "$DMG" "${TMP}/Duskry_x64.dmg"
echo "  x64 DMG: ${DMG}"

# ── universal ──────────────────────────────────────────────────────────────
echo "▶ Building universal"
npm run tauri build -- --target universal-apple-darwin
validate_bundle universal-apple-darwin
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

**macOS**: Download the signed and notarized \`.dmg\` file for your chip.

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
