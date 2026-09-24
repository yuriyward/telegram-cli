import { expect, mock, test } from "bun:test";
import { rejects } from "node:assert/strict";

import { Dialog, Message, PeersIndex } from "@mtcute/bun";
import type { TelegramClient, tl } from "@mtcute/bun";

import { listChats } from "../peers.ts";
import { readUnread } from "../unread.ts";

const peers = PeersIndex.from({
  users: [
    { _: "user", firstName: "Example Person", id: 2 },
    { _: "user", bot: true, firstName: "Example Bot", id: 3 },
  ],
});
const dialog = (id: number, count: number, read = 4, manual = false): Dialog =>
  new Dialog(
    {
      _: "dialog",
      notifySettings: { _: "peerNotifySettings" },
      peer: { _: "peerUser", userId: id },
      readInboxMaxId: read,
      readOutboxMaxId: 0,
      topMessage: 10,
      unreadCount: count,
      unreadMark: manual,
      unreadMentionsCount: 0,
      unreadPollVotesCount: 0,
      unreadReactionsCount: 0,
    },
    peers,
    new Map()
  );
const message = (id: number, out = false): Message =>
  new Message(
    {
      _: "message",
      date: 1_700_000_000,
      fromId: { _: "peerUser", userId: 2 },
      id,
      message: "Example",
      out,
      peerId: { _: "peerUser", userId: 2 },
    } satisfies tl.RawMessage,
    peers
  );

test("unread discovery counts only matching people and includes archived dialogs", async () => {
  const client = {
    iterDialogs: mock<TelegramClient["iterDialogs"]>(async function* iterate() {
      yield dialog(3, 9);
      yield dialog(2, 0, 4, true);
      yield dialog(2, 3);
    }),
  };
  const result = await listChats(
    client,
    { kind: "person", limit: Infinity, search: "", unread: true },
    new Map()
  );
  expect(result).toMatchObject({ complete: true, count: 1, unreadCount: 3 });
  expect(result.chats[0]).toMatchObject({
    id: 2,
    readInboxMaxId: 4,
    unreadCount: 3,
  });
  expect(client.iterDialogs).toHaveBeenCalledWith({ archived: "keep" });
});

test("discovery reports truncation and totals only returned chats", async () => {
  const client = {
    iterDialogs: mock<TelegramClient["iterDialogs"]>(async function* iterate() {
      yield dialog(2, 3);
      yield dialog(3, 9);
    }),
  };
  const result = await listChats(
    client,
    { kind: "all", limit: 1, search: "", unread: true },
    new Map()
  );
  expect(result).toMatchObject({ complete: false, count: 1, unreadCount: 3 });
});

test("unread pages exclude outgoing, read and post-snapshot messages; retain boundary across devices", async () => {
  const client = {
    getMessages: mock<TelegramClient["getMessages"]>(
      async () => await Promise.resolve([])
    ),
    getPeerDialogs: mock<TelegramClient["getPeerDialogs"]>(
      async () => await Promise.resolve([dialog(2, 4)])
    ),
    iterHistory: mock<TelegramClient["iterHistory"]>(async function* iterate() {
      yield* [
        message(11),
        message(10),
        message(9, true),
        message(8),
        message(7),
        message(6),
        message(4),
      ];
    }),
    iterSearchMessages: mock<TelegramClient["iterSearchMessages"]>(
      async function* iterate() {}
    ),
  };
  const first = await readUnread(client, { chat: 2, limit: 2 });
  expect(first.messages.map((item) => item.id)).toEqual([8, 10]);
  expect(first).toMatchObject({
    after: 4,
    complete: false,
    nextBefore: 8,
    unreadCount: 4,
  });
  client.getPeerDialogs.mockImplementation(
    async () => await Promise.resolve([dialog(2, 0, 10)])
  );
  const second = await readUnread(client, {
    after: first.after,
    before: 8,
    chat: 2,
    limit: 2,
  });
  expect(second.messages.map((item) => item.id)).toEqual([6, 7]);
  expect(second.complete).toBe(true);
  client.iterHistory.mockClear();
  const empty = await readUnread(client, { chat: 2, limit: 2 });
  expect(empty.messages).toEqual([]);
  expect(client.iterHistory).not.toHaveBeenCalled();
  expect(client.iterSearchMessages).not.toHaveBeenCalled();
  expect(client.getMessages).not.toHaveBeenCalled();
});

test("missing dialogs fail explicitly", async () => {
  const client = {
    getMessages: mock<TelegramClient["getMessages"]>(
      async () => await Promise.resolve([])
    ),
    getPeerDialogs: mock<TelegramClient["getPeerDialogs"]>(
      async () => await Promise.resolve([null])
    ),
    iterHistory: mock<TelegramClient["iterHistory"]>(
      async function* iterate() {}
    ),
    iterSearchMessages: mock<TelegramClient["iterSearchMessages"]>(
      async function* iterate() {}
    ),
  };
  await rejects(readUnread(client, { chat: 2, limit: 10 }), {
    code: "CHAT_NOT_FOUND",
  });
});

test("unread reply context is opt-in and can include an already read parent", async () => {
  const target = message(10);
  target.raw.replyTo = { _: "messageReplyHeader", replyToMsgId: 3 };
  const client = {
    getMessages: mock<TelegramClient["getMessages"]>(
      async () => await Promise.resolve([message(3)])
    ),
    getPeerDialogs: mock<TelegramClient["getPeerDialogs"]>(
      async () => await Promise.resolve([dialog(2, 1)])
    ),
    iterHistory: mock<TelegramClient["iterHistory"]>(async function* iterate() {
      yield target;
    }),
    iterSearchMessages: mock<TelegramClient["iterSearchMessages"]>(
      async function* iterate() {}
    ),
  };
  const plain = await readUnread(client, { chat: 2, limit: 10 });
  expect(plain.replies).toBeUndefined();
  expect(client.getMessages).not.toHaveBeenCalled();
  const contextual = await readUnread(client, {
    chat: 2,
    limit: 10,
    replies: true,
  });
  expect(contextual.messages.map((item) => item.id)).toEqual([10]);
  expect(contextual.replies?.map((item) => item.id)).toEqual([3]);
  expect(client.getMessages.mock.calls).toEqual([[2, [3]]]);
});
