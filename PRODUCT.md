# telegram-cli

**Job:** "When an AI agent works for me on my personal Telegram account, I want it to read, search, export and draft through one predictable CLI, so that it can answer about my conversations and prepare replies without ever sending anything I did not approve."

## Users

| Who | Uses it to |
| --- | --- |
| An AI agent acting for the account owner | Find chats, read and export history, download attachments, save drafts, send or react after approval |
| The account owner | Log in once, then approve what the agent sends |

## Never

- **N1** Send a message or set a reaction without `--user-confirmed`, which the agent passes only after the owner approved those exact texts or emoji for that recipient (ADR-0001).
- **N2** Commit credentials, session data, exports or message-derived fixtures; tests and examples use synthetic identities.
- **N3** Pick a recipient by fuzzy display-name matching; references are marked ids, `@usernames`, `me` or exact aliases.
