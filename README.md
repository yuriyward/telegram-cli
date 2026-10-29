# telegram-cli

A command-line client for a personal Telegram account, built for AI agents: JSON on stdout, diagnostics on stderr. It finds chats, reads, searches and exports history (Markdown or JSON, with photos), downloads attachments, manages native drafts, and sends messages or reactions only when the caller passes `--user-confirmed`.

## Install

Requires [Bun](https://bun.sh) 1.3.14 or newer.

```bash
bun install
cp .env.example .env   # fill TELEGRAM_API_ID and TELEGRAM_API_HASH from https://my.telegram.org
bun src/cli.ts auth login --interactive --qr
```

The session is stored in `~/.local/state/telegram-cli` (change it with `--session-dir`).

## Use

```bash
bun src/cli.ts --help
bun src/cli.ts chats list --kind person --unread --all
bun src/cli.ts messages export --chat @example --since 7d --format markdown
```

Agent instructions: `AGENTS.md`. Product intent: `PRODUCT.md`. Decisions: `knowledge/`.

## Develop

```bash
bun run check   # lint, format, typecheck, tests, build
```

## License

[AGPL-3.0-or-later](LICENSE). If you distribute a modified version, or run one as a service others use, you must publish its source under the same license.
