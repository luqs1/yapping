#!/usr/bin/env bash
# Drive pi + the yapping extension inside a private tmux server and capture screens.
#
#   plugins/pi/test/tmux-capture.sh OUTDIR [COLS] [ROWS]
#
# Writes OUTDIR/<step>.txt (plain) and OUTDIR/<step>.ans (with truecolour SGR).
# Uses the zero-cost scripted model so the prompt "tell Finn …" really runs yap_send.
set -euo pipefail
OUT=${1:?outdir}; COLS=${2:-160}; ROWS=${3:-46}
HERE=$(cd "$(dirname "$0")" && pwd)
PLUGIN=$(cd "$HERE/.." && pwd)
PI=$(which -a pi | grep / | head -1)
SOCK=yaptest-$$
RELAY=${YAP_RELAY:-http://localhost:7788}
T="tmux -L $SOCK"
mkdir -p "$OUT"
cleanup() { $T kill-server 2>/dev/null || true; }
trap cleanup EXIT

$T -f /dev/null start-server \; set -s extended-keys on \; set -s extended-keys-format csi-u \; new-session -d -s yap -x "$COLS" -y "$ROWS" \
  "env TERM=xterm-256color COLORTERM=truecolor YAP_RELAY=$RELAY $PI -ne -e $PLUGIN -e $PLUGIN/test/scripted-model.ts --provider yap-test --model scripted --no-session --offline"
$T set -g default-terminal "tmux-256color" >/dev/null
$T set -ga terminal-overrides ",*:Tc" >/dev/null
$T set -sg escape-time 10 >/dev/null

snap() { $T capture-pane -p -t yap > "$OUT/$1.txt"; $T capture-pane -p -e -t yap > "$OUT/$1.ans"; echo "--- $1"; cat "$OUT/$1.txt"; }
keys() { $T send-keys -t yap "$@"; }
lit() { $T send-keys -t yap -l "$1"; }

sleep 5
snap 00-pi-widget
# the agent path: prompt → yap_send (exact words) → relay
lit "tell Finn I'm running late"; sleep 0.3; keys Enter; sleep 3
snap 01-tool-call
# open the Discord view on Finn and run the demo flow
lit "/yap finn"; sleep 0.5; keys Enter; sleep 0.4; keys Enter; sleep 2
snap 02-yap-open
lit "hey can you take a look at my demo?"; sleep 0.2; keys Enter; sleep 1
snap 03-reading
sleep 2
snap 04-waiting
sleep 4.5
snap 05-talking
sleep 0.35
snap 05b-talking
sleep 6
snap 06-ready
lit "o"; sleep 0.5
snap 07-observe
keys Escape; sleep 0.3
lit "y"; sleep 2
snap 08-approved
keys Tab; sleep 0.6
snap 09-fall26
keys Tab; sleep 0.6
snap 10-bridges-theo
keys Down; sleep 0.6
snap 11-mum-off
keys C-s; sleep 0.8
snap 12-mum-on
keys C-s; sleep 0.5
keys Escape; sleep 1
snap 13-closed
# a message arriving while closed → notification + widget
curl -s -X POST "$RELAY/api/action?user=finn" -H 'content-type: application/json' \
  -d '{"t":"send","chatId":"dm-finn","text":"np! grab me a flat white on the way"}' >/dev/null
sleep 1.5
snap 14-notified
