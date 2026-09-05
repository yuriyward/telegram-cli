import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { rejects } from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { Dialog, PeersIndex, User } from "@mtcute/bun";
import type { TelegramClient, tl } from "@mtcute/bun";

import {
  aliasName,
  aliasesByPeer,
  exactPeer,
  loadAliases,
  resolveReference,
  setAlias,
} from "../aliases.ts";
import { getDraft, saveDraft } from "../drafts.ts";

let directory: string;
beforeEach(async () => {
  await mkdir(".tmp", { recursive: true });
  directory = await mkdtemp(path.resolve(".tmp/account-tools-test-"));
});
afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

const user = (id: number): User =>
  new User({ _: "user", firstName: "Example Person", id });
const client = () => ({
  getMe: mock<TelegramClient["getMe"]>(
    async () => await Promise.resolve(user(1))
  ),
  getPeer: mock<TelegramClient["getPeer"]>(
    async () => await Promise.resolve(user(2))
  ),
});

test("aliases are exact, account-bound, private, atomic, and normalized", async () => {
  const api = client();
  expect(await loadAliases(directory)).toEqual([]);
  const entry = await setAlias(
    api,
    directory,
    " Teammate ",
    "@example_person",
    false
  );
  expect(entry.alias).toBe("teammate");
  expect(entry.accountId).toBe(1);
  expect(entry.peer.id).toBe(2);
  expect(await resolveReference(api, directory, "TEAMMATE")).toBe(2);
  expect(await readdir(directory)).toEqual(["aliases.json"]);
  const info = await stat(path.join(directory, "aliases.json"));
  // eslint-disable-next-line no-bitwise -- POSIX file permissions are a bitmask.
  expect(info.mode & 0o777).toBe(0o600);
  await rejects(resolveReference(api, directory, "team"), {
    code: "PEER_NOT_FOUND",
  });
  api.getMe.mockImplementation(async () => await Promise.resolve(user(3)));
  await rejects(resolveReference(api, directory, "teammate"), {
    code: "ALIAS_ACCOUNT_MISMATCH",
  });
});

test("alias repointing requires replacement and failure preserves the old file", async () => {
  const api = client();
  await setAlias(api, directory, "teammate", "2", false);
  const before = await readFile(path.join(directory, "aliases.json"), "utf-8");
  api.getPeer.mockImplementation(async () => await Promise.resolve(user(3)));
  await rejects(setAlias(api, directory, "teammate", "3", false), {
    code: "ALIAS_EXISTS",
  });
  expect(await readFile(path.join(directory, "aliases.json"), "utf-8")).toBe(
    before
  );
  await setAlias(api, directory, "teammate", "3", true);
  expect(await resolveReference(api, directory, "teammate")).toBe(3);
});

test("explicit peer references avoid account lookups; ambiguous targets and reserved names fail", async () => {
  const api = client();
  await Promise.all(
    ["me", "@example_person", "2", "-3"].map(async (value) => {
      const expected = exactPeer(value);
      if (expected === undefined) {
        throw new Error("Invalid fixture reference");
      }
      expect(await resolveReference(api, directory, value)).toBe(expected);
    })
  );
  expect(api.getMe).not.toHaveBeenCalled();
  for (const name of ["me", "self", "123", "@example_person", "../alias"]) {
    expect(aliasName.safeParse(name).success).toBe(false);
  }
  expect(() => exactPeer("9007199254740992")).toThrow();
  expect(() => exactPeer("0")).toThrow();
  expect(exactPeer("@abc")).toBe("@abc");
  await rejects(setAlias(api, directory, "teammate", "Example Person", false), {
    code: "PEER_NOT_FOUND",
  });
  expect(api.getPeer).not.toHaveBeenCalled();
});

test("corrupt alias storage fails closed", async () => {
  await writeFile(path.join(directory, "aliases.json"), "not json");
  await rejects(loadAliases(directory));
});

test("alias creation initializes the session before resolving a cached numeric peer", async () => {
  const api = client();
  let initialized = false;
  api.getMe.mockImplementation(async () => {
    await Promise.resolve();
    initialized = true;
    return user(1);
  });
  api.getPeer.mockImplementation(async () => {
    expect(initialized).toBe(true);
    return await Promise.resolve(user(2));
  });
  await setAlias(api, directory, "teammate", "2", false);
});

test("Unicode aliases normalize consistently and discovery excludes other accounts", async () => {
  const api = client();
  expect(await aliasesByPeer(api, directory)).toEqual(new Map());
  expect(api.getMe).not.toHaveBeenCalled();
  await setAlias(api, directory, " КОЛЕГА ", "2", false);
  await setAlias(api, directory, "cafe\u0301", "2", false);
  expect(await resolveReference(api, directory, "колега")).toBe(2);
  expect(await resolveReference(api, directory, "CAFÉ")).toBe(2);
  expect(await aliasesByPeer(api, directory)).toEqual(
    new Map([[2, ["колега", "café"]]])
  );
  api.getMe.mockImplementation(async () => await Promise.resolve(user(3)));
  expect(await aliasesByPeer(api, directory)).toEqual(new Map());
  for (const name of ["bad name", "bad\nname", "bad\u200Bname", "bad/alias"]) {
    expect(aliasName.safeParse(name).success).toBe(false);
  }
});

const dialog = (draft?: tl.RawDraftMessage): Dialog => {
  const raw: tl.RawDialog = {
    _: "dialog",
    notifySettings: { _: "peerNotifySettings" },
    peer: { _: "peerUser", userId: 2 },
    readInboxMaxId: 0,
    readOutboxMaxId: 0,
    topMessage: 0,
    unreadCount: 0,
    unreadMentionsCount: 0,
    unreadPollVotesCount: 0,
    unreadReactionsCount: 0,
  };
  if (draft !== undefined) {
    raw.draft = draft;
  }
  return new Dialog(raw, PeersIndex.from({ users: [user(2).raw] }), new Map());
};

test("draft reads preserve raw metadata and writes refuse to overwrite", async () => {
  const draft: tl.RawDraftMessage = {
    _: "draftMessage",
    date: 1,
    message: "Existing draft",
    replyTo: { _: "inputReplyToMessage", replyToMsgId: 9 },
  };
  const api = {
    getPeerDialogs: mock<TelegramClient["getPeerDialogs"]>(
      async () => await Promise.resolve([dialog(draft)])
    ),
    saveDraft: mock<TelegramClient["saveDraft"]>(async () => {}),
  };
  expect(await getDraft(api, 2)).toEqual(draft);
  await rejects(saveDraft(api, 2, "New draft", undefined, false), {
    code: "DRAFT_EXISTS",
  });
  expect(api.saveDraft).not.toHaveBeenCalled();
  expect(await saveDraft(api, 2, "New draft", 10, true)).toEqual({
    chat: 2,
    replaced: true,
    saved: true,
    sent: false,
  });
  expect(api.saveDraft).toHaveBeenCalledWith(2, {
    message: "New draft",
    replyTo: { _: "inputReplyToMessage", replyToMsgId: 10 },
  });
});

test("new drafts preserve plain text exactly; failed checks never write", async () => {
  const api = {
    getPeerDialogs: mock<TelegramClient["getPeerDialogs"]>(
      async () => await Promise.resolve([dialog()])
    ),
    saveDraft: mock<TelegramClient["saveDraft"]>(async () => {}),
  };
  expect(
    await saveDraft(api, 2, " **plain**\n👩‍💻 ", undefined, false)
  ).toMatchObject({ replaced: false, sent: false });
  expect(api.saveDraft).toHaveBeenCalledWith(2, { message: " **plain**\n👩‍💻 " });
  api.saveDraft.mockClear();
  api.getPeerDialogs.mockImplementation(
    async () => await Promise.reject(new Error("network failure"))
  );
  await rejects(saveDraft(api, 2, "Text", undefined, true), /network failure/u);
  expect(api.saveDraft).not.toHaveBeenCalled();
});
