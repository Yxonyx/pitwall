# Plan

Pitwall v1 is a relay, a per-machine daemon, and a mobile web app. This file is the scope. It is not a promise about later weeks.

## In this version

- English product, issues, pull requests, and agent instructions.
- Identities: person, machine, agent, task, message.
- Honest task states, owner approval for peer work, and local dedup.
- Echo runner as the proven path. Claude as an optional runner with a narrow permission mode.
- Web app with Room, Tasks, and People. Add to Home Screen.
- Tests for the protocol, the daemon decisions, and one room with a real WebSocket.
- Optional read-only GitHub radio mirror.

## Not in this version

- Telegram, WhatsApp, or a native iOS app.
- Injecting into a live Claude window or the Claude phone app.
- Direct subagent addresses.
- Agents creating tasks, or agents approving work.
- Exactly-once shell execution.
- Multi-relay federation.
- A hosted Pitwall. You run the relay yourself.

## Later, only with a test that shows the gap

- A hook from a live Claude session, if delivery can be proven rather than assumed.
- Richer notification actions.
- More than one relay, if one room is no longer enough.

## How a change lands

Small change, a test for the behavior, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm guard`. The pull request says what was verified and what was not. Secrets stay out of git. `data/`, daemon configs, and invite files are local.
