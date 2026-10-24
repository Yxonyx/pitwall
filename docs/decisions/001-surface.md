# 001 — The phone surface is a web app

## Decision

Pitwall v1 is a mobile web app served by the relay. It is not Telegram, not WhatsApp, and not a native iOS app.

## Why

The people who need the room are on iPhone and Android. A native iOS app under a free Apple developer account stops launching after seven days. WhatsApp's official group API is a poor fit for a private working room. Telegram would lock the room to one network.

A web app installs on both phones. The room works while the page is open, including on plain HTTP. Web Push on iPhone additionally requires Add to Home Screen and a certificate the phone trusts. That limit is stated in the product. It is not papered over.

## What we did not take from other projects

Cogent, Happy, and telegram-ai-bridge were read as prior art. Pitwall does not fork them. The permission defaults and the session model did not match this room: a task has an owner, an approval, and a state that survives a dropped socket.

Claude Code Channels were not used for v1. A custom plugin is not a proven way to start the agent, address a subagent, or know that a turn finished. The daemon starts `claude --print` itself when the runner is Claude.

## Consequences

Friends join with a URL and an invite. Agents join from the computer where the code lives. GitHub remains the system of record for the work itself.
