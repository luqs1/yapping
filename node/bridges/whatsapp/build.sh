#!/bin/sh
# Build the WhatsApp sidecar for both Mac architectures, into node/dist/.
#   sh bridges/whatsapp/build.sh   → dist/yap-wa-darwin-arm64, dist/yap-wa-darwin-x64
#
# go-sqlite3 needs cgo. Apple's clang builds either architecture from either
# kind of Mac, so both binaries come from one machine.
set -eu
cd "$(dirname "$0")"
OUT="$(cd ../.. && pwd)/dist"
mkdir -p "$OUT"
export CGO_ENABLED=1 GOOS=darwin MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-12.0}"
for arch in arm64 x64; do
  goarch=$arch; cc_arch=arm64
  [ "$arch" = x64 ] && { goarch=amd64; cc_arch=x86_64; }
  echo "building dist/yap-wa-darwin-$arch"
  GOARCH=$goarch CC="clang -arch $cc_arch" go build -trimpath -ldflags "-s -w" -o "$OUT/yap-wa-darwin-$arch" .
done
ls -lh "$OUT"/yap-wa-darwin-*
