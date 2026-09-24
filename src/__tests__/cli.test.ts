import { expect, test } from "bun:test";
import path from "node:path";

import { Command } from "commander";
import { z } from "zod";

import { registerMessageCommands } from "../commands.ts";

const failure = z.object({
  code: z.string(),
  recovery: z.string(),
  status: z.literal("error"),
});
const invoke = async (
  args: readonly string[],
  input?: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const process = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: path.resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, TELEGRAM_API_HASH: "", TELEGRAM_API_ID: "" },
    stderr: "pipe",
    stdin: input === undefined ? "ignore" : new Blob([input]),
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, stderr, stdout };
};

test.each([
  {
    args: ["--chat", "42", "--query", "example phrase"],
    command: "search",
    since: "all",
  },
  {
    args: [
      "--chat",
      "42",
      "--query",
      "example phrase",
      "--since",
      "2026-01-01",
    ],
    command: "search",
    since: "2026-01-01",
  },
  {
    args: ["--chat", "42", "--query", "example phrase"],
    command: "read",
    since: "today",
  },
])(
  "search and read have independent date defaults: %j",
  ({ args, command, since }) => {
    const messages = new Command("messages");
    registerMessageCommands(messages, {
      directory: () => ".tmp/unused",
      run: async () => {
        await Promise.resolve();
      },
      signal: new AbortController().signal,
    });
    const selected = messages.commands.find(
      (entry) => entry.name() === command
    );
    expect(selected).toBeDefined();
    selected?.parseOptions([...args]);
    expect(selected?.opts()).toMatchObject({ query: "example phrase", since });
  }
);

test("whole-chat search needs no dates and advertises its scope", async () => {
  const help = await invoke(["messages", "search", "--help"]);
  expect(help.stdout.replaceAll(/\s+/gu, " ")).toContain(
    "Search the entire chat"
  );
  expect(help.stdout.replaceAll(/\s+/gu, " ")).toContain('(default: "all")');
  const result = await invoke([
    "messages",
    "search",
    "--chat",
    "42",
    "--query",
    "example phrase",
  ]);
  expect(result.exitCode).toBe(1);
  expect(failure.parse(JSON.parse(result.stderr)).code).toBe("CONFIG_REQUIRED");
});

test("help runs without credentials", async () => {
  const result = await invoke(["messages", "export", "--help"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("--since");
  expect(result.stdout).toContain("--timezone");
  expect(result.stdout).toContain("--download-photos");
  expect(result.stdout).toContain("all,");
  expect(result.stdout).toContain("unique file in exports/");
  expect(result.stdout.replaceAll(/\s+/gu, " ")).toContain(
    "inline group senders"
  );
  expect(result.stderr).toBe("");
});

test.each([
  { args: ["messages", "export"] },
  {
    args: [
      "messages",
      "export",
      "--chat",
      "42",
      "--since",
      "2026-02-30",
      "--output",
      "unused.json",
    ],
  },
  { args: ["chats", "list", "--limit", "0"] },
  { args: ["chats", "list", "--kind", "invalid"] },
  { args: ["unknown"] },
])("invalid invocation returns a JSON error: %j", async ({ args }) => {
  const result = await invoke(args);
  expect(result.exitCode).toBe(2);
  expect(result.stdout).toBe("");
  expect(failure.parse(JSON.parse(result.stderr)).status).toBe("error");
});

test("discovery exposes kind filters and full exports need no output filename", async () => {
  const help = await invoke(["chats", "list", "--help"]);
  expect(help.stdout).toContain("--kind");
  expect(help.stdout).toContain("--unread");
  expect(help.stdout).toContain("--all");
  expect(help.stdout.replaceAll(/\s+/gu, " ")).toContain("private aliases");
  expect(help.stdout).toContain("Results explain matches.");
  const result = await invoke([
    "messages",
    "export",
    "--chat",
    "42",
    "--since",
    "all",
  ]);
  expect(result.exitCode).toBe(1);
  expect(failure.parse(JSON.parse(result.stderr)).code).toBe("CONFIG_REQUIRED");
});

test("missing credentials fail without opening a session", async () => {
  const result = await invoke(["auth", "status"]);
  expect(result.exitCode).toBe(1);
  expect(failure.parse(JSON.parse(result.stderr)).code).toBe("CONFIG_REQUIRED");
});

test("headless login fails instead of prompting", async () => {
  const result = await invoke(["auth", "login", "--interactive"]);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(failure.parse(JSON.parse(result.stderr)).status).toBe("error");
});

test("QR login is discoverable and still requires an interactive terminal", async () => {
  const help = await invoke(["auth", "login", "--help"]);
  expect(help.stdout).toContain("--qr");
  const result = await invoke(["auth", "login", "--interactive", "--qr"]);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(failure.parse(JSON.parse(result.stderr)).status).toBe("error");
});

test.each([
  { command: ["messages", "unread"], flag: "--after" },
  { command: ["messages", "unread"], flag: "--replies" },
  { command: ["messages", "get"], flag: "--replies" },
  { command: ["messages", "read"], flag: "--from" },
  { command: ["messages", "search"], flag: "--query" },
  { command: ["messages", "context"], flag: "--id" },
  { command: ["messages", "download"], flag: "--output" },
  { command: ["aliases", "set"], flag: "--replace" },
  { command: ["aliases", "list"], flag: "authenticated account" },
  { command: ["drafts", "get"], flag: "--chat" },
  { command: ["drafts", "save"], flag: "--text-file" },
  { command: ["messages", "send"], flag: "--user-confirmed" },
  { command: ["messages", "send"], flag: "explicitly approved" },
  { command: ["messages", "send"], flag: "- for stdin" },
])("agent command help works offline: %j", async ({ command, flag }) => {
  const result = await invoke([...command, "--help"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.replaceAll(/\s+/gu, " ")).toContain(flag);
  expect(result.stderr).toBe("");
});

test.each(
  [
    ["messages", "get", "--chat", "2"],
    ["messages", "get", "--chat", "2", "--id", "0"],
    ["messages", "unread", "--chat", "2", "--limit", "101"],
    ["messages", "unread", "--chat", "2", "--after", "-1"],
    ["messages", "read", "--chat", "2", "--limit", "101"],
    ["messages", "search", "--chat", "2"],
    ["messages", "download", "--chat", "2"],
    ["messages", "download", "--chat", "2", "--id", "0"],
    ["messages", "read", "--chat", "2", "--before", "0"],
    ["messages", "context", "--chat", "2", "--id", "10", "--after", "51"],
    ["aliases", "set", "--name", "me", "--chat", "2"],
    ["drafts", "save", "--chat", "2"],
    ["messages", "send", "--chat", "2", "--text-file", "unused.txt"],
    ["messages", "send", "--chat", "2", "--user-confirmed"],
    [
      "messages",
      "send",
      "--chat",
      "2",
      "--text-file",
      "unused.txt",
      "--user-confirmed",
      "--reply-to",
      "0",
    ],
    [
      "drafts",
      "save",
      "--chat",
      "2",
      "--text-file",
      "unused.txt",
      "--reply-to",
      "-1",
    ],
  ].map((args) => ({ args }))
)("new commands validate before opening the account: %j", async ({ args }) => {
  const result = await invoke(args);
  expect(result.exitCode).toBe(2);
  expect(failure.parse(JSON.parse(result.stderr)).status).toBe("error");
  expect(result.stdout).toBe("");
});

test("photo export flag is parsed before opening the account", async () => {
  const result = await invoke([
    "messages",
    "export",
    "--chat",
    "2",
    "--since",
    "today",
    "--download-photos",
  ]);
  expect(result.exitCode).toBe(1);
  expect(failure.parse(JSON.parse(result.stderr)).code).toBe("CONFIG_REQUIRED");
});

const send = ["messages", "send", "--chat", "2", "--text-file", "-"];

test.each([
  { input: Array.from({ length: 11 }, () => "Hi").join("\n---\n") },
  { input: "First\n---\n\n---\nThird" },
  { input: "Only\n---\n" },
])("invalid stdin bubbles never open the account: %j", async ({ input }) => {
  const result = await invoke([...send, "--user-confirmed"], input);
  expect(result.exitCode).toBe(2);
  expect(failure.parse(JSON.parse(result.stderr)).code).toBe(
    "INVALID_ARGUMENT"
  );
});

test("stdin bubbles are parsed before opening the account", async () => {
  const result = await invoke(
    [...send, "--user-confirmed"],
    "First line\nsecond line\n---\nDon't $HOME `x`\n"
  );
  expect(result.exitCode).toBe(1);
  expect(failure.parse(JSON.parse(result.stderr)).code).toBe("CONFIG_REQUIRED");
});
