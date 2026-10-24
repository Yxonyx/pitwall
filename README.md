# Raj

Raj is a shared room for people and the coding agents on their machines.

A person talks in the room. A small daemon on a computer runs the named agent and reports an honest state. GitHub stays the place for pull requests, review, and evidence. Raj is the live room, and the delivery of a task to the machine that can do it.

The phone surface is a web app. Add it to the Home Screen. It is not a native iOS app, because a free Apple developer account expires those in seven days.

## What v1 does

- One relay holds the room. Each machine runs a daemon that connects out. The daemon does not open a public port.
- People, machines, agents, tasks, and messages are separate.
- Address an agent as `@name` when the name is unique, or `@machine/agent`.
- Say, with no agent, is a human message. Say, with an agent, is a talk task and does not edit files.
- Work is a task that may edit. A peer's work waits for an owner. An owner's work starts. An agent cannot approve. The word "yes" in chat is not approval.
- States are queued, delivered, accepted, running, needs input, needs approval, completed, failed, cancelled, and uncertain. Completed requires a result. A crash between claim and a result becomes uncertain and is not started again.
- Delivery is at least once. The daemon dedups with a local row.
- The default runner is echo. It changes nothing. Claude is optional: talk uses plan mode, approved work uses accept-edits. Unattended shell prompts fail the task.
- An optional read-only mirror can copy the newest open GitHub issue labelled `radio` into the room. Those messages never become tasks. It is off until you set it.

## What v1 does not do

- It does not type into a live Claude Code window, a Channels plugin, or the Claude app on a phone.
- It does not address subagents. The daemon owns the worker.
- It does not promise that a shell command runs exactly once.
- It does not send Telegram or WhatsApp messages.
- `@all` and Status do not wake agents or create tasks. They post a board.
- Agents do not create tasks, and they cannot approve work.
- Observers cannot post.
- iPhone notifications work only after Add to Home Screen, and only on HTTPS. Self-signed certificates are not worth setting up. The room itself still works over HTTP while the page is open.
- A stopped or idle agent is not done.

## Run it

Node 24. From this repo:

```bash
corepack pnpm install
corepack pnpm build
node dist/cli/main.js relay init
node dist/cli/main.js relay start
```

Open the printed address, join with the owner invite, then invite a machine from People. On that computer:

```bash
node dist/cli/main.js daemon join http://127.0.0.1:8787 <invite> --name backend --agent coder
```

The daemon keeps running until Ctrl-C. Say `@coder hello` in the room. Echo finishes the task and changes nothing.

For a phone on the same network, restart with `--host 0.0.0.0`. For a friend on another network, put the relay on an address both of you can reach, such as Tailscale. See [SETUP.md](SETUP.md).

## Development

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm guard
```

The license is MIT.
