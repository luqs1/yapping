#!/bin/sh
# Compile the node into one binary per Mac architecture, in node/dist/.
#   sh build.sh        → dist/yap-darwin-arm64, dist/yap-darwin-x64 (+ dist/yap-wa-darwin-*)
set -eu
cd "$(dirname "$0")"
bun install --frozen-lockfile >/dev/null 2>&1 || bun install >/dev/null
mkdir -p dist
for arch in arm64 x64; do
  echo "building dist/yap-darwin-$arch"
  bun build src/cli.ts --compile --minify --target="bun-darwin-$arch" --outfile="dist/yap-darwin-$arch"
done
# The WhatsApp sidecar (Go), if Go is here: dist/yap-wa-darwin-{arm64,x64}.
if command -v go >/dev/null 2>&1; then
  sh bridges/whatsapp/build.sh
else
  echo "skipping yap-wa (WhatsApp sidecar): Go isn't installed"
fi
# Copy the built sidebar beside the binaries, if the UI has been built.
if [ -f ../ui/dist/sidebar.html ]; then
  mkdir -p dist/ui && cp ../ui/dist/sidebar.html dist/ui/sidebar.html
fi
ls -lh dist/yap-darwin-* dist/yap-wa-darwin-* 2>/dev/null || true
