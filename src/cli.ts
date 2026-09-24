#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { TelegramClient } from "@mtcute/bun";
import { Command, CommanderError } from "commander";
import { z } from "zod";

import { version } from "../package.json";
import { aliasesByPeer, resolveReference } from "./aliases.ts";
import {
  registerAliasCommands,
  registerDownloadCommand,
  registerDraftCommands,
  registerMessageCommands,
  registerSendCommand,
} from "./commands.ts";
import { dateRange, historyOffset } from "./dates.ts";
import { PhotoDownloads } from "./downloads.ts";
import { errorDetails } from "./errors.ts";
import { exportMessages } from "./export.ts";
import { peerSummary } from "./format.ts";
import { json } from "./json.ts";
import { listChats } from "./peers.ts";
import { defaultSessionDirectory, login, withClient } from "./session.ts";
import { registerUnreadCommand } from "./unread.ts";

const cancellation = new AbortController();
const interrupt = (): void => {
  cancellation.abort(
    new Error("Interrupted; retry with a new output filename.")
  );
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

const program = new Command("tg")
  .description(
    "Telegram user-account CLI. Results: JSON on stdout; diagnostics: stderr."
  )
  .version(version)
  .option(
    "--session-dir <path>",
    "Private account session directory",
    defaultSessionDirectory
  )
  .option("--timeout <seconds>", "Per-request timeout", "60")
  .exitOverride()
  .configureOutput({
    writeErr: () => {
      // Errors are emitted once as JSON below.
    },
  });

const run = async <T>(
  operation: (client: TelegramClient) => Promise<T>,
  allowLogin = false
): Promise<void> => {
  const options = z
    .object({
      sessionDir: z.string().min(1),
      timeout: z.coerce.number().int().positive().max(3600),
    })
    .parse(program.opts());
  const result = await withClient(
    options.sessionDir,
    async (client) =>
      await operation(
        client.withParams({
          abortSignal: cancellation.signal,
          floodSleepThreshold: 30_000,
          maxRetryCount: 3,
          timeout: options.timeout * 1000,
        })
      ),
    allowLogin
  );
  process.stdout.write(
    `${json({ data: result, schemaVersion: 1, status: "success" })}\n`
  );
};

const auth = program
  .command("auth")
  .description("Authenticate a personal Telegram account");
auth
  .command("login")
  .description(
    "One-time terminal login; credentials from TELEGRAM_API_ID / TELEGRAM_API_HASH"
  )
  .requiredOption(
    "--interactive",
    "Allow terminal prompts for phone, code, and 2FA"
  )
  .option(
    "--qr",
    "Scan a QR code from Telegram Settings > Devices instead of requesting a code"
  )
  .action(async (inputOptions: Record<string, boolean>) => {
    const options = z
      .object({ qr: z.boolean().default(false) })
      .parse(inputOptions);
    if (!process.stdin.isTTY || !process.stderr.isTTY) {
      throw new Error(
        "Login needs a terminal. Run tg auth login --interactive yourself."
      );
    }
    await run(
      async (client) =>
        peerSummary(await login(client, cancellation.signal, options.qr)),
      true
    );
  });
auth
  .command("status")
  .description("Check the saved session without prompting")
  .action(async () => {
    await run(async (client) => peerSummary(await client.getMe()));
  });

program
  .command("chats")
  .description("Discover chat IDs")
  .command("list")
  .description(
    "List recent dialogs, including archived chats; search names, usernames and private aliases. Results explain matches."
  )
  .option(
    "--search <text>",
    "Case-insensitive substring of name, username or saved alias",
    ""
  )
  .option(
    "--kind <kind>",
    "all, person, group, channel, bot, or community",
    "all"
  )
  .option("--limit <count>", "Maximum matching chats", "50")
  .option(
    "--unread",
    "Only chats with unread incoming messages; excludes manual unread marks alone"
  )
  .option("--all", "Return all matching chats, ignoring --limit")
  .action(async (inputOptions: Record<string, string | boolean>) => {
    const options = z
      .object({
        all: z.boolean().default(false),
        kind: z.enum(["all", "person", "group", "channel", "bot", "community"]),
        limit: z.coerce.number().int().min(1).max(1000),
        search: z.string(),
        unread: z.boolean().default(false),
      })
      .parse(inputOptions);
    await run(async (client) => {
      const aliases = await aliasesByPeer(
        client,
        z.string().parse(program.opts().sessionDir)
      );
      return await listChats(
        client,
        { ...options, limit: options.all ? Infinity : options.limit },
        aliases
      );
    });
  });

const messagesCommand = program
  .command("messages")
  .description(
    "Retrieve Telegram history; send only with explicit user approval"
  );
const commandContext = {
  directory: (): string => z.string().parse(program.opts().sessionDir),
  run,
  signal: cancellation.signal,
};
registerMessageCommands(messagesCommand, commandContext);
registerUnreadCommand(messagesCommand, commandContext);
registerDownloadCommand(messagesCommand, commandContext);
registerSendCommand(messagesCommand, commandContext);
registerAliasCommands(program, commandContext);
registerDraftCommands(program, commandContext);

messagesCommand
  .command("export")
  .description(
    "Export all accessible messages in [since, until), oldest first. Never overwrites files."
  )
  .requiredOption(
    "--chat <id-or-username>",
    "Marked chat ID from chats list, @username, or exact saved alias"
  )
  .requiredOption(
    "--since <date>",
    "all, YYYY-MM-DD, ISO timestamp with offset, today, or Nd (rolling days)"
  )
  .option(
    "--until <date>",
    "Exclusive end; same syntax as --since; defaults to now"
  )
  .option(
    "--timezone <zone>",
    "IANA timezone for calendar dates and Markdown",
    "UTC"
  )
  .option(
    "--format <format>",
    "json or markdown (direct-chat key; inline group senders)",
    "json"
  )
  .option(
    "--output <path>",
    "Destination; defaults to a unique file in exports/. Interrupted output stays at <path>.partial"
  )
  .option(
    "--download-photos",
    "Download attached photos beside the export; excludes documents and link previews. Inspect receipt.media for failures."
  )
  .action(async (inputOptions: Record<string, string | boolean>) => {
    const options = z
      .object({
        chat: z.string().min(1),
        downloadPhotos: z.boolean().default(false),
        format: z.enum(["json", "markdown"]),
        output: z.string().min(1).optional(),
        since: z.string(),
        timezone: z.string(),
        until: z.string().optional(),
      })
      .parse(inputOptions);
    const range = dateRange(options.since, options.until, options.timezone);
    await run(async (client) => {
      const chat = await resolveReference(
        client,
        commandContext.directory(),
        options.chat
      );
      const self = await client.getMe();
      if (self.isBot) {
        throw new Error("Export requires a user account.");
      }
      let { output } = options;
      if (output === undefined) {
        await mkdir("exports", { mode: 0o700, recursive: true });
        const extension = options.format === "json" ? "json" : "md";
        output = path.join("exports", `telegram-${randomUUID()}.${extension}`);
      }
      const messages = client.iterHistory(chat, {
        offset: historyOffset(range.since),
        reverse: true,
      });
      const exportOptions = {
        ...options,
        ...range,
        chat: String(chat),
        output,
        self: peerSummary(self),
        signal: cancellation.signal,
      };
      if (options.downloadPhotos) {
        return await exportMessages(messages, {
          ...exportOptions,
          photos: new PhotoDownloads(client, output, cancellation.signal),
        });
      }
      return await exportMessages(messages, exportOptions);
    });
  });

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) {
    process.exitCode = 0;
  } else {
    const details = errorDetails(
      error instanceof Error ? error : new Error("Command failed.")
    );
    process.stderr.write(`${json(details)}\n`);
    process.exitCode = details.exitCode;
  }
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
