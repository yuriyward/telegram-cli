import { randomUUID } from "node:crypto";
import { open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

import type { TelegramClient } from "@mtcute/bun";
import { z } from "zod";

import { CliError } from "./errors.ts";
import { peerSummary } from "./format.ts";
import { json } from "./json.ts";

export const aliasName = z
  .string()
  .trim()
  .toLowerCase()
  .normalize()
  .regex(/^\p{L}[\p{L}\p{M}\p{N}_-]{0,63}$/u)
  .refine(
    (name) => name !== "me" && name !== "self",
    "Reserved peer reference"
  );
const aliasEntry = z.object({
  accountId: z.number().int().positive(),
  alias: aliasName,
  peer: z.object({
    id: z.number().int(),
    name: z.string(),
    type: z.string(),
    username: z.string().nullable(),
  }),
});
const aliasStore = z.object({
  aliases: z.array(aliasEntry),
  schemaVersion: z.literal(1),
});

export const loadAliases = async (directory: string) => {
  try {
    return aliasStore.parse(
      JSON.parse(await readFile(path.join(directory, "aliases.json"), "utf-8"))
    ).aliases;
  } catch (error) {
    if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success) {
      return [];
    }
    throw error;
  }
};

export const exactPeer = (value: string): number | string | undefined => {
  if (/^-?\d+$/u.test(value)) {
    return z.coerce
      .number()
      .int()
      .refine((id) => id !== 0)
      .parse(value);
  }
  if (
    /^@[a-z0-9_]{1,32}$/iu.test(value) ||
    value === "me" ||
    value === "self"
  ) {
    return value;
  }
  return undefined;
};

export const resolveReference = async (
  client: Pick<TelegramClient, "getMe">,
  directory: string,
  value: string
): Promise<number | string> => {
  const exact = exactPeer(value);
  if (exact !== undefined) {
    return exact;
  }
  const entries = await loadAliases(directory);
  const name = value.trim().toLowerCase().normalize();
  const entry = entries.find((item) => item.alias === name);
  if (entry === undefined) {
    throw new CliError(
      "PEER_NOT_FOUND",
      "Use a marked ID, @username, me, or an exact saved alias. Discover peers with chats list."
    );
  }
  const self = await client.getMe();
  if (self.id !== entry.accountId) {
    throw new CliError(
      "ALIAS_ACCOUNT_MISMATCH",
      "Alias belongs to another account; explicitly recreate it with aliases set --replace."
    );
  }
  return entry.peer.id;
};

export const aliasesByPeer = async (
  client: Pick<TelegramClient, "getMe">,
  directory: string
): Promise<Map<number, string[]>> => {
  const entries = await loadAliases(directory);
  const result = new Map<number, string[]>();
  if (entries.length === 0) {
    return result;
  }
  const self = await client.getMe();
  for (const entry of entries) {
    if (entry.accountId !== self.id) {
      continue;
    }
    const names = result.get(entry.peer.id) ?? [];
    names.push(entry.alias);
    result.set(entry.peer.id, names);
  }
  return result;
};

// Call inside withClient: its session lock serializes alias reads and writes.
export const setAlias = async (
  client: Pick<TelegramClient, "getMe" | "getPeer">,
  directory: string,
  name: string,
  target: string,
  replace: boolean
) => {
  const alias = aliasName.parse(name);
  const reference = exactPeer(target);
  if (reference === undefined) {
    throw new CliError(
      "PEER_NOT_FOUND",
      "Alias targets must be a marked ID, @username, or me; display names and other aliases are not accepted."
    );
  }
  const entries = await loadAliases(directory);
  const previous = entries.find((item) => item.alias === alias);
  // Initialize the session before resolving numeric IDs from its peer cache.
  const self = await client.getMe();
  const peer = await client.getPeer(reference);
  const entry = { accountId: self.id, alias, peer: peerSummary(peer) };
  if (
    previous !== undefined &&
    !replace &&
    (previous.accountId !== entry.accountId ||
      previous.peer.id !== entry.peer.id)
  ) {
    throw new CliError(
      "ALIAS_EXISTS",
      "Alias points to a different recipient. Use --replace only after checking the target."
    );
  }
  const temporary = path.join(directory, `aliases-${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(
        json({
          aliases: [...entries.filter((item) => item.alias !== alias), entry],
          schemaVersion: 1,
        })
      );
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path.join(directory, "aliases.json"));
  } catch (error) {
    await unlink(temporary);
    throw error;
  }
  return entry;
};
