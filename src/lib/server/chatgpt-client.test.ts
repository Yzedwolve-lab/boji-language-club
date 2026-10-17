import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, errorResponse } from "./errors";
import { createChatGPTClient, listChatGPTModels } from "./chatgpt-client";
import { analyzeNutritionWithCompatibleAI } from "./nutrition-adapter";
import { createAIStarterPlan } from "./ai-planning";
import { TIME_TEMPLATES } from "../domain";
import { TASKS } from "../lessons";
import type { AIPlanningInput } from "../ai-types";

const token = "fake-oauth-secret-never-real";
const getAccessToken = async () => token;
const schema = z.object({ answer: z.string().min(1) }).strict();
const request = { system: "Give a JSON answer.", user: { text: "Hi" }, schema };
const event = (value: unknown) => {
  const item = value as Record<string, unknown>;
  const positioned = [
    "response.output_text.delta",
    "response.output_text.done",
    "response.content_part.added",
    "response.content_part.done",
  ].includes(String(item.type));
  return `data: ${JSON.stringify(positioned ? { item_id: "msg_test", output_index: 0, content_index: 0, ...item } : item)}\n\n`;
};
const final = (text = JSON.stringify({ answer: "你好" })) => ({
  type: "response.completed",
  response: {
    status: "completed",
    error: null,
    incomplete_details: null,
    output: [
      {
        id: "msg_test",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text }],
      },
    ],
  },
});
const stream = (text: string, chunkSize = 17, cancel = vi.fn()) => {
  const bytes = new TextEncoder().encode(text);
  let position = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (position >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(position, (position += chunkSize)));
      },
      cancel,
    }),
    { headers: { "content-type": "text/event-stream; charset=utf-8" } },
  );
};
const response = (value: unknown) =>
  stream(event(final(JSON.stringify(value))));
const client = (
  fetcher = vi.fn(async () => response({ answer: "你好" })),
  timeoutMs = 35000,
) =>
  createChatGPTClient({
    getAccessToken,
    model: "account-model",
    fetcher,
    timeoutMs,
  });

afterEach(() => vi.useRealTimers());

describe("ChatGPT plan streaming boundary", () => {
  it("uses fixed public Responses, safe parameters and JSON input without exposing tokens", async () => {
    const fetcher = vi.fn(async () => response({ answer: "你好" }));
    expect(await client(fetcher).completeJson(request)).toEqual({
      answer: "你好",
    });
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init).toMatchObject({
      redirect: "error",
      cache: "no-store",
      method: "POST",
    });
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    });
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      model: "account-model",
      store: false,
      stream: true,
      instructions: expect.stringContaining("untrusted data"),
      input: [{ role: "user", content: JSON.stringify(request.user) }],
    });
    expect(init.body).not.toContain(token);
  });

  it.each([1, 7, 29, 4096])(
    "handles split UTF-8 and CRLF SSE frames at %s bytes",
    async (size) => {
      const text = JSON.stringify({ answer: "你好 🌱" });
      const body =
        `: keep-alive\n\n${event({ type: "response.created" })}${event({ type: "response.output_text.delta", delta: text.slice(0, 10) })}${event({ type: "response.output_text.delta", delta: text.slice(10) })}${event(final(text))}`.replaceAll(
          "\n",
          "\r\n",
        );
      const fetcher = vi.fn(async () => stream(body, size));
      expect(await client(fetcher).completeJson(request)).toEqual({
        answer: "你好 🌱",
      });
    },
  );

  it("cancels a stream on completed without waiting for the remote socket to close", async () => {
    const cancel = vi.fn();
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(event(final())));
            },
            cancel,
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    expect(await client(fetcher).completeJson(request)).toEqual({
      answer: "你好",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    event({
      type: "response.output_text.delta",
      delta: '{"answer":"partial"}',
    }),
    event({ type: "response.output_text.done", text: '{"answer":"partial"}' }),
    event(final()).trimEnd(),
    event({ type: "response.incomplete" }),
  ])("classifies interrupted or incomplete streams %#", async (body) => {
    await expect(
      client(vi.fn(async () => stream(body))).completeJson(request),
    ).rejects.toMatchObject({ code: "chatgpt_response_incomplete" });
  });

  it.each([
    "data: [DONE]\n\n",
    "data: invalid JSON\n\n",
    `event: response.failed\n${event(final())}`,
    event({ type: "response.refusal.delta", delta: "no" }) + event(final()),
    event({ type: "response.output_text.delta", delta: "wrong" }) +
      event(final()),
  ])(
    "does not accept a partial, refused or malformed stream %#",
    async (body) => {
      await expect(
        client(vi.fn(async () => stream(body))).completeJson(request),
      ).rejects.toMatchObject({ code: "invalid_provider_output" });
    },
  );

  it.each([
    { ...final(), response: { ...final().response, status: "incomplete" } },
    { ...final(), response: { ...final().response, error: { code: "bad" } } },
    { ...final(), response: { ...final().response, output: [] } },
    {
      ...final(),
      response: { ...final().response, output: [{ type: "function_call" }] },
    },
    {
      ...final(),
      response: {
        ...final().response,
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "refusal", refusal: "no" }],
          },
        ],
      },
    },
  ])("rejects invalid final response or schema %#", async (value) => {
    await expect(
      client(vi.fn(async () => stream(event(value)))).completeJson(request),
    ).rejects.toMatchObject({ code: "invalid_provider_output" });
  });

  it.each([
    ["not JSON", "chatgpt_response_invalid_json"],
    ['```json\n{"answer":"ok"}\n```', "chatgpt_response_invalid_json"],
    ['{"answer":0}', "chatgpt_response_invalid_schema"],
    ['{"answer":"ok","extra":true}', "chatgpt_response_invalid_schema"],
  ])("distinguishes JSON and schema failures %#", async (text, code) => {
    await expect(
      client(vi.fn(async () => stream(event(final(text))))).completeJson(
        request,
      ),
    ).rejects.toMatchObject({ code });
  });

  const emptyTerminal = () => ({
    ...final(),
    response: { ...final().response, output: [] },
  });
  const itemDone = (text: string) => ({
    type: "response.output_item.done",
    output_index: 0,
    item: final(text).response.output[0],
  });
  const completeParts = (text: string) =>
    event({
      type: "response.content_part.added",
      part: { type: "output_text", text: "" },
    }) +
    event({ type: "response.output_text.delta", delta: text }) +
    event({ type: "response.output_text.done", text }) +
    event({
      type: "response.content_part.done",
      part: { type: "output_text", text },
    }) +
    event(itemDone(text));

  it.each([1, 19, 4096])(
    "accepts observed headerless SSE with completed item.done and empty terminal at %s-byte chunks",
    async (size) => {
      const text = '{"connected":true}';
      const received = stream(
        completeParts(text) + event(emptyTerminal()) + "data: [DONE]\n\n",
        size,
      );
      received.headers.delete("content-type");
      await expect(
        client(vi.fn(async () => received)).completeJson({
          ...request,
          schema: z.object({ connected: z.literal(true) }).strict(),
        }),
      ).resolves.toEqual({ connected: true });
    },
  );

  it.each(["application/json", "text/html", "text/event-stream-invalid"])(
    "rejects an explicit incompatible media type %s",
    async (type) => {
      const received = stream(
        completeParts('{"answer":"ok"}') + event(emptyTerminal()),
      );
      received.headers.set("content-type", type);
      await expect(
        client(vi.fn(async () => received)).completeJson(request),
      ).rejects.toMatchObject({ code: "invalid_provider_output" });
    },
  );

  it.each([
    completeParts('{"answer":"ok"}'),
    completeParts('{"answer":"ok"}') + event({ type: "response.incomplete" }),
  ])(
    "never accepts item.done without a successful terminal %#",
    async (body) => {
      await expect(
        client(vi.fn(async () => stream(body))).completeJson(request),
      ).rejects.toMatchObject({ code: "chatgpt_response_incomplete" });
    },
  );

  it.each([
    event({
      type: "response.content_part.added",
      content_index: 1,
      part: { type: "output_text", text: "" },
    }) + event(itemDone('{"answer":"ok"}')),
    event({
      type: "response.content_part.added",
      part: { type: "refusal", refusal: "no" },
    }) + event(itemDone('{"answer":"ok"}')),
    event(itemDone('{"answer":"ok"}')) +
      event({
        type: "response.content_part.added",
        part: { type: "output_text", text: "" },
      }),
    event({ type: "response.output_text.delta", delta: '{"answer":"ok"}' }),
    event({ type: "response.output_text.done", text: '{"answer":"ok"}' }),
    event({
      ...itemDone('{"answer":"ok"}'),
      item: { ...itemDone('{"answer":"ok"}').item, status: "incomplete" },
    }),
    event({
      type: "response.output_text.delta",
      delta: '{"answer":',
      item_id: "msg_first",
    }) +
      event({
        type: "response.output_text.delta",
        delta: '"ok"}',
        item_id: "msg_test",
      }) +
      event(itemDone('{"answer":"ok"}')),
    event({
      type: "response.output_text.delta",
      delta: '{"answer":"ok"}',
      output_index: 1,
    }) + event(itemDone('{"answer":"ok"}')),
    event({
      type: "response.output_text.delta",
      delta: '{"answer":"ok"}',
      content_index: 1,
    }) + event(itemDone('{"answer":"ok"}')),
    event({
      type: "response.output_text.delta",
      delta: '{"answer":"ok"}',
      item_id: undefined,
    }) + event(itemDone('{"answer":"ok"}')),
    event({ type: "response.output_text.done", text: '{"answer":"wrong"}' }) +
      event(itemDone('{"answer":"ok"}')),
    event({
      type: "response.content_part.done",
      part: { type: "output_text", text: '{"answer":"wrong"}' },
    }) + event(itemDone('{"answer":"ok"}')),
    event(itemDone('{"answer":"ok"}')) + event(itemDone('{"answer":"wrong"}')),
    event(itemDone('{"answer":"ok"}')) +
      event({ type: "response.output_text.delta", delta: "extra" }),
    event(itemDone('{"answer":"ok"}')) +
      event({
        ...itemDone('{"answer":"other"}'),
        output_index: 1,
        item: { ...itemDone('{"answer":"other"}').item, id: "msg_other" },
      }),
  ])(
    "rejects mismatched, partial or cross-item fallback output %#",
    async (body) => {
      await expect(
        client(
          vi.fn(async () => stream(body + event(emptyTerminal()))),
        ).completeJson(request),
      ).rejects.toMatchObject({ code: "invalid_provider_output" });
    },
  );

  it("requires nonempty terminal output to agree with earlier completed items", async () => {
    await expect(
      client(
        vi.fn(async () =>
          stream(
            completeParts('{"answer":"ok"}') +
              event(final('{"answer":"wrong"}')),
          ),
        ),
      ).completeJson(request),
    ).rejects.toMatchObject({ code: "invalid_provider_output" });
    await expect(
      client(
        vi.fn(async () =>
          stream(
            completeParts('{"answer":"ok"}') + event(final('{"answer":"ok"}')),
          ),
        ),
      ).completeJson(request),
    ).resolves.toEqual({ answer: "ok" });
  });

  it("allows an accompanying reasoning item but never returns it", async () => {
    const value = final();
    value.response.output.unshift({ type: "reasoning", summary: [] } as never);
    expect(
      await client(vi.fn(async () => stream(event(value)))).completeJson(
        request,
      ),
    ).toEqual({ answer: "你好" });
  });

  it.each([
    [
      "subscription_sharing_usage_limit_exceeded",
      "chatgpt_usage_limit_exceeded",
      429,
    ],
    [
      "subscription_sharing_usage_unavailable",
      "chatgpt_usage_unavailable",
      503,
    ],
    ["subscription_sharing_user_not_eligible", "chatgpt_not_eligible", 403],
    ["chatpass_v2_scope_not_authorized", "chatgpt_permission_denied", 403],
    ["subscription_sharing_invalid_user", "chatgpt_session_expired", 401],
    [
      "subscription_sharing_unsupported_capability",
      "chatgpt_request_rejected",
      502,
    ],
  ])(
    "handles exact %s after streaming starts without returning partial text",
    async (code, expected, status) => {
      const body =
        event({
          type: "response.output_text.delta",
          delta: '{"answer":"partial"}',
        }) +
        event({
          type: "response.failed",
          response: { error: { code, message: token } },
        });
      try {
        await client(vi.fn(async () => stream(body))).completeJson(request);
      } catch (error) {
        expect(error).toMatchObject({ code: expected, status });
        expect(await errorResponse(error).text()).not.toContain(token);
        return;
      }
      throw new Error("Expected rejection");
    },
  );

  it("handles explicit stream errors and never echoes arbitrary error details", async () => {
    const body = event({
      type: "error",
      code: "subscription_sharing_usage_limit_exceeded",
      message: token,
    });
    await expect(
      client(vi.fn(async () => stream(body))).completeJson(request),
    ).rejects.toMatchObject({
      code: "chatgpt_usage_limit_exceeded",
      status: 429,
    });
    const unknown = event({
      type: "response.failed",
      response: { error: { code: token, message: token } },
    });
    await expect(
      client(vi.fn(async () => stream(unknown))).completeJson(request),
    ).rejects.toMatchObject({ code: "provider_unavailable", status: 503 });
  });

  it.each([
    [401, "chatgpt_session_expired"],
    [403, "chatgpt_permission_denied"],
    [400, "chatgpt_request_rejected"],
    [404, "chatgpt_model_unavailable"],
    [429, "chatgpt_rate_limited"],
    [503, "provider_unavailable"],
    [504, "provider_timeout"],
  ])(
    "sanitizes HTTP %s admission failures even without an error object",
    async (status, code) => {
      const fetcher = vi.fn(async () =>
        Response.json({ detail: token }, { status: status as number }),
      );
      try {
        await client(fetcher).completeJson(request);
      } catch (error) {
        expect(error).toMatchObject({ code });
        expect(await errorResponse(error).text()).not.toContain(token);
        return;
      }
      throw new Error("Expected rejection");
    },
  );

  it("uses an exact structured admission code instead of guessing from message text", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: "subscription_sharing_usage_limit_exceeded",
            message: token,
          },
        },
        { status: 429 },
      ),
    );
    await expect(client(fetcher).completeJson(request)).rejects.toMatchObject({
      code: "chatgpt_usage_limit_exceeded",
    });
    const prose = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: "unknown",
            message: "subscription_sharing_usage_limit_exceeded",
          },
        },
        { status: 429 },
      ),
    );
    await expect(client(prose).completeJson(request)).rejects.toMatchObject({
      code: "chatgpt_rate_limited",
    });
  });

  it("caps stream bytes, unfinished frames and generated text while cancelling bodies", async () => {
    for (const body of [
      ":" + "a".repeat(128001),
      (":" + "a".repeat(1000) + "\n\n").repeat(512) + event(final()),
      event({ type: "response.output_text.delta", delta: "a".repeat(48001) }) +
        event(final()),
    ]) {
      const cancel = vi.fn();
      await expect(
        client(
          vi.fn(async () => stream(body + " ".repeat(4096), 1024, cancel)),
        ).completeJson(request),
      ).rejects.toMatchObject({ code: "invalid_provider_output" });
      expect(cancel).toHaveBeenCalledOnce();
    }
  });

  it("rejects advertised oversized bodies, non-SSE responses and malformed UTF-8", async () => {
    for (const value of [
      new Response("data", {
        headers: {
          "content-type": "text/event-stream",
          "content-length": "512001",
        },
      }),
      Response.json(final()),
      new Response(new Uint8Array([255]), {
        headers: { "content-type": "text/event-stream" },
      }),
    ]) {
      await expect(
        client(vi.fn(async () => value)).completeJson(request),
      ).rejects.toMatchObject({ code: "invalid_provider_output" });
    }
  });

  it.each(["fetch", "body", "token"])(
    "enforces the full deadline during %s",
    async (stage) => {
      vi.useFakeTimers();
      const cancel = vi.fn();
      const fetcher = vi.fn(async () =>
        stage === "fetch"
          ? await new Promise<Response>(() => {})
          : new Response(new ReadableStream({ cancel }), {
              headers: { "content-type": "text/event-stream" },
            }),
      );
      const getToken =
        stage === "token"
          ? () => new Promise<string>(() => {})
          : getAccessToken;
      const promise = createChatGPTClient({
        getAccessToken: getToken,
        model: "account-model",
        fetcher,
        timeoutMs: 1000,
      }).completeJson(request);
      const assertion = expect(promise).rejects.toMatchObject({
        code: "provider_timeout",
      });
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
      if (stage === "body") expect(cancel).toHaveBeenCalledOnce();
      if (stage === "token") expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("does not start transport if token refresh resolves after the deadline", async () => {
    vi.useFakeTimers();
    let resolve!: (value: string) => void;
    const fetcher = vi.fn();
    const promise = createChatGPTClient({
      getAccessToken: () =>
        new Promise((done) => {
          resolve = done;
        }),
      model: "account-model",
      fetcher,
      timeoutMs: 1000,
    }).completeJson(request);
    const assertion = expect(promise).rejects.toMatchObject({
      code: "provider_timeout",
    });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    resolve(token);
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves only safe auth codes and replaces raw transport errors", async () => {
    const auth = createChatGPTClient({
      getAccessToken: async () => {
        throw new ApiError(999, "chatgpt_permission_required", token);
      },
      model: "account-model",
    });
    await expect(auth.completeJson(request)).rejects.toMatchObject({
      status: 403,
      code: "chatgpt_permission_required",
    });
    const failing = client(
      vi.fn(async () => {
        throw new Error(token);
      }),
    );
    await expect(failing.completeJson(request)).rejects.toMatchObject({
      code: "provider_network_error",
    });
  });

  it("checks configuration, inputs and credentials before any fetch", async () => {
    const fetcher = vi.fn();
    for (const model of ["", "has space", "bad\r\nvalue", "a".repeat(201)])
      expect(() =>
        createChatGPTClient({ getAccessToken, model, fetcher }),
      ).toThrow();
    await expect(
      client(fetcher).completeJson({
        ...request,
        user: { text: "a".repeat(12000) },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(
      client(fetcher).completeJson({ ...request, user: circular }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    for (const value of ["", "bad\r\ntoken"]) {
      const bad = createChatGPTClient({
        getAccessToken: async () => value,
        model: "account-model",
        fetcher,
      });
      await expect(bad.completeJson(request)).rejects.toMatchObject({
        code: "chatgpt_session_expired",
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("account-specific model discovery", () => {
  it("keeps visible entries and server ordering without fallback models", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        models: [
          {
            slug: "second-name",
            display_name: "Second name",
            visibility: "list",
          },
          { slug: "hidden-name", visibility: "hidden" },
          {
            slug: "first-name",
            display_name: "First name",
            visibility: "list",
          },
        ],
      }),
    );
    expect(await listChatGPTModels(getAccessToken, fetcher)).toEqual([
      { slug: "second-name", displayName: "Second name" },
      { slug: "first-name", displayName: "First name" },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(
      await listChatGPTModels(getAccessToken, async () =>
        Response.json({ models: [] }),
      ),
    ).toEqual([]);
  });

  it("reads a 568,595-byte catalog while returning only the seven visible picker entries", async () => {
    // Synthetic data reproduces the observed catalog size and item counts,
    // without storing provider instructions, credentials or account information.
    const catalog = {
      models: Array.from({ length: 9 }, (_, index) => ({
        slug: `catalog-model-${index}`,
        display_name: `Catalog model ${index}`,
        visibility: index < 7 ? "list" : "hidden",
        base_instructions: "Synthetic provider metadata. ".repeat(1000),
        capabilities: { unrelated: true },
      })),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(catalog)).byteLength;
    catalog.models[8].base_instructions += "x".repeat(568595 - bytes);
    const body = JSON.stringify(catalog);
    expect(new TextEncoder().encode(body).byteLength).toBe(568595);
    const result = await listChatGPTModels(
      getAccessToken,
      async () =>
        new Response(body, {
          headers: {
            "content-type": "application/json",
            "content-length": "568595",
          },
        }),
    );
    expect(result).toEqual(
      Array.from({ length: 7 }, (_, index) => ({
        slug: `catalog-model-${index}`,
        displayName: `Catalog model ${index}`,
      })),
    );
    expect(JSON.stringify(result)).not.toContain("metadata");
  });

  it.each([
    { data: [{ id: "wrong-api-catalog" }] },
    { models: [{ visibility: "list", slug: "model" }] },
    {
      models: [
        { visibility: "list", slug: "model", display_name: "Model" },
        { visibility: "list", slug: "model", display_name: "Duplicate" },
      ],
    },
    {
      models: [
        { visibility: "list", slug: "bad\nmodel", display_name: "Model" },
      ],
    },
    { models: new Array(1001).fill({ visibility: "hidden" }) },
  ])("rejects malformed model catalogs %#", async (catalog) => {
    await expect(
      listChatGPTModels(getAccessToken, async () => Response.json(catalog)),
    ).rejects.toMatchObject({ code: "chatgpt_models_invalid_response" });
  });

  it("rejects a malformed catalog with a model-specific error and preserves authentication errors", async () => {
    await expect(
      listChatGPTModels(
        getAccessToken,
        async () => new Response(" ".repeat(128001)),
      ),
    ).rejects.toMatchObject({ code: "chatgpt_models_invalid_response" });
    await expect(
      listChatGPTModels(getAccessToken, async () =>
        Response.json({ detail: token }, { status: 401 }),
      ),
    ).rejects.toMatchObject({ code: "chatgpt_session_expired" });
  });

  it("rejects advertised and streamed catalogs beyond 2 MiB and cancels both bodies", async () => {
    const limit = 2 * 1024 * 1024;
    const advertisedCancel = vi.fn();
    const advertised = new Response(
      new ReadableStream({ cancel: advertisedCancel }),
      {
        headers: {
          "content-type": "application/json",
          "content-length": String(limit + 1),
        },
      },
    );
    await expect(
      listChatGPTModels(getAccessToken, async () => advertised),
    ).rejects.toMatchObject({ code: "chatgpt_models_invalid_response" });
    expect(advertisedCancel).toHaveBeenCalledOnce();

    const streamedCancel = vi.fn();
    const streamed = stream(
      JSON.stringify({ models: [], metadata: "x".repeat(limit + 8192) }),
      4096,
      streamedCancel,
    );
    streamed.headers.set("content-type", "application/json");
    await expect(
      listChatGPTModels(getAccessToken, async () => streamed),
    ).rejects.toMatchObject({ code: "chatgpt_models_invalid_response" });
    expect(streamedCancel).toHaveBeenCalledOnce();
  });
});

describe("existing adapters with ChatGPT client injection", () => {
  const foodOutput = () => ({
    language: {
      status: "english",
      explanation: "A food phrase.",
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
          carbsG: null,
          fatG: null,
        },
      },
    ],
    unresolvedFoods: [],
    uncertainties: ["Size is unknown."],
  });
  it("preserves food evidence, unknowns and deterministic totals through Responses", async () => {
    const result = await analyzeNutritionWithCompatibleAI(
      { food: "  2 eggs  ", coverage: "partial" },
      {
        config: null,
        client: client(vi.fn(async () => response(foodOutput()))),
      },
    );
    expect(result).toMatchObject({
      originalFood: "  2 eggs  ",
      basis: "model_estimate",
      dailyTotals: null,
      recordedTotals: { kcal: { min: 130, max: 170 }, carbsG: null },
      requiresReview: true,
      assessment: "not_evaluated",
    });
    const invalid = foodOutput();
    invalid.items[0].sourceText = "invented food";
    await expect(
      analyzeNutritionWithCompatibleAI(
        { food: "2 eggs", coverage: "complete" },
        {
          client: client(vi.fn(async () => response(invalid))),
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_provider_output" });
  });

  const planInput: AIPlanningInput = {
    profile: {
      nickname: "Test",
      gender: "unspecified",
      age: 28,
      weightKg: null,
      heightCm: null,
      bodyFatPercent: null,
      activityLevel: "light",
      timeBudget: 30,
      timeZone: "Asia/Shanghai",
      examType: "none",
      examScore: null,
      examDate: "",
      comparableToeflScore: null,
      cetStatus: "not_provided",
      goal: "user",
      healthConsent: true,
    },
    preferences: {
      activityLevel: "light",
      dietaryPreferences: "",
      allergies: "",
    },
    englishSample:
      "I enjoy learning English because it helps me communicate with people from different countries. Every day I read a short story and write about my experiences.",
  };
  const planOutput = () => ({
    nutrition: { summary: "将蔬菜与主食搭配。", mealIdeas: [] },
    english: {
      summary: "能说明日常习惯。",
      strengths: [
        {
          observation: "能表达原因。",
          evidence: "because it helps me communicate",
        },
      ],
      focusAreas: [],
      tasks: TASKS.map((component) => ({
        component,
        instruction: `Practice ${component}.`,
      })),
    },
  });
  it("keeps budgets and sample validation independent of the chosen AI provider", async () => {
    const result = await createAIStarterPlan(planInput, {
      client: client(vi.fn(async () => response(planOutput()))),
    });
    expect(result.english.basis).toBe("written_sample");
    expect(result.english.tasks.map((task) => task.minutes)).toEqual(
      TASKS.map((task) => TIME_TEMPLATES[30][task]),
    );
    expect(result).not.toHaveProperty("xp");
    const invalid = planOutput();
    invalid.english.strengths[0].evidence = "invented evidence";
    await expect(
      createAIStarterPlan(planInput, {
        client: client(vi.fn(async () => response(invalid))),
      }),
    ).rejects.toMatchObject({ code: "invalid_provider_output" });
    await expect(createAIStarterPlan(planInput, {})).rejects.toMatchObject({
      code: "provider_unavailable",
    });
  });
});
