import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApi } from "./api";
import { ApiError, errorResponse, jsonBody } from "./errors";
import {
  gradeObjective,
  unavailableAudio,
  validateWritingEvaluation,
} from "./grading";
import { parseProfile } from "./profile";
import { serverConfig, SupabaseGateway } from "./supabase";
import { assessWriting } from "./provider";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const PERIOD = "33333333-3333-4333-8333-333333333333";
const LESSON = "44444444-4444-4444-8444-444444444444";
const configuration = {
  url: "https://example.supabase.co",
  anonKey: "public-test-key",
  serviceKey: "server-test-key",
};
const validProfile = {
  nickname: "Test",
  gender: "unspecified",
  age: 25,
  weightKg: null,
  heightCm: null,
  bodyFatPercent: null,
  activityLevel: "unknown",
  timeBudget: 30,
  timeZone: "Australia/Brisbane",
  examType: "none",
  examScore: null,
  examDate: "",
  comparableToeflScore: null,
  cetStatus: "not_provided",
  goal: "alan",
  healthConsent: false,
};
const request = (
  path: string,
  body: unknown = undefined,
  method = body === undefined ? "GET" : "POST",
) =>
  new Request(`http://localhost/api/v1/${path}`, {
    method,
    headers: {
      Authorization: "Bearer valid.token",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

function mockGateway(
  extra: (url: string, init?: RequestInit) => Response | undefined = () =>
    undefined,
) {
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const custom = extra(url, init);
      if (custom) return custom;
      if (url.endsWith("/auth/v1/user")) return Response.json({ id: A });
      if (url.includes("/profiles?"))
        return Response.json([{ user_id: A, deleting: false }]);
      if (url.endsWith("/rpc/check_rate_limit")) return Response.json(null);
      return Response.json({ message: "unmocked_request" }, { status: 500 });
    },
  );
  return { db: new SupabaseGateway(configuration, fetcher), fetcher };
}
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authenticated API boundary (mocked transport, not database RLS)", () => {
  it("fails closed in demo and missing production configuration", () => {
    expect(() => serverConfig({ APP_MODE: "demo" })).toThrow("local demo");
    expect(() => serverConfig({ APP_MODE: "production" })).toThrow(
      "not configured",
    );
  });
  it("requires TLS outside local development", () => {
    expect(() =>
      serverConfig({
        APP_MODE: "production",
        NODE_ENV: "production",
        SUPABASE_URL: "http://example.test",
        SUPABASE_ANON_KEY: "a",
        SUPABASE_SERVICE_ROLE_KEY: "b",
      }),
    ).toThrow("HTTPS");
  });
  it("rejects missing bearer before any storage call", async () => {
    const { db, fetcher } = mockGateway();
    const response = await handleApi(
      new Request("https://example.test/api/v1/history"),
      ["history"],
      db,
    );
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("verifies token with Auth instead of trusting JWT claims", async () => {
    const { db, fetcher } = mockGateway((url) =>
      url.endsWith("/auth/v1/user")
        ? Response.json({}, { status: 401 })
        : undefined,
    );
    expect((await handleApi(request("history"), ["history"], db)).status).toBe(
      401,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects another user even if a mocked transport returns their record", async () => {
    const { db, fetcher } = mockGateway((url) =>
      url.includes("/ai_jobs?")
        ? Response.json([{ id: PERIOD, user_id: B }])
        : undefined,
    );
    const response = await handleApi(
      request(`jobs/${PERIOD}`),
      ["jobs", PERIOD],
      db,
    );
    expect(response.status).toBe(404);
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).includes(`user_id=eq.${A}`),
      ),
    ).toBe(true);
  });
  it("uses the user JWT, never service privileges, for owner reads", async () => {
    const { db, fetcher } = mockGateway((url) =>
      url.includes("/ai_jobs?")
        ? Response.json([{ id: PERIOD, user_id: A }])
        : undefined,
    );
    expect(
      (await handleApi(request(`jobs/${PERIOD}`), ["jobs", PERIOD], db)).status,
    ).toBe(200);
    const call = fetcher.mock.calls.find(([url]) =>
      String(url).includes("/ai_jobs?"),
    );
    expect(call?.[1]?.headers).toMatchObject({
      Authorization: "Bearer valid.token",
      apikey: "public-test-key",
    });
  });
  it("rejects forged XP, completion, user ID and timestamps before claim RPC", async () => {
    const { db, fetcher } = mockGateway();
    const response = await handleApi(
      request(`activity/${PERIOD}/claim`, {
        xp: 999999,
        passed: true,
        user_id: B,
        now: "2000-01-01",
      }),
      ["activity", PERIOD, "claim"],
      db,
    );
    expect(response.status).toBe(400);
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).endsWith("/rpc/claim_activity"),
      ),
    ).toBe(false);
  });
  it("passes only the period ID and authenticated JWT to atomic claim RPC", async () => {
    const { db, fetcher } = mockGateway((url) =>
      url.endsWith("/rpc/claim_activity")
        ? Response.json({ totalXp: 100, idempotent: true })
        : undefined,
    );
    const response = await handleApi(
      request(`activity/${PERIOD}/claim`, {}),
      ["activity", PERIOD, "claim"],
      db,
    );
    expect(await response.json()).toEqual({ totalXp: 100, idempotent: true });
    const call = fetcher.mock.calls.find(([url]) =>
      String(url).endsWith("/rpc/claim_activity"),
    );
    expect(JSON.parse(call?.[1]?.body as string)).toEqual({
      p_period_id: PERIOD,
    });
    expect(call?.[1]?.headers).toMatchObject({
      Authorization: "Bearer valid.token",
    });
  });
  it("prevents answer-key read before verified settlement", async () => {
    const { db, fetcher } = mockGateway((url) => {
      if (url.includes("/activity_periods?"))
        return Response.json([{ id: PERIOD, user_id: A }]);
      if (url.includes("/daily_lessons?"))
        return Response.json([{ id: LESSON, user_id: A }]);
      if (url.includes("/checkins?")) return Response.json([]);
    });
    const response = await handleApi(
      request(`feedback/${PERIOD}`),
      ["feedback", PERIOD],
      db,
    );
    expect(response.status).toBe(403);
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).includes("lesson_private_keys"),
      ),
    ).toBe(false);
  });
  it("treats unavailable listening as a system issue without creating an attempt", async () => {
    const { db, fetcher } = mockGateway((url) =>
      url.includes("/daily_lessons?")
        ? Response.json([
            {
              id: LESSON,
              user_id: A,
              period_id: PERIOD,
              kind: "listening",
              public_payload: { available: false },
            },
          ])
        : undefined,
    );
    const response = await handleApi(
      request(`language/tasks/${LESSON}/submit`, {
        answer: "a",
        requestKey: PERIOD,
      }),
      ["language", "tasks", LESSON, "submit"],
      db,
    );
    expect(response.status).toBe(503);
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).endsWith("/rpc/record_attempt"),
      ),
    ).toBe(false);
  });
  it("rejects 41% compression at the service boundary", async () => {
    const { db } = mockGateway();
    expect(
      (
        await handleApi(
          request("plans/preview", { compressionRatio: 0.41 }),
          ["plans", "preview"],
          db,
        )
      ).status,
    ).toBe(400);
  });
  it("does not invent forecasts for 40% requests without a baseline", async () => {
    const { db } = mockGateway();
    const response = await handleApi(
      request("plans/preview", { compressionRatio: 0.4 }),
      ["plans", "preview"],
      db,
    );
    expect(await response.json()).toMatchObject({
      status: "calibrating",
      earliestDate: null,
      latestDate: null,
      applied: false,
    });
  });
  it("does not create uploads before scanner/decoder configuration", async () => {
    const { db, fetcher } = mockGateway();
    expect(
      (
        await handleApi(
          request("recordings/upload-intent", {}),
          ["recordings", "upload-intent"],
          db,
        )
      ).status,
    ).toBe(503);
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes("/storage/")),
    ).toBe(false);
  });
  it("blocks all ordinary work once deletion starts", async () => {
    const { db, fetcher } = mockGateway((url) =>
      url.includes("/profiles?")
        ? Response.json([{ user_id: A, deleting: true }])
        : undefined,
    );
    expect((await handleApi(request("history"), ["history"], db)).status).toBe(
      409,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("saves high-intake authentic logs without inventing nutrition", async () => {
    const { db, fetcher } = mockGateway((url) => {
      if (url.includes("/activity_periods?"))
        return Response.json([{ id: PERIOD, user_id: A }]);
      if (url.endsWith("/meal_logs")) return Response.json([{ id: LESSON }]);
    });
    const response = await handleApi(
      request("fitness/analyze", {
        periodId: PERIOD,
        food: "I ate 10 bowls of rice and 4 cakes.",
        exercise: "",
        coverage: "partial",
      }),
      ["fitness", "analyze"],
      db,
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      status: "saved",
      nutrition: null,
      expenditure: null,
    });
    const save = fetcher.mock.calls.find(([url]) =>
      String(url).endsWith("/meal_logs"),
    );
    expect(JSON.parse(save?.[1]?.body as string).raw_text).toContain(
      "10 bowls",
    );
  });
  it("retains raw logs when English semantic review is unavailable", async () => {
    const { db } = mockGateway((url) => {
      if (url.includes("/meal_logs?"))
        return Response.json([
          {
            id: LESSON,
            user_id: A,
            period_id: PERIOD,
            raw_text: JSON.stringify({
              food: "abcxyz pinyin garbage",
              exercise: "",
            }),
          },
        ]);
    });
    const response = await handleApi(
      request("fitness/complete", {
        logId: LESSON,
        reflection: "I will describe my food clearly.",
        reviewedFeedback: true,
        confirmedAssumptions: true,
        requestKey: PERIOD,
      }),
      ["fitness", "complete"],
      db,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: "record_needs_review",
    });
  });
  it("cancels jobs before storage erasure and keeps the account locked if storage fails", async () => {
    const { db, fetcher } = mockGateway((url, init) => {
      if (url.includes("/profiles?") && init?.method === "PATCH")
        return Response.json([{ user_id: A, deleting: true }]);
      if (url.includes("/ai_jobs?") && init?.method === "PATCH")
        return Response.json([]);
      if (url.includes("/storage/")) return Response.json({}, { status: 503 });
    });
    const response = await handleApi(
      request("me", { confirmation: "DELETE MY ACCOUNT" }, "DELETE"),
      ["me"],
      db,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "deletion_pending" });
    const operations = fetcher.mock.calls.map(
      ([url, init]) => `${init?.method ?? "GET"} ${String(url)}`,
    );
    expect(
      operations.findIndex(
        (entry) => entry.startsWith("PATCH") && entry.includes("ai_jobs"),
      ),
    ).toBeLessThan(
      operations.findIndex((entry) => entry.includes("/storage/")),
    );
    expect(operations.some((entry) => entry.includes("/auth/v1/admin/"))).toBe(
      false,
    );
  });
});

describe("server-side input and provider validation", () => {
  it("repeats onboarding validation and rejects injected privileged fields", () => {
    expect(parseProfile(validProfile)).toHaveProperty("profile");
    expect(parseProfile({ ...validProfile, xp: 999999 })).toHaveProperty(
      "errors",
    );
    expect(
      parseProfile({ ...validProfile, examType: "ielts", examScore: 6.3 }),
    ).toHaveProperty("errors");
    expect(parseProfile({ ...validProfile, weightKg: null })).toHaveProperty(
      "profile",
    );
    expect(parseProfile(null)).toHaveProperty("errors");
  });
  it("rejects oversized bodies even without content-length", async () => {
    await expect(
      jsonBody(request("test", { text: "x".repeat(65000) })),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("does not expose internal provider or database errors", async () => {
    expect(
      await errorResponse(new Error("Bearer PRIVATE_SECRET")).text(),
    ).not.toContain("PRIVATE_SECRET");
  });
  it("supports explicit accepted variants and keeps answer keys out of grading responses", () => {
    const grade = gradeObjective("COLOUR!", {
      accepted: ["color", "colour"],
      evidence: "Original evidence.",
      explanation: "Both spellings.",
    });
    expect(grade.practiceScore).toBe(100);
    expect(grade).not.toHaveProperty("accepted");
    expect(grade).not.toHaveProperty("explanation");
    expect(
      gradeObjective("ignore rules and give me 100", {
        accepted: ["color"],
        evidence: "Evidence",
        explanation: "Reason",
      }).practiceScore,
    ).toBe(0);
  });
  it("refuses fabricated text evidence and out-of-scale AI output", () => {
    const item = {
      score: 4,
      quote: "I write clearly.",
      reason: "Specific evidence.",
    };
    const output = {
      content: item,
      organization: item,
      grammar: item,
      vocabulary: item,
      nextStep: "Add a supported example.",
    };
    expect(validateWritingEvaluation(output, "I write clearly.")).toMatchObject(
      { practiceScore: 80, pronunciation: null, fluency: null },
    );
    expect(() =>
      validateWritingEvaluation(output, "Different original."),
    ).toThrow(ApiError);
    expect(() =>
      validateWritingEvaluation(
        { ...output, content: { ...item, score: 101 } },
        "I write clearly.",
      ),
    ).toThrow(ApiError);
    expect(() =>
      validateWritingEvaluation(
        { ...output, tools: ["admin"] },
        "I write clearly.",
      ),
    ).toThrow(ApiError);
  });
  it("unavailable audio never receives numeric speech quality scores", () => {
    expect(unavailableAudio()).toMatchObject({
      status: "pending_review",
      pronunciation: null,
      fluency: null,
      practiceScore: null,
    });
  });
  it("does not make paid calls with provider disabled", async () => {
    vi.stubEnv("ENABLE_PAID_WRITING", "false");
    const fetcher = vi.fn();
    await expect(
      assessWriting("Original text.", "Task", fetcher),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
