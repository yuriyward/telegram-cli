import { expect, test } from "bun:test";

import { Chat, User } from "@mtcute/bun";
import Long from "long";

import { matchPeer, peerKind } from "../peers.ts";

const person = new User({
  _: "user",
  firstName: "Example Person",
  id: 42,
  username: "example_person",
});
const bot = new User({
  _: "user",
  bot: true,
  firstName: "Example Bot",
  id: 43,
});
const group = new Chat({ _: "chatForbidden", id: 44, title: "Example Group" });
const supergroup = new Chat({
  _: "channelForbidden",
  accessHash: Long.ONE,
  id: 45,
  megagroup: true,
  title: "Example Supergroup",
});
const channel = new Chat({
  _: "channelForbidden",
  accessHash: Long.ONE,
  broadcast: true,
  id: 46,
  title: "Example Channel",
});

test("people, bots, basic groups, supergroups and broadcast channels are distinct", () => {
  expect([person, bot, group, supergroup, channel].map(peerKind)).toEqual([
    "person",
    "bot",
    "group",
    "group",
    "channel",
  ]);
  expect(matchPeer(person, "example", "person")).not.toBeNull();
  expect(matchPeer(group, "example", "person")).toBeNull();
  expect(matchPeer(supergroup, "example", "group")).not.toBeNull();
  expect(matchPeer(channel, "example", "group")).toBeNull();
  expect(matchPeer(bot, "example", "person")).toBeNull();
});

test("discovery matches names and usernames, including @ prefixes and whitespace", () => {
  expect(matchPeer(person, "  @EXAMPLE_PERSON  ", "all")).toEqual([
    { field: "username", value: "example_person" },
  ]);
  expect(matchPeer(person, "Example Person", "all")).toEqual([
    { field: "name", value: "Example Person" },
  ]);
  expect(matchPeer(person, "someone else", "all")).toBeNull();
  expect(matchPeer(person, "", "person")).toEqual([]);
});

test("discovery explains alias matches and preserves kind filtering", () => {
  expect(matchPeer(person, " TEAM ", "person", ["teammate", "колега"])).toEqual(
    [{ field: "alias", value: "teammate" }]
  );
  expect(matchPeer(person, "КОЛЕГА", "person", ["колега"])).toEqual([
    { field: "alias", value: "колега" },
  ]);
  expect(matchPeer(person, "колега", "group", ["колега"])).toBeNull();
  expect(matchPeer(person, "колега", "person")).toBeNull();
  expect(matchPeer(person, "example", "person", ["example-teammate"])).toEqual([
    { field: "name", value: "Example Person" },
    { field: "username", value: "example_person" },
    { field: "alias", value: "example-teammate" },
  ]);
});
