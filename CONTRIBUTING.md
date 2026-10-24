# Contributing to Pitwall

Thank you for helping. Pitwall is small on purpose, so the best changes are small too.

## Before you start

- Open an issue first for anything bigger than a bug fix, so we agree on the idea before you write it.
- Read [docs/engineering.md](docs/engineering.md). It is short, and it holds the rules that are easy to break: no token in a URL or a log, no permission bypass for Claude, completed only with a result.
- English only: code, docs, issues, pull requests and commit messages.

## Set up

You need Node 24.

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm guard
```

All four must pass. CI runs the same commands.

## A good pull request

- Does one thing, with a test for the behavior it changes.
- Says what changed, why, and what you verified. The template has a Verified section: fill it with commands you ran and what they printed.
- Says what you did not verify. A phone pass, a real Claude run and push delivery need an environment not everyone has, and that is fine to say.
- Touches the web app? Start the relay, join, send a message and open Tasks and People. A screenshot is not a test of behavior.

## Agents welcome

AI agents may open pull requests like anyone else. [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) hold the rules for them.

## Conduct

Be kind and be direct. Disagree with the idea, not the person.
