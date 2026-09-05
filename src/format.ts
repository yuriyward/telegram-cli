import type { Message, Peer, tl } from "@mtcute/bun";

import type { AttachmentResult } from "./downloads.ts";
import { json } from "./json.ts";
import { MarkdownEncoder } from "./markdown.ts";

export interface PeerSummary {
  id: number;
  name: string;
  type: string;
  username: string | null;
}

export const peerSummary = (peer: Peer): PeerSummary => ({
  id: peer.id,
  name: peer.displayName,
  type: peer.type,
  username: peer.username,
});

export class ExportEncoder {
  private readonly users = new Map<number, tl.TypeUser>();
  private readonly chats = new Map<number, tl.TypeChat>();
  private readonly markdown: MarkdownEncoder;
  private readonly format: "json" | "markdown";

  constructor(
    format: "json" | "markdown",
    timezone: string,
    self?: PeerSummary
  ) {
    this.format = format;
    this.markdown = new MarkdownEncoder(timezone, self);
  }

  message(
    message: Message,
    count: number,
    attachment?: AttachmentResult
  ): string {
    if (this.format === "json") {
      for (const [id, user] of message._peers.users) {
        this.users.set(id, user);
      }
      for (const [id, chat] of message._peers.chats) {
        this.chats.set(id, chat);
      }
      return `${count === 0 ? "" : ",\n"}${json(message.raw)}`;
    }
    return this.markdown.message(message, attachment);
  }

  finish(
    complete: boolean,
    count: number,
    attachments?: readonly AttachmentResult[]
  ): string {
    const result = json({ complete, count });
    if (this.format === "markdown") {
      const failed =
        attachments?.filter((item) => item.status === "failed").length ?? 0;
      const media =
        attachments === undefined
          ? ""
          : ` photosDownloaded=${attachments.length - failed} photosFailed=${failed}`;
      return `\nmessages=${count} complete=${complete}${media}\n`;
    }
    const media =
      attachments === undefined ? "" : `,"attachments":${json(attachments)}`;
    return `\n],"users":${json([...this.users.values()])},"chats":${json([...this.chats.values()])}${media},"result":${result}}\n`;
  }
}
