import type { Peer } from "@mtcute/bun";

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
