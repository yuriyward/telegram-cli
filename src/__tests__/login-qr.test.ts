import { expect, test } from "bun:test";

import { User } from "@mtcute/bun";

import { renderLoginQr } from "../login-qr.ts";
import { login } from "../session.ts";

test("renders a terminal QR and scan instructions without printing the token URL", async () => {
  const url = "tg://login?token=local-test-token";
  const rendered = await renderLoginQr(url, new Date("2026-09-05T12:00:00Z"));
  expect(rendered).toContain("Settings > Devices > Link Desktop Device");
  expect(rendered).toContain("2026-09-05T12:00:00.000Z");
  expect(rendered).not.toContain(url);
  expect(rendered).toMatch(/[▀▄█]/u);
});

test("QR login selects the SDK QR flow and preserves password and abort handling", async () => {
  const user = new User({ _: "user", firstName: "Fixture", id: 42 });
  const result = await login(
    {
      start: async (params) => {
        expect(params?.qrCodeHandler).toBeFunction();
        expect(params?.phone).toBeUndefined();
        expect(params?.code).toBeUndefined();
        expect(params?.password).toBeFunction();
        expect(params?.abortSignal).toBeInstanceOf(AbortSignal);
        return await Promise.resolve(user);
      },
    },
    new AbortController().signal,
    true
  );
  expect(result.id).toBe(42);
});
