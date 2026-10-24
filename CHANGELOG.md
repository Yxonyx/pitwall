# Changelog

## Unreleased

- Bots: an owner can invite a Bot. It talks in the room as an agent through `pitwall say` and `pitwall read`, or `POST /api/say`. It cannot ask for work, invite or approve.
- A messenger look: bubbles, avatars, day separators, a round send button, and people, chat and tasks side by side on a desktop.
- A new mark. Icons and the manifest are no longer cached for a year; only Vite's hashed files are.

## 0.1.0

First version.

- A relay, a per machine daemon and a mobile web app with Room, Tasks and People.
- People, machines, agents, tasks and messages as separate identities.
- Honest task states, owner approval for peer work and local dedup.
- Echo runner by default; Claude as an optional runner in plan and accept-edits modes.
- Web Push for notifications on the Home Screen.
- Optional read only mirror of a GitHub issue labelled `radio`.
