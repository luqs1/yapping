#!/usr/bin/env bash
# yaplab: a two-person GUI test lab for yapping on one Linux VM.
#
# Run it from a yapping checkout on your Mac:
#
#   e2e/lab/setup.sh                    sync this working tree to the VM and (re)build the lab
#   e2e/lab/setup.sh --host other-vm    another ssh alias (default: hetzner-arm)
#   e2e/lab/setup.sh --no-sync          don't rsync; rebuild from what's already on the VM
#   e2e/lab/setup.sh --no-apt           skip apt-get (packages already there)
#   e2e/lab/setup.sh --no-harnesses     skip Claude Code / opencode / pi installs
#   e2e/lab/setup.sh --restart          restart the lab server, nodes and apps after syncing
#                                       (needed for code changes to take effect)
#
# On the VM it runs again as `setup.sh --remote …` (as root) and does the rest.
# Safe to re-run: every step checks before it acts.
#
# What it builds (everything under /srv/yaplab, everything on 127.0.0.1):
#   /srv/yaplab/repo          the synced tree (bun install in server/ node/ ui/, ui built)
#   yaplab-server.service     dev-mode server (YAP_DEV=1) on 127.0.0.1:18787, data in /srv/yaplab/server-data
#   users yapa / yapb         Alice Lab <alice@example.test> / Bob Lab <bob@example.test>, no sudo
#   yaplab-node@<user>        their nodes, ~/.yapping, local API 17790 / 17791, linked + contacts
#   yaplab-xvfb@<user>        Xvfb :11 / :12 at 1440x900x24 (xauth cookie in ~/.Xauthority)
#   yaplab-wm@<user>          openbox
#   yaplab-vnc@<user>         x11vnc on 127.0.0.1:5911 / 5912
#   yaplab-term@<user>        alacritty (JetBrains Mono) → tmux session "claude" → Claude Code launcher
#   yaplab-browser@<user>     Chromium (Playwright build) on the node's sidebar page
#   /srv/yaplab/bin/lab       the computer-use CLI (see e2e/README.md)
#
# It never touches production: yapping.service, /opt/yapping, /var/lib/yapping,
# /etc/yapping, port 8787, cloudflared.

set -euo pipefail

HOST=hetzner-arm
LAB=/srv/yaplab
REMOTE=0 SYNC=1 APT=1 HARNESSES=1 RESTART=0
PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift ;;
    --remote) REMOTE=1 ;;
    --no-sync) SYNC=0 ;;
    --no-apt) APT=0; PASS+=(--no-apt) ;;
    --no-harnesses) HARNESSES=0; PASS+=(--no-harnesses) ;;
    --restart) RESTART=1; PASS+=(--restart) ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown flag $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }

# ── On the Mac: sync, then run the rest on the VM ─────────────────────────
if [ "$REMOTE" = 0 ]; then
  REPO="$(cd "$(dirname "$0")/../.." && pwd)"
  if [ "$SYNC" = 1 ]; then
    say "rsync $REPO → $HOST:$LAB/repo"
    ssh "$HOST" "sudo mkdir -p $LAB/repo"
    # No owner/group from the Mac; node_modules and builds stay on the VM
    # (excluded paths are protected from --delete).
    rsync -rlptz --delete --rsync-path="sudo rsync" \
      --exclude=.git/ --exclude=node_modules/ --exclude=.DS_Store \
      --exclude=/node/dist/ --exclude=/ui/dist/ --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' \
      --exclude=.env --exclude='.env.*' --exclude=.clerk/ --exclude=/.claude/ --exclude=/server/.data/ \
      --exclude=/plugins/claude/.claude-plugin/types/ --exclude=/plugins/claude/tsconfig.json --exclude=/plugins/pi/vendor/ \
      "$REPO/" "$HOST:$LAB/repo/"
  fi
  ssh -t "$HOST" "sudo bash $LAB/repo/e2e/lab/setup.sh --remote ${PASS[*]:-}"
  exit 0
fi

# ── On the VM, as root ────────────────────────────────────────────────────
[ "$(id -u)" = 0 ] || { echo "--remote must run as root" >&2; exit 1; }
REPO=$LAB/repo
BUN=/usr/local/bin/bun
SERVER_PORT=18787
SERVER=http://127.0.0.1:$SERVER_PORT
PLAYWRIGHT_VERSION=1.65.1
export PLAYWRIGHT_BROWSERS_PATH=$LAB/ms-playwright
export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64

#        user  who    name         email                display vnc  port
PEOPLE=("yapa alice Alice_Lab alice@example.test :11 5911 17790"
        "yapb bob   Bob_Lab   bob@example.test   :12 5912 17791")

# Production must stay exactly as it is.
PROD_PID=$(systemctl show -p MainPID --value yapping.service 2>/dev/null || echo none)
say "production yapping.service MainPID=$PROD_PID (not touched)"

APT_PKGS=(xdotool scrot wmctrl openbox alacritty fonts-jetbrains-mono fonts-inter x11-xserver-utils xauth x11-utils tmux rsync)
if [ "$APT" = 1 ]; then
  missing=()
  for p in "${APT_PKGS[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
  if [ ${#missing[@]} -gt 0 ]; then
    say "apt-get install ${missing[*]}"
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${missing[@]}"
  fi
fi

say "lab dirs, group and users"
mkdir -p $LAB/{bin,etc,shots,server-data,server-home} "$PLAYWRIGHT_BROWSERS_PATH"
getent group yaplab >/dev/null || groupadd --system yaplab
id yaplab >/dev/null 2>&1 || useradd --system --gid yaplab --home-dir $LAB/server-home --shell /usr/sbin/nologin yaplab
chown yaplab:yaplab $LAB/server-data $LAB/server-home
chmod 700 $LAB/server-data
chmod 1777 $LAB/shots

for row in "${PEOPLE[@]}"; do
  read -r U WHO NAME EMAIL DISP VNC PORT <<<"$row"
  NAME=${NAME//_/ }
  id "$U" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --comment "$NAME (yaplab)" "$U"
  usermod -aG yaplab "$U"
  # never sudo
  gpasswd -d "$U" sudo >/dev/null 2>&1 || true
  H=$(getent passwd "$U" | cut -d: -f6)
  cat >$LAB/etc/$U.env <<EOF
LAB_USER=$U
LAB_WHO=$WHO
LAB_NAME="$NAME"
LAB_EMAIL=$EMAIL
DISPLAY=$DISP
XAUTHORITY=$H/.Xauthority
VNC_PORT=$VNC
YAP_PORT=$PORT
YAP_HOME=$H/.yapping
YAP_SERVER=$SERVER
YAP_NO_BROWSER=1
YAP_WA_BIN=/nonexistent/yap-wa
PATH=$H/.local/bin:$H/.opencode/bin:$H/.bun/bin:/usr/local/bin:/usr/bin:/bin
EOF
  chmod 644 $LAB/etc/$U.env
  ln -sfn $LAB/etc/$U.env $LAB/etc/$WHO.env
  # X cookie: only this user (and root) can talk to their display.
  if ! sudo -u "$U" xauth -f "$H/.Xauthority" list "$DISP" 2>/dev/null | grep -q .; then
    sudo -u "$U" xauth -q -f "$H/.Xauthority" add "$DISP" . "$(mcookie)"
  fi
  sudo -u "$U" mkdir -p "$H/work" "$H/.config/openbox" "$H/.config/alacritty"
  sudo -u "$U" tee "$H/.config/alacritty/alacritty.toml" >/dev/null <<'EOF'
[window]
padding = { x = 10, y = 8 }
dimensions = { columns = 104, lines = 50 }
title = "Claude Code"

[font]
size = 11.0
normal = { family = "JetBrains Mono", style = "Regular" }
bold = { family = "JetBrains Mono", style = "Bold" }
italic = { family = "JetBrains Mono", style = "Italic" }

[colors.primary]
background = "#1e1f22"
foreground = "#e6e6e6"

[env]
TERM = "xterm-256color"
COLORTERM = "truecolor"
EOF
  sudo -u "$U" tee "$H/.config/openbox/rc.xml" >/dev/null <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <focus><focusNew>yes</focusNew><followMouse>no</followMouse></focus>
  <placement><policy>Smart</policy></placement>
  <theme><name>Clearlooks</name><titleLayout>NLIMC</titleLayout>
    <font place="ActiveWindow"><name>Inter</name><size>9</size><weight>Bold</weight></font>
    <font place="InactiveWindow"><name>Inter</name><size>9</size></font></theme>
  <desktops><number>1</number></desktops>
  <applications>
    <application class="yaplab-term"><position force="yes"><x>0</x><y>0</y></position>
      <size><width>930</width><height>900</height></size><focus>yes</focus></application>
    <application class="yaplab-chromium"><position force="yes"><x>930</x><y>0</y></position>
      <size><width>510</width><height>900</height></size></application>
  </applications>
</openbox_config>
EOF
  sudo -u "$U" tee "$H/.config/openbox/autostart" >/dev/null <<'EOF'
xsetroot -solid '#3b3f46' &
EOF
  sudo -u "$U" tee "$H/.tmux.conf" >/dev/null <<'EOF'
set -g default-terminal "tmux-256color"
set -ga terminal-overrides ",xterm-256color:Tc"
set -g mouse on
set -g history-limit 20000
set -g status off
EOF
done

say "lab tools in $LAB/bin"
install -m 755 "$REPO/e2e/lab/lab" $LAB/bin/lab
ln -sfn $LAB/bin/lab /usr/local/bin/lab
cat >$LAB/bin/chromium <<EOF
#!/bin/bash
# The Playwright build of Chromium (Ubuntu ships chromium only as a snap).
# --no-sandbox: this kernel restricts unprivileged user namespaces and the
# Playwright build has no setuid sandbox; the lab browser only opens 127.0.0.1.
bin=\$(ls -d $PLAYWRIGHT_BROWSERS_PATH/chromium-*/chrome-linux*/chrome 2>/dev/null | sort -V | tail -1)
[ -x "\$bin" ] || { echo "no chromium under $PLAYWRIGHT_BROWSERS_PATH" >&2; exit 1; }
exec "\$bin" --no-sandbox --test-type --disable-infobars --class=yaplab-chromium --user-data-dir="\$HOME/.config/yaplab-chromium" \\
  --no-first-run --no-default-browser-check --password-store=basic --disable-dev-shm-usage \\
  --disable-features=Translate,MediaRouter --disable-background-networking "\$@"
EOF
chmod 755 $LAB/bin/chromium
cat >$LAB/bin/claude-launch <<'EOF'
#!/bin/bash
# Claude Code with the yapping mod, for this lab user. Sits at the login
# prompt until a person logs in (the lab never logs any harness in).
cd "$HOME/work" 2>/dev/null || cd "$HOME"
export PATH="$HOME/.local/bin:$HOME/.opencode/bin:$HOME/.bun/bin:/usr/local/bin:$PATH"
if command -v claude >/dev/null; then
  claude --plugin-dir /srv/yaplab/repo/plugins/claude "$@"
else
  echo "Claude Code isn't installed for $USER (run e2e/lab/setup.sh)."
fi
echo
echo "Claude Code exited. This is a shell as $USER; run claude-launch to start it again."
exec bash -l
EOF
chmod 755 $LAB/bin/claude-launch
ln -sfn $LAB/bin/claude-launch /usr/local/bin/claude-launch

say "bun install + ui build"
for d in server node ui; do (cd $REPO/$d && $BUN install --frozen-lockfile >/dev/null 2>&1 || $BUN install >/dev/null); done
(cd $REPO/ui && $BUN run build >/dev/null)
test -s $REPO/ui/dist/sidebar.html
# Claude Code writes types/ and tsconfig.json into the mod's folder when it loads it.
chgrp -R yaplab $REPO/plugins/claude
chmod -R g+rwX $REPO/plugins/claude
find $REPO/plugins/claude -type d -exec chmod g+s {} +

if ! ls -d $PLAYWRIGHT_BROWSERS_PATH/chromium-*/chrome-linux*/chrome >/dev/null 2>&1; then
  say "Playwright Chromium $PLAYWRIGHT_VERSION → $PLAYWRIGHT_BROWSERS_PATH"
  tmp=$(mktemp -d)
  (cd "$tmp" && $BUN x playwright@$PLAYWRIGHT_VERSION install chromium)
  rm -rf "$tmp"
fi
chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH"

say "systemd units"
cat >/etc/systemd/system/yaplab-server.service <<EOF
[Unit]
Description=yaplab dev server (lab only, NOT production) on 127.0.0.1:$SERVER_PORT
After=network.target

[Service]
User=yaplab
Group=yaplab
WorkingDirectory=$REPO/server
Environment=YAP_DEV=1 PORT=$SERVER_PORT HOST=127.0.0.1 YAP_DATA=$LAB/server-data YAP_ORIGIN=$SERVER HOME=$LAB/server-home
ExecStart=$BUN run src/index.ts
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
cat >/etc/systemd/system/yaplab-node@.service <<EOF
[Unit]
Description=yaplab yapping node for %i
After=yaplab-server.service network.target

[Service]
User=%i
EnvironmentFile=$LAB/etc/%i.env
WorkingDirectory=/home/%i
ExecStart=$BUN $REPO/node/src/cli.ts daemon
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
cat >/etc/systemd/system/yaplab-xvfb@.service <<EOF
[Unit]
Description=yaplab Xvfb display for %i

[Service]
User=%i
EnvironmentFile=$LAB/etc/%i.env
ExecStart=/usr/bin/Xvfb \${DISPLAY} -screen 0 1440x900x24 -nolisten tcp -auth \${XAUTHORITY} -dpi 96
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
x_unit() { # name description exec [after]
  cat >/etc/systemd/system/yaplab-$1@.service <<EOF
[Unit]
Description=yaplab $2 for %i
BindsTo=yaplab-xvfb@%i.service
After=yaplab-xvfb@%i.service ${4:-}

[Service]
User=%i
EnvironmentFile=$LAB/etc/%i.env
WorkingDirectory=/home/%i
ExecStartPre=$LAB/bin/lab wait-x %i
ExecStart=$3
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
}
x_unit wm "openbox" "/usr/bin/openbox"
x_unit vnc "x11vnc (127.0.0.1 only)" "/usr/bin/x11vnc -display \${DISPLAY} -auth \${XAUTHORITY} -localhost -noipv6 -rfbport \${VNC_PORT} -forever -shared -nopw -quiet"
x_unit term "terminal with Claude Code" "/usr/bin/alacritty --class yaplab-term,yaplab-term -e tmux new-session -A -s claude $LAB/bin/claude-launch" "yaplab-wm@%i.service"
x_unit browser "Chromium on the sidebar" "$LAB/bin/chromium --window-position=930,0 --window-size=510,900 --app=http://127.0.0.1:\${YAP_PORT}/" "yaplab-wm@%i.service yaplab-node@%i.service"
systemctl daemon-reload

say "lab server"
systemctl enable -q yaplab-server.service
[ "$RESTART" = 1 ] && systemctl restart yaplab-server.service || systemctl start yaplab-server.service
for i in $(seq 1 60); do curl -fsS $SERVER/ >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS -o /dev/null $SERVER/ || { journalctl -u yaplab-server -n 30 --no-pager; exit 1; }

say "link nodes (device flow) and make them contacts (invite)"
for row in "${PEOPLE[@]}"; do
  read -r U WHO NAME EMAIL DISP VNC PORT <<<"$row"
  NAME=${NAME//_/ }
  H=$(getent passwd "$U" | cut -d: -f6)
  # Only a node that still has to be linked is stopped (linking writes its config.json).
  grep -qs '"deviceToken"' "$H/.yapping/config.json" || systemctl stop yaplab-node@$U 2>/dev/null || true
  sudo -u "$U" env HOME="$H" YAP_HOME="$H/.yapping" YAP_SERVER=$SERVER $BUN $REPO/e2e/lab/accounts.ts link "$EMAIL" "$NAME" "$WHO-lab"
done
YAP_SERVER=$SERVER $BUN $REPO/e2e/lab/accounts.ts befriend /home/yapa/.yapping /home/yapb/.yapping

say "nodes and desktops"
for row in "${PEOPLE[@]}"; do
  read -r U _ <<<"$row"
  for unit in node xvfb wm vnc; do systemctl enable -q yaplab-$unit@$U; done
  systemctl start yaplab-node@$U yaplab-xvfb@$U yaplab-wm@$U yaplab-vnc@$U
  [ "$RESTART" = 1 ] && systemctl restart yaplab-wm@$U || true
done

if [ "$HARNESSES" = 1 ]; then
  say "harnesses (not logged in)"
  for row in "${PEOPLE[@]}"; do
    read -r U _ <<<"$row"
    H=$(getent passwd "$U" | cut -d: -f6)
    run() { sudo -u "$U" -H env HOME="$H" PATH="$H/.local/bin:$H/.opencode/bin:$H/.bun/bin:/usr/local/bin:/usr/bin:/bin" bash -lc "$1"; }
    run 'command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash'
    run "claude mcp get yapping >/dev/null 2>&1 || claude mcp add -s user yapping -e YAP_HOME=$H/.yapping -e YAP_SERVER=$SERVER -- $BUN $REPO/node/src/cli.ts mcp"
    run 'command -v opencode >/dev/null || curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path' || echo "opencode install failed for $U" >&2
    run "command -v pi >/dev/null || $BUN install -g @earendil-works/pi-coding-agent" || echo "pi install failed for $U" >&2
  done
fi

say "terminal + Chromium on each desktop"
for row in "${PEOPLE[@]}"; do
  read -r U _ <<<"$row"
  systemctl enable -q yaplab-term@$U yaplab-browser@$U
  if [ "$RESTART" = 1 ]; then systemctl restart yaplab-node@$U yaplab-term@$U yaplab-browser@$U
  else systemctl start yaplab-term@$U yaplab-browser@$U; fi
done

NOW_PID=$(systemctl show -p MainPID --value yapping.service 2>/dev/null || echo none)
say "done. production MainPID $PROD_PID → $NOW_PID"
[ "$PROD_PID" = "$NOW_PID" ] || echo "WARNING: production MainPID changed" >&2
lab status || true
