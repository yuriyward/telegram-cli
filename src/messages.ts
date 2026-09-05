import type { Message, TelegramClient } from "@mtcute/bun";
import { getMarkedPeerId } from "@mtcute/core/utils.js";

import type { DateRange } from "./dates.ts";
import { CliError } from "./errors.ts";
import { messageRecord } from "./message-metadata.ts";

export interface ReadOptions extends DateRange {
  chat: number | string;
  from?: number | string | undefined;
  query?: string | undefined;
  before?: number | undefined;
  limit: number;
  replies: boolean;
}

const missingReplies = (messages: readonly Message[]) => {
  const known = new Set(
    messages.map((message) => `${message.chat.id}:${message.id}`)
  );
  const pending = new Map<number, Set<number>>();
  for (const message of messages) {
    const reply = message.raw.replyTo;
    if (reply?._ !== "messageReplyHeader" || reply.replyToMsgId === undefined) {
      continue;
    }
    const chatId =
      reply.replyToPeerId === undefined
        ? message.chat.id
        : getMarkedPeerId(reply.replyToPeerId);
    if (!known.has(`${chatId}:${reply.replyToMsgId}`)) {
      const ids = pending.get(chatId) ?? new Set<number>();
      ids.add(reply.replyToMsgId);
      pending.set(chatId, ids);
    }
  }
  return pending;
};

export const replyContext = async (
  client: Pick<TelegramClient, "getMessages">,
  messages: readonly Message[]
) => {
  const pending = missingReplies(messages);
  const context = [];
  // One batch per peer, sequential across peers to avoid unbounded request bursts.
  for (const [chatId, ids] of pending) {
    const fetched: (Message | null)[] = [];
    const batch = [...ids];
    for (let offset = 0; offset < batch.length; offset += 100) {
      // eslint-disable-next-line no-await-in-loop -- Bound requests and respect Telegram flood limits.
      const result = await client.getMessages(
        chatId,
        batch.slice(offset, offset + 100)
      );
      fetched.push(...result);
    }
    const found = new Map(
      fetched.filter((item) => item !== null).map((item) => [item.id, item])
    );
    for (const id of ids) {
      const message = found.get(id);
      context.push(
        message === undefined
          ? { chatId, id, unavailable: true }
          : messageRecord(message)
      );
    }
  }
  return context;
};

const readSource = (
  client: Pick<TelegramClient, "iterHistory" | "iterSearchMessages">,
  options: ReadOptions
) => {
  const filtered = options.query !== undefined || options.from !== undefined;
  if (filtered) {
    const params: NonNullable<
      Parameters<TelegramClient["iterSearchMessages"]>[0]
    > = {
      chatId: options.chat,
      chunkSize: Math.min(100, options.limit + 1),
      maxDate: Math.ceil(options.until.getTime() / 1000),
      minDate: Math.max(0, Math.ceil(options.since.getTime() / 1000) - 1),
      offset: options.before ?? 0,
      query: options.query ?? "",
    };
    if (options.from !== undefined) {
      params.fromUser = options.from;
    }
    return client.iterSearchMessages(params);
  }
  return client.iterHistory(options.chat, {
    chunkSize: Math.min(100, options.limit + 1),
    offset: {
      date: Math.ceil(options.until.getTime() / 1000),
      id: options.before ?? 0,
    },
  });
};

export const readMessages = async (
  client: Pick<
    TelegramClient,
    "iterHistory" | "iterSearchMessages" | "getMessages"
  >,
  options: ReadOptions
) => {
  const source = readSource(client, options);
  const messages: Message[] = [];
  let complete = true;
  for await (const message of source) {
    if (message.date < options.since) {
      break;
    }
    if (
      message.date >= options.until ||
      (options.before !== undefined && message.id >= options.before)
    ) {
      continue;
    }
    if (messages.length === options.limit) {
      complete = false;
      break;
    }
    messages.push(message);
  }
  const nextBefore = complete ? null : messages.at(-1)?.id;
  messages.reverse();
  return {
    complete,
    messages: messages.map(messageRecord),
    nextBefore,
    order: "oldest-first",
    replies: options.replies ? await replyContext(client, messages) : undefined,
    selection: "latest-matching",
    since: options.since.toISOString(),
    until: options.until.toISOString(),
  };
};

export const messageContext = async (
  client: Pick<TelegramClient, "getHistory" | "getMessages">,
  chat: number | string,
  id: number,
  before: number,
  after: number
) => {
  const [targets, older, newer] = await Promise.all([
    client.getMessages(chat, [id]),
    before === 0
      ? []
      : client.getHistory(chat, { limit: before, offset: { date: 0, id } }),
    after === 0
      ? []
      : client.getHistory(chat, {
          limit: after,
          offset: { date: 0, id: id + 1 },
          reverse: true,
        }),
  ]);
  const target = targets.find((item) => item?.id === id);
  if (target === undefined || target === null) {
    throw new CliError(
      "MESSAGE_NOT_FOUND",
      "Message is unavailable in this chat."
    );
  }
  const unique = new Map(
    [
      ...older.filter((item) => item.id < id),
      target,
      ...newer.filter((item) => item.id > id),
    ].map((item) => [item.id, item])
  );
  const messages = [...unique.values()].toSorted((a, b) => a.id - b.id);
  return {
    messages: messages.map(messageRecord),
    order: "oldest-first",
    replies: await replyContext(client, messages),
    targetId: id,
  };
};
