import type { Peer, TelegramClient } from "@mtcute/bun";

import { peerSummary } from "./format.ts";

export const peerKind = (peer: Peer): string => {
  if (peer.type === "user") {
    return peer.isBot ? "bot" : "person";
  }
  return peer.isGroup ? "group" : peer.chatType;
};

interface PeerMatch {
  field: "name" | "username" | "alias";
  value: string;
}

export const matchPeer = (
  peer: Peer,
  search: string,
  kind: string,
  aliases: readonly string[] = []
): PeerMatch[] | null => {
  if (kind !== "all" && peerKind(peer) !== kind) {
    return null;
  }
  const query = search.trim().replace(/^@/u, "").toLowerCase().normalize();
  if (query === "") {
    return [];
  }
  const candidates: PeerMatch[] = [{ field: "name", value: peer.displayName }];
  if (peer.username !== null) {
    candidates.push({ field: "username", value: peer.username });
  }
  for (const alias of aliases) {
    candidates.push({ field: "alias", value: alias });
  }
  const matches = candidates.filter((candidate) =>
    candidate.value.toLowerCase().normalize().includes(query)
  );
  return matches.length === 0 ? null : matches;
};

export const listChats = async (
  client: Pick<TelegramClient, "iterDialogs">,
  options: { search: string; kind: string; limit: number; unread: boolean },
  aliases: ReadonlyMap<number, readonly string[]>
) => {
  const chats = [];
  let complete = true;
  for await (const dialog of client.iterDialogs({ archived: "keep" })) {
    if (options.unread && dialog.unreadCount === 0) {
      continue;
    }
    const matches = matchPeer(
      dialog.peer,
      options.search,
      options.kind,
      aliases.get(dialog.peer.id)
    );
    if (matches === null) {
      continue;
    }
    if (chats.length === options.limit) {
      complete = false;
      break;
    }
    chats.push({
      ...peerSummary(dialog.peer),
      kind: peerKind(dialog.peer),
      manuallyUnread: dialog.isManuallyUnread,
      matches: matches.length === 0 ? undefined : matches,
      readInboxMaxId: dialog.lastReadIngoing,
      unreadCount: dialog.unreadCount,
    });
  }
  return {
    chats,
    complete,
    count: chats.length,
    unreadCount: chats.reduce((sum, chat) => sum + chat.unreadCount, 0),
  };
};
