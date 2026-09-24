import { expect, mock, test } from "bun:test";

import { Message, PeersIndex } from "@mtcute/bun";
import type { TelegramClient } from "@mtcute/bun";

import { setReactions } from "../react.ts";

const reacted = new Message(
  {
    _: "message",
    date: 1_767_225_600,
    fromId: { _: "peerUser", userId: 2 },
    id: 7,
    message: "Example",
    peerId: { _: "peerUser", userId: 2 },
    reactions: {
      _: "messageReactions",
      results: [
        {
          _: "reactionCount",
          chosenOrder: 0,
          count: 1,
          reaction: { _: "reactionEmoji", emoticon: "👍" },
        },
      ],
    },
  },
  PeersIndex.from({
    users: [{ _: "user", firstName: "Example Person", id: 2 }],
  })
);

test("sets the emoji set and reports the message's reactions", async () => {
  const api = {
    sendReaction: mock<TelegramClient["sendReaction"]>(
      async () => await Promise.resolve(reacted)
    ),
  };
  expect(await setReactions(api, 2, 7, ["👍", "❤️"])).toEqual({
    chat: 2,
    id: 7,
    reactions: [{ chosen: true, count: 1, emoji: "👍" }],
    requested: ["👍", "❤️"],
  });
  expect(api.sendReaction).toHaveBeenCalledWith({
    chatId: 2,
    emoji: ["👍", "❤️"],
    message: 7,
  });
});

test("an empty set removes reactions by sending null and tolerates an unavailable result message", async () => {
  const api = {
    sendReaction: mock<TelegramClient["sendReaction"]>(
      async () => await Promise.resolve(null)
    ),
  };
  expect(await setReactions(api, "@example_person", 7, [])).toEqual({
    chat: "@example_person",
    id: 7,
    reactions: undefined,
    requested: [],
  });
  expect(api.sendReaction).toHaveBeenCalledWith({
    chatId: "@example_person",
    emoji: null,
    message: 7,
  });
});
