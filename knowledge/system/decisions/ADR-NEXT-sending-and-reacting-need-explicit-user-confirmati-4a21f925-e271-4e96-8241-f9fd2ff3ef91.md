---
id: ADR-NEXT-sending-and-reacting-need-explicit-user-confirmati-4a21f925-e271-4e96-8241-f9fd2ff3ef91
type: decision
status: accepted
domain: system
title: Sending and reacting need explicit user confirmation
# area.name, e.g. dispatch.queue. One accepted decision per key; replacing one needs `supersedes`.
decision_key: send.confirmation
code_paths:
  - src/**
supersedes: []
superseded_by: null
---

# ADR-NEXT-sending-and-reacting-need-explicit-user-confirmati-4a21f925-e271-4e96-8241-f9fd2ff3ef91 — Sending and reacting need explicit user confirmation

## Question

How does the CLI keep an agent from sending messages or reactions the account owner did not approve?

## Outcome

`messages send` and `messages react` refuse to run without `--user-confirmed`. The flag is the agent's statement that
the owner approved these exact texts or emoji for this recipient in the current conversation; reads, exports, drafts
and requests to reply never imply it.

## Alternatives

| Alternative | Why it lost |
|---|---|
| No send command; the owner sends by hand | Copying approved bubbles into Telegram by hand was the friction the CLI removes |
| An interactive prompt before each send | Agents run non-interactively; a prompt either blocks or gets answered by the agent itself |
| A bot account instead of the user account | Messages must arrive from the owner, not a bot |

## Premises

- A sent message goes out under the owner's name and cannot be taken back; a reaction can notify the other person.
- The CLI cannot see the conversation where approval happened, so it can only demand an explicit, auditable flag.

## Revisit if

- An agent sends with the flag where the owner had not approved.
- A standing approval (an owner-approved workflow for a recipient and case) needs to be checked by the CLI itself.

## Evidence

- reported: commit 867eab4 (2026-09-24) added `messages send` behind `--user-confirmed`; commit 81678f7 added
  `messages react` behind the same flag.
