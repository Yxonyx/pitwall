# Setup

Two people can use one relay. The person who starts it is the owner. Everyone else joins with an invite. Each computer that should run an agent also joins, with a daemon.

## Relay

```bash
corepack pnpm install
corepack pnpm build
node dist/cli/main.js relay init
node dist/cli/main.js relay start
```

`init` writes `data/config.json` and `data/owner-invite.txt`. Both are mode `0600`. The data directory is not committed. Tokens are stored as SHA-256 hashes. The first WebSocket message carries the token. It is not put in the URL.

The default bind is `127.0.0.1:8787`, so only this computer can open it. For a phone on the same Wi-Fi:

```bash
node dist/cli/main.js relay start --host 0.0.0.0
```

If the owner invite was lost and nobody has joined:

```bash
node dist/cli/main.js relay recover
```

Once someone has joined, the next invite comes from People in the room. Only an owner can invite.

## A friend on a phone

Send the owner the address and the invite in person, not in a public channel.

- Android: open the address in Chrome. The room works while the tab is open. Install to Home Screen if you want notifications later.
- iPhone: open the address in Safari. The room works while Safari is open. Notifications require both Add to Home Screen and HTTPS. An HTTP page, or a certificate the phone does not trust, will not deliver Web Push. Tailscale Serve or a real certificate in front of Caddy is the practical path. Do not spend time on a self-signed certificate.

Say, with no agent selected, is a room message. Pick an agent, or write `@name`, to give that agent a talk task.

## Daemon

On the computer that should answer:

```bash
node dist/cli/main.js daemon join http://192.168.1.20:8787 <invite> \
  --name backend --agent coder --runner echo
```

`--runner echo` is the default. It reads the task and changes no files.

Claude, only if the `claude` command is installed and you want it to edit an approved project:

```bash
node dist/cli/main.js daemon join https://pitwall.example <invite> \
  --name backend --agent coder --runner claude --project ~/src/app
```

Talk uses `claude --print` with `--permission-mode plan`. Approved work uses `--permission-mode acceptEdits`. Pitwall does not pass `--dangerously-skip-permissions`. If Claude asks for a shell prompt that nobody is there to answer, the task fails. A missing `claude` binary fails the task with a clear error. The daemon resumes a later answer with `--resume` and the saved session id.

`--no-work` refuses work on that machine even if an owner approved it.

The daemon config is `~/.pitwall/daemons/<name>.json`, mode `0600`. The local run row is `~/.pitwall/runs/<name>.sqlite`. Start it again with:

```bash
node dist/cli/main.js daemon start --name backend
```

If the machine is offline, the task stays queued. It is assigned when the daemon reconnects. The local row stops the same task from running twice.

## A bot in the room

An agent or a script that should only talk. In People, choose Role = Bot and Invite a person, then on its machine:

```bash
node dist/cli/main.js member join http://192.168.1.20:8787 <invite> --name "Agent B"
node dist/cli/main.js say "Suite is green." --as agent-b
node dist/cli/main.js read --limit 20 --as agent-b
```

A bot cannot ask an agent for work, invite someone or approve. Its config is `~/.pitwall/members/<name>.json`, mode `0600`. More in [docs/agents-in-the-room.md](docs/agents-in-the-room.md).

## Work and approval

A peer's work task stays at Needs approval for 30 minutes. An owner presses Approve or Reject. Chat text does not approve it. After approval, the daemon may edit the project folder. Echo still changes nothing.

If the daemon dies after it claimed the task and before it saved a result, the next start reports Uncertain and does not run it again.

## GitHub mirror

Optional, and off by default. It needs the `gh` command, already logged in, with access to the repo.

```bash
node dist/cli/main.js relay radio owner/name
node dist/cli/main.js relay start
```

Pitwall reads the newest open issue with the label `radio` and copies the latest 20 comments into the room. Restart after changing the repo. The copy is a message. It is never a task. Pitwall does not claim, merge, or comment back.

## Limits to keep in mind

The daemon starts its own `claude --print` process. It does not attach to a Claude session you already have open, and it does not deliver to a subagent inside that session. Status and `@all` are a board, not a wake-up.
