import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";

import { FileLocation } from "@mtcute/bun";
import type { Message, TelegramClient } from "@mtcute/bun";

import { DownloadFailureError } from "./download-error.ts";
import { CliError, errorDetails } from "./errors.ts";

export type DownloadClient = Pick<TelegramClient, "downloadAsStream">;

export interface AttachmentResult {
  chatId: number;
  messageId: number;
  status: "downloaded" | "failed";
  path?: string;
  partial?: string;
  bytes?: number;
  originalName?: string | null;
  error?: { code: string; message: string };
}

interface DownloadedAttachment extends AttachmentResult {
  status: "downloaded";
  path: string;
}

export const downloadAttachment = async (
  client: DownloadClient,
  message: Message,
  output?: string,
  signal?: AbortSignal
): Promise<DownloadedAttachment> => {
  signal?.throwIfAborted();
  const { media } = message;
  if (!(media instanceof FileLocation)) {
    throw new CliError(
      "NO_ATTACHMENT",
      "Message has no downloadable attachment. Link previews, polls and locations are not files."
    );
  }
  const originalName = "fileName" in media ? media.fileName : null;
  let extension = path.extname(originalName ?? "").toLowerCase();
  if (!/^\.[a-z0-9]{1,10}$/u.test(extension)) {
    extension = ".bin";
  }
  if (media.type === "photo") {
    extension = ".jpg";
  }
  let destination = output;
  if (destination === undefined) {
    await mkdir("exports", { mode: 0o700, recursive: true });
    destination = path.join(
      "exports",
      `attachment-${randomUUID()}${extension}`
    );
  }
  destination = path.resolve(destination);
  if (existsSync(destination)) {
    throw new CliError(
      "EEXIST",
      "Attachment output already exists; choose a new filename."
    );
  }
  const partial = `${destination}.partial`;
  const file = await open(partial, "wx", 0o600);
  const cancellation = new AbortController();
  const downloadSignal =
    signal === undefined
      ? cancellation.signal
      : AbortSignal.any([signal, cancellation.signal]);
  let bytes = 0;
  try {
    try {
      downloadSignal.throwIfAborted();
      const stream = client.downloadAsStream(media, {
        abortSignal: downloadSignal,
        highWaterMark: 1_048_576,
        stallTimeout: 60_000,
      });
      for await (const chunk of stream) {
        downloadSignal.throwIfAborted();
        await file.writeFile(chunk);
        bytes += chunk.byteLength;
      }
      downloadSignal.throwIfAborted();
      if (media.fileSize !== undefined && bytes !== media.fileSize) {
        throw new CliError(
          "DOWNLOAD_SIZE_MISMATCH",
          `Expected ${media.fileSize} bytes; received ${bytes}.`
        );
      }
      await file.sync();
    } finally {
      cancellation.abort();
      await file.close();
    }
    await link(partial, destination);
    await unlink(partial);
  } catch (error) {
    throw new DownloadFailureError(
      partial,
      error instanceof Error ? error : new Error("Attachment download failed.")
    );
  }
  return {
    bytes,
    chatId: message.chat.id,
    messageId: message.id,
    originalName,
    path: destination,
    status: "downloaded",
  };
};

export class PhotoDownloads {
  readonly results: AttachmentResult[] = [];
  private directoryReady: Promise<void> | undefined;
  private readonly directory: string;
  private readonly parent: string;
  private readonly client: DownloadClient;
  private readonly signal: AbortSignal | undefined;

  constructor(client: DownloadClient, output: string, signal?: AbortSignal) {
    this.client = client;
    this.signal = signal;
    this.directory = `${path.resolve(output)}.media`;
    this.parent = path.dirname(path.resolve(output));
  }

  async download(message: Message): Promise<AttachmentResult | undefined> {
    if (
      message.raw._ !== "message" ||
      message.raw.media?._ !== "messageMediaPhoto"
    ) {
      return undefined;
    }
    let result: AttachmentResult;
    try {
      this.directoryReady ??= mkdir(this.directory, { mode: 0o700 });
      await this.directoryReady;
      const saved = await downloadAttachment(
        this.client,
        message,
        path.join(this.directory, `message-${message.id}.jpg`),
        this.signal
      );
      result = { ...saved, path: path.relative(this.parent, saved.path) };
    } catch (error) {
      this.signal?.throwIfAborted();
      const details = errorDetails(
        error instanceof Error ? error : new Error("Photo download failed.")
      );
      result = {
        chatId: message.chat.id,
        error: { code: details.code, message: details.message },
        messageId: message.id,
        status: "failed",
      };
      if (error instanceof DownloadFailureError) {
        result.partial = path.relative(this.parent, error.partial);
      }
    }
    this.results.push(result);
    return result;
  }

  summary() {
    const failed = this.results.filter(
      (item) => item.status === "failed"
    ).length;
    return {
      complete: failed === 0,
      downloaded: this.results.length - failed,
      failed,
    };
  }
}
