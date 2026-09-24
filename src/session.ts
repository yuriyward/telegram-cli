import { existsSync } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { input, password } from "@inquirer/prompts";
import { TelegramClient } from "@mtcute/bun";
import type { User } from "@mtcute/bun";
import { LogManager } from "@mtcute/core/utils.js";
import { z } from "zod";

import { CliError } from "./errors.ts";
import { renderLoginQr } from "./login-qr.ts";

export const defaultSessionDirectory = path.join(
  process.env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state"),
  "telegram-cli"
);

const credentials = z.object({
  TELEGRAM_API_HASH: z.string().regex(/^[\da-f]{32}$/iu),
  TELEGRAM_API_ID: z.coerce.number().int().positive(),
});

export const withClient = async <T>(
  directory: string,
  operation: (client: TelegramClient) => Promise<T>,
  allowLogin = false
): Promise<T> => {
  const result = credentials.safeParse(process.env);
  if (!result.success) {
    throw new CliError(
      "CONFIG_REQUIRED",
      "Set TELEGRAM_API_ID and TELEGRAM_API_HASH in your environment or local .env file."
    );
  }
  const storage = path.join(directory, "account.session");
  if (!allowLogin && !existsSync(storage)) {
    throw new CliError("SESSION_REQUIRED", "No saved Telegram session.");
  }
  process.umask(0o077);
  await mkdir(directory, { mode: 0o700, recursive: true });
  const lockPath = path.join(directory, "session.lock");
  if (existsSync(lockPath)) {
    throw new CliError("SESSION_LOCKED", `Session is locked: ${lockPath}`);
  }
  const lock = await open(lockPath, "wx", 0o600);
  let client: TelegramClient | undefined;
  try {
    await lock.writeFile(`${process.pid}\n`);
    client = new TelegramClient({
      apiHash: result.data.TELEGRAM_API_HASH,
      apiId: result.data.TELEGRAM_API_ID,
      disableUpdates: !allowLogin,
      logLevel: LogManager.OFF,
      storage,
    });
    await client.prepare();
    return await operation(client);
  } finally {
    try {
      await client?.destroy();
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
};

export const login = async (
  client: Pick<TelegramClient, "start">,
  signal: AbortSignal,
  qr = false
): Promise<User> => {
  const rendering = new AbortController();
  const loginSignal = AbortSignal.any([signal, rendering.signal]);
  const context = { output: process.stderr, signal: loginSignal };
  const user = await client.start({
    abortSignal: loginSignal,
    ...(qr
      ? {
          qrCodeHandler: (url: string, expires: Date): void => {
            renderLoginQr(url, expires)
              .then((code) => {
                if (!loginSignal.aborted) {
                  process.stderr.write(code);
                }
              })
              .catch(() => {
                rendering.abort(
                  new Error("Could not render the Telegram login QR code.")
                );
              });
          },
        }
      : {
          code: async () =>
            await password({ message: "Telegram login code:" }, context),
          phone: async () =>
            await input(
              { message: "Telegram phone number (including country code):" },
              context
            ),
        }),
    codeSentCallback: (code) => {
      process.stderr.write(
        code.type === "app"
          ? "Telegram reports delivery to the verified Telegram service chat on your other devices. If no code arrives, cancel and use auth login --interactive --qr.\n"
          : `Login code delivery: ${code.type}\n`
      );
    },
    invalidCodeCallback: (kind) => {
      process.stderr.write(`Invalid ${kind}; try again.\n`);
    },
    password: async () =>
      await password(
        { message: "Telegram two-step verification password:" },
        context
      ),
  });
  if (user.isBot) {
    throw new Error(
      "A user account is required; this session belongs to a bot."
    );
  }
  return user;
};
