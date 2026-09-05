import type { Message, Peer } from "@mtcute/bun";

import type { AttachmentResult } from "./downloads.ts";
import type { PeerSummary } from "./format.ts";
import { json } from "./json.ts";
import { messageMetadata } from "./message-metadata.ts";

const identity = (peer: Peer): string =>
  `${json(peer.displayName)}[${peer.type === "user" ? "u" : "c"}${peer.id}]`;

const attachmentMarkdown = (attachment?: AttachmentResult): string => {
  if (attachment?.status === "downloaded" && attachment.path !== undefined) {
    const url = attachment.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")
      .replaceAll("(", "%28")
      .replaceAll(")", "%29");
    return `\n![photo #${attachment.messageId}](<${url}>)\n`;
  }
  if (attachment?.status === "failed") {
    return `\ndownload-error=${json(attachment.error)}\n`;
  }
  return "";
};

const attributes = (
  message: Message,
  attachment?: AttachmentResult
): string[] => {
  const { raw } = message;
  const result: string[] = [];
  if (raw.replyTo?._ === "messageReplyHeader") {
    const { _: _constructor, replyToMsgId, ...context } = raw.replyTo;
    if (replyToMsgId !== undefined) {
      result.push(`reply=#${replyToMsgId}`);
    }
    if (Object.keys(context).length > 0) {
      result.push(`reply-context=${json(context)}`);
    }
  }
  if (raw._ === "messageService") {
    result.push(`service=${json(raw.action)}`);
  } else {
    const metadata = messageMetadata(message);
    if (metadata.media !== undefined) {
      const { type, ...details } = metadata.media;
      const state = attachment?.status ?? "not downloaded";
      result.push(`[${type}; ${state}]`);
      if (Object.values(details).some((value) => value !== undefined)) {
        result.push(`media=${json(details)}`);
      }
    }
    if (metadata.album !== undefined) {
      result.push(`album=${metadata.album}`);
    }
    if (metadata.links !== undefined) {
      result.push(`links=${json(metadata.links)}`);
    }
    if (metadata.edited !== undefined) {
      result.push(`edited=${metadata.edited}`);
    }
    if (metadata.forward !== undefined) {
      result.push(`forward=${json(metadata.forward)}`);
    }
  }
  return result;
};

export class MarkdownEncoder {
  private day = "";
  private readonly dateFormatter: Intl.DateTimeFormat;
  private readonly timeFormatter: Intl.DateTimeFormat;
  private readonly self: PeerSummary | undefined;

  constructor(timezone: string, self?: PeerSummary) {
    this.self = self;
    this.dateFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
    });
    this.timeFormatter = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      second: "2-digit",
      timeZone: timezone,
    });
  }

  message(message: Message, attachment?: AttachmentResult): string {
    const { chat } = message;
    const direct = chat.type === "user";
    const date = this.dateFormatter.format(message.date);
    let prefix = "";
    if (this.day === "") {
      const layout = direct ? "direct" : "group";
      prefix += `layout=${layout} conversation=${identity(chat)}\n\n`;
    }
    if (date !== this.day) {
      prefix += `## ${date}\n`;
      this.day = date;
      if (direct && this.self !== undefined) {
        prefix += `me=${json(this.self.name)}[u${this.self.id}]`;
        if (chat.id !== this.self.id) {
          prefix += `; peer=${identity(chat)}`;
        }
        prefix += "\n";
      }
      prefix += "\n";
    }
    let sender = identity(message.sender);
    if (direct && this.self !== undefined) {
      if (message.sender.id === this.self.id) {
        sender = "me";
      } else if (message.sender.id === chat.id) {
        sender = "peer";
      }
    }
    const header = [
      this.timeFormatter.format(message.date),
      `#${message.id}`,
      sender,
      ...attributes(message, attachment),
    ].join(" ");
    return `${prefix}${header}\n> ${message.text.replaceAll("\n", "\n> ")}\n${attachmentMarkdown(attachment)}\n`;
  }
}
