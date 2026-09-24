import { expect, mock, test } from "bun:test";
import { rejects } from "node:assert/strict";

import { Message, PeersIndex } from "@mtcute/bun";
import type { TelegramClient, tl } from "@mtcute/bun";
import Long from "long";

import { dateRange } from "../dates.ts";
import { messageContext, readMessages, replyContext } from "../messages.ts";

const peers = PeersIndex.from({
  users: [{ _: "user", firstName: "Example Contact", id: 2 }],
});
const item = (
  id: number,
  seconds = 0,
  replyTo?: tl.RawMessageReplyHeader
): Message => {
  const raw: tl.RawMessage = {
    _: "message",
    date: 1_782_864_000 + seconds,
    fromId: { _: "peerUser", userId: 2 },
    id,
    message: "  👩‍💻 exact\n\n\ntext  ",
    peerId: { _: "peerUser", userId: 2 },
  };
  if (replyTo !== undefined) {
    raw.replyTo = replyTo;
  }
  return new Message(raw, peers);
};
const options = {
  ...dateRange("2026-07-01", "2026-07-02", "UTC"),
  chat: 2,
  limit: 2,
  replies: false,
};
const reader = (items: Message[]) => ({
  getMessages: mock<TelegramClient["getMessages"]>(
    async () => await Promise.resolve([])
  ),
  iterHistory: mock<TelegramClient["iterHistory"]>(async function* history() {
    yield* items;
  }),
  iterSearchMessages: mock<TelegramClient["iterSearchMessages"]>(
    async function* search() {
      yield* items;
    }
  ),
});

test("reads latest page chronologically, preserving text and exclusive ID pagination", async () => {
  const client = reader([
    item(6, 86_400),
    item(5, 30),
    item(4, 30),
    item(3, 30),
    item(2),
    item(1, -1),
  ]);
  const first = await readMessages(client, options);
  expect(first.messages.map((message) => message.id)).toEqual([4, 5]);
  expect(first.messages[0]?.text).toBe("  👩‍💻 exact\n\n\ntext  ");
  expect(first.complete).toBe(false);
  expect(first.nextBefore).toBe(4);
  const second = await readMessages(client, { ...options, before: 4 });
  expect(second.messages.map((message) => message.id)).toEqual([2, 3]);
  expect(second.complete).toBe(true);
  expect(second.nextBefore).toBeNull();
  expect(client.iterSearchMessages).not.toHaveBeenCalled();
  expect(client.getMessages).not.toHaveBeenCalled();
});

test("search and sender filters are pushed to Telegram with exact date bounds", async () => {
  const client = reader([item(2), item(1, -1)]);
  const result = await readMessages(client, {
    ...options,
    before: 10,
    from: 2,
    query: "exact",
  });
  expect(result.messages.map((message) => message.id)).toEqual([2]);
  expect(client.iterHistory).not.toHaveBeenCalled();
  expect(client.iterSearchMessages).toHaveBeenCalledWith({
    chatId: 2,
    chunkSize: 3,
    fromUser: 2,
    maxDate: 1_782_950_400,
    minDate: 1_782_863_999,
    offset: 10,
    query: "exact",
  });
});

test("fractional date boundaries are expanded for the server and checked exactly locally", async () => {
  const client = reader([item(4, 3), item(3, 2), item(2, 1), item(1)]);
  const result = await readMessages(client, {
    ...options,
    ...dateRange("2026-07-01T00:00:00.500Z", "2026-07-01T00:00:02.500Z", "UTC"),
    from: 2,
  });
  expect(result.messages.map((message) => message.id)).toEqual([2, 3]);
  expect(result.complete).toBe(true);
  expect(client.iterSearchMessages.mock.calls[0]?.[0]).toMatchObject({
    maxDate: 1_782_864_003,
    minDate: 1_782_864_000,
  });
});

test("empty reads are complete and never fetch replies implicitly", async () => {
  const client = reader([]);
  const result = await readMessages(client, options);
  expect(result.messages).toEqual([]);
  expect(result.complete).toBe(true);
  expect(result.nextBefore).toBeNull();
  expect(client.getMessages).not.toHaveBeenCalled();
});

test("reply targets are deduplicated, reuse loaded messages, and respect cross-chat identity", async () => {
  const client = reader([]);
  client.getMessages.mockImplementation(
    async (chat) => await Promise.resolve(chat === 2 ? [item(8), null] : [null])
  );
  const result = await replyContext(client, [
    item(10, 0, { _: "messageReplyHeader", replyToMsgId: 8 }),
    item(11, 0, { _: "messageReplyHeader", replyToMsgId: 8 }),
    item(12, 0, { _: "messageReplyHeader", replyToMsgId: 10 }),
    item(13, 0, { _: "messageReplyHeader", replyToMsgId: 7 }),
    item(14, 0, {
      _: "messageReplyHeader",
      replyToMsgId: 10,
      replyToPeerId: { _: "peerChannel", channelId: 3 },
    }),
  ]);
  expect(client.getMessages.mock.calls).toEqual([
    [2, [8, 7]],
    [-1_000_000_000_003, [10]],
  ]);
  expect(result).toHaveLength(3);
  expect(result[1]).toEqual({ chatId: 2, id: 7, unavailable: true });
  expect(result[2]).toEqual({
    chatId: -1_000_000_000_003,
    id: 10,
    unavailable: true,
  });
});

test("reply requests are bounded to 100 IDs per batch", async () => {
  const client = reader([]);
  const messages = Array.from({ length: 101 }, (_, index) =>
    item(index + 200, 0, { _: "messageReplyHeader", replyToMsgId: index + 1 })
  );
  expect(await replyContext(client, messages)).toHaveLength(101);
  expect(client.getMessages.mock.calls[0]?.[1]).toHaveLength(100);
  expect(client.getMessages.mock.calls[1]?.[1]).toEqual([101]);
});

test("context loads a bounded window and reuses reply targets within it", async () => {
  const client = {
    getHistory: mock<TelegramClient["getHistory"]>(
      async (_chat, params) =>
        await Promise.resolve(
          Object.assign(params?.reverse === true ? [item(11)] : [item(9)], {
            total: 1,
          })
        )
    ),
    getMessages: mock<TelegramClient["getMessages"]>(
      async () =>
        await Promise.resolve([
          item(10, 0, { _: "messageReplyHeader", replyToMsgId: 9 }),
        ])
    ),
  };
  const result = await messageContext(client, 2, 10, 1, 1);
  expect(result.messages.map((message) => message.id)).toEqual([9, 10, 11]);
  expect(result.replies).toEqual([]);
  expect(client.getMessages).toHaveBeenCalledTimes(1);
  expect(client.getHistory.mock.calls).toEqual([
    [2, { limit: 1, offset: { date: 0, id: 10 } }],
    [2, { limit: 1, offset: { date: 0, id: 11 }, reverse: true }],
  ]);
});

test("missing context target is explicit and zero-sized windows do no extra requests", async () => {
  const client = {
    getHistory: mock<TelegramClient["getHistory"]>(
      async () => await Promise.resolve(Object.assign([], { total: 0 }))
    ),
    getMessages: mock<TelegramClient["getMessages"]>(
      async () => await Promise.resolve([null])
    ),
  };
  await rejects(messageContext(client, 2, 10, 0, 0), {
    code: "MESSAGE_NOT_FOUND",
  });
  expect(client.getHistory).not.toHaveBeenCalled();
});

test("exact lookup fetches only the target unless reply context is requested", async () => {
  const parent = item(8, -86_400, { _: "messageReplyHeader", replyToMsgId: 7 });
  const target = item(10, 0, { _: "messageReplyHeader", replyToMsgId: 8 });
  const client = {
    getHistory: mock<TelegramClient["getHistory"]>(
      async () => await Promise.resolve(Object.assign([], { total: 0 }))
    ),
    getMessages: mock<TelegramClient["getMessages"]>(
      async (_chat, ids) =>
        await Promise.resolve(
          Array.isArray(ids) && ids[0] === 10 ? [target] : [parent]
        )
    ),
  };
  const plain = await messageContext(client, 2, 10, 0, 0, false);
  expect(plain.messages.map((message) => message.id)).toEqual([10]);
  expect(plain.replies).toBeUndefined();
  expect(client.getMessages.mock.calls).toEqual([[2, [10]]]);
  client.getMessages.mockClear();
  const contextual = await messageContext(client, 2, 10, 0, 0, true);
  expect(contextual.replies?.map((message) => message.id)).toEqual([8]);
  expect(client.getMessages.mock.calls).toEqual([
    [2, [10]],
    [2, [8]],
  ]);
  expect(client.getHistory).not.toHaveBeenCalled();
});

test("read-with-replies includes parents outside the date range without altering selected messages", async () => {
  const client = reader([
    item(10, 0, { _: "messageReplyHeader", replyToMsgId: 8 }),
  ]);
  client.getMessages.mockImplementation(
    async () => await Promise.resolve([item(8, -86_400)])
  );
  const result = await readMessages(client, { ...options, replies: true });
  expect(result.messages.map((message) => message.id)).toEqual([10]);
  expect(result.replies?.map((message) => message.id)).toEqual([8]);
});

test("structured messages include reaction emoji, counts and account selection", async () => {
  const reacted = item(10);
  reacted.raw.reactions = {
    _: "messageReactions",
    results: [
      {
        _: "reactionCount",
        chosenOrder: 0,
        count: 3,
        reaction: { _: "reactionEmoji", emoticon: "❤️" },
      },
      {
        _: "reactionCount",
        count: 2,
        reaction: {
          _: "reactionCustomEmoji",
          documentId: Long.fromString("9007199254740993"),
        },
      },
    ],
  };
  const result = await readMessages(reader([reacted]), options);
  expect(result.messages[0]?.reactions).toEqual([
    { chosen: true, count: 3, emoji: "❤️" },
    { count: 2, customEmojiId: "9007199254740993" },
  ]);
});
