import type { Message } from "@mtcute/bun";

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
    return { reply: raw.replyTo, service: raw.action };
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
