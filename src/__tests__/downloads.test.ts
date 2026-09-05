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

import { Message, PeersIndex, Photo, tl } from "@mtcute/bun";
import type { TelegramClient } from "@mtcute/bun";
import Long from "long";
import { z } from "zod";

import { dateRange } from "../dates.ts";
import { DownloadFailureError } from "../download-error.ts";
import { downloadAttachment, PhotoDownloads } from "../downloads.ts";
import { errorDetails } from "../errors.ts";
import { exportMessages } from "../export.ts";
import { json } from "../json.ts";

let directory: string;
beforeEach(async () => {
  await mkdir(".tmp", { recursive: true });
  directory = await mkdtemp(path.resolve(".tmp/download-test-"));
});
afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

const peers = PeersIndex.from({
  users: [{ _: "user", firstName: "Example Person", id: 2 }],
});
const photo: tl.RawMessageMediaPhoto = {
  _: "messageMediaPhoto",
  photo: {
    _: "photo",
    accessHash: Long.ZERO,
    date: 1,
    dcId: 1,
    fileReference: new Uint8Array(),
    id: Long.ONE,
    sizes: [
      { _: "photoSize", h: 10, size: 1, type: "m", w: 10 },
      { _: "photoSizeProgressive", h: 20, sizes: [1, 4], type: "y", w: 20 },
    ],
  },
};
const document: tl.RawMessageMediaDocument = {
  _: "messageMediaDocument",
  document: {
    _: "document",
    accessHash: Long.ZERO,
    attributes: [
      { _: "documentAttributeFilename", fileName: "../../outside.pdf" },
    ],
    date: 1,
    dcId: 1,
    fileReference: new Uint8Array(),
    id: Long.ONE,
    mimeType: "application/pdf",
    size: 4,
  },
};
const item = (
  id: number,
  media?: tl.TypeMessageMedia,
  date = 1_782_864_000
): Message => {
  const raw: tl.RawMessage = {
    _: "message",
    date,
    fromId: { _: "peerUser", userId: 2 },
    id,
    message: "Exact caption",
    peerId: { _: "peerUser", userId: 2 },
  };
  if (media !== undefined) {
    raw.media = media;
  }
  return new Message(raw, peers);
};
const source = async function* source(
  items: Message[]
): AsyncGenerator<Message> {
  yield* items;
};
const client = () => ({
  downloadAsStream: mock<TelegramClient["downloadAsStream"]>(
    () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4]));
          controller.close();
        },
      })
  ),
});
const settings = (format: "json" | "markdown", name = "export") => ({
  ...dateRange("2026-07-01", "2026-07-02", "UTC"),
  chat: "2",
  format,
  output: path.join(directory, `${name}.${format}`),
});

test("downloads largest photo, streams bytes, and publishes private files", async () => {
  const api = client();
  const output = path.join(directory, "photo.jpg");
  const result = await downloadAttachment(api, item(10, photo), output);
  expect(result).toMatchObject({
    bytes: 4,
    chatId: 2,
    messageId: 10,
    path: output,
    status: "downloaded",
  });
  expect([...(await readFile(output))]).toEqual([1, 2, 3, 4]);
  const location = api.downloadAsStream.mock.calls[0]?.[0];
  expect(location).toBeInstanceOf(Photo);
  if (!(location instanceof Photo)) {
    throw new Error("Expected photo fixture");
  }
  expect(location.location).toMatchObject({ thumbSize: "y" });
  expect(api.downloadAsStream.mock.calls[0]?.[1]).toMatchObject({
    highWaterMark: 1_048_576,
    stallTimeout: 60_000,
  });
  expect(api.downloadAsStream.mock.calls[0]?.[1]?.abortSignal?.aborted).toBe(
    true
  );
  const info = await stat(output);
  // eslint-disable-next-line no-bitwise -- POSIX file permissions are a bitmask.
  expect(info.mode & 0o777).toBe(0o600);
  expect(await readdir(directory)).toEqual(["photo.jpg"]);
});

test("single-message downloads accept documents without using sender-controlled paths", async () => {
  const output = path.join(directory, "document.bin");
  const result = await downloadAttachment(client(), item(10, document), output);
  expect(result.originalName).toBe("../../outside.pdf");
  expect(result.path).toBe(output);
  expect(await readdir(directory)).toEqual(["document.bin"]);
});

test("existing destination and partial files are never overwritten", async () => {
  const api = client();
  const output = path.join(directory, "existing.bin");
  await writeFile(output, "original");
  await rejects(downloadAttachment(api, item(10, document), output), {
    code: "EEXIST",
  });
  const next = path.join(directory, "next.bin");
  await writeFile(`${next}.partial`, "original partial");
  await rejects(downloadAttachment(api, item(10, document), next), {
    code: "EEXIST",
  });
  expect(await readFile(output, "utf-8")).toBe("original");
  expect(await readFile(`${next}.partial`, "utf-8")).toBe("original partial");
  expect(api.downloadAsStream).not.toHaveBeenCalled();
});

test("truncated bytes remain partial and errors retain the recovery path", async () => {
  const api = client();
  api.downloadAsStream.mockImplementation(
    () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      })
  );
  const output = path.join(directory, "truncated.jpg");
  let details;
  try {
    await downloadAttachment(api, item(10, photo), output);
  } catch (error) {
    expect(error).toBeInstanceOf(DownloadFailureError);
    details = errorDetails(z.instanceof(Error).parse(error));
  }
  expect(details?.code).toBe("DOWNLOAD_SIZE_MISMATCH");
  expect(details?.downloadPartial).toBe(`${output}.partial`);
  expect(await readdir(directory)).toEqual(["truncated.jpg.partial"]);
  expect([...(await readFile(`${output}.partial`))]).toEqual([1]);
});

test("cancellation prevents publishing even when the last chunk has arrived", async () => {
  const cancellation = new AbortController();
  const api = client();
  api.downloadAsStream.mockImplementation(
    () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          cancellation.abort(new Error("Stopped"));
          controller.close();
        },
      })
  );
  const output = path.join(directory, "cancelled.bin");
  await rejects(
    downloadAttachment(api, item(10, document), output, cancellation.signal),
    DownloadFailureError
  );
  expect(await readdir(directory)).toEqual(["cancelled.bin.partial"]);
});

test("link previews and text-only messages never trigger downloads", async () => {
  const api = client();
  const preview = item(11, {
    _: "messageMediaWebPage",
    webpage: {
      _: "webPage",
      displayUrl: "example.com",
      hash: 0,
      id: Long.ONE,
      url: "https://example.com",
    },
  });
  await rejects(
    downloadAttachment(api, item(10), path.join(directory, "text")),
    { code: "NO_ATTACHMENT" }
  );
  await rejects(
    downloadAttachment(api, preview, path.join(directory, "preview")),
    { code: "NO_ATTACHMENT" }
  );
  const photos = new PhotoDownloads(api, path.join(directory, "export.json"));
  expect(await photos.download(preview)).toBeUndefined();
  expect(await photos.download(item(12, document))).toBeUndefined();
  expect(api.downloadAsStream).not.toHaveBeenCalled();
  expect(await readdir(directory)).toEqual([]);
});

test("photo export links images in Markdown and downloads only in-range photos", async () => {
  const api = client();
  const options = settings("markdown", "export (sample)");
  const photos = new PhotoDownloads(api, options.output);
  const receipt = await exportMessages(
    source([
      item(9, photo, 1_782_863_999),
      item(10, photo),
      item(11, document),
      item(12, photo, 1_782_950_400),
    ]),
    { ...options, photos }
  );
  expect(receipt.count).toBe(2);
  expect(receipt.media).toEqual({ complete: true, downloaded: 1, failed: 0 });
  expect(api.downloadAsStream).toHaveBeenCalledTimes(1);
  const text = await readFile(receipt.output, "utf-8");
  expect(text).toContain("[photo; downloaded]");
  expect(text).toContain(
    "![photo #10](<export%20%28sample%29.markdown.media/message-10.jpg>)"
  );
  expect(text).toContain("[document; not downloaded]");
  expect(text).toContain("> Exact caption");
  expect(text).toContain("photosDownloaded=1 photosFailed=0");
  const info = await stat(`${options.output}.media`);
  // eslint-disable-next-line no-bitwise -- POSIX file permissions are a bitmask.
  expect(info.mode & 0o777).toBe(0o700);
});

test("raw messages stay unchanged and attachment references live alongside them", async () => {
  const options = settings("json");
  const message = item(10, photo);
  const receipt = await exportMessages(source([message]), {
    ...options,
    photos: new PhotoDownloads(client(), options.output),
  });
  const data = z
    .object({
      attachments: z.array(
        z.object({
          messageId: z.number(),
          path: z.string(),
          status: z.string(),
        })
      ),
      messages: z.array(z.record(z.string(), z.json())),
    })
    .parse(JSON.parse(await readFile(receipt.output, "utf-8")));
  expect(json(data.messages[0])).toBe(json(message.raw));
  expect(data.attachments[0]).toMatchObject({
    messageId: 10,
    path: "export.json.media/message-10.jpg",
    status: "downloaded",
  });
});

test("failed photo downloads preserve all text and report failed media", async () => {
  const api = client();
  api.downloadAsStream.mockImplementation(
    () =>
      new ReadableStream({
        start(controller) {
          controller.error(new tl.RpcError(400, "FILE_REFERENCE_EXPIRED"));
        },
      })
  );
  const options = settings("markdown");
  const photos = new PhotoDownloads(api, options.output);
  const receipt = await exportMessages(source([item(10, photo), item(11)]), {
    ...options,
    photos,
  });
  expect(receipt.complete).toBe(true);
  expect(receipt.count).toBe(2);
  expect(receipt.media).toEqual({ complete: false, downloaded: 0, failed: 1 });
  expect(photos.results[0]).toMatchObject({
    error: { code: "FILE_REFERENCE_EXPIRED" },
    partial: "export.markdown.media/message-10.jpg.partial",
    status: "failed",
  });
  const text = await readFile(receipt.output, "utf-8");
  expect(text).toContain("[photo; failed]");
  expect(text).toContain("FILE_REFERENCE_EXPIRED");
  expect(text).toContain("#11");
  expect(text).not.toContain("![photo");
});

test("exports remain metadata-only by default", async () => {
  const options = settings("json");
  const receipt = await exportMessages(source([item(10, photo)]), options);
  expect(receipt.media).toBeUndefined();
  expect(await readdir(directory)).toEqual(["export.json"]);
  expect(await readFile(receipt.output, "utf-8")).not.toContain(
    '"attachments"'
  );
});
