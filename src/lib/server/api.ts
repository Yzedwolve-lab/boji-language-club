import "server-only";
import { z } from "zod";
import { ApiError, errorResponse, jsonBody } from "./errors";
import { parseProfile } from "./profile";
import {
  gradeObjective,
  objectiveKeySchema,
  unavailableAudio,
} from "./grading";
import { assessWriting } from "./provider";
import { serverConfig, SupabaseGateway, type Session } from "./supabase";
import { validateEnglishLog } from "../domain";

type Period = {
  id: string;
  user_id: string;
  status: string;
  club_date: string;
  day_index: number;
};
type Lesson = {
  id: string;
  user_id: string;
  period_id: string;
  kind: string;
  answers_revealed: boolean;
  public_payload: { prompt?: string; available?: boolean };
};
type Attempt = {
  id: string;
  user_id: string;
  period_id: string;
  kind: string;
  original_input: unknown;
};
type Evaluation = {
  id: string;
  attempt_id: string;
  user_id: string;
  status: string;
  practice_score: number | null;
  created_at: string;
};
type Job = { id: string; user_id: string; state: string; attempt_id: string };
const uuid = z.string().uuid();
const submissionSchema = z
  .object({
    answer: z.string().trim().min(1).max(12000),
    requestKey: uuid,
    providerConsent: z.boolean().optional(),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success)
    throw new ApiError(
      400,
      "validation_error",
      result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    );
  return result.data;
}
const ok = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

async function personalRows<T>(
  db: SupabaseGateway,
  table: string,
  session: Session,
  query = "",
) {
  return db.rest<T[]>(
    `${table}?user_id=eq.${session.userId}&select=*&${query}`,
    session,
  );
}

async function exportData(db: SupabaseGateway, session: Session) {
  const names = [
    "profiles",
    "consent_records",
    "exam_records",
    "goals",
    "forecast_baselines",
    "plan_versions",
    "activity_periods",
    "daily_lessons",
    "task_attempts",
    "evaluations",
    "meal_logs",
    "food_items",
    "exercise_logs",
    "review_items",
    "recordings",
    "checkins",
    "xp_ledger",
    "ai_jobs",
    "usage_ledger",
  ];
  const result: Record<string, unknown[]> = {};
  for (const name of names) {
    const rows: unknown[] = [];
    for (let offset = 0; ; offset += 1000) {
      const batch = await personalRows<unknown>(
        db,
        name,
        session,
        `limit=1000&offset=${offset}&order=${name === "profiles" ? "user_id" : "id"}.asc`,
      );
      rows.push(...batch);
      if (batch.length < 1000) break;
      if (rows.length >= 100000)
        throw new ApiError(
          503,
          "export_requires_background_job",
          "This export needs a background job; no partial export has been represented as complete.",
        );
    }
    result[name] = rows;
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    records: result,
    notice:
      "Audio metadata is included; private audio binaries require separate authorized download. Provider-held data and backups follow their retention policies.",
  };
}

async function deleteAccount(db: SupabaseGateway, session: Session) {
  await db.rest(
    `profiles?user_id=eq.${session.userId}`,
    session,
    { method: "PATCH", body: JSON.stringify({ deleting: true }) },
    true,
  );
  await db.rest(
    `ai_jobs?user_id=eq.${session.userId}&state=in.(pending,running,system_error)`,
    session,
    { method: "PATCH", body: JSON.stringify({ state: "cancelled" }) },
    true,
  );
  const headers = {
    apikey: db.config.serviceKey,
    Authorization: `Bearer ${db.config.serviceKey}`,
    "Content-Type": "application/json",
  };
  // All application paths are a single-level <user UUID>/<recording UUID>.<extension>.
  // List instead of relying on metadata so interrupted uploads are removed too.
  for (;;) {
    const response = await db.fetcher(
      `${db.config.url}/storage/v1/object/list/club-audio`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ prefix: session.userId, limit: 100, offset: 0 }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      throw new ApiError(
        503,
        "deletion_pending",
        "Deletion is paused while private audio storage is unavailable. Retry account deletion to resume.",
      );
    const objects = (await response.json()) as {
      name: string;
      id: string | null;
    }[];
    if (!objects.length) break;
    if (
      objects.some(
        (entry) =>
          !entry.id || entry.name.includes("/") || entry.name.includes(".."),
      )
    )
      throw new ApiError(
        503,
        "deletion_pending",
        "Unexpected storage layout requires an operator to finish erasure.",
      );
    const removal = await db.fetcher(
      `${db.config.url}/storage/v1/object/club-audio`,
      {
        method: "DELETE",
        headers,
        body: JSON.stringify({
          prefixes: objects.map((entry) => `${session.userId}/${entry.name}`),
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!removal.ok)
      throw new ApiError(
        503,
        "deletion_pending",
        "Private audio erasure is pending. Retry to resume.",
      );
  }
  const response = await db.fetcher(
    `${db.config.url}/auth/v1/admin/users/${session.userId}`,
    { method: "DELETE", headers, signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok)
    throw new ApiError(
      503,
      "deletion_pending",
      "Audio was removed; account erasure is pending. Retry to resume.",
    );
  return {
    status: "deleted",
    notice:
      "Primary account data and private audio have been deleted. Backup and provider retention require the operator’s published policy.",
  };
}

export async function handleApi(
  request: Request,
  path: string[],
  injected?: SupabaseGateway,
): Promise<Response> {
  try {
    const db = injected ?? new SupabaseGateway(serverConfig());
    const session = await db.authenticate(request);
    const endpoint = path.join("/");
    const method = request.method;
    const profiles = await personalRows<{ deleting: boolean }>(
      db,
      "profiles",
      session,
      "limit=1",
    );
    if (profiles[0]?.deleting && !(method === "DELETE" && endpoint === "me"))
      throw new ApiError(
        409,
        "account_deleting",
        "Account erasure is in progress.",
      );
    await db.rpc("check_rate_limit", {}, session);

    if (method === "POST" && endpoint === "onboarding") {
      const result = parseProfile(await jsonBody(request));
      if ("errors" in result) return ok(result, 400);
      if (result.profile.age < 18)
        throw new ApiError(
          400,
          "adults_only",
          "The initial production service is for adults. The local demo and general record-only guidance remain available.",
        );
      const stored = await db.rpc<{ payload: unknown }>(
        "initialize_profile",
        { p_uid: session.userId, p_payload: result.profile },
        session,
        true,
      );
      return ok({ profile: stored.payload, mode: "production" });
    }
    if (!profiles[0])
      throw new ApiError(409, "missing_profile", "Complete onboarding first.");

    if (
      method === "GET" &&
      ["activity/current", "me/dashboard"].includes(endpoint)
    ) {
      const period = await db.rpc<Period>("current_activity", {}, session);
      const [lessons, attempts, evaluations] = await Promise.all([
        personalRows<Lesson>(
          db,
          "daily_lessons",
          session,
          `period_id=eq.${period.id}&order=kind.asc`,
        ),
        personalRows<Attempt>(
          db,
          "task_attempts",
          session,
          `period_id=eq.${period.id}&order=created_at.asc`,
        ),
        personalRows<Evaluation>(
          db,
          "evaluations",
          session,
          "order=created_at.desc&limit=500",
        ),
      ]);
      const ids = new Set(attempts.map((attempt) => attempt.id));
      return ok({
        period,
        profile: profiles[0],
        lessons,
        attempts,
        evaluations: evaluations.filter((evaluation) =>
          ids.has(evaluation.attempt_id),
        ),
        nutritionMode: "tracking_only",
      });
    }
    if (
      method === "POST" &&
      path[0] === "activity" &&
      path[2] === "claim" &&
      path.length === 3
    ) {
      const periodId = parse(uuid, path[1]);
      // Reject owner, passed, xp or client timestamps instead of accidentally accepting them.
      parse(z.object({}).strict(), await jsonBody(request));
      return ok(
        await db.rpc("claim_activity", { p_period_id: periodId }, session),
      );
    }
    if (method === "GET" && endpoint === "history") {
      const [periods, checkins, ledger] = await Promise.all([
        personalRows(
          db,
          "activity_periods",
          session,
          "order=created_at.desc&limit=100",
        ),
        personalRows(
          db,
          "checkins",
          session,
          "order=created_at.desc&limit=100",
        ),
        personalRows(
          db,
          "xp_ledger",
          session,
          "order=created_at.desc&limit=100",
        ),
      ]);
      return ok({
        periods,
        checkins,
        ledger,
        limit: 100,
        fullExportEndpoint: "/api/v1/me/export",
      });
    }
    if (method === "POST" && endpoint === "me/export")
      return ok(await exportData(db, session));
    if (method === "DELETE" && endpoint === "me") {
      parse(
        z.object({ confirmation: z.literal("DELETE MY ACCOUNT") }).strict(),
        await jsonBody(request),
      );
      return ok(await deleteAccount(db, session));
    }
    if (method === "GET" && path[0] === "jobs" && path.length === 2)
      return ok(await db.own<Job>("ai_jobs", parse(uuid, path[1]), session));

    if (
      method === "POST" &&
      path[0] === "language" &&
      path[1] === "tasks" &&
      ["submit", "retry"].includes(path[3]) &&
      path.length === 4
    ) {
      const lesson = await db.own<Lesson>(
        "daily_lessons",
        parse(uuid, path[2]),
        session,
      );
      const input = parse(submissionSchema, await jsonBody(request));
      if (lesson.public_payload.available === false)
        throw new ApiError(
          503,
          "material_unavailable",
          "This lesson requires a verified audio resource. No attempt has been marked incorrect.",
        );
      let evaluation: unknown = null;
      if (["vocabulary", "reading", "listening"].includes(lesson.kind)) {
        const keys = await db.rest<{ private_payload: unknown }[]>(
          `lesson_private_keys?lesson_id=eq.${lesson.id}&select=private_payload&limit=1`,
          session,
          {},
          true,
        );
        const key = objectiveKeySchema.safeParse(keys[0]?.private_payload);
        if (!key.success)
          throw new ApiError(
            503,
            "answer_key_unavailable",
            "A verified answer key is unavailable.",
          );
        evaluation = gradeObjective(input.answer, key.data);
      }
      const saved = await db.rpc<{ attempt: Attempt; idempotent: boolean }>(
        "record_attempt",
        {
          p_uid: session.userId,
          p_period: lesson.period_id,
          p_lesson: lesson.id,
          p_kind: lesson.kind,
          p_input: {
            answer: input.answer,
            providerConsent: input.providerConsent === true,
          },
          p_request: input.requestKey,
          p_evaluation: evaluation,
        },
        session,
        true,
      );
      if (evaluation) return ok({ ...saved, evaluation });
      const jobs = await personalRows<Job>(
        db,
        "ai_jobs",
        session,
        `attempt_id=eq.${saved.attempt.id}&limit=1`,
      );
      const job = jobs[0];
      if (lesson.kind === "speaking")
        return ok({ ...saved, job, evaluation: unavailableAudio() }, 202);
      if (
        !job ||
        saved.idempotent ||
        input.providerConsent !== true ||
        process.env.ENABLE_PAID_WRITING !== "true"
      )
        return ok(
          {
            ...saved,
            job,
            status: "pending_review",
            reason:
              "Writing assessment requires explicit provider consent, a configured provider and a reviewed usage budget.",
          },
          202,
        );
      try {
        const units = Number(process.env.WRITING_RESERVATION_UNITS ?? 0);
        if (!Number.isSafeInteger(units) || units < 1)
          throw new ApiError(
            503,
            "budget_not_configured",
            "Writing cost reservation has not been reviewed.",
          );
        const reserved = await db.rpc<boolean>(
          "reserve_usage",
          { p_uid: session.userId, p_job: job.id, p_units: units },
          session,
          true,
        );
        if (!reserved)
          return ok({ ...saved, job, status: "pending_review" }, 202);
        await db.rest(
          "consent_records",
          session,
          {
            method: "POST",
            body: JSON.stringify({
              user_id: session.userId,
              purpose: "send_writing_to_openai",
              accepted: true,
              policy_version: "provider-consent-v1",
            }),
          },
          true,
        );
        const assessed = await assessWriting(
          input.answer,
          lesson.public_payload.prompt ?? "",
          db.fetcher,
        );
        await db.rpc(
          "finish_assessment",
          {
            p_uid: session.userId,
            p_job: job.id,
            p_evaluation: assessed,
            p_error: null,
          },
          session,
          true,
        );
        await db.rest(
          `usage_ledger?user_id=eq.${session.userId}&job_id=eq.${job.id}`,
          session,
          { method: "PATCH", body: JSON.stringify({ state: "spent" }) },
          true,
        );
        return ok({ ...saved, evaluation: assessed });
      } catch (error) {
        const code =
          error instanceof ApiError ? error.code : "provider_unavailable";
        await db.rpc(
          "finish_assessment",
          {
            p_uid: session.userId,
            p_job: job.id,
            p_evaluation: null,
            p_error: code,
          },
          session,
          true,
        );
        // A timeout may still have cost money. Keep its reservation, never guess a refund.
        return ok(
          {
            ...saved,
            status: "system_error",
            error: code,
            message:
              "Your original answer is saved. Provider failure is not a learner failure.",
          },
          202,
        );
      }
    }

    if (method === "POST" && endpoint === "fitness/analyze") {
      const input = parse(
        z
          .object({
            periodId: uuid,
            food: z.string().max(10000),
            exercise: z.string().max(3000),
            coverage: z.enum(["partial", "complete", "exercise_only"]),
          })
          .strict(),
        await jsonBody(request),
      );
      await db.own<Period>("activity_periods", input.periodId, session);
      if (!input.food.trim() && !input.exercise.trim())
        throw new ApiError(
          400,
          "empty_log",
          "Log at least one meal or activity before submitting.",
        );
      // Save truthful raw logs regardless of energy intake or semantic/provider availability.
      const rows = await db.rest<{ id: string }[]>(
        "meal_logs",
        session,
        {
          method: "POST",
          body: JSON.stringify({
            user_id: session.userId,
            period_id: input.periodId,
            raw_text: JSON.stringify({
              food: input.food,
              exercise: input.exercise,
            }),
            coverage: input.coverage,
          }),
        },
        true,
      );
      return ok(
        {
          logId: rows[0].id,
          status: "saved",
          mode: "tracking_only",
          nutrition: null,
          expenditure: null,
          feedback:
            "Your authentic record is saved. Nutrition extraction and database matching are not configured. No calorie target or full-day evaluation has been inferred.",
        },
        201,
      );
    }
    if (method === "POST" && endpoint === "fitness/complete") {
      const input = parse(
        z
          .object({
            logId: uuid,
            reflection: z.string().trim().min(8).max(1500),
            reviewedFeedback: z.literal(true),
            confirmedAssumptions: z.literal(true),
            requestKey: uuid,
          })
          .strict(),
        await jsonBody(request),
      );
      const log = await db.own<{
        id: string;
        user_id: string;
        period_id: string;
        raw_text: string;
      }>("meal_logs", input.logId, session);
      const original = JSON.parse(log.raw_text) as {
        food: string;
        exercise: string;
      };
      const food = original.food.trim()
        ? validateEnglishLog(original.food, "food")
        : null;
      const exercise = original.exercise.trim()
        ? validateEnglishLog(original.exercise, "activity")
        : null;
      // Conservative deterministic recognition supports simple supplied English logs.
      // Unrecognized raw logs remain saved and require review; they are never erased.
      if (!(food?.valid || exercise?.valid))
        throw new ApiError(
          422,
          "record_needs_review",
          "Your log is saved; use a clear English food/activity phrase or wait for semantic review.",
        );
      if (
        !/[a-z]{2,}/i.test(input.reflection) ||
        /[\u3400-\u9fff]/.test(input.reflection)
      )
        throw new ApiError(
          422,
          "english_reflection_required",
          "Write one practical reflection in English.",
        );
      const evaluation = {
        status: "passed",
        practiceScore: 100,
        pronunciation: null,
        fluency: null,
        evidenceMode: "record_review",
        rubricVersion: "record-quality-v1",
        feedback: {
          mode: "tracking_only",
          note: "Credit is for a valid record, acknowledged assumptions/feedback and reflection. Food quantity, body metrics and exercise calories earn no bonus.",
        },
      };
      return ok(
        await db.rpc(
          "record_attempt",
          {
            p_uid: session.userId,
            p_period: log.period_id,
            p_lesson: null,
            p_kind: "fitness",
            p_input: input,
            p_request: input.requestKey,
            p_evaluation: evaluation,
          },
          session,
          true,
        ),
      );
    }

    if (method === "GET" && path[0] === "feedback" && path.length === 2) {
      const period = await db.own<Period>(
        "activity_periods",
        parse(uuid, path[1]),
        session,
      );
      const lessons = await personalRows<Lesson>(
        db,
        "daily_lessons",
        session,
        `period_id=eq.${period.id}`,
      );
      // The immutable settlement snapshot proves full pass. No guessed lesson ID can unlock keys.
      const checkins = await personalRows(
        db,
        "checkins",
        session,
        `activity_period_id=eq.${period.id}&limit=1`,
      );
      if (!checkins.length)
        throw new ApiError(
          403,
          "answers_locked",
          "Full answer keys are released after successful daily settlement.",
        );
      const keys = await db.rest(
        `lesson_private_keys?lesson_id=in.(${lessons.map((lesson) => lesson.id).join(",")})&select=*`,
        session,
        {},
        true,
      );
      await db.rest(
        `daily_lessons?user_id=eq.${session.userId}&period_id=eq.${period.id}`,
        session,
        { method: "PATCH", body: JSON.stringify({ answers_revealed: true }) },
        true,
      );
      return ok({ keys, answersRevealed: true });
    }
    if (method === "POST" && endpoint === "plans/preview") {
      parse(
        z
          .object({ compressionRatio: z.number().finite().min(0).max(0.4) })
          .strict(),
        await jsonBody(request),
      );
      return ok({
        status: "calibrating",
        earliestDate: null,
        latestDate: null,
        confidenceLabel: "Insufficient independent evidence",
        assumptions: [
          "No validated unaccelerated forecast baseline is available.",
        ],
        nextReviewDate: null,
        basedOnEvidenceIds: [],
        planVersion: 1,
        applied: false,
      });
    }
    if (
      method === "POST" &&
      ["plans/confirm", "recordings/upload-intent"].includes(endpoint)
    )
      throw new ApiError(
        503,
        "service_unavailable",
        endpoint.startsWith("recordings")
          ? "Private storage is defined, but verified media decoding, upload scanning and retention workers must be configured before uploads are enabled."
          : "A validated independent forecast is required before plan confirmation.",
      );
    throw new ApiError(404, "not_found", "Unknown API endpoint.");
  } catch (error) {
    return errorResponse(error);
  }
}
