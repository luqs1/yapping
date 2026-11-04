#!/bin/sh
# yapping: install the node on this Mac.
#   curl -fsSL https://yap.luqmaan.dev/install.sh | sh
#
# Puts `yap` in ~/.yapping/bin, starts it at login, then opens sign-in.
set -eu

BASE="${YAP_SERVER:-https://yap.luqmaan.dev}"
DIR="${YAP_HOME:-$HOME/.yapping}"
BIN="$DIR/bin"

say() { printf '%s\n' "$*"; }

if [ "$(uname -s)" != "Darwin" ]; then
  say "Sorry, yapping only runs on a Mac for now."
  exit 1
fi

case "$(uname -m)" in
  arm64) ARCH=arm64 ;;
  x86_64)
    # An Intel shell on Apple silicon (Rosetta) should still get the native build.
    if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then ARCH=arm64; else ARCH=x64; fi ;;
  *) say "Sorry, this Mac's chip ($(uname -m)) isn't supported."; exit 1 ;;
esac

say "Installing yapping..."
mkdir -p "$BIN"
chmod 700 "$DIR"
curl -fsSL "$BASE/dl/yap-darwin-$ARCH" -o "$BIN/yap.download"
chmod +x "$BIN/yap.download"
mv -f "$BIN/yap.download" "$BIN/yap"
# Downloaded binaries carry a quarantine flag; this one came from us.
xattr -d com.apple.quarantine "$BIN/yap" 2>/dev/null || true

# Put yap on PATH for new terminals (zsh is the Mac default; bash too if used).
LINE='export PATH="$HOME/.yapping/bin:$PATH"'
[ "$DIR" = "$HOME/.yapping" ] || LINE="export PATH=\"$BIN:\$PATH\""
for rc in "$HOME/.zshrc" "$HOME/.bash_profile"; do
  if [ "$rc" = "$HOME/.zshrc" ] || [ -f "$rc" ]; then
    grep -qs '.yapping/bin' "$rc" || printf '\n# yapping\n%s\n' "$LINE" >> "$rc"
  fi
done

"$BIN/yap" service install
say ""
say "Now sign in. A browser window will open."
"$BIN/yap" login

say ""
say "All set. yapping runs in the background and starts when you log in."
say "Open your chats with:  yap open"
say "Use it from Claude Code with:  claude mcp add yapping -- yap mcp"
say "(Open a new terminal window first so it can find 'yap'.)"
