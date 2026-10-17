import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createAIConnectionService } from "./ai-connection-service";
import { ApiError } from "./errors";
import { ChatGPTAppStore } from "./chatgpt-app-store";
import { writeFile } from "node:fs/promises";

let directory: string;
const origin = "http://127.0.0.1:3100";
let clock = Date.parse("2026-10-15T03:00:00Z");
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
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}
function sse(value: unknown) {
  return new Response(
    `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ id: "msg-service-fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }] } })}\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "boji-chatgpt-service-test-"));
  clock = Date.parse("2026-10-15T03:00:00Z");
});
afterEach(async () => {
  vi.restoreAllMocks();
  const target = resolve(directory);
  if (
    !target.startsWith(`${resolve(tmpdir())}${sep}boji-chatgpt-service-test-`)
  )
    throw new Error("Unsafe test path");
  await rm(target, { recursive: true, force: true });
});
function setup(overrides: Record<string, string> = {}) {
  let signedIn = false;
  let accountId = "account-1";
  const auth = {
    start: vi.fn(async () => ({
      authorizationUrl:
        "https://auth.openai.com/api/accounts/authorize?state=test-state",
      attemptId: "test-attempt",
    })),
    complete: vi.fn(
      async ({ attemptId }: { url: string; attemptId: string }) => {
        if (attemptId !== "test-attempt")
          throw new ApiError(
            400,
            "chatgpt_state_invalid",
            "Invalid test attempt",
          );
        signedIn = true;
        return {
          signedIn: true,
          sharing: true,
          accountId,
          email: "test@example.invalid",
          name: "Test",
        };
      },
    ),
    getSummary: vi.fn(async () => ({
      signedIn,
      sharing: signedIn,
      ...(signedIn
        ? { accountId, email: "test@example.invalid", name: "Test" }
        : {}),
    })),
    getAccessToken: vi.fn(async () => "synthetic-oauth-token"),
    signOut: vi.fn(async () => {
      signedIn = false;
      return { remoteRevocationConfirmed: false };
    }),
    cancel: vi.fn(async () => {}),
  };
  const transport = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/models"))
        return Response.json({
          models: [
            {
              slug: "test-model",
              display_name: "Test Model",
              visibility: "list",
            },
          ],
        });
      if (String(input).endsWith("/chat/completions"))
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: { content: '{"connected":true}' },
            },
          ],
        });
      const body = JSON.parse(String(init?.body));
      if (body.input?.[0]?.content?.includes("originalFood"))
        return sse({
          language: {
            status: "english",
            explanation: "Food phrase",
            suggestedEnglish: null,
            corrections: [],
          },
          items: [
            {
              sourceText: "2 eggs",
              name: "eggs",
              quantity: 2,
              unit: "piece",
              quantityAssumed: false,
              assumption: null,
              preparation: "cooked",
              nutrition: {
                kcal: { min: 130, max: 170 },
                proteinG: { min: 11, max: 14 },
                carbsG: { min: 0, max: 2 },
                fatG: { min: 9, max: 12 },
              },
            },
          ],
          unresolvedFoods: [],
          uncertainties: ["Egg size unknown"],
        });
      return sse({ connected: true });
    },
  );
  const env = { BOJI_PRIVATE_DIR: directory, ...overrides };
  const options = {
    env,
    auth,
    fetcher: transport,
    now: () => clock,
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
  };
  return {
    auth,
    transport,
    options,
    changeAccount: () => {
      accountId = "account-2";
    },
    service: createAIConnectionService(options),
  };
}
async function signIn(service: ReturnType<typeof createAIConnectionService>) {
  const start = await service.handle(
    request("chatgpt/start", {}),
    "chatgpt/start",
  );
  expect(start.status).toBe(200);
  expect(start.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax");
  const callback = await service.handle(
    request("chatgpt/callback?code=test&state=test", undefined, cookies(start)),
    "chatgpt/callback",
  );
  expect(callback.status).toBe(303);
  expect(callback.headers.get("location")).toBe(`${origin}/#chatgpt=connected`);
  expect(callback.headers.get("referrer-policy")).toBe("no-referrer");
  return cookies(callback);
}
async function connect(
  service: ReturnType<typeof createAIConnectionService>,
  cookie: string,
) {
  const result = await service.handle(
    request("chatgpt/connect", {}, cookie),
    "chatgpt/connect",
  );
  expect(await result.clone().json()).toMatchObject({
    provider: "chatgpt",
    connected: true,
    chatgpt: { model: "test-model" },
  });
  expect(result.status).toBe(200);
  return `${cookie}; ${cookies(result)}`;
}
describe("ChatGPT and API Key routing", () => {
  it("offers local login without an API key or bootstrap token; status never calls a provider", async () => {
    const { service, transport } = setup();
    const data = await (
      await service.handle(request("status"), "status")
    ).json();
    expect(data).toMatchObject({
      connected: false,
      provider: null,
      apiKey: { configured: false },
      chatgpt: { available: true, signedIn: false },
    });
    expect(transport).not.toHaveBeenCalled();
    expect(JSON.stringify(data)).not.toContain("synthetic-oauth-token");
  });
  it("binds callback to a browser attempt and does not claim a tested connection after sign-in", async () => {
    const { service, auth, transport } = setup();
    const invalid = await service.handle(
      request("chatgpt/callback?code=test&state=test"),
      "chatgpt/callback",
    );
    expect(invalid.headers.get("location")).toContain("chatgpt=error");
    expect(auth.complete).not.toHaveBeenCalled();
    const cookie = await signIn(service);
    const data = await (
      await service.handle(request("status", undefined, cookie), "status")
    ).json();
    expect(data).toMatchObject({
      connected: false,
      chatgpt: {
        signedIn: true,
        sharing: true,
        connected: false,
        email: "test@example.invalid",
      },
    });
    expect(transport).not.toHaveBeenCalled();
    const privateStatus = await (
      await service.handle(request("status"), "status")
    ).json();
    expect(privateStatus.chatgpt).not.toHaveProperty("email");
  });
  it("tests before activation, persists session across recreation, and routes nutrition through Responses", async () => {
    const { service, options, transport } = setup();
    const cookie = await connect(service, await signIn(service));
    const recreated = createAIConnectionService(options);
    const status = await (
      await recreated.handle(request("status", undefined, cookie), "status")
    ).json();
    expect(status).toMatchObject({ provider: "chatgpt", connected: true });
    const result = await recreated.handle(
      request("nutrition", { food: "  2 eggs  ", coverage: "partial" }, cookie),
      "nutrition",
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      originalFood: "  2 eggs  ",
      recordedTotals: { kcal: { min: 130, max: 170 } },
      dailyTotals: null,
    });
    expect(
      transport.mock.calls.filter(([url]) =>
        String(url).endsWith("/chat/completions"),
      ),
    ).toHaveLength(0);
  });
  it.each(["completed", "incomplete", "interrupted"] as const)(
    "activates a headerless item-done stream only after terminal completion: %s",
    async (terminal) => {
      const { service, options, transport } = setup();
      const originalTransport = transport.getMockImplementation()!;
      const text = '{"connected":true}';
      transport.mockImplementation(async (url, init) => {
        if (!String(url).endsWith("/responses"))
          return originalTransport(url, init);
        const events: unknown[] = [
          {
            type: "response.output_text.delta",
            item_id: "msg-connection-fixture",
            output_index: 0,
            content_index: 0,
            delta: text,
          },
          {
            type: "response.output_text.done",
            item_id: "msg-connection-fixture",
            output_index: 0,
            content_index: 0,
            text,
          },
          {
            type: "response.output_item.done",
            output_index: 0,
            item: {
              id: "msg-connection-fixture",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text }],
            },
          },
        ];
        if (terminal !== "interrupted")
          events.push({
            type: `response.${terminal}`,
            response: { status: terminal, output: [] },
          });
        // Byte body deliberately omits Content-Type, matching the live service.
        return new Response(
          new TextEncoder().encode(
            events
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(""),
          ),
        );
      });
      const cookie = await signIn(service);
      const result = await service.handle(
        request("chatgpt/connect", {}, cookie),
        "chatgpt/connect",
      );
      expect(result.status).toBe(terminal === "completed" ? 200 : 503);
      const recreated = createAIConnectionService(options);
      const status = await (
        await recreated.handle(
          request("status", undefined, `${cookie}; ${cookies(result)}`),
          "status",
        )
      ).json();
      expect(status.chatgpt).toMatchObject({
        signedIn: true,
        connected: terminal === "completed",
      });
      expect(status.connected).toBe(terminal === "completed");
    },
  );
  it("rejects cross-origin, rebinding, hosted and production login before network", async () => {
    const { service, auth } = setup();
    for (const headers of [
      { Origin: "https://evil.invalid" },
      { Host: "evil.invalid:3100" },
      { Host: "127.0.0.1:9999" },
      { "Sec-Fetch-Site": "cross-site" },
    ] as Record<string, string>[]) {
      expect(
        (
          await service.handle(
            request("chatgpt/start", {}, "", headers),
            "chatgpt/start",
          )
        ).status,
      ).toBe(403);
    }
    expect(auth.start).not.toHaveBeenCalled();
    const prod = setup({ APP_MODE: "production" });
    expect(
      (await prod.service.handle(request("chatgpt/start", {}), "chatgpt/start"))
        .status,
    ).toBe(403);
  });
  it("requires a tested browser session and valid input before inference", async () => {
    const { service, transport } = setup();
    const cookie = await signIn(service);
    expect(
      (
        await service.handle(
          request(
            "nutrition",
            { food: "2 eggs", coverage: "partial" },
            `${cookie}; boji_ai_provider=chatgpt`,
          ),
          "nutrition",
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await service.handle(
          request("chatgpt/connect", {}, "boji_chatgpt=forged"),
          "chatgpt/connect",
        )
      ).status,
    ).toBe(401);
    expect(transport).not.toHaveBeenCalled();
    const connected = await connect(service, cookie);
    transport.mockClear();
    expect(
      (
        await service.handle(
          request("nutrition", { food: "   ", coverage: "partial" }, connected),
          "nutrition",
        )
      ).status,
    ).toBe(400);
    expect(transport).not.toHaveBeenCalled();
  });
  it("a rejected or incomplete test cannot activate the provider or clear saved API configuration", async () => {
    const { service, transport } = setup();
    const cookie = await signIn(service);
    transport.mockImplementation(async (url) =>
      String(url).endsWith("/models")
        ? Response.json({
            models: [
              { slug: "test-model", display_name: "Test", visibility: "list" },
            ],
          })
        : new Response('data: {"type":"response.failed"}\n\n', {
            headers: { "Content-Type": "text/event-stream" },
          }),
    );
    const result = await service.handle(
      request("chatgpt/connect", {}, cookie),
      "chatgpt/connect",
    );
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.headers.get("set-cookie")).toBeNull();
    const data = await (
      await service.handle(request("status", undefined, cookie), "status")
    ).json();
    expect(data.chatgpt.connected).toBe(false);
  });
  it("sign-out revokes all local browser grants, even when remote revocation is unconfirmed", async () => {
    const { service, auth, transport } = setup();
    const cookie = await connect(service, await signIn(service));
    const result = await service.handle(
      request("chatgpt/disconnect", {}, cookie),
      "chatgpt/disconnect",
    );
    expect(await result.json()).toMatchObject({
      connected: false,
      provider: null,
      remoteRevocationConfirmed: false,
    });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    transport.mockClear();
    expect(
      (
        await service.handle(
          request("nutrition", { food: "2 eggs", coverage: "partial" }, cookie),
          "nutrition",
        )
      ).status,
    ).toBe(401);
    expect(transport).not.toHaveBeenCalled();
  });
  it("new sign-in invalidates the previous browser grant before spending another account's allowance", async () => {
    const { service, transport } = setup();
    const oldCookie = await connect(service, await signIn(service));
    await signIn(service);
    transport.mockClear();
    expect(
      (
        await service.handle(
          request(
            "nutrition",
            { food: "2 eggs", coverage: "partial" },
            oldCookie,
          ),
          "nutrition",
        )
      ).status,
    ).toBe(401);
    expect(transport).not.toHaveBeenCalled();
  });
  it("keeps API Key usable, explicitly switches providers, and never falls back on quota failure", async () => {
    const { service, transport } = setup({
      APP_MODE: "self_hosted",
      ENABLE_OPENAI_COMPATIBLE: "true",
      OPENAI_COMPAT_BASE_URL: "https://provider.example/v1",
      OPENAI_COMPAT_API_KEY: "synthetic-api-key",
      OPENAI_COMPAT_MODEL: "test-model",
      BOJI_SELF_HOSTED_PASSWORD: "test-only-password-at-least-16",
      BOJI_SELF_HOSTED_ORIGIN: origin,
    });
    const api = await service.handle(
      request("connect", { password: "test-only-password-at-least-16" }),
      "connect",
    );
    expect(await api.clone().json()).toMatchObject({
      provider: "api_key",
      connected: true,
    });
    const gpt = await connect(service, await signIn(service));
    const cookie = `${gpt}; ${cookies(api)
      .split("; ")
      .filter((part) => !part.startsWith("boji_ai_provider="))
      .join("; ")}`;
    transport.mockClear();
    transport.mockImplementation(async () =>
      Response.json(
        { error: { code: "usage_limit_reached", message: "secret" } },
        { status: 429 },
      ),
    );
    const result = await service.handle(
      request("nutrition", { food: "2 eggs", coverage: "partial" }, cookie),
      "nutrition",
    );
    expect(result.status).toBe(429);
    expect(await result.text()).not.toContain("secret");
    expect(
      transport.mock.calls.every(([url]) =>
        String(url).startsWith("https://api.openai.com/v1/"),
      ),
    ).toBe(true);
  });
  it("expires local browser sessions without spending allowance", async () => {
    const { service, transport } = setup();
    const cookie = await connect(service, await signIn(service));
    clock += 31 * 24 * 60 * 60_000;
    transport.mockClear();
    expect(
      (
        await service.handle(
          request("nutrition", { food: "2 eggs", coverage: "partial" }, cookie),
          "nutrition",
        )
      ).status,
    ).toBe(401);
    expect(transport).not.toHaveBeenCalled();
  });
  it("a disk failure after switching OAuth accounts cannot authorize the old browser on the new account", async () => {
    const { service, changeAccount, transport, auth } = setup();
    const oldCookie = await connect(service, await signIn(service));
    const start = await service.handle(
      request("chatgpt/start", {}),
      "chatgpt/start",
    );
    changeAccount();
    const spy = vi
      .spyOn(ChatGPTAppStore.prototype, "write")
      .mockRejectedValueOnce(new Error("disk full"));
    const callback = await service.handle(
      request(
        "chatgpt/callback?state=test&code=test",
        undefined,
        cookies(start),
      ),
      "chatgpt/callback",
    );
    expect(callback.headers.get("location")).toContain("chatgpt=error");
    expect(
      callback.headers
        .getSetCookie()
        .some((value) => value.startsWith("boji_chatgpt=")),
    ).toBe(false);
    spy.mockRestore();
    transport.mockClear();
    expect(
      (
        await service.handle(
          request(
            "nutrition",
            { food: "2 eggs", coverage: "partial" },
            oldCookie,
          ),
          "nutrition",
        )
      ).status,
    ).toBe(401);
    expect(transport).not.toHaveBeenCalled();
    expect(
      (
        await service.handle(
          request("chatgpt/disconnect", {}, oldCookie),
          "chatgpt/disconnect",
        )
      ).status,
    ).toBe(401);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
  it("corrupt ChatGPT storage does not break an independent API Key connection", async () => {
    const { service } = setup({
      APP_MODE: "self_hosted",
      ENABLE_OPENAI_COMPATIBLE: "true",
      OPENAI_COMPAT_BASE_URL: "https://provider.example/v1",
      OPENAI_COMPAT_API_KEY: "synthetic-api-key",
      OPENAI_COMPAT_MODEL: "test-model",
      BOJI_SELF_HOSTED_PASSWORD: "test-only-password-at-least-16",
      BOJI_SELF_HOSTED_ORIGIN: origin,
    });
    await signIn(service);
    await writeFile(join(directory, "chatgpt", "browser.json"), "corrupt");
    const result = await service.handle(
      request("connect", { password: "test-only-password-at-least-16" }),
      "connect",
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      connected: true,
      provider: "api_key",
      chatgpt: { available: false },
    });
    expect(
      result.headers
        .getSetCookie()
        .some((value) => value.startsWith("boji_self_hosted=")),
    ).toBe(true);
  });
  it("switches an already tested provider without another inference and protects selection from CSRF", async () => {
    const { service, transport } = setup();
    const cookie = await connect(service, await signIn(service));
    transport.mockClear();
    const switched = await service.handle(
      request("select", { provider: "chatgpt" }, cookie),
      "select",
    );
    expect(switched.status).toBe(200);
    expect(await switched.json()).toMatchObject({
      provider: "chatgpt",
      connected: true,
    });
    expect(
      (
        await service.handle(
          request("select", { provider: "api_key" }, cookie),
          "select",
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await service.handle(
          request("select", { provider: "chatgpt" }, cookie, {
            Origin: "https://evil.invalid",
          }),
          "select",
        )
      ).status,
    ).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });
});
