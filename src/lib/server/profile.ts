import "server-only";
import { z } from "zod";
import { validateProfile } from "../domain";

export const profileSchema = z
  .object({
    nickname: z.string().max(24),
    gender: z.enum(["male", "female", "unspecified"]),
    age: z.number().int(),
    weightKg: z.number().finite().nullable(),
    heightCm: z.number().finite().nullable(),
    bodyFatPercent: z.number().finite().nullable(),
    activityLevel: z.string().max(40),
    timeBudget: z.union([
      z.literal(30),
      z.literal(60),
      z.literal(120),
      z.literal(240),
    ]),
    timeZone: z.string().max(100),
    examType: z.enum([
      "none",
      "ielts",
      "pte_academic",
      "toefl_legacy_total",
      "toefl_2026_band",
      "cet4",
      "cet6",
    ]),
    examScore: z.number().finite().nullable(),
    examDate: z.string().max(10),
    comparableToeflScore: z.number().finite().nullable(),
    cetStatus: z.string().max(40),
    goal: z.enum(["user", "member", "shareholder", "alan"]),
    healthConsent: z.boolean(),
  })
  .strict();

export function parseProfile(raw: unknown) {
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success)
    return {
      errors: Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join(".") || "profile",
          issue.message,
        ]),
      ),
    };
  const errors = validateProfile(parsed.data);
  if (Object.keys(errors).length) return { errors };
  return {
    profile: {
      ...parsed.data,
      nickname:
        parsed.data.nickname.trim() ||
        `俱乐部成员-${crypto.randomUUID().slice(0, 6)}`,
    },
  };
}
