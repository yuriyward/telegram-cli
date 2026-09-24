import type { Message } from "@mtcute/bun";

export interface ReactionMetadata {
  chosen?: true;
  count: number;
  customEmojiId?: string;
  emoji?: string;
  paid?: true;
}

export const reactionMetadata = (
  message: Message
): ReactionMetadata[] | undefined => {
  const reactions = message.reactions?.reactions.flatMap<ReactionMetadata>(
    (reaction) => {
      const common =
        reaction.order === null
          ? { count: reaction.count }
          : { chosen: true as const, count: reaction.count };
      const value = reaction.raw.reaction;
      if (value._ === "reactionEmoji") {
        return [{ ...common, emoji: value.emoticon }];
      }
      if (value._ === "reactionCustomEmoji") {
        return [{ ...common, customEmojiId: value.documentId.toString() }];
      }
      return value._ === "reactionPaid"
        ? [{ ...common, emoji: "⭐", paid: true }]
        : [];
    }
  );
  return reactions === undefined || reactions.length === 0
    ? undefined
    : reactions;
};

export const mediaMetadata = (message: Message) => {
  const { media } = message;
  if (media === null) {
    const { raw } = message;
    return raw._ === "message" && raw.media !== undefined
      ? { type: raw.media._.replace(/^messageMedia/u, "").toLowerCase() }
      : undefined;
  }
  if (media.type === "webpage") {
    return {
      title: media.preview.title,
      type: "link-preview",
      url: media.preview.url,
    };
  }
  let type: string = media.type;
  if (media.type === "video") {
    type = media.isRound ? "video-note" : media.type;
    if (media.isAnimation) {
      type = "animation";
    }
  }
  return {
    emoji: media.type === "sticker" ? media.emoji : undefined,
    filename: "fileName" in media ? (media.fileName ?? undefined) : undefined,
    mime: "mimeType" in media ? media.mimeType : undefined,
    seconds: "duration" in media ? media.duration : undefined,
    type,
  };
};

export const messageMetadata = (message: Message) => {
  const { raw } = message;
  if (raw._ === "messageService") {
    return {
      reactions: reactionMetadata(message),
      reply: raw.replyTo,
      service: raw.action,
    };
  }
  const links = raw.entities?.flatMap((entity) =>
    entity._ === "messageEntityTextUrl"
      ? [
          {
            length: entity.length,
            offset: entity.offset,
            text: raw.message.slice(
              entity.offset,
              entity.offset + entity.length
            ),
            url: entity.url,
          },
        ]
      : []
  );
  return {
    album: raw.groupedId?.toString(),
    edited:
      raw.editDate === undefined
        ? undefined
        : new Date(raw.editDate * 1000).toISOString(),
    forward: raw.fwdFrom,
    links: links !== undefined && links.length > 0 ? links : undefined,
    media: mediaMetadata(message),
    reactions: reactionMetadata(message),
    reply: raw.replyTo,
  };
};

export const messageRecord = (message: Message) => ({
  chatId: message.chat.id,
  date: message.date.toISOString(),
  id: message.id,
  sender: { id: message.sender.id, name: message.sender.displayName },
  text: message.text,
  ...messageMetadata(message),
});
