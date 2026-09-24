import { expect, mock, test } from "bun:test";
import { rejects } from "node:assert/strict";

import { Message, PeersIndex } from "@mtcute/bun";
import type { TelegramClient } from "@mtcute/bun";

import { errorDetails } from "../errors.ts";
import { messageRecord } from "../message-metadata.ts";
import { SendFailureError, sendMessages, splitBubbles } from "../send.ts";

const peers = PeersIndex.from({
  users: [
    { _: "user", firstName: "Example Self", id: 1 },
    { _: "user", firstName: "Example Person", id: 2 },
  ],
});
const sent = (id: number, text: string): Message =>
  new Message(
    {
      _: "message",
      date: 1_767_225_600,
      fromId: { _: "peerUser", userId: 1 },
      id,
      message: text,
      out: true,
      peerId: { _: "peerUser", userId: 2 },
    },
    peers
  );
const sender = (texts: readonly string[]) => {
  let index = 0;
  return {
    sendText: mock<TelegramClient["sendText"]>(async () => {
      index += 1;
      return await Promise.resolve(sent(10 + index, texts[index - 1] ?? ""));
    }),
  };
};

test("sends bubbles in order and reports each sent message", async () => {
  const api = sender(["Hi", "Second"]);
  expect(
    await sendMessages(
      api,
      "@example_person",
      ["Hi", "Second"],
      undefined,
      false
    )
  ).toMatchObject({
    chat: 2,
    count: 2,
    messages: [
      { id: 11, text: "Hi" },
      { id: 12, text: "Second" },
    ],
    sent: true,
  });
  expect(api.sendText.mock.calls).toEqual([
    ["@example_person", "Hi", { clearDraft: false }],
    ["@example_person", "Second", { clearDraft: false }],
  ]);
});

test("only the first bubble replies and requires its parent", async () => {
  const api = sender([" **plain**\n", "Next"]);
  await sendMessages(api, 2, [" **plain**\n", "Next"], 10, true);
  expect(api.sendText.mock.calls).toEqual([
    [2, " **plain**\n", { clearDraft: true, mustReply: true, replyTo: 10 }],
    [2, "Next", { clearDraft: true }],
  ]);
});

test("a failure stops sending and reports what was delivered", async () => {
  const api = sender(["First"]);
  api.sendText.mockImplementationOnce(
    async () => await Promise.resolve(sent(11, "First"))
  );
  api.sendText.mockImplementationOnce(
    async () => await Promise.reject(new Error("network failure"))
  );
  await rejects(
    sendMessages(api, 2, ["First", "Second", "Third"], undefined, false),
    {
      message: "Sent 1 of 3 messages before failing.",
      name: "SendFailureError",
    }
  );
  expect(api.sendText).toHaveBeenCalledTimes(2);
  const failure = new SendFailureError(
    [messageRecord(sent(11, "First"))],
    3,
    new Error("network failure")
  );
  expect(errorDetails(failure)).toMatchObject({
    code: "COMMAND_FAILED",
    message: "network failure",
    sent: [{ id: 11, text: "First" }],
  });
});

test("bubbles split only on whole --- lines and keep inner text exact", () => {
  expect(
    splitBubbles(
      "  Hi 👋\n\nsecond paragraph\n---\r\n--- not a separator\n a---b \n---  \nLast\n"
    )
  ).toEqual([
    "  Hi 👋\n\nsecond paragraph",
    "--- not a separator\n a---b ",
    "Last",
  ]);
  expect(splitBubbles("Single message\n")).toEqual(["Single message"]);
});
