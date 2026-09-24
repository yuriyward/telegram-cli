import type { TelegramClient } from "@mtcute/bun";
import type { Command } from "commander";
import { z } from "zod";

import { resolveReference } from "./aliases.ts";
import { CliError } from "./errors.ts";
import { readMessages } from "./messages.ts";

interface UnreadOptions {
  chat: number | string;
  limit: number;
  before?: number | undefined;
  after?: number | undefined;
  replies?: boolean | undefined;
}

export const readUnread = async (
  client: Pick<
    TelegramClient,
    "getPeerDialogs" | "iterHistory" | "iterSearchMessages" | "getMessages"
  >,
  options: UnreadOptions
) => {
  const [dialog] = await client.getPeerDialogs(options.chat);
  if (dialog === null || dialog === undefined) {
    throw new CliError("CHAT_NOT_FOUND", "No dialog exists for this chat.");
  }
  const after = options.after ?? dialog.lastReadIngoing;
  const top = dialog.raw.topMessage;
  const result = await readMessages(client, {
    ...options,
    after,
    before: Math.min(options.before ?? top + 1, top + 1),
    incomingOnly: true,
    replies: options.replies ?? false,
    since: new Date(0),
    timezone: "UTC",
    until: new Date(Date.now() + 1000),
  });
  return {
    after,
    chatId: dialog.peer.id,
    complete: result.complete,
    manuallyUnread: dialog.isManuallyUnread,
    messages: result.messages,
    nextBefore: result.nextBefore,
    order: result.order,
    readInboxMaxId: dialog.lastReadIngoing,
    replies: result.replies,
    unreadCount: dialog.unreadCount,
  };
};

export const registerUnreadCommand = (
  messages: Command,
  context: {
    run: <T>(
      operation: (client: TelegramClient) => Promise<T>
    ) => Promise<void>;
    directory: () => string;
  }
): void => {
  messages
    .command("unread")
    .description(
      "Read incoming messages beyond Telegram's read boundary, oldest first within the latest page. Never marks read. Counts are a live snapshot."
    )
    .requiredOption(
      "--chat <reference>",
      "Marked ID, @username, me, or exact saved alias"
    )
    .option("--limit <count>", "Maximum messages (1–100)", "50")
    .option(
      "--replies",
      "Also fetch missing immediate reply targets, even if already read"
    )
    .option("--before <id>", "Exclusive nextBefore cursor for older pages")
    .option(
      "--after <id>",
      "Retain the returned after boundary when paging, even if another device marks read"
    )
    .action(async (input: Record<string, string | boolean>) => {
      const id = z.coerce.number().int().min(0).max(2_147_483_647);
      const options = z
        .object({
          after: id.optional(),
          before: id.min(1).optional(),
          chat: z.string().min(1),
          limit: z.coerce.number().int().min(1).max(100),
          replies: z.boolean().default(false),
        })
        .parse(input);
      await context.run(async (client) => {
        const chat = await resolveReference(
          client,
          context.directory(),
          options.chat
        );
        return await readUnread(client, { ...options, chat });
      });
    });
};
