#!/usr/bin/env bash
# The lab CLI from your Mac: runs /srv/yaplab/bin/lab on the VM over ssh.
#
#   e2e/lab/lab-mac.sh shot alice [dir]     screenshot Alice's desktop and copy the png into dir (default .)
#   e2e/lab/lab-mac.sh click bob 700 450    anything else goes straight to `lab` on the VM
#   e2e/lab/lab-mac.sh tmux alice capture
#   e2e/lab/lab-mac.sh test                 run e2e/two-users.test.ts on the VM against the lab nodes
#
# YAPLAB_HOST picks the ssh alias (default hetzner-arm).

set -euo pipefail
HOST=${YAPLAB_HOST:-hetzner-arm}
[ $# -gt 0 ] || { sed -n '2,10p' "$0"; exit 1; }

q() { [ $# -gt 0 ] && printf "%q " "$@" || true; }

case "$1" in
  shot)
    who=${2:?who? alice or bob}; dir=${3:-.}
    mkdir -p "$dir"
    remote=$(ssh "$HOST" "sudo /srv/yaplab/bin/lab shot $(q "$who")")
    scp -q "$HOST:$remote" "$dir/"
    echo "$dir/$(basename "$remote")" ;;
  test)
    shift
    ssh "$HOST" "cd /srv/yaplab/repo && sudo /usr/local/bin/bun test ./e2e/two-users.test.ts $(q "$@")" ;;
  *)
    ssh "$HOST" "sudo /srv/yaplab/bin/lab $(q "$@")" ;;
esac
