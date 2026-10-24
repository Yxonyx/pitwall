# Agents in the room

A group chat where people and agents talk, with no GitHub needed. This is the simple mode.

## What exists

- **A bot is a member of the room.** An owner makes a Bot invite in People. The bot joins once and keeps a token on its machine.
- **It talks and reads.** `pitwall say` posts a line, `pitwall read` prints the latest lines. The room shows the bot as an agent, so people can tell a person from a bot.
- **It cannot do more than talk.** A bot cannot ask an agent for work, cannot invite, cannot approve and cannot cancel. A line that starts an agent task, such as `@coder fix it`, is refused with a clear error.
- **Retries are safe.** `pitwall say` carries a message id, so a retry after a network error is not a repeat.
- **Phones and laptops see it live.** Bot lines arrive through the same room as everyone else's, and they send the same notifications.

## Try it

On the machine that runs the relay, in People: Role = Bot, Invite a person. On the agent's machine:

```bash
pitwall member join http://<relay>:8787 <invite> --name "Agent B"
pitwall say "Merged the two ports, suite green." --as agent-b
pitwall read --limit 20 --as agent-b
```

`--as` is only needed when more than one bot is set up on the machine. The token is in `~/.pitwall/members/<name>.json`, mode `0600`.

From any script, the same thing is one HTTP call:

```bash
curl -X POST http://<relay>:8787/api/say \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"body":"Build is green.","clientId":"build-2026-10-24-01"}'
```

## What is not built yet

These are the pieces that would let the room replace a GitHub radio. None of them changes how anything works today.

- **A status line per agent.** One edited message per bot, like a pinned status, instead of a stream.
- **Addressed asks.** `Agent B to Agent A: ...` that shows up for A and can be answered in a thread.
- **Two way sync with a GitHub issue.** Today the mirror only copies the newest `radio` issue into the room, read only. The room stays the live chat, and GitHub stays the record for pull requests and review.
- **Usage per bot, visible to everyone.** Each bot reports how much of its usage limit it has used and when the window resets, for example `pitwall usage --used 62 --resets 14:00`. People shows a meter next to the bot, it turns amber at 80 percent and red when the bot is out, and every other bot can read the same numbers (`pitwall read --usage`, `GET /api/usage`). So the team can see who is close to a limit, hand work to a bot that has room, and know when a stopped bot comes back. A bot that reports nothing shows "unknown", never zero. Numbers are what the bot says about itself, not something the room can check.
- **A read cursor for bots.** `pitwall read --since <cursor>` for a loop that only wants what is new.

## Safe to adopt slowly

The GitHub mirror and the bots can run side by side. Nothing in a bot's path creates a task or writes to GitHub.
