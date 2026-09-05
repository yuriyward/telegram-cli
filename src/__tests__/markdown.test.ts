import { expect, test } from "bun:test";

import { Message, PeersIndex } from "@mtcute/bun";
import type { tl } from "@mtcute/bun";
import Long from "long";

import { MarkdownEncoder } from "../markdown.ts";

const self = { id: 1, name: "Example Owner", type: "user", username: null };
const peers = PeersIndex.from({
  chats: [{ _: "chatForbidden", id: 3, title: "Example Group" }],
  users: [
    { _: "user", firstName: "Example Owner", id: 1 },
    { _: "user", firstName: "Example Contact", id: 2 },
  ],
});

const message = (
  id: number,
  sender: number,
  group = false,
  date = 1_782_864_000
): Message =>
  new Message(
    {
      _: "message",
      date,
      fromId: { _: "peerUser", userId: sender },
      id,
      message: "Exact text\n## still message text",
      peerId: group
        ? { _: "peerChat", chatId: 3 }
        : { _: "peerUser", userId: 2 },
    },
    peers
  );

test("direct chats use a small role key, independent of who speaks first", () => {
  const encoder = new MarkdownEncoder("UTC", self);
  const first = encoder.message(message(10, 2));
  const second = encoder.message(message(11, 1));
  expect(first).toContain('layout=direct conversation="Example Contact"[u2]');
  expect(first).toContain('me="Example Owner"[u1]; peer="Example Contact"[u2]');
  expect(first).toContain("#10 peer\n");
  expect(second).toContain("#11 me\n");
  expect(second).not.toContain("Example Owner");
  expect(second).not.toContain("me=");
  expect(first).toContain("> Exact text\n> ## still message text");
});

test("direct participant context is repeated at the next date boundary", () => {
  const encoder = new MarkdownEncoder("UTC", self);
  encoder.message(message(10, 1));
  const nextDay = encoder.message(message(11, 2, false, 1_782_950_400));
  expect(nextDay).toStartWith("## 2026-07-02\n");
  expect(nextDay).toContain(
    'me="Example Owner"[u1]; peer="Example Contact"[u2]'
  );
});

test("missing account context never guesses who is me", () => {
  const text = new MarkdownEncoder("UTC").message(message(10, 2));
  expect(text).toContain('#10 "Example Contact"[u2]');
  expect(text).not.toContain("me=");
});

test("large groups keep each sender local with no participant dictionary", () => {
  const users: tl.RawUser[] = Array.from({ length: 300 }, (_, index) => ({
    _: "user",
    firstName: "Same Display Name",
    id: index + 100,
  }));
  const groupPeers = PeersIndex.from({
    chats: [...peers.chats.values()],
    users,
  });
  const encoder = new MarkdownEncoder("UTC", self);
  for (const user of users) {
    const text = encoder.message(
      new Message(
        {
          _: "message",
          date: 1_782_864_000,
          fromId: { _: "peerUser", userId: user.id },
          id: user.id,
          message: "Text",
          peerId: { _: "peerChat", chatId: 3 },
        },
        groupPeers
      )
    );
    expect(text).toContain(`#${user.id} "Same Display Name"[u${user.id}]`);
    expect(text).not.toContain("me=");
    expect(text).not.toContain("peer=");
    expect(text).not.toContain("participants=");
  }
});

test("group identity is repeated when a sender returns after others", () => {
  const encoder = new MarkdownEncoder("UTC", self);
  expect(encoder.message(message(10, 1, true))).toContain(
    'layout=group conversation="Example Group"[c-3]'
  );
  encoder.message(message(11, 2, true));
  expect(encoder.message(message(12, 1, true))).toContain(
    '#12 "Example Owner"[u1]'
  );
});

test("cross-chat replies retain peer and quote context alongside the compact reference", () => {
  const original = message(10, 1, true);
  const item = new Message(
    {
      ...original.raw,
      replyTo: {
        _: "messageReplyHeader",
        quoteText: "Quoted source",
        replyToMsgId: 9,
        replyToPeerId: { _: "peerChat", chatId: 4 },
      },
    },
    peers
  );
  const text = new MarkdownEncoder("UTC", self).message(item);
  expect(text).toContain("reply=#9");
  expect(text).toContain('"quoteText":"Quoted source"');
  expect(text).toContain('"replyToPeerId":{"_":"peerChat","chatId":4}');
});

const withMedia = (media: tl.TypeMessageMedia): Message =>
  new Message(
    {
      ...message(10, 1).raw,
      _: "message",
      media,
      message: "Caption",
    },
    peers
  );

const documentMedia = (
  attributes: tl.TypeDocumentAttribute[]
): tl.RawMessageMediaDocument => ({
  _: "messageMediaDocument",
  document: {
    _: "document",
    accessHash: Long.ZERO,
    attributes,
    date: 1,
    dcId: 1,
    fileReference: new Uint8Array(),
    id: Long.ONE,
    mimeType: "application/octet-stream",
    size: 1,
  },
});

test.each([
  {
    attributes: [{ _: "documentAttributeAudio", duration: 12, voice: true }],
    label: "voice",
  },
  {
    attributes: [
      {
        _: "documentAttributeVideo",
        duration: 7,
        h: 100,
        roundMessage: true,
        w: 100,
      },
    ],
    label: "video-note",
  },
  {
    attributes: [
      { _: "documentAttributeVideo", duration: 7, h: 100, w: 100 },
      { _: "documentAttributeAnimated" },
    ],
    label: "animation",
  },
  {
    attributes: [
      {
        _: "documentAttributeSticker",
        alt: "🙂",
        stickerset: { _: "inputStickerSetEmpty" },
      },
    ],
    label: "sticker",
  },
] satisfies { attributes: tl.TypeDocumentAttribute[]; label: string }[])(
  "media types use existing attributes without downloading: %j",
  ({ attributes, label }) => {
    const text = new MarkdownEncoder("UTC", self).message(
      withMedia(documentMedia(attributes))
    );
    expect(text).toContain(`[${label}; not downloaded]`);
    if (label === "voice") {
      expect(text).toContain('"seconds":12');
    }
    if (label === "sticker") {
      expect(text).toContain('"emoji":"🙂"');
    }
  }
);

test("filenames are escaped and link previews are not attached photos", () => {
  const encoder = new MarkdownEncoder("UTC", self);
  const file = encoder.message(
    withMedia(
      documentMedia([
        { _: "documentAttributeFilename", fileName: "file\n## text.txt" },
      ])
    )
  );
  expect(file).toContain('"filename":"file\\n## text.txt"');
  const preview = encoder.message(
    withMedia({
      _: "messageMediaWebPage",
      webpage: {
        _: "webPage",
        displayUrl: "example.com",
        hash: 0,
        id: Long.ONE,
        photo: { _: "photoEmpty", id: Long.ONE },
        title: "Example page",
        url: "https://example.com",
      },
    })
  );
  expect(preview).toContain("[link-preview; not downloaded]");
  expect(preview).toContain('"url":"https://example.com"');
  expect(preview).not.toContain("[photo;");
});

test("hidden links preserve UTF-16 positions and albums retain 64-bit IDs", () => {
  const item = new Message(
    {
      ...message(10, 1).raw,
      _: "message",
      entities: [
        {
          _: "messageEntityTextUrl",
          length: 5,
          offset: 3,
          url: "https://example.com/guide",
        },
      ],
      groupedId: Long.MAX_VALUE,
      message: "😀 guide",
    },
    peers
  );
  const text = new MarkdownEncoder("UTC", self).message(item);
  expect(text).toContain('"text":"guide"');
  expect(text).toContain('"offset":3');
  expect(text).toContain('"url":"https://example.com/guide"');
  expect(text).toContain("album=9223372036854775807");
  expect(text).toContain("> 😀 guide");
  expect(
    new MarkdownEncoder("UTC", self).message(message(11, 1))
  ).not.toContain("media=");
});
