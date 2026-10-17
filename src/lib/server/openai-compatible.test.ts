import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, errorResponse } from "./errors";
import {
  createOpenAICompatibleClient,
  openAICompatibleStatus,
  readOpenAICompatibleConfig,
} from "./openai-compatible";
import { guardedProviderFetcher } from "./self-hosted-transport";

const env = {
  ENABLE_OPENAI_COMPATIBLE: "true",
  OPENAI_COMPAT_BASE_URL: "https://provider.example/v1/",
  OPENAI_COMPAT_API_KEY: "test-secret-not-real",
  OPENAI_COMPAT_MODEL: "configured-model",
};
const config = () => readOpenAICompatibleConfig(env)!;
const schema = z.object({ answer: z.string().min(1) }).strict();
const request = {
  system: "Provide a JSON answer.",
  user: { text: "Hello" },
  schema,
};
const completion = (content: unknown, finish_reason = "stop") =>
  Response.json({
    choices: [{ finish_reason, message: { content: JSON.stringify(content) } }],
  });
afterEach(() => vi.useRealTimers());

describe("server-only OpenAI-compatible boundary", () => {
  it("defaults off and never represents configuration as a connection test", () => {
    expect(readOpenAICompatibleConfig({})).toBeNull();
    expect(openAICompatibleStatus({})).toEqual({
      status: "disabled",
      provider: "openai-compatible",
    });
    expect(openAICompatibleStatus(env)).toEqual({
      status: "configured",
      provider: "openai-compatible",
    });
    expect(
      openAICompatibleStatus({ ENABLE_OPENAI_COMPATIBLE: "true" }),
    ).toEqual({ status: "unavailable", provider: "openai-compatible" });
  });
  it.each([
    "http://provider.example/v1",
    "https://user:pass@provider.example/v1",
    "https://provider.example/v1?secret=x",
    "https://provider.example/v1#secret",
    "https://127.0.0.1/v1",
    "https://localhost./v1",
    "https://sub.localhost/v1",
    "https://service.local./v1",
    "https://10.0.0.4/v1",
    "https://169.254.169.254/v1",
    "https://[::1]/v1",
    "https://[fd00::1]/v1",
    "file:///tmp/test",
    "not-a-url",
  ])("rejects an unsafe endpoint: %s", (url) => {
    expect(() =>
      readOpenAICompatibleConfig({ ...env, OPENAI_COMPAT_BASE_URL: url }),
    ).toThrow("配置");
  });
  it("requires explicit local mode and permits keyless loopback only there", () => {
    const local = {
      ...env,
      OPENAI_COMPAT_BASE_URL: "http://localhost:11434/v1",
      OPENAI_COMPAT_API_KEY: "",
      OPENAI_COMPAT_ALLOW_LOCAL: "true",
    };
    expect(readOpenAICompatibleConfig(local)).toMatchObject({
      allowLocal: true,
      apiKey: "",
    });
    expect(() =>
      readOpenAICompatibleConfig({
        ...local,
        OPENAI_COMPAT_BASE_URL: "http://10.0.0.4/v1",
      }),
    ).toThrow();
    expect(() =>
      readOpenAICompatibleConfig({
        ...local,
        OPENAI_COMPAT_BASE_URL: "https://provider.example/v1",
      }),
    ).toThrow();
  });
  it("bounds timeout and validates token parameter without leaking bad secrets", () => {
    for (const overrides of [
      { OPENAI_COMPAT_TIMEOUT_MS: "0" },
      { OPENAI_COMPAT_TIMEOUT_MS: "36000" },
      { OPENAI_COMPAT_TIMEOUT_MS: "NaN" },
      { OPENAI_COMPAT_TOKEN_PARAMETER: "tools" },
      { OPENAI_COMPAT_API_KEY: "bad\r\nsecret" },
    ]) {
      expect(() =>
        readOpenAICompatibleConfig({ ...env, ...overrides }),
      ).toThrow("配置");
      expect(
        JSON.stringify(openAICompatibleStatus({ ...env, ...overrides })),
      ).not.toContain("secret");
    }
  });
  it("uses the operator endpoint, bounded JSON request, no tools and no redirects", async () => {
    const fetcher = vi.fn(async () => completion({ answer: "Hi" }));
    const result = await createOpenAICompatibleClient(
      config(),
      fetcher,
    ).completeJson(request);
    expect(result).toEqual({ answer: "Hi" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://provider.example/v1/chat/completions",
      expect.objectContaining({
        redirect: "error",
        cache: "no-store",
        headers: {
          Authorization: "Bearer test-secret-not-real",
          "Content-Type": "application/json",
        },
      }),
    );
    const init = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init[1].body as string);
    expect(body).toMatchObject({
      model: "configured-model",
      max_tokens: 3200,
      stream: false,
      response_format: { type: "json_object" },
    });
    expect(body.tools).toBeUndefined();
    expect(body.messages[1].content).toBe(JSON.stringify(request.user));
  });
  it("allows the provider's supported completion token parameter explicitly", async () => {
    const fetcher = vi.fn(async () => completion({ answer: "Hi" }));
    await createOpenAICompatibleClient(
      { ...config(), tokenParameter: "max_completion_tokens" },
      fetcher,
    ).completeJson(request);
    const init = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init[1].body as string)).toMatchObject({
      max_completion_tokens: 3200,
    });
    expect(JSON.parse(init[1].body as string).max_tokens).toBeUndefined();
  });
  it("rejects oversized input before transport", async () => {
    const fetcher = vi.fn();
    await expect(
      createOpenAICompatibleClient(config(), fetcher).completeJson({
        ...request,
        user: "x".repeat(12001),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["length", "content_filter", "tool_calls"])(
    "rejects non-complete output (%s)",
    async (reason) => {
      await expect(
        createOpenAICompatibleClient(config(), async () =>
          completion({ answer: "Hi" }, reason),
        ).completeJson(request),
      ).rejects.toMatchObject({ code: "invalid_provider_output" });
    },
  );
  it.each([{ answer: 12 }, { answer: "ok", injected: true }])(
    "validates output with the supplied strict schema",
    async (data) => {
      await expect(
        createOpenAICompatibleClient(config(), async () =>
          completion(data),
        ).completeJson(request),
      ).rejects.toMatchObject({ code: "invalid_provider_output" });
    },
  );
  it("rejects malformed, fenced, refused or multiple-choice responses", async () => {
    const responses = [
      new Response("not JSON"),
      Response.json({
        choices: [
          { finish_reason: "stop", message: { content: "```json\n{}\n```" } },
        ],
      }),
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: '{"answer":"Hi"}', refusal: "No" },
          },
        ],
      }),
      Response.json({ choices: [] }),
    ];
    for (const response of responses)
      await expect(
        createOpenAICompatibleClient(
          config(),
          async () => response,
        ).completeJson(request),
      ).rejects.toMatchObject({ code: "invalid_provider_output" });
  });
  it("caps response bytes even when content-length is missing", async () => {
    const cancelled = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(64001)));
        },
        cancel: cancelled,
      }),
    );
    await expect(
      createOpenAICompatibleClient(config(), async () => response).completeJson(
        request,
      ),
    ).rejects.toMatchObject({ code: "invalid_provider_output" });
    expect(cancelled).toHaveBeenCalled();
  });
  it("redacts provider HTTP and network errors and never retries implicitly", async () => {
    const httpFetcher = vi.fn(
      async () =>
        new Response("test-secret-not-real health data", { status: 429 }),
    );
    await expect(
      createOpenAICompatibleClient(config(), httpFetcher).completeJson(request),
    ).rejects.toMatchObject({ code: "provider_rate_limited" });
    expect(httpFetcher).toHaveBeenCalledTimes(1);
    await expect(
      createOpenAICompatibleClient(config(), async () => {
        throw new Error("test-secret-not-real");
      }).completeJson(request),
    ).rejects.toMatchObject({ code: "provider_network_error" });
  });
  it.each([
    [401, "provider_authentication_failed", 502, "认证失败"],
    [403, "provider_permission_denied", 502, "权限"],
    [404, "provider_resource_not_found", 502, "大小写"],
    [400, "provider_request_rejected", 502, "max_completion_tokens"],
    [429, "provider_rate_limited", 429, "频率"],
    [500, "provider_unavailable", 503, "暂时不可用"],
    [503, "provider_unavailable", 503, "暂时不可用"],
    [408, "provider_timeout", 503, "超时"],
    [504, "provider_timeout", 503, "超时"],
  ])(
    "classifies provider HTTP %i and renders a safe route error",
    async (status, code, appStatus, hint) => {
      const sensitive = [
        "test-secret-not-real",
        "configured-model",
        "https://provider.example/v1",
        "private original food",
      ];
      const fetcher = vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "unsafe_provider_address",
              message: sensitive.join(" "),
            },
          },
          { status: Number(status) },
        ),
      );
      const error = await createOpenAICompatibleClient(config(), fetcher)
        .completeJson(request)
        .catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(ApiError);
      const response = errorResponse(error);
      expect(response.status).toBe(appStatus);
      const body = await response.json();
      expect(body).toEqual({ error: code, message: expect.any(String) });
      expect(body.message).toContain(hint);
      for (const secret of sensitive)
        expect(JSON.stringify(body)).not.toContain(secret);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    "credit_balance_exhausted",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
    "insufficient_quota",
  ])("distinguishes the allowlisted quota code %s from rate limits", async (code) => {
    const error = await createOpenAICompatibleClient(config(), async () =>
      Response.json(
        { error: { code, message: "test-secret-not-real", type: "anything" } },
        { status: 429 },
      ),
    )
      .completeJson(request)
      .catch((failure: unknown) => failure);
    const response = errorResponse(error);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "provider_quota_exceeded",
      message: expect.stringContaining("账单和额度"),
    });
  });
  it.each([
    { error: { code: "slow_down", type: "insufficient_quota" } },
    { error: { code: "rate_limit_exceeded", message: "insufficient_quota" } },
    { error: { code: "insufficient_quota\ntest-secret-not-real" } },
    { error: { code: "__proto__", message: "test-secret-not-real" } },
    { error: { code: { toString: "insufficient_quota" } } },
    { error: { type: "insufficient_quota" } },
  ])("does not infer quota or echo arbitrary provider codes/types/messages", async (body) => {
    await expect(
      createOpenAICompatibleClient(config(), async () =>
        Response.json(body, { status: 429 }),
      ).completeJson(request),
    ).rejects.toMatchObject({ code: "provider_rate_limited", status: 429 });
  });
  it("uses the HTTP status before any JSON code and cancels other error bodies", async () => {
    const cancelled = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ error: { code: "insufficient_quota" } }),
            ),
          );
        },
        cancel: cancelled,
      }),
      { status: 401 },
    );
    await expect(
      createOpenAICompatibleClient(config(), async () => response).completeJson(request),
    ).rejects.toMatchObject({ code: "provider_authentication_failed" });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("bounds error-body reads with content-length=%s", async (withLength) => {
    const cancelled = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("x".repeat(8193)));
        },
        cancel: cancelled,
      }),
      {
        status: 429,
        headers: withLength ? { "Content-Length": "8193" } : undefined,
      },
    );
    await expect(
      createOpenAICompatibleClient(config(), async () => response).completeJson(request),
    ).rejects.toMatchObject({ code: "provider_rate_limited" });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it("reports network failures separately from HTTP rejection without exposing details", async () => {
    const error = await createOpenAICompatibleClient(config(), async () => {
      throw new TypeError("test-secret-not-real https://provider.example/v1");
    })
      .completeJson(request)
      .catch((failure: unknown) => failure);
    const response = errorResponse(error);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "provider_network_error",
      message: expect.stringContaining("DNS"),
    });
  });
  it("preserves trusted transport address denial with a fixed message and no outbound call", async () => {
    const transport = vi.fn();
    const fetcher = guardedProviderFetcher(config(), {
      resolveHost: async () => [{ address: "192.168.1.1", family: 4 }],
      transport,
    });
    const error = await createOpenAICompatibleClient(config(), fetcher)
      .completeJson(request)
      .catch((failure: unknown) => failure);
    const response = errorResponse(error);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "unsafe_provider_address",
      message: expect.stringContaining("公开 HTTPS"),
    });
    expect(transport).not.toHaveBeenCalled();
  });
  it("redacts transport wrappers even when they throw an ApiError", async () => {
    for (const code of [
      "provider_unavailable",
      "invalid_provider_output",
      "provider_timeout",
      "unsafe_provider_address",
      "provider_authentication_failed",
      "provider_quota_exceeded",
      "unexpected_secret",
    ]) {
      const fetcher: typeof fetch = async () => {
        throw new ApiError(503, code, "test-secret-not-real original food");
      };
      const error = await createOpenAICompatibleClient(config(), fetcher)
        .completeJson(request)
        .catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(ApiError);
      const response = errorResponse(error);
      expect(await response.text()).not.toContain("test-secret-not-real");
    }
  });
  it("aborts stalled requests and reports timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetcher: typeof fetch = async (_, init) => {
      signal = init?.signal;
      return await new Promise<Response>(() => {});
    };
    const pending = createOpenAICompatibleClient(
      { ...config(), timeoutMs: 1000 },
      fetcher,
    ).completeJson(request);
    const assertion = expect(pending).rejects.toMatchObject({
      code: "provider_timeout",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(signal?.aborted).toBe(true);
  });
  it("applies the deadline to body streaming as well", async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream({ cancel: cancelled }));
    const pending = createOpenAICompatibleClient(
      { ...config(), timeoutMs: 1000 },
      async () => response,
    ).completeJson(request);
    const assertion = expect(pending).rejects.toMatchObject({
      code: "provider_timeout",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(cancelled).toHaveBeenCalled();
  });
  it("applies the deadline to a stalled provider error body", async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream({ cancel: cancelled }), {
      status: 429,
    });
    const pending = createOpenAICompatibleClient(
      { ...config(), timeoutMs: 1000 },
      async () => response,
    ).completeJson(request);
    const assertion = expect(pending).rejects.toMatchObject({
      code: "provider_timeout",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(cancelled).toHaveBeenCalled();
  });
});
