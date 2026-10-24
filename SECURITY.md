# Security

Pitwall runs commands on your computers when you ask it to, so security reports matter.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private report: **Security** tab, then **Report a vulnerability**. Include what you found, how to reproduce it, and what you think it allows.

You will get an answer within a few days. Fixes are released as soon as they are tested, and the report is credited unless you prefer not.

## What counts

Anything that lets someone without an invite join, approve work they should not, make an agent edit files without an owner's approval, read another person's token, or turn a talk task into a work task.

## What Pitwall already does

- Tokens are random, stored as SHA-256 hashes, kept in files with mode `0600`, and never logged or put in a URL.
- Claude never runs with a permission bypass.
- Peer work waits for an owner's approval in the product, not in chat.
- Web text is rendered with `textContent`, and links only when they are HTTPS with no user info.

Run Pitwall on a network you trust, or behind HTTPS and an access layer such as Tailscale. Do not expose a relay to the open internet without one.
