import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

let directory: string;
beforeEach(async () => {
  await mkdir(".tmp", { recursive: true });
  directory = await mkdtemp(path.resolve(".tmp/session-test-"));
});
afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

test("offline initialization loads crypto and releases its lock after failure", async () => {
  const child = Bun.spawn(
    [
      "bun",
      "--eval",
      `
    import { withClient } from './src/session.ts';
    try {
      await withClient(process.argv[1], async (client) => {
        await client.prepare();
        throw new Error('fixture failure');
      }, true);
    } catch (error) {
      process.stdout.write(error.message);
    }
  `,
      directory,
    ],
    {
      cwd: path.resolve(import.meta.dir, "../.."),
      env: {
        ...Bun.env,
        TELEGRAM_API_HASH: "a".repeat(32),
        TELEGRAM_API_ID: "12345",
      },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code).toBe(0);
  expect(stdout).toBe("fixture failure");
  expect(stderr).toBe("");
  expect(await Bun.file(path.join(directory, "session.lock")).exists()).toBe(
    false
  );
  const info = await stat(path.join(directory, "account.session"));
  // eslint-disable-next-line no-bitwise -- POSIX file permissions are a bitmask.
  expect(info.mode & 0o777).toBe(0o600);
});

test("a competing session fails without touching the existing lock", async () => {
  await writeFile(path.join(directory, "account.session"), "fixture");
  await writeFile(path.join(directory, "session.lock"), "123\n");
  const child = Bun.spawn(
    ["bun", "run", "src/cli.ts", "--session-dir", directory, "auth", "status"],
    {
      cwd: path.resolve(import.meta.dir, "../.."),
      env: {
        ...Bun.env,
        TELEGRAM_API_HASH: "a".repeat(32),
        TELEGRAM_API_ID: "12345",
      },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [stderr, code] = await Promise.all([
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code).toBe(1);
  expect(z.object({ code: z.string() }).parse(JSON.parse(stderr)).code).toBe(
    "SESSION_LOCKED"
  );
  expect(await readFile(path.join(directory, "session.lock"), "utf-8")).toBe(
    "123\n"
  );
});
