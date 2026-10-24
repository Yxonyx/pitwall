# Engineering

Raj is a small Node 24 program. The style is the style of the file you are editing.

- TypeScript is strict. Imports that Node loads use a `.js` suffix.
- The protocol in `src/protocol` is pure. The web app may import it. It must not import `node:` or the relay.
- SQLite uses `node:sqlite`. Writes that must commit together use `BEGIN IMMEDIATE`. Broadcast after commit, not inside the transaction.
- Secrets are random, stored as SHA-256, and written to files mode `0600`. Directories that hold them are mode `0700`. Do not log a token.
- Do not put a token in a query string.
- Render text with `textContent`. A link is rendered only when it is HTTPS and has no userinfo.
- Claude is never started with a permission bypass. Talk is plan. Approved work is accept-edits. Echo is the default.
- Tests live next to the code. The end-to-end test starts a real relay on port 0. Do not mock the WebSocket there.
- Do not claim a test passed unless you ran it.
- A pull request has a Verified section. Say what you did not run.
- Keep a change small. Do not refactor the room on the way to a bugfix.
- `pnpm guard` rejects private keys, GitHub tokens, and a Claude permission bypass in non-test source.

Commands:

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm guard
```
