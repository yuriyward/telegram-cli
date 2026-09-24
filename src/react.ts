import type { TelegramClient } from "@mtcute/bun";

import { reactionMetadata } from "./message-metadata.ts";

// Telegram replaces the account's reactions on the message with this set; empty removes them.
export const setReactions = async (
  client: Pick<TelegramClient, "sendReaction">,
  chat: number | string,
  id: number,
  emojis: readonly string[]
) => {
  const message = await client.sendReaction({
    chatId: chat,
    emoji: emojis.length === 0 ? null : [...emojis],
    message: id,
  });
  return {
    chat,
    id,
    reactions: message === null ? undefined : reactionMetadata(message),
    requested: emojis,
  };
};
