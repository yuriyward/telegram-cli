import { tl } from "@mtcute/bun";
import { CommanderError } from "commander";
import { z } from "zod";

import { DownloadFailureError } from "./download-error.ts";
import { ExportFailureError } from "./export.ts";
import type { ExportReceipt } from "./export.ts";
import { SendFailureError } from "./send.ts";

export class CliError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

interface ErrorDetails {
  code: string;
  exitCode: number;
  message: string;
  partial: ExportReceipt | undefined;
  downloadPartial: string | undefined;
  sent: SendFailureError["sent"] | undefined;
  recovery: string;
  schemaVersion: number;
  status: "error";
}

const recovery = new Map([
  [
    "NO_ATTACHMENT",
    "Choose a message containing an attached photo or file, not a link preview.",
  ],
  [
    "DOWNLOAD_SIZE_MISMATCH",
    "Keep the incomplete .partial file separate; retry to a new output filename.",
  ],
  [
    "ALIAS_EXISTS",
    "Check aliases list and the target ID before using aliases set --replace.",
  ],
  [
    "ALIAS_ACCOUNT_MISMATCH",
    "Use an explicit peer reference or recreate the alias for this account.",
  ],
  [
    "PEER_NOT_FOUND",
    "Discover peers with chats list; use an exact ID, @username, or saved alias.",
  ],
  [
    "DRAFT_EXISTS",
    "Inspect drafts get before explicitly saving with --replace.",
  ],
  [
    "MESSAGE_NOT_FOUND",
    "Check the chat and message ID; deleted or inaccessible messages cannot be retrieved.",
  ],
  ["AUTH_KEY_UNREGISTERED", "Run tg auth login --interactive in a terminal."],
  [
    "CONFIG_REQUIRED",
    "Set TELEGRAM_API_ID and TELEGRAM_API_HASH from my.telegram.org/apps.",
  ],
  ["EACCES", "Check permissions on the session directory and output path."],
  [
    "EEXIST",
    "Choose a new output filename; existing files are never overwritten.",
  ],
  ["ENOENT", "Create the output parent directory or correct the path."],
  [
    "SESSION_LOCKED",
    "Wait for the other tg process. After a crash, verify the PID in session.lock is no longer running before removing that lock file.",
  ],
  ["SESSION_REQUIRED", "Run tg auth login --interactive in a terminal."],
  ["SESSION_REVOKED", "Run tg auth login --interactive in a terminal."],
]);

export const errorDetails = (error: Error): ErrorDetails => {
  const cause =
    (error instanceof ExportFailureError ||
      error instanceof DownloadFailureError ||
      error instanceof SendFailureError) &&
    error.cause instanceof Error
      ? error.cause
      : error;
  const system = z.object({ code: z.string() }).safeParse(cause);
  const usage =
    cause instanceof CommanderError ||
    cause instanceof z.ZodError ||
    cause instanceof RangeError;
  let code = usage ? "INVALID_ARGUMENT" : "COMMAND_FAILED";
  if (system.success) {
    ({ code } = system.data);
  }
  if (tl.RpcError.is(cause)) {
    code = cause.text;
  }
  return {
    code,
    downloadPartial:
      error instanceof DownloadFailureError ? error.partial : undefined,
    exitCode: usage ? 2 : 1,
    message: cause.message,
    partial: error instanceof ExportFailureError ? error.receipt : undefined,
    recovery:
      error instanceof SendFailureError
        ? "Messages in sent were delivered. Check the chat before resending only the rest; a timed-out send may also have arrived."
        : (recovery.get(code) ??
          "Check the arguments and Telegram access. For a flood wait, wait the seconds specified in the error before retrying with a new output filename."),
    schemaVersion: 1,
    sent: error instanceof SendFailureError ? error.sent : undefined,
    status: "error",
  };
};
