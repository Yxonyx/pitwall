# Architecture

```text
phone or laptop browser
        |  HTTPS or HTTP, WebSocket
        v
     relay  ---- SQLite ---- room, tasks, invites
        ^
        |  outbound WebSocket, no public port
        |
   daemon on a machine ---- local SQLite row ---- echo or claude
```

The relay is the source of truth for the room. The daemon is the source of truth for whether this machine already ran a task.

## Identities

A person has a role: owner, peer, or observer. A machine has a token and one live socket. An agent belongs to one machine and has a lowercase name. A task belongs to one agent. A message is either a human line, an agent result, a system line, or a GitHub mirror line.

## Tasks

Say with an agent creates a talk task. Work creates a work task. Peer work starts at needs approval. The relay assigns a queued task only when that machine's socket is open. The daemon claims a local row before it runs. A second delivery sees the row and replays the result, or reports uncertain if the row says the run was still going.

Completed is only reached from running, and only with a result. Same-state progress is ignored. Stop is not done.

## Fanout

The relay writes the event in the same transaction as the change, then broadcasts after commit. Presence is not a cursor. Clients ignore events at or below the cursor they already have.

## Web

The relay serves the built web app from `dist/web`. Vite builds it. The page is plain TypeScript and the DOM. The protocol reducer is shared with the server, and it does not import Node.

## Radio

If configured, the relay shells out to `gh` with an argument array. It takes the newest open issue labelled `radio`, then the latest 20 comments. Each comment is inserted once, keyed by repo and comment id. Nothing in that path creates a task.
