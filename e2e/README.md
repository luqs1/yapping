# yaplab: two people, two desktops, one VM

A reusable GUI test lab for yapping. Two Linux users on the VM (`hetzner-arm`)
each get a real yapping node built from **your working tree**, a desktop you can
watch over VNC, Claude Code with the yapping mod, and Chromium on their sidebar.
They're linked to a throwaway dev-mode server and are contacts through a real
invite. The same VM runs yapping production; the lab never touches it.

| | Alice | Bob |
| --- | --- | --- |
| Linux user | `yapa` | `yapb` |
| account | Alice Lab `alice@example.test` | Bob Lab `bob@example.test` |
| node local API | `127.0.0.1:17790` | `127.0.0.1:17791` |
| node home | `/home/yapa/.yapping` | `/home/yapb/.yapping` |
| X display (1440x900) | `:11` | `:12` |
| VNC | `127.0.0.1:5911` | `127.0.0.1:5912` |

Lab server: `yaplab-server.service`, `YAP_DEV=1`, `127.0.0.1:18787`, data in
`/srv/yaplab/server-data`. Everything listens on 127.0.0.1 only.

Units (all `systemctl … yaplab-*`): `yaplab-server`, and per user
`yaplab-node@`, `yaplab-xvfb@`, `yaplab-wm@` (openbox), `yaplab-vnc@` (x11vnc),
`yaplab-term@` (alacritty → tmux session `claude` → Claude Code launcher),
`yaplab-browser@` (Chromium in app mode on the node's sidebar).

## Build or update it

From the repo on your Mac:

```sh
e2e/lab/setup.sh              # rsync this tree to /srv/yaplab/repo, then build everything missing
e2e/lab/setup.sh --restart    # same, and restart server, nodes and apps so new code runs
e2e/lab/setup.sh --help       # flags: --host, --no-sync, --no-apt, --no-harnesses, --restart
```

It is idempotent. The sync skips `.git`, `node_modules`, builds, `*.db` and
secrets; `bun install` and the ui build run on the VM. `--restart` restarts the
terminals too, which ends any Claude Code session running in them.

## Run the tests

```sh
e2e/lab/lab-mac.sh test       # e2e/two-users.test.ts on the VM, against the two lab nodes
```

or on the VM: `cd /srv/yaplab/repo && sudo bun test ./e2e/two-users.test.ts`.
It sends real (encrypted) messages between Alice and Bob through the lab server:
delivery both ways, reactions, `set_sees` reaching the other side, an agent send
refused with `sees_off` in a hidden chat, propose → approve arriving with
`assistedBy`, `create_chat`, and a scan of the server DB for plaintext. Every
run uses fresh random text, so it can run any number of times.

The unit suites run on the synced tree too:
`ssh hetzner-arm 'cd /srv/yaplab/repo/server && bun test'` (and `…/node`).

## Watch and drive the desktops

Watch with any VNC viewer through an ssh tunnel:

```sh
ssh -N -L 5911:127.0.0.1:5911 -L 5912:127.0.0.1:5912 hetzner-arm
open vnc://127.0.0.1:5911     # Alice (macOS Screen Sharing; it may ask for a password: leave it empty)
open vnc://127.0.0.1:5912     # Bob
```

Drive them from the Mac (`e2e/lab/lab-mac.sh` runs `/srv/yaplab/bin/lab` on the VM):

```sh
e2e/lab/lab-mac.sh shot alice ./shots        # screenshot → scp into ./shots, prints the local path
e2e/lab/lab-mac.sh click bob 1180 160
e2e/lab/lab-mac.sh dclick alice 400 300      # also: rclick, move (hover)
e2e/lab/lab-mac.sh type alice "hello Bob"
e2e/lab/lab-mac.sh key alice Return          # xdotool keysyms: ctrl+l, ctrl+shift+t, Escape…
e2e/lab/lab-mac.sh scroll bob 1180 500 down 5
e2e/lab/lab-mac.sh open bob /srv/yaplab/bin/chromium --app=http://127.0.0.1:17791/
e2e/lab/lab-mac.sh windows alice             # wmctrl -lGx
e2e/lab/lab-mac.sh focus alice "Claude Code"
e2e/lab/lab-mac.sh tmux alice capture        # exact text of Alice's Claude Code screen (capture 200: scrollback)
e2e/lab/lab-mac.sh tmux alice send "/yap" Enter
e2e/lab/lab-mac.sh rpc bob inbox             # Bob's node local API
e2e/lab/lab-mac.sh status
e2e/lab/lab-mac.sh restart apps              # server | nodes | apps | all
```

Coordinates are display pixels (1440x900). The terminal fills x 0–930 and the
sidebar x 930–1440.

## Log Claude Code in (the lab never does)

Each terminal starts at Claude Code's first-run screens. Either:

- **On the desktop:** connect over VNC, pick a theme, choose a login method,
  open the URL it shows in a browser on your Mac, and paste the code back into
  the VNC window. (`lab-mac.sh tmux alice capture` prints the URL as text;
  `lab-mac.sh tmux alice send "<code>" Enter` types the code.)
- **Over ssh:** `ssh -t hetzner-arm sudo -iu yapa` then `claude` and `/login`
  (same for `yapb`). Credentials land in that user's `~/.claude`, so then
  `lab-mac.sh restart apps` (or `/exit` and `claude-launch` in the desktop
  terminal) picks them up.

The yapping MCP server is already configured for both users
(`claude mcp list` shows `yapping … ✔ Connected`), and the launcher
(`/srv/yaplab/bin/claude-launch`) runs `claude --plugin-dir /srv/yaplab/repo/plugins/claude`.
opencode and pi are installed for both users (`~/.opencode/bin/opencode`, `~/.bun/bin/pi`)
with no provider configured.

## Reset

Fresh accounts, empty chats (keys, devices and messages are thrown away):

```sh
ssh hetzner-arm 'sudo systemctl stop "yaplab-*" && sudo rm -rf /srv/yaplab/server-data/* /home/yapa/.yapping /home/yapb/.yapping'
e2e/lab/setup.sh --no-apt --restart
```

Remove the lab entirely:

```sh
ssh hetzner-arm 'sudo systemctl disable --now "yaplab-*"; sudo rm -f /etc/systemd/system/yaplab-*; sudo systemctl daemon-reload;
  sudo userdel -r yapa; sudo userdel -r yapb; sudo userdel yaplab; sudo rm -rf /srv/yaplab /usr/local/bin/lab /usr/local/bin/claude-launch'
```

## Notes

- Chromium is Playwright's Chrome for Testing build (Ubuntu only ships chromium
  as a snap), run with `--no-sandbox` because this kernel restricts unprivileged
  user namespaces. It only ever opens 127.0.0.1 pages.
- The VNC servers have no password; they listen on 127.0.0.1 only, so reach
  them through ssh.
- The nodes run with `YAP_WA_BIN` pointing nowhere, so no WhatsApp bridge runs.
