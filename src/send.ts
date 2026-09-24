import type { TelegramClient } from "@mtcute/bun";

import { messageRecord } from "./message-metadata.ts";

type SentMessage = ReturnType<typeof messageRecord>;

// Newlines around separators are layout, not message content.
export const splitBubbles = (text: string): string[] =>
  text
    .split(/^---[ \t]*\r?$/mu)
    .map((bubble) => bubble.replaceAll(/^(?:\r?\n)+|(?:\r?\n)+$/gu, ""));

export class SendFailureError extends Error {
  readonly sent: readonly SentMessage[];

  constructor(sent: readonly SentMessage[], total: number, cause: Error) {
    super(`Sent ${sent.length} of ${total} messages before failing.`, {
      cause,
    });
    this.name = "SendFailureError";
    this.sent = sent;
  }
}

export const sendMessages = async (
  client: Pick<TelegramClient, "sendText">,
  chat: number | string,
  texts: readonly string[],
  replyTo: number | undefined,
  clearDraft: boolean
) => {
  const sent: SentMessage[] = [];
  for (const [index, text] of texts.entries()) {
    const params: NonNullable<Parameters<TelegramClient["sendText"]>[2]> = {
      clearDraft,
    };
    if (index === 0 && replyTo !== undefined) {
      // Fail instead of silently sending a non-reply when the parent is missing.
      params.mustReply = true;
      params.replyTo = replyTo;
    }
    try {
      // eslint-disable-next-line no-await-in-loop -- Bubbles must arrive in order.
      sent.push(messageRecord(await client.sendText(chat, text, params)));
    } catch (error) {
      throw new SendFailureError(
        sent,
        texts.length,
        error instanceof Error ? error : new Error("Send failed.")
      );
    }
  }
  return {
    chat: sent[0]?.chatId,
    count: sent.length,
    messages: sent,
    sent: true,
  };
};
