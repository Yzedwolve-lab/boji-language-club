import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createSelfHostedService } from "./self-hosted";
import { SelfHostedStore } from "./self-hosted-store";

let directory: string;
let env: Record<string, string>;
let currentTime: number;
const origin = "http://127.0.0.1:3100";
const password = "test-only-password-at-least-16";
const resolveHost = async () => [{ address: "93.184.216.34", family: 4 }];
const completion = (content: unknown) =>
  Response.json({
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(content) } },
    ],
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
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "boji-self-hosted-test-"));
  currentTime = Date.parse("2026-10-15T03:00:00Z");
  env = {
    APP_MODE: "self_hosted",
    ENABLE_OPENAI_COMPATIBLE: "true",
    OPENAI_COMPAT_BASE_URL: "https://provider.example/v1",
    OPENAI_COMPAT_API_KEY: "test-key-not-real",
    OPENAI_COMPAT_MODEL: "test-model",
    BOJI_SELF_HOSTED_PASSWORD: password,
    BOJI_SELF_HOSTED_ORIGIN: origin,
    BOJI_PRIVATE_DIR: directory,
    BOJI_DAILY_AI_CALL_LIMIT: "40",
  };
});
afterEach(async () => {
  const target = resolve(directory);
  const parent = resolve(tmpdir());
  if (!target.startsWith(`${parent}${sep}boji-self-hosted-test-`))
    throw new Error("Unsafe test cleanup path");
  await rm(target, { recursive: true, force: true });
});

describe("personal self-hosted AI boundary", () => {
  function setup(
    transport = vi.fn(async () => completion({ connected: true })),
  ) {
    return {
      transport,
      service: createSelfHostedService({
        env,
        fetcher: transport,
        resolveHost,
        now: () => currentTime,
      }),
    };
  }
  async function connect(service: ReturnType<typeof createSelfHostedService>) {
    const response = await service.handle(
      request("connect", { password }),
      "connect",
    );
    expect(response.status).toBe(200);
    return response.headers.get("set-cookie")!.split(";")[0];
  }
  it("configuration status does not claim a connection or call a model", async () => {
    const { service, transport } = setup();
    const response = await service.handle(request("status"), "status");
    expect(await response.json()).toEqual({
      mode: "self_hosted",
      configured: true,
      authenticated: false,
      connected: false,
      setup: { available: false, configuredVia: "environment" },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(transport).not.toHaveBeenCalled();
  });
  it("demo and invalid password configuration cannot activate paid endpoints", async () => {
    const validEnvironment = { ...env };
    for (const overrides of [
      { APP_MODE: "demo" },
      { BOJI_SELF_HOSTED_PASSWORD: "too-short" },
      { ENABLE_OPENAI_COMPATIBLE: "false" },
    ] as Array<Record<string, string>>) {
      env = { ...validEnvironment, ...overrides };
      const { service, transport } = setup();
      expect(
        (await service.handle(request("connect", { password }), "connect"))
          .status,
      ).toBe(503);
      expect(transport).not.toHaveBeenCalled();
    }
  });
  it("requires authentication before either paid endpoint", async () => {
    const { service, transport } = setup();
    for (const path of ["plan", "nutrition"])
      expect((await service.handle(request(path, {}), path)).status).toBe(401);
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects wrong passwords and hostile or missing origins before any AI call", async () => {
    const { service, transport } = setup();
    expect(
      (
        await service.handle(
          request("connect", { password: "wrong" }),
          "connect",
        )
      ).status,
    ).toBe(401);
    for (const value of ["https://evil.example", "null", ""])
      expect(
        (
          await service.handle(
            request("connect", { password }, "", { Origin: value }),
            "connect",
          )
        ).status,
      ).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });
  it("sets a session only after genuine provider output and keeps it across service recreation", async () => {
    const { service, transport } = setup();
    const response = await service.handle(
      request("connect", { password }),
      "connect",
    );
    expect(transport).toHaveBeenCalledTimes(1);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(await response.json()).toMatchObject({
      connected: true,
      authenticated: true,
    });
    const second = createSelfHostedService({
      env,
      resolveHost,
      fetcher: transport,
      now: () => currentTime,
    });
    expect(
      await (
        await second.handle(
          request("status", undefined, cookie.split(";")[0]),
          "status",
        )
      ).json(),
    ).toMatchObject({ connected: true });
    const disk = await readFile(join(directory, "usage.json"), "utf8");
    expect(disk).not.toContain(password);
    expect(disk).not.toContain(env.OPENAI_COMPAT_API_KEY);
    expect(disk).not.toContain("provider.example");
  });
  it("does not issue a session or leak provider errors after a failed connection", async () => {
    const transport = vi.fn(async () => {
      throw new Error(`leak ${password} ${env.OPENAI_COMPAT_API_KEY}`);
    });
    const { service } = setup(transport);
    const response = await service.handle(
      request("connect", { password }),
      "connect",
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).not.toContain(password);
    expect(
      JSON.parse(await readFile(join(directory, "usage.json"), "utf8")).calls,
    ).toBe(1);
  });
  it("rejects a misleading connection response instead of claiming success", async () => {
    const { service } = setup(
      vi.fn(async () => completion({ connected: false })),
    );
    const response = await service.handle(
      request("connect", { password }),
      "connect",
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("revokes the server session on disconnect so a copied cookie cannot be replayed", async () => {
    const { service, transport } = setup();
    const cookie = await connect(service);
    const disconnected = await service.handle(
      request("disconnect", {}, cookie),
      "disconnect",
    );
    expect(disconnected.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(
      (
        await service.handle(
          request("nutrition", { food: "2 eggs", coverage: "partial" }, cookie),
          "nutrition",
        )
      ).status,
    ).toBe(401);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    "BOJI_SELF_HOSTED_PASSWORD",
    "OPENAI_COMPAT_API_KEY",
    "OPENAI_COMPAT_MODEL",
  ])("invalidates old cookies when %s changes", async (key) => {
    const { service } = setup();
    const cookie = await connect(service);
    env[key] = `${env[key]}-changed`;
    expect(
      await (
        await service.handle(request("status", undefined, cookie), "status")
      ).json(),
    ).toMatchObject({ connected: false });
  });
  it("expires the session after 12 hours and rejects tampering", async () => {
    const { service } = setup();
    const cookie = await connect(service);
    expect(
      await (
        await service.handle(
          request("status", undefined, `${cookie}forged`),
          "status",
        )
      ).json(),
    ).toMatchObject({ authenticated: false });
    currentTime += 12 * 60 * 60_000;
    expect(
      await (
        await service.handle(request("status", undefined, cookie), "status")
      ).json(),
    ).toMatchObject({ authenticated: false });
  });
  it("persists six connection attempts per 15 minutes across service recreation", async () => {
    const { service, transport } = setup();
    for (let index = 0; index < 6; index++)
      expect(
        (
          await service.handle(
            request("connect", { password: "bad" }),
            "connect",
          )
        ).status,
      ).toBe(401);
    const restarted = createSelfHostedService({
      env,
      resolveHost,
      fetcher: transport,
      now: () => currentTime,
    });
    expect(
      (await restarted.handle(request("connect", { password }), "connect"))
        .status,
    ).toBe(429);
    expect(transport).not.toHaveBeenCalled();
    currentTime += 15 * 60_000;
    expect(
      (await restarted.handle(request("connect", { password }), "connect"))
        .status,
    ).toBe(200);
  });
  it("persists daily reservations and resets only on a later UTC date", async () => {
    env.BOJI_DAILY_AI_CALL_LIMIT = "1";
    const { service, transport } = setup();
    const cookie = await connect(service);
    const input = { food: "2 eggs", coverage: "partial" };
    const restarted = createSelfHostedService({
      env,
      resolveHost,
      fetcher: transport,
      now: () => currentTime,
    });
    expect(
      (await restarted.handle(request("nutrition", input, cookie), "nutrition"))
        .status,
    ).toBe(429);
    currentTime -= 24 * 60 * 60_000;
    expect(
      (await restarted.handle(request("connect", { password }), "connect"))
        .status,
    ).toBe(429);
    currentTime += 48 * 60 * 60_000;
    expect(
      (await restarted.handle(request("connect", { password }), "connect"))
        .status,
    ).toBe(200);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed nutrition before reserving or sending a request", async () => {
    const { service, transport } = setup();
    const cookie = await connect(service);
    for (const body of [
      { food: "", coverage: "partial" },
      { food: "x".repeat(10001), coverage: "partial" },
      { food: "eggs", coverage: "partial", endpoint: "https://evil.example" },
    ])
      expect(
        (await service.handle(request("nutrition", body, cookie), "nutrition"))
          .status,
      ).toBe(400);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(await readFile(join(directory, "usage.json"), "utf8")).calls,
    ).toBe(1);
  });
  it("returns unknown nutrition as null without storing the original text on the server", async () => {
    const transport = vi.fn(async () => completion({ connected: true }));
    const { service } = setup(transport);
    const cookie = await connect(service);
    transport.mockImplementation(async () =>
      completion({
        language: {
          status: "english",
          explanation: "A regional dish name is reasonable English.",
          suggestedEnglish: null,
          corrections: [],
        },
        items: [],
        unresolvedFoods: [
          {
            sourceText: "a bowl of secret family stew",
            reason: "Ingredients and portion are unknown.",
          },
        ],
        uncertainties: ["Please describe the ingredients."],
      }),
    );
    const response = await service.handle(
      request(
        "nutrition",
        { food: "a bowl of secret family stew", coverage: "partial" },
        cookie,
      ),
      "nutrition",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      originalFood: "a bowl of secret family stew",
      recordedTotals: { kcal: null },
      dailyTotals: null,
      assessment: "not_evaluated",
    });
    expect(await readFile(join(directory, "usage.json"), "utf8")).not.toContain(
      "secret family stew",
    );
  });
  it("fails closed on damaged persistent limits instead of resetting the budget", async () => {
    await writeFile(join(directory, "usage.json"), "broken json");
    const { service, transport } = setup();
    expect(
      (await service.handle(request("connect", { password }), "connect"))
        .status,
    ).toBe(503);
    expect(transport).not.toHaveBeenCalled();
    expect(await readFile(join(directory, "usage.json"), "utf8")).toBe(
      "broken json",
    );
  });
  it("serializes concurrent persistent reservations so the last quota cannot be overspent", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        new SelfHostedStore(directory).reserveCall(currentTime, 3),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(3);
    expect(
      JSON.parse(await readFile(join(directory, "usage.json"), "utf8")).calls,
    ).toBe(3);
  });
});
