import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createSelfHostedService } from "./self-hosted";
import {
  SETUP_TOKEN_TTL_MS,
  readSelfHostedConfiguration,
} from "./self-hosted-configuration";
import type { SelfHostedAIConfigureInput } from "../ai-types";

let directory: string;
let setupToken: string;
let now: number;
let env: Record<string, string>;
const origin = "http://127.0.0.1:3100";
const password = "test-web-owner-password-16plus";
const providerKey = "test-provider-key-not-real";
const resolveHost = vi.fn(async () => [
  { address: "93.184.216.34", family: 4 },
]);
const completion = () =>
  Response.json({
    choices: [
      { finish_reason: "stop", message: { content: '{"connected":true}' } },
    ],
  });
const form = (
  overrides: Partial<SelfHostedAIConfigureInput> = {},
): SelfHostedAIConfigureInput => ({
  setupToken,
  baseUrl: "https://provider.example/v1",
  apiKey: providerKey,
  model: "example-model",
  password,
  dailyLimit: 40,
  ...overrides,
});
function request(
  path: string,
  body?: unknown,
  cookie = "",
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/api/self-hosted/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Host: "127.0.0.1:3100",
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function installToken(token = setupToken, createdAt = now) {
  await writeFile(
    join(directory, "setup-token.json"),
    JSON.stringify({
      version: 1,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      createdAt: new Date(createdAt).toISOString(),
    }),
  );
}
const service = (transport = vi.fn(async () => completion())) => ({
  transport,
  app: createSelfHostedService({
    env,
    fetcher: transport,
    resolveHost,
    now: () => now,
  }),
});
async function configure(app: ReturnType<typeof createSelfHostedService>) {
  const response = await app.handle(request("configure", form()), "configure");
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "boji-web-config-test-"));
  setupToken = randomBytes(32).toString("base64url");
  now = Date.parse("2026-10-15T06:00:00Z");
  env = { BOJI_PRIVATE_DIR: directory };
  resolveHost.mockClear();
  resolveHost.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  await installToken();
});
afterEach(async () => {
  const target = resolve(directory);
  if (!target.startsWith(`${resolve(tmpdir())}${sep}boji-web-config-test-`))
    throw new Error("Unsafe test cleanup path");
  await rm(target, { recursive: true, force: true });
});

describe("web configuration authorization and persistence", () => {
  it("permits explicitly enabled first-time loopback configuration without an API key", async () => {
    const { app, transport } = service();
    const response = await app.handle(
      request(
        "configure",
        form({
          baseUrl: "http://127.0.0.1:9000/v1",
          apiKey: "",
          allowLocal: true,
        }),
      ),
      "configure",
    );
    expect(response.status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(resolveHost).not.toHaveBeenCalled();
    const config = (await readSelfHostedConfiguration(env)).config;
    expect(config?.provider.apiKey).toBe("");
  });
  it("advertises setup without exposing its token, key, URL or any provider call", async () => {
    const { app, transport } = service();
    const status = await app.handle(request("status"), "status");
    expect(await status.json()).toEqual({
      mode: "demo",
      configured: false,
      authenticated: false,
      connected: false,
      setup: { available: true, configuredVia: "none" },
    });
    expect(transport).not.toHaveBeenCalled();
    expect(resolveHost).not.toHaveBeenCalled();
    expect(
      (await app.handle(request("configuration"), "configuration")).status,
    ).toBe(401);
  });
  it.each([undefined, "A".repeat(43)])(
    "requires the launch token before any DNS lookup or provider call",
    async (token) => {
      const { app, transport } = service();
      expect(
        (
          await app.handle(
            request("configure", form({ setupToken: token })),
            "configure",
          )
        ).status,
      ).toBe(401);
      expect(transport).not.toHaveBeenCalled();
      expect(resolveHost).not.toHaveBeenCalled();
      await expect(
        readFile(join(directory, "ai-config.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
  it("requires strict matching Host and Origin and JSON even with a valid token", async () => {
    const { app, transport } = service();
    for (const headers of [
      { Host: "evil.example" },
      { Origin: "https://evil.example" },
      { "Content-Type": "text/plain" },
    ] as Array<Record<string, string>>) {
      const response = await app.handle(
        request("configure", form(), "", headers),
        "configure",
      );
      expect([403, 415]).toContain(response.status);
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it("accepts Next's internal Request URL when browser Host and Origin match, without trusting forwarded headers", async () => {
    const { app, transport } = service();
    const internalRequest = new Request(
      "http://localhost:9999/api/self-hosted/configure",
      {
        method: "POST",
        headers: {
          Host: "127.0.0.1:3100",
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form()),
      },
    );
    expect((await app.handle(internalRequest, "configure")).status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await readSelfHostedConfiguration(env)).config?.origin).toBe(
      origin,
    );
    const forged = request("configure", form(), "", {
      Host: "different.example",
      "X-Forwarded-Host": "127.0.0.1:3100",
      "X-Forwarded-Proto": "http",
    });
    expect((await app.handle(forged, "configure")).status).toBe(403);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("expires a token after thirty minutes without creating configuration", async () => {
    now += SETUP_TOKEN_TTL_MS;
    const { app, transport } = service();
    expect(
      await (await app.handle(request("status"), "status")).json(),
    ).toMatchObject({ setup: { available: false } });
    expect(
      (await app.handle(request("configure", form()), "configure")).status,
    ).toBe(401);
    expect(transport).not.toHaveBeenCalled();
  });
  it("never enables file configuration or setup in production mode", async () => {
    const { app, transport } = service();
    await configure(app);
    env.APP_MODE = "production";
    expect(
      await (await app.handle(request("status"), "status")).json(),
    ).toMatchObject({
      configured: false,
      setup: { available: false, configuredVia: "none" },
    });
    expect(
      (await app.handle(request("configure", form()), "configure")).status,
    ).toBe(503);
    expect(
      (await app.handle(request("connect", { password }), "connect")).status,
    ).toBe(503);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("saves only after a successful test, hashes the password, consumes token and works without env or restart", async () => {
    const { app, transport } = service();
    const cookie = await configure(app);
    const fileText = await readFile(join(directory, "ai-config.json"), "utf8");
    const file = JSON.parse(fileText);
    expect(file.apiKey).toBe(providerKey); // Private disk is explicitly not an encrypted vault.
    expect(fileText).not.toContain(password);
    expect(fileText).not.toContain(setupToken);
    expect(file.passwordHash).toMatch(/^[a-f0-9]{64}$/);
    expect(file.passwordSalt).toMatch(/^[a-f0-9]{32}$/);
    await expect(
      readFile(join(directory, "setup-token.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await (
        await app.handle(request("status", undefined, cookie), "status")
      ).json(),
    ).toMatchObject({
      mode: "self_hosted",
      connected: true,
      setup: { available: false, configuredVia: "file" },
    });
    const restarted = createSelfHostedService({
      env,
      fetcher: transport,
      resolveHost,
      now: () => now,
    });
    expect(
      await (
        await restarted.handle(request("status", undefined, cookie), "status")
      ).json(),
    ).toMatchObject({ connected: true });
    const metadata = await restarted.handle(
      request("configuration", undefined, cookie),
      "configuration",
    );
    expect(await metadata.json()).toEqual({
      baseUrl: "https://provider.example/v1",
      model: "example-model",
      dailyLimit: 40,
      tokenParameter: "max_tokens",
      allowLocal: false,
      hasApiKey: true,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("retains token on provider failure and counts the failed request persistently", async () => {
    const { app, transport } = service(
      vi.fn(async () => {
        throw new Error(`${providerKey} raw provider failure`);
      }),
    );
    const response = await app.handle(
      request("configure", form()),
      "configure",
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(providerKey);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(
      JSON.parse(await readFile(join(directory, "usage.json"), "utf8")).calls,
    ).toBe(1);
    await expect(
      readFile(join(directory, "ai-config.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await readFile(join(directory, "setup-token.json"), "utf8"),
    ).not.toContain(setupToken);
    transport.mockImplementation(async () => completion());
    await configure(app);
  });
  it("requires the current password to update even if a fresh launch token exists", async () => {
    const { app, transport } = service();
    const cookie = await configure(app);
    await installToken();
    expect(
      (await app.handle(request("configure", form()), "configure")).status,
    ).toBe(401);
    expect(
      (
        await app.handle(
          request("configure", form({ currentPassword: "wrong" }), cookie),
          "configure",
        )
      ).status,
    ).toBe(401);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("allows password-only recovery when the old provider fails and issues a new session only after a successful repair", async () => {
    const { app, transport } = service();
    const expiredCookie = await configure(app);
    now += 12 * 60 * 60_000;
    transport.mockImplementation(async () =>
      Response.json({ error: "expired provider key" }, { status: 401 }),
    );
    const failedConnect = await app.handle(
      request("connect", { password }),
      "connect",
    );
    expect(failedConnect.status).toBe(502);
    expect(await failedConnect.json()).toEqual({
      error: "provider_authentication_failed",
      message: expect.stringContaining("认证失败"),
    });
    expect(failedConnect.headers.get("set-cookie")).toBeNull();
    const summary = await app.handle(
      request("configuration", { password }),
      "configuration",
    );
    expect(summary.status).toBe(200);
    expect(summary.headers.get("set-cookie")).toBeNull();
    const summaryText = await summary.text();
    expect(JSON.parse(summaryText)).toMatchObject({
      model: "example-model",
      hasApiKey: true,
    });
    expect(summaryText).not.toContain(providerKey);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(
      await (
        await app.handle(request("status", undefined, expiredCookie), "status")
      ).json(),
    ).toMatchObject({ authenticated: false, connected: false });
    // Repair does not depend on a cookie minted by the currently broken provider.
    transport.mockImplementation(async () => completion());
    const repair = await app.handle(
      request(
        "configure",
        form({
          currentPassword: password,
          password: "",
          setupToken: undefined,
          apiKey: "replacement-test-key",
        }),
      ),
      "configure",
    );
    expect(repair.status).toBe(200);
    expect(repair.headers.get("set-cookie")).toContain("HttpOnly");
    expect(await repair.json()).toMatchObject({ connected: true });
    expect(transport).toHaveBeenCalledTimes(3);
    expect(
      JSON.parse(await readFile(join(directory, "ai-config.json"), "utf8"))
        .apiKey,
    ).toBe("replacement-test-key");
  });
  it("protects password recovery with origin checks, persistent rate limits and no provider calls", async () => {
    const { app, transport } = service();
    await configure(app);
    now += 16 * 60_000;
    const wrongOrigin = await app.handle(
      request("configuration", { password }, "", {
        Origin: "https://evil.example",
      }),
      "configuration",
    );
    expect(wrongOrigin.status).toBe(403);
    for (let index = 0; index < 6; index++)
      expect(
        (
          await app.handle(
            request("configuration", { password: "wrong" }),
            "configuration",
          )
        ).status,
      ).toBe(401);
    const restarted = createSelfHostedService({
      env,
      fetcher: transport,
      resolveHost,
      now: () => now,
    });
    expect(
      (
        await restarted.handle(
          request("configuration", { password }),
          "configuration",
        )
      ).status,
    ).toBe(429);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("does not expose password recovery in production mode", async () => {
    const { app, transport } = service();
    await configure(app);
    env.APP_MODE = "production";
    expect(
      (
        await app.handle(
          request("configuration", { password }),
          "configuration",
        )
      ).status,
    ).toBe(503);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("retains an empty key on the same endpoint but requires a new key on any endpoint change", async () => {
    const { app, transport } = service();
    const cookie = await configure(app);
    const next = await app.handle(
      request(
        "configure",
        form({
          currentPassword: password,
          apiKey: "",
          password: "",
          model: "updated-model",
        }),
        cookie,
      ),
      "configure",
    );
    expect(next.status).toBe(200);
    expect(
      JSON.parse(await readFile(join(directory, "ai-config.json"), "utf8"))
        .apiKey,
    ).toBe(providerKey);
    const newCookie = next.headers.get("set-cookie")!.split(";")[0];
    const before = await readFile(join(directory, "ai-config.json"), "utf8");
    expect(
      (
        await app.handle(
          request(
            "configure",
            form({
              currentPassword: password,
              apiKey: "",
              baseUrl: "https://different.example/v1",
            }),
            newCookie,
          ),
          "configure",
        )
      ).status,
    ).toBe(400);
    expect(await readFile(join(directory, "ai-config.json"), "utf8")).toBe(
      before,
    );
    expect(transport).toHaveBeenCalledTimes(2);
    expect(
      await (
        await app.handle(request("status", undefined, cookie), "status")
      ).json(),
    ).toMatchObject({ connected: false });
  });
  it("preserves the previous bytes and usable session after a failed update", async () => {
    const { app, transport } = service();
    const cookie = await configure(app);
    const before = await readFile(join(directory, "ai-config.json"), "utf8");
    transport.mockImplementation(async () =>
      Response.json({ error: "fake" }, { status: 500 }),
    );
    expect(
      (
        await app.handle(
          request(
            "configure",
            form({ currentPassword: password, model: "broken-model" }),
            cookie,
          ),
          "configure",
        )
      ).status,
    ).toBe(503);
    expect(await readFile(join(directory, "ai-config.json"), "utf8")).toBe(
      before,
    );
    expect(
      await (
        await app.handle(request("status", undefined, cookie), "status")
      ).json(),
    ).toMatchObject({ connected: true });
  });
  it("rejects concurrent configure submissions without a second billable request", async () => {
    let finish!: () => void;
    let started!: () => void;
    const began = new Promise<void>((resolveStarted) => {
      started = resolveStarted;
    });
    const { app, transport } = service(
      vi.fn(async () => {
        started();
        await new Promise<void>((resolveFinish) => {
          finish = resolveFinish;
        });
        return completion();
      }),
    );
    const first = app.handle(request("configure", form()), "configure");
    await began;
    expect(
      (await app.handle(request("configure", form()), "configure")).status,
    ).toBe(409);
    finish();
    expect((await first).status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("detects launcher token rotation during the provider test before saving", async () => {
    const { app } = service(
      vi.fn(async () => {
        await installToken(randomBytes(32).toString("base64url"));
        return completion();
      }),
    );
    const response = await app.handle(
      request("configure", form()),
      "configure",
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(
      readFile(join(directory, "ai-config.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("fails closed if the configuration cannot be atomically installed", async () => {
    const { app } = service(
      vi.fn(async () => {
        await mkdir(join(directory, "ai-config.json"));
        return completion();
      }),
    );
    const response = await app.handle(
      request("configure", form()),
      "configure",
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(
      await readFile(join(directory, "setup-token.json"), "utf8"),
    ).toContain("tokenHash");
  });
  it("persists failed setup attempts and refuses a seventh attempt before provider work", async () => {
    const { app, transport } = service();
    for (let i = 0; i < 6; i++)
      await app.handle(
        request("configure", form({ setupToken: "A".repeat(43) })),
        "configure",
      );
    const restarted = createSelfHostedService({
      env,
      fetcher: transport,
      resolveHost,
      now: () => now,
    });
    expect(
      (await restarted.handle(request("configure", form()), "configure"))
        .status,
    ).toBe(429);
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects oversized fields and attempts to select filesystem paths", async () => {
    const { app, transport } = service();
    expect(
      (
        await app.handle(
          request("configure", form({ apiKey: "x".repeat(4097) })),
          "configure",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.handle(
          request("configure", { ...form(), privateDirectory: "/public" }),
          "configure",
        )
      ).status,
    ).toBe(400);
    expect(transport).not.toHaveBeenCalled();
  });
  it("blocks a public hostname resolving to any private address before sending the key", async () => {
    resolveHost.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    const { app, transport } = service();
    const response = await app.handle(request("configure", form()), "configure");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "unsafe_provider_address",
      message: expect.stringContaining("公开 HTTPS"),
    });
    expect(transport).not.toHaveBeenCalled();
    await expect(
      readFile(join(directory, "ai-config.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("keeps environment configuration usable and permits authorized migration to file", async () => {
    Object.assign(env, {
      APP_MODE: "self_hosted",
      ENABLE_OPENAI_COMPATIBLE: "true",
      OPENAI_COMPAT_BASE_URL: "https://provider.example/v1",
      OPENAI_COMPAT_API_KEY: providerKey,
      OPENAI_COMPAT_MODEL: "env-model",
      BOJI_SELF_HOSTED_PASSWORD: password,
      BOJI_SELF_HOSTED_ORIGIN: origin,
    });
    const { app } = service();
    const login = await app.handle(request("connect", { password }), "connect");
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const update = await app.handle(
      request(
        "configure",
        form({ currentPassword: password, password: "", apiKey: "" }),
        cookie,
      ),
      "configure",
    );
    expect(update.status).toBe(200);
    expect((await readSelfHostedConfiguration(env)).via).toBe("file");
    expect(
      (await app.handle(request("connect", { password }), "connect")).status,
    ).toBe(200);
  });
});
