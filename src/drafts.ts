import type { TelegramClient } from "@mtcute/bun";

import { CliError } from "./errors.ts";

export const getDraft = async (
  client: Pick<TelegramClient, "getPeerDialogs">,
  chat: number | string
) => {
  const [dialog] = await client.getPeerDialogs(chat);
  return dialog?.draftMessage?.raw ?? null;
};

export const saveDraft = async (
  client: Pick<TelegramClient, "getPeerDialogs" | "saveDraft">,
  chat: number | string,
  text: string,
  replyTo: number | undefined,
  replace: boolean
) => {
  const existing = await getDraft(client, chat);
  if (existing !== null && !replace) {
    throw new CliError(
      "DRAFT_EXISTS",
      "A Telegram draft already exists. Read it with drafts get; use --replace only when replacement is intended."
    );
  }
  const draft: NonNullable<Parameters<TelegramClient["saveDraft"]>[1]> = {
    message: text,
  };
  if (replyTo !== undefined) {
    draft.replyTo = { _: "inputReplyToMessage", replyToMsgId: replyTo };
  }
  await client.saveDraft(chat, draft);
  return { chat, replaced: existing !== null, saved: true, sent: false };
};
