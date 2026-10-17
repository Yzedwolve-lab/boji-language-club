import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createAIConnectionService } from "./ai-connection-service";
import { SelfHostedStore } from "./self-hosted-store";

const origin = "http://127.0.0.1:3100";
const password = "synthetic-test-password-at-least-16";
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(
    join(tmpdir(), "boji-nutrition-clarification-test-"),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  const target = resolve(directory);
  if (
    !target.startsWith(
      `${resolve(tmpdir())}${sep}boji-nutrition-clarification-test-`,
    )
  )
    throw new Error("Unsafe test cleanup path");
  await rm(target, { recursive: true, force: true });
});

function request(path: string, body?: unknown, cookie = "") {
  return new Request(`${origin}/api/self-hosted/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Host: "127.0.0.1:3100",
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
function completion(value: unknown, responses: boolean) {
  if (!responses)
    return Response.json({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(value) } },
      ],
    });
  return new Response(
    `data: ${JSON.stringify({
      type: "response.completed",
      response: {
        status: "completed",
        output: [
          {
            id: "msg-clarification",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: JSON.stringify(value) }],
          },
        ],
      },
    })}\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
function setup() {
  let signedIn = false;
  const summary = () => ({
    signedIn,
    sharing: signedIn,
    ...(signedIn ? { accountId: "synthetic-account" } : {}),
  });
  const auth = {
    start: vi.fn(async () => ({
      authorizationUrl:
        "https://auth.openai.com/api/accounts/authorize?state=synthetic",
      attemptId: "synthetic-attempt",
    })),
    complete: vi.fn(async () => {
      signedIn = true;
      return summary();
    }),
    getSummary: vi.fn(async () => summary()),
    getAccessToken: vi.fn(async () => "synthetic-token"),
    signOut: vi.fn(async () => {
      signedIn = false;
      return { remoteRevocationConfirmed: false };
    }),
    cancel: vi.fn(async () => {}),
  };
  const transport = vi.fn(
    async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/models"))
        return Response.json({
          models: [
            { slug: "test-model", display_name: "Test", visibility: "list" },
          ],
        });
      const data = String(init?.body).includes("originalFood")
        ? {
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
                  kcal: { min: 150, max: 190 },
                  proteinG: { min: 11, max: 14 },
                  carbsG: { min: 0, max: 2 },
                  fatG: { min: 9, max: 12 },
                },
              },
            ],
            unresolvedFoods: [],
            uncertainties: [],
            clarificationQuestions: [],
          }
        : { connected: true };
      return completion(data, String(url).endsWith("/responses"));
    },
  );
  return {
    transport,
    service: createAIConnectionService({
      env: {
        APP_MODE: "self_hosted",
        ENABLE_OPENAI_COMPATIBLE: "true",
        OPENAI_COMPAT_BASE_URL: "https://provider.example/v1",
        OPENAI_COMPAT_API_KEY: "synthetic-key",
        OPENAI_COMPAT_MODEL: "test-model",
        BOJI_SELF_HOSTED_PASSWORD: password,
        BOJI_SELF_HOSTED_ORIGIN: origin,
        BOJI_PRIVATE_DIR: directory,
        BOJI_DAILY_AI_CALL_LIMIT: "40",
      },
      auth,
      fetcher: transport,
      now: () => Date.parse("2026-10-15T03:00:00Z"),
      resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    }),
  };
}

describe.each(["api_key", "chatgpt"] as const)(
  "%s nutrition clarification boundary",
  (provider) => {
    it("validates answers before spending quota and sends valid answer evidence through the selected AI", async () => {
      const { service, transport } = setup();
      let cookie: string;
      if (provider === "api_key") {
        const connected = await service.handle(
          request("connect", { password }),
          "connect",
        );
        expect(connected.status).toBe(200);
        cookie = cookies(connected);
      } else {
        const started = await service.handle(
          request("chatgpt/start", {}),
          "chatgpt/start",
        );
        expect(started.status).toBe(200);
        const signedIn = await service.handle(
          request(
            "chatgpt/callback?code=synthetic&state=synthetic",
            undefined,
            cookies(started),
          ),
          "chatgpt/callback",
        );
        expect(signedIn.status).toBe(303);
        const connected = await service.handle(
          request("chatgpt/connect", {}, cookies(signedIn)),
          "chatgpt/connect",
        );
        expect(connected.status).toBe(200);
        cookie = `${cookies(signedIn)}; ${cookies(connected)}`;
      }
      const reserve = vi.spyOn(SelfHostedStore.prototype, "reserveCall");
      transport.mockClear();
      const answer = {
        sourceText: "2 eggs",
        question: "How large were the eggs?",
        answer: "Large eggs.",
      };
      const invalidInputs = [
        {
          food: "2 eggs",
          clarificationAnswers: [{ ...answer, answer: "大的" }],
        },
        {
          food: "2 eggs",
          clarificationAnswers: [{ ...answer, sourceText: "steak" }],
        },
        { food: "2 eggs", clarificationAnswers: Array(4).fill(answer) },
        { food: "2 eggs" + "\n".repeat(6500) },
      ];
      for (const input of invalidInputs) {
        const result = await service.handle(
          request("nutrition", { ...input, coverage: "complete" }, cookie),
          "nutrition",
        );
        expect(result.status).toBe(400);
        expect(await result.json()).toMatchObject({
          error: "invalid_food_input",
        });
      }
      expect(reserve).not.toHaveBeenCalled();
      expect(transport).not.toHaveBeenCalled();
      const result = await service.handle(
        request(
          "nutrition",
          {
            food: "2 eggs",
            coverage: "complete",
            clarificationAnswers: [answer],
          },
          cookie,
        ),
        "nutrition",
      );
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({
        originalFood: "2 eggs",
        clarificationAnswers: [answer],
        clarificationQuestions: [],
        analysisState: "estimated",
        dailyTotals: { kcal: { min: 150, max: 190 } },
        assessment: "not_evaluated",
      });
      expect(reserve).toHaveBeenCalledTimes(1);
      expect(transport).toHaveBeenCalledTimes(1);
      const [url, init] = transport.mock.calls[0];
      expect(String(url)).toBe(
        provider === "chatgpt"
          ? "https://api.openai.com/v1/responses"
          : "https://provider.example/v1/chat/completions",
      );
      expect(String(init?.body)).toContain("clarificationAnswers");
      expect(String(init?.body)).toContain("Large eggs.");
    });
  },
);
