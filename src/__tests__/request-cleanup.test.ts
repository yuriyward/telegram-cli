import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

let directory: string;
beforeEach(async () => {
  await mkdir(".tmp", { recursive: true });
  directory = await mkdtemp(path.resolve(".tmp/request-cleanup-"));
});
afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

// Exercise the pinned dependency's real request timers without a Telegram connection.
test.each(["success", "rpc-error", "rejection", "abort", "reset", "timeout"])(
  "request cleanup exits promptly after %s",
  async (outcome) => {
    const child = Bun.spawn(
      [
        "bun",
        "--eval",
        `
        import { withClient } from './src/session.ts';
        import { DcConnectionManager } from './node_modules/@mtcute/core/network/network-manager.js';
        const outcome = process.argv[2];
        await withClient(process.argv[1], async (client) => {
          await client.prepare();
          const mt = client._client.mt;
          const dc = new DcConnectionManager(mt.network, mt._defaultDcs.main.id, mt._defaultDcs, true);
          const connection = dc.main._connections[0];
          const controller = new AbortController();
          try {
            const result = connection.sendRpc(
              { _: 'help.getNearestDc' }, outcome === 'timeout' ? 20 : 60000, controller.signal
            );
            if (['success', 'rpc-error', 'rejection'].includes(outcome)) {
              const rpc = connection._session.queuedRpc.popFront();
              rpc.done = true;
              if (outcome === 'rejection') rpc.promise.reject(new Error('fixture rejection'));
              else rpc.promise.resolve(outcome === 'success'
                ? { _: 'nearestDc', country: 'XX', thisDc: 2, nearestDc: 2 }
                : { _: 'mt_rpc_error', errorCode: 400, errorMessage: 'FIXTURE_ERROR' });
            } else if (outcome === 'abort') controller.abort(new Error('fixture abort'));
            else if (outcome === 'reset') connection.reset(true);
            try {
              const value = await result;
              process.stdout.write(value.errorMessage ?? value._);
            } catch (error) {
              process.stdout.write(error.message);
            }
          } finally {
            await dc.destroy();
          }
        }, true);
        `,
        directory,
        outcome,
      ],
      {
        cwd: path.resolve(import.meta.dir, "../.."),
        env: {
          ...Bun.env,
          TELEGRAM_API_HASH: "a".repeat(32),
          TELEGRAM_API_ID: "12345",
        },
        stderr: "pipe",
        stdin: "ignore",
        stdout: "pipe",
      }
    );
    const watchdog = setTimeout(() => {
      child.kill();
    }, 2000);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toBe(
        {
          abort: "fixture abort",
          rejection: "fixture rejection",
          reset: "Session is reset",
          "rpc-error": "FIXTURE_ERROR",
          success: "nearestDc",
          timeout: "TIMEOUT",
        }[outcome]
      );
      expect(
        await Bun.file(path.join(directory, "session.lock")).exists()
      ).toBe(false);
    } finally {
      clearTimeout(watchdog);
    }
  }
);
