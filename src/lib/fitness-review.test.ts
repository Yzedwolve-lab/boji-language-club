import { describe, expect, it } from "vitest";
import type { AINutritionResult, AIStarterPlan } from "./ai-types";
import { emptyFitness } from "./demo-store";
import {
  evaluateFitnessReview,
  fitnessReviewFingerprint,
} from "./fitness-review";

const plan = {
  createdAt: "2026-10-15T00:00:00Z",
  nutrition: {
    status: "general_guidance",
    energy: {
      status: "available",
      targetKcal: { min: 1800, max: 2200 },
    },
  },
} as AIStarterPlan;
function diary(min = 1850, max = 2150) {
  return {
    ...emptyFitness(),
    breakfast: "My complete food diary",
    coverage: true,
    analyzed: true,
    confirmed: true,
    reviewed: true,
    reflection: "I checked my complete food diary.",
    aiAnalysis: {
      originalFood: "My complete food diary",
      coverage: "complete",
      language: { status: "english" },
      clarificationAnswers: [],
      clarificationQuestions: [],
      unresolvedFoods: [],
      recordedTotals: {
        kcal: { min, max },
        proteinG: null,
        carbsG: null,
        fatG: null,
      },
    } as unknown as AINutritionResult,
  };
}
describe("daily fitness plan review", () => {
  it.each(["breakfast", "lunch", "dinner"] as const)(
    "reviews a sole %s entry by declared coverage and intake range, without requiring other meals",
    (meal) => {
      const value = diary();
      value.breakfast = "";
      value[meal] = "My complete food diary";
      expect(evaluateFitnessReview(value, plan, true)).toMatchObject({
        status: "within_range",
        canComplete: true,
      });

      const partial = {
        ...value,
        coverage: false,
        aiAnalysis: { ...value.aiAnalysis, coverage: "partial" as const },
      };
      expect(evaluateFitnessReview(partial, plan, true)).toMatchObject({
        status: "partial",
        canComplete: false,
      });

      value.aiAnalysis.recordedTotals.kcal = { min: 160, max: 180 };
      expect(evaluateFitnessReview(value, plan, true)).toMatchObject({
        status: "below_range",
        canComplete: false,
      });
    },
  );
  it("never treats a 170 kcal full-day record as plan completion", () => {
    expect(evaluateFitnessReview(diary(160, 180), plan)).toMatchObject({
      status: "below_range",
      canComplete: false,
    });
  });
  it.each([
    [1850, 2150, "within_range", true],
    [1800, 2200, "within_range", true],
    [2250, 2400, "above_range", false],
    [1700, 1900, "boundary_uncertain", false],
    [2100, 2300, "boundary_uncertain", false],
    [0, 5000, "boundary_uncertain", false],
  ])(
    "evaluates the full estimate interval %s–%s",
    (min, max, status, canComplete) => {
      expect(
        evaluateFitnessReview(diary(Number(min), Number(max)), plan),
      ).toMatchObject({ status, canComplete });
    },
  );
  it("requires an applicable plan and full-day coverage", () => {
    expect(evaluateFitnessReview(diary())).toMatchObject({
      status: "plan_required",
      canComplete: false,
    });
    expect(
      evaluateFitnessReview({ ...diary(), coverage: false }, plan),
    ).toMatchObject({ status: "partial", canComplete: false });
  });
  it("does not turn missing calories or unrecognized food into zero", () => {
    const value = diary();
    value.aiAnalysis!.recordedTotals.kcal = null;
    expect(evaluateFitnessReview(value, plan)).toMatchObject({
      status: "unknown",
      canComplete: false,
    });
    const unresolved = diary();
    unresolved.aiAnalysis!.unresolvedFoods = [
      { sourceText: "food", reason: "unknown" },
    ];
    expect(evaluateFitnessReview(unresolved, plan).canComplete).toBe(false);
  });
  it("requires current input and clarification-answer snapshots", () => {
    expect(
      evaluateFitnessReview({ ...diary(), breakfast: "Changed diary" }, plan)
        .canComplete,
    ).toBe(false);
    expect(
      evaluateFitnessReview(
        {
          ...diary(),
          clarificationAnswers: [
            { sourceText: "food", question: "How much?", answer: "One bowl" },
          ],
        },
        plan,
      ).canComplete,
    ).toBe(false);
  });
  it("blocks unanswered questions and English revisions", () => {
    const question = diary();
    question.aiAnalysis!.clarificationQuestions = [
      { sourceText: "food", question: "How much?" },
    ];
    expect(evaluateFitnessReview(question, plan)).toMatchObject({
      status: "needs_clarification",
      canComplete: false,
    });
    const english = diary();
    english.aiAnalysis!.language.status = "needs_revision";
    expect(evaluateFitnessReview(english, plan)).toMatchObject({
      status: "english_revision",
      canComplete: false,
    });
  });
  it("binds completion evidence to the actual plan and analysis", () => {
    const key = fitnessReviewFingerprint(diary(), plan);
    expect(fitnessReviewFingerprint(diary(1900, 2100), plan)).not.toBe(key);
    expect(
      fitnessReviewFingerprint(diary(), { ...plan, createdAt: "later" }),
    ).not.toBe(key);
  });
});
