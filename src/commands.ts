import { readFile } from "node:fs/promises";

import type { TelegramClient } from "@mtcute/bun";
import type { Command } from "commander";
import { z } from "zod";

import {
  aliasName,
  loadAliases,
  resolveReference,
  setAlias,
} from "./aliases.ts";
import { dateRange } from "./dates.ts";
import { downloadAttachment } from "./downloads.ts";
import { getDraft, saveDraft } from "./drafts.ts";
import { CliError } from "./errors.ts";
import { messageContext, readMessages } from "./messages.ts";

interface CommandsContext {
  run: <T>(operation: (client: TelegramClient) => Promise<T>) => Promise<void>;
  directory: () => string;
  signal: AbortSignal;
}

const messageId = z.coerce.number().int().positive().max(2_147_483_646);
const readInput = z.object({
  before: messageId.optional(),
  chat: z.string().min(1),
  from: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100),
  query: z.string().min(1).optional(),
  replies: z.boolean().default(false),
  since: z.string(),
  timezone: z.string(),
  until: z.string().optional(),
});

export const registerDownloadCommand = (
  messages: Command,
  context: CommandsContext
): void => {
  messages
    .command("download")
    .description(
      "Download one message's attached photo or file (including videos, voice notes and stickers). Never opens files or marks messages read."
    )
    .requiredOption(
      "--chat <reference>",
      "Marked ID, @username, me, or exact saved alias"
    )
    .requiredOption(
      "--id <id>",
      "Message ID containing the attachment; excludes link previews"
    )
    .option(
      "--output <path>",
      "Destination file; defaults to a unique file in exports/. Never overwrites; failures retain .partial"
    )
    .action(async (input: Record<string, string>) => {
      const options = z
        .object({
          chat: z.string().min(1),
          id: messageId,
          output: z.string().min(1).optional(),
        })
        .parse(input);
      await context.run(async (client) => {
        await client.getMe();
        const chat = await resolveReference(
          client,
          context.directory(),
          options.chat
        );
        const messagesFound = await client.getMessages(chat, [options.id]);
        const message = messagesFound.find((item) => item?.id === options.id);
        if (message === undefined || message === null) {
          throw new CliError(
            "MESSAGE_NOT_FOUND",
            "Message is unavailable in this chat."
          );
        }
        return await downloadAttachment(
          client,
          message,
          options.output,
          context.signal
        );
      });
    });
};

export const registerMessageCommands = (
  messages: Command,
  context: CommandsContext
): void => {
  for (const name of ["read", "search"]) {
    const command = messages
      .command(name)
      .description(
        "Read latest matching messages in [since, until), displayed oldest first. No read receipts. Repeat with nextBefore and the returned until for older pages."
      )
      .requiredOption(
        "--chat <reference>",
        "Marked ID, @username, me, or exact saved alias"
      )
      .option(
        "--from <reference>",
        "Server-side sender filter: ID, @username, me, or alias"
      )
      .option(
        "--since <date>",
        "today, Nd, all, YYYY-MM-DD, or ISO timestamp",
        "today"
      )
      .option(
        "--until <date>",
        "Exclusive end, defaults to now; retain for pagination"
      )
      .option("--timezone <zone>", "IANA timezone for calendar dates", "UTC")
      .option(
        "--limit <count>",
        "Maximum matching messages (1–100); complete=false means more exist",
        "50"
      )
      .option("--before <id>", "Exclusive message-ID cursor from nextBefore")
      .option(
        "--replies",
        "Also fetch missing immediate reply targets, batched per chat; may be outside the filters"
      );
    if (name === "search") {
      command.requiredOption(
        "--query <text>",
        "Telegram server-side text search"
      );
    } else {
      command.option(
        "--query <text>",
        "Optional Telegram server-side text search"
      );
    }
    command.action(async (input: Record<string, string | boolean>) => {
      const options = readInput.parse(input);
      const range = dateRange(options.since, options.until, options.timezone);
      await context.run(async (client) => {
        const chat = await resolveReference(
          client,
          context.directory(),
          options.chat
        );
        const from =
          options.from === undefined
            ? undefined
            : await resolveReference(client, context.directory(), options.from);
        return await readMessages(client, { ...options, ...range, chat, from });
      });
    });
  }
  messages
    .command("context")
    .description(
      "Retrieve a message, bounded surrounding history, and immediate reply targets (not recursive)"
    )
    .requiredOption(
      "--chat <reference>",
      "Marked ID, @username, me, or exact saved alias"
    )
    .requiredOption("--id <id>", "Target message ID")
    .option("--before <count>", "Number of earlier messages (0–50)", "5")
    .option("--after <count>", "Number of later messages (0–50)", "5")
    .action(async (input: Record<string, string | boolean>) => {
      const options = z
        .object({
          after: z.coerce.number().int().min(0).max(50),
          before: z.coerce.number().int().min(0).max(50),
          chat: z.string().min(1),
          id: messageId,
        })
        .parse(input);
      await context.run(
        async (client) =>
          await messageContext(
            client,
            await resolveReference(client, context.directory(), options.chat),
            options.id,
            options.before,
            options.after
          )
      );
    });
};

export const registerAliasCommands = (
  program: Command,
  context: CommandsContext
): void => {
  const aliases = program
    .command("aliases")
    .description(
      "Private exact peer aliases, stored with this account session"
    );
  aliases
    .command("list")
    .description("List saved aliases for the authenticated account")
    .action(async () => {
      await context.run(async (client) => {
        const entries = await loadAliases(context.directory());
        if (entries.length === 0) {
          return { aliases: [] };
        }
        const self = await client.getMe();
        return {
          aliases: entries.filter((entry) => entry.accountId === self.id),
        };
      });
    });
  aliases
    .command("set")
    .description(
      "Save an exact peer ID under a private alias; no fuzzy matching"
    )
    .requiredOption(
      "--name <alias>",
      "Unicode letters, digits, underscores or hyphens; starts with a letter; case-insensitive"
    )
    .requiredOption(
      "--chat <reference>",
      "Exact marked ID, @username, or me; not a display name"
    )
    .option("--replace", "Explicitly allow repointing an existing alias")
    .action(async (input: Record<string, string | boolean>) => {
      const options = z
        .object({
          chat: z.string().min(1),
          name: aliasName,
          replace: z.boolean().default(false),
        })
        .parse(input);
      await context.run(
        async (client) =>
          await setAlias(
            client,
            context.directory(),
            options.name,
            options.chat,
            options.replace
          )
      );
    });
};

export const registerDraftCommands = (
  program: Command,
  context: CommandsContext
): void => {
  const drafts = program
    .command("drafts")
    .description(
      "Native Telegram compose drafts; saving changes Telegram but never sends a message"
    );
  drafts
    .command("get")
    .description(
      "Read the current chat draft, including reply and formatting metadata"
    )
    .requiredOption(
      "--chat <reference>",
      "Marked ID, @username, me, or exact saved alias"
    )
    .action(async (input: Record<string, string | boolean>) => {
      const options = z.object({ chat: z.string().min(1) }).parse(input);
      await context.run(async (client) => {
        const chat = await resolveReference(
          client,
          context.directory(),
          options.chat
        );
        return { chat, draft: await getDraft(client, chat) };
      });
    });
  drafts
    .command("save")
    .description(
      "Save plain text into Telegram's compose box. Checks for existing drafts; other devices can still race this check."
    )
    .requiredOption(
      "--chat <reference>",
      "Marked ID, @username, me, or exact saved alias"
    )
    .requiredOption(
      "--text-file <path>",
      "UTF-8 plain text file, kept out of shell history; no implicit stdin"
    )
    .option("--reply-to <id>", "Reply to this message in the same chat")
    .option("--replace", "Allow replacing the existing Telegram draft")
    .action(async (input: Record<string, string | boolean>) => {
      const options = z
        .object({
          chat: z.string().min(1),
          replace: z.boolean().default(false),
          replyTo: messageId.optional(),
          textFile: z.string().min(1),
        })
        .parse(input);
      const text = z
        .string()
        .min(1)
        .max(4096)
        .refine((value) => value.trim().length > 0, "Draft must contain text")
        .parse(await readFile(options.textFile, "utf-8"));
      await context.run(async (client) => {
        const reference = await resolveReference(
          client,
          context.directory(),
          options.chat
        );
        const peer = await client.getPeer(reference);
        return await saveDraft(
          client,
          peer.id,
          text,
          options.replyTo,
          options.replace
        );
      });
    });
};
