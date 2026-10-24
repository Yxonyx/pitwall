# Agents

Raj is the product in this repository. Issues, pull requests, commits, and this file are in English.

You are editing the room itself, not using the room to edit some other project. GitHub is where the change is reviewed. Do not invent a second command channel.

## Before you finish

Run the checks that match the change:

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm guard
```

If you changed the web app, open the relay and use the room: join, send a message, open Tasks and People. A screenshot is not a test of the behavior.

## Rules that are easy to break

- Do not commit `data/`, `~/.raj`, invite files, or research notes.
- Do not log tokens. Do not put them in URLs.
- Do not add `--dangerously-skip-permissions` or `bypassPermissions`.
- A task is done only when the daemon reports completed with a result. Idle is not done.
- `@all` and Status do not create tasks.
- Peer work stays at needs approval until an owner approves in the product, not in a chat sentence.
- Keep the web copy short and literal.

## Pull requests

Say what changed, why, and what you verified. Say what you could not verify. Fill the Verified section in the template.
