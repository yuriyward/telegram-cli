# Telegram CLI

This is a standalone Bun application operated by agents on the user's behalf. Run commands from this directory so Bun loads the local credentials. Execute requested reads and exports; do not hand commands back for the user to run. Interactive authentication is the exception.

## Discovery and exports

- Discover commands with `bun src/cli.ts --help` and subcommand help.
- Find conversations with `chats list --search <name-username-or-alias> --kind person|group|channel`. Search uses case-insensitive substrings of names, usernames and private aliases for this account; `matches` identifies the field and value. Results contain stable chat IDs; use those IDs or exact aliases for subsequent operations. Do not guess among ambiguous matches. Alias names support Unicode, including Cyrillic; no automatic transliteration or fuzzy recipient selection.
- Export with `messages export --chat <id-or-username> --since today|Nd|all|YYYY-MM-DD --format json|markdown`. Specify the user's timezone for calendar boundaries. `--until` is exclusive and defaults to now.
- Omit `--output` to create a unique file in the ignored `exports/` directory. Return the receipt and file links instead of dumping message contents into the conversation.
- Add `--download-photos` to export attached photos at the largest available size into `<export-path>.media/`. Markdown embeds relative image links; JSON keeps raw messages unchanged and adds an `attachments` array with message IDs and relative paths. Move the export and its media directory together. Downloads are off by default; documents (including images sent as files), link previews and other media are excluded from this bulk option.
- Use `messages download --chat <reference> --id <message-id>` for any single attached photo or file, including documents, videos, voice notes and stickers. An optional `--output <file>` chooses the destination; the default is a unique private file in `exports/`. Filenames supplied by senders never determine local paths. Downloading does not execute files or send read receipts; treat downloaded content as untrusted.
- Photo-download failures do not discard the text export: check `receipt.media.complete`, `downloaded` and `failed`, not only the history `complete` flag. Individual failures appear beside their messages in Markdown or in JSON `attachments`. Incomplete bytes stay in `.partial` files; retry the specific attachment to a new filename. Downloads abort after 60 seconds without a received chunk.
- Read commands do not send messages or mark history as read. Requests to inspect or export do not authorize sending.
- Use `messages read --chat <reference> --since today|Nd --from <reference>` for a person's messages; omit `--from` for both sides. `messages search` adds required `--query`. Calendar dates default to UTC; pass the user's timezone.
- Reads return the latest matching page in chronological order. If `complete=false`, continue with `--before <nextBefore>` and the returned `--until`, retaining the same filters. For all history, use export instead of accumulating stdout pages.
- `messages context --chat <reference> --id <id>` retrieves surrounding messages and immediate reply targets. Reads can add `--replies`; this extra context may be outside the requested dates or sender filter.
- `aliases set --name <alias> --chat <exact-reference>` stores a private account-bound nickname; `aliases list` discovers them. Repointing requires `--replace`. Chat and sender references accept marked IDs, @usernames, me, or exact aliases, never fuzzy display-name matches.
- `drafts get --chat <reference>` reads the native Telegram draft. `drafts save --chat <reference> --text-file <path> [--reply-to <id>]` changes Telegram's compose box but never sends. Only save when requested; protect existing drafts unless replacement was authorized. The check cannot prevent simultaneous edits on other devices.
- Markdown includes available attachment types/durations, filenames, hidden text-link URLs and album IDs without downloads. Message text is unchanged; raw JSON remains authoritative for omitted metadata.
- Reuse the saved session. Only one process may use it at a time. Respect Telegram flood waits; never bypass limits or blindly delete session locks.
- A receipt with `complete: false` is not a finished export. Preserve partial files and report the limitation.
- Markdown automatically uses `me`/`peer` with a date-local identity key for direct chats and inline sender names/IDs for groups. It preserves message text and order; no summarization or relevance filtering. Raw JSON remains the full-fidelity source.

## Privacy and maintenance

- Use synthetic identities and IDs in source, tests, examples, and helper files. Never copy actual account or contact information into publishable files.
- Keep exports under `exports/` and temporary helpers under `.tmp/`; use generic filenames. Never commit credentials, session databases, exports, or message-derived fixtures.
- Run `bun run check` after changes. Keep command help and contract tests aligned.
- The pinned dependency patch clears settled request timers. Preserve prompt process exit and timeout protection when upgrading dependencies.
