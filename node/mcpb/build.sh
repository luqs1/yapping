#!/bin/sh
# Build the Claude Desktop bundle: node/dist/yapping.mcpb
#   sh mcpb/build.sh
#
# Inside the bundle:
#   manifest.json, icon.png
#   server/yap      the node, one universal binary (arm64 + x64)
#   server/yap-wa   the WhatsApp sidecar, universal too (if Go built it)
#   ui/sidebar.html the sidebar (ui/dist, built by the UI's own build)
#
# Signing: ad-hoc by default. With a Developer ID, set
#   YAP_SIGN_ID="Developer ID Application: … (TEAMID)"
# and, to notarize too, YAP_NOTARY_PROFILE=<a `xcrun notarytool store-credentials` profile>.
set -eu
cd "$(dirname "$0")/.."
MCPB="npx -y @anthropic-ai/mcpb@2"

sh build.sh
[ -f ../ui/dist/sidebar.html ] || { echo "ui/dist/sidebar.html is missing: build the UI first (cd ui && bun build.ts)"; exit 1; }

STAGE=dist/mcpb
rm -rf "$STAGE" dist/yapping.mcpb
mkdir -p "$STAGE/server" "$STAGE/ui"

echo "making universal binaries"
lipo -create dist/yap-darwin-arm64 dist/yap-darwin-x64 -output "$STAGE/server/yap"
if [ -f dist/yap-wa-darwin-arm64 ] && [ -f dist/yap-wa-darwin-x64 ]; then
  lipo -create dist/yap-wa-darwin-arm64 dist/yap-wa-darwin-x64 -output "$STAGE/server/yap-wa"
else
  echo "warning: no yap-wa (WhatsApp sidecar) in this bundle"
fi
chmod 755 "$STAGE"/server/*

ID="${YAP_SIGN_ID:--}"
for f in "$STAGE"/server/*; do
  name=$(basename "$f")
  if [ "$ID" = "-" ]; then
    codesign --force --sign - --identifier "dev.luqmaan.yapping.$name" "$f"
  else
    codesign --force --sign "$ID" --identifier "dev.luqmaan.yapping.$name" --options runtime --timestamp \
      --entitlements mcpb/entitlements.plist "$f"
  fi
  codesign --verify --strict "$f"
done

if [ -n "${YAP_NOTARY_PROFILE:-}" ]; then
  echo "notarizing"
  ditto -c -k "$STAGE/server" dist/notarize.zip
  xcrun notarytool submit dist/notarize.zip --keychain-profile "$YAP_NOTARY_PROFILE" --wait
  rm -f dist/notarize.zip
fi

cp ../ui/dist/sidebar.html "$STAGE/ui/sidebar.html"
cp mcpb/icon.png "$STAGE/icon.png"
# The manifest's version follows the node's.
VERSION=$("$STAGE/server/yap" --version)
sed "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" mcpb/manifest.json > "$STAGE/manifest.json"

$MCPB validate "$STAGE/manifest.json"
$MCPB pack "$STAGE" dist/yapping.mcpb
ls -lh dist/yapping.mcpb
