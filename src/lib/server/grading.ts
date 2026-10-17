import "server-only";
import { z } from "zod";
import { ApiError } from "./errors";

export const objectiveKeySchema = z
  .object({
    accepted: z.array(z.string().min(1)).min(1),
    explanation: z.string().min(1),
    evidence: z.string().min(1),
    transcript: z.string().optional(),
  })
  .strict();
export function gradeObjective(
  answer: string,
  key: z.infer<typeof objectiveKeySchema>,
) {
  const parsed = objectiveKeySchema.parse(key);
  const normalize = (text: string) =>
    text
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/[.!?]+$/, "")
      .replace(/\s+/g, " ");
  const passed = parsed.accepted.some(
    (variant) => normalize(variant) === normalize(answer),
  );
  return {
    status: passed ? "passed" : "needs_revision",
    practiceScore: passed ? 100 : 0,
    rubricVersion: "objective-v1",
    evidenceMode: "objective",
    pronunciation: null,
    fluency: null,
  };
}

const dimension = z
  .object({
    score: z.number().finite().min(0).max(5),
    quote: z.string().min(1).max(2000),
    reason: z.string().min(1).max(2000),
  })
  .strict();
export const writingEvaluationSchema = z
  .object({
    content: dimension,
    organization: dimension,
    grammar: dimension,
    vocabulary: dimension,
    nextStep: z.string().min(1).max(2000),
  })
  .strict();

export function validateWritingEvaluation(raw: unknown, original: string) {
  const parsed = writingEvaluationSchema.safeParse(raw);
  if (!parsed.success)
    throw new ApiError(
      503,
      "invalid_provider_output",
      "The provider returned an invalid assessment. Your original answer is saved.",
    );
  const dimensions = [
    parsed.data.content,
    parsed.data.organization,
    parsed.data.grammar,
    parsed.data.vocabulary,
  ];
  if (dimensions.some((item) => !original.includes(item.quote)))
    throw new ApiError(
      503,
      "invalid_provider_evidence",
      "The assessment could not be matched to your original text.",
    );
  const score = Math.round(
    dimensions.reduce((sum, item) => sum + item.score, 0) * 5,
  );
  return {
    status: score >= 60 ? "passed" : "needs_revision",
    practiceScore: score,
    rubricVersion: "writing-v1",
    evidenceMode: "text",
    pronunciation: null,
    fluency: null,
    feedback: parsed.data,
  };
}

export function unavailableAudio() {
  return {
    status: "pending_review",
    practiceScore: null,
    pronunciation: null,
    fluency: null,
    evidenceMode: "unavailable",
    reason:
      "No verified audio decoder/scoring provider is configured. Audio quality cannot be inferred from a transcript, duration or file existence.",
  } as const;
}
