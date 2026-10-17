import { describe, it, expect } from "vitest";
import {
  newDemo,
  rollDemo,
  claimDemo,
  defaultProfile,
  isFitnessComplete,
  normalizeDemoState,
  applicableAIPlan,
  effectivePlanningProfile,
  requiresFitnessReview,
} from "./demo-store";
import {
  FITNESS_REVIEW_VERSION,
  fitnessReviewFingerprint,
} from "./fitness-review";
import { energyInputKey } from "./energy-plan";
import type { AINutritionResult, AIStarterPlan } from "./ai-types";
describe("explicit local demo lifecycle", () => {
  it("starts selected target with silver XP and no invented metrics", () => {
    const s = newDemo(
      { ...defaultProfile(), goal: "alan" },
      new Date("2026-10-15T02:00:00Z"),
    );
    expect(s.xp).toBe(0);
    expect(s.profile.weightKg).toBeNull();
    expect(s.current.dayIndex).toBe(1);
  });
  it("archives unclaimed drafts without incrementing training Day", () => {
    const s = newDemo(defaultProfile(), new Date("2026-10-15T02:00:00Z"));
    s.current.fitness.breakfast = "2 eggs";
    const next = rollDemo(s, "2026-10-16");
    expect(next.current.dayIndex).toBe(1);
    expect(next.history[0].fitness.breakfast).toBe("2 eggs");
    expect(next.xp).toBe(0);
  });
  it("does not settle incomplete evidence", () => {
    expect(() => claimDemo(newDemo(defaultProfile()))).toThrow();
  });
  it("rejects malformed numeric activity scores", () => {
    const s = newDemo(defaultProfile());
    s.current.fitness = { ...s.current.fitness, completed: true, quality: 100 };
    for (const k of [
      "vocabulary",
      "listening",
      "reading",
      "writing",
      "speaking",
    ] as const)
      s.current.learning[k] = 100;
    s.current.learning.vocabulary = 101;
    expect(() => claimDemo(s)).toThrow();
  });
  it("claim is idempotent and waits for day boundary", () => {
    const s = newDemo(defaultProfile(), new Date("2026-10-15T02:00:00Z"));
    s.current.fitness = { ...s.current.fitness, completed: true, quality: 100 };
    for (const k of [
      "vocabulary",
      "listening",
      "reading",
      "writing",
      "speaking",
    ] as const)
      s.current.learning[k] = 80;
    const first = claimDemo(s);
    expect(first.xp).toBe(90);
    expect(claimDemo(first).xp).toBe(90);
    expect(first.current.dayIndex).toBe(1);
    expect(rollDemo(first, "2026-10-16").current.dayIndex).toBe(2);
    expect(first.ledger).toHaveLength(1);
  });
  it("missed weeks add no imaginary completions", () => {
    const s = newDemo(defaultProfile(), new Date("2026-10-15T02:00:00Z"));
    expect(rollDemo(s, "2026-11-01").current.dayIndex).toBe(1);
    expect(rollDemo(s, "2026-11-01").history).toHaveLength(1);
  });
});

describe("AI daily review persistence", () => {
  function ready() {
    const state = newDemo({
      ...defaultProfile(),
      age: 30,
      heightCm: 175,
      weightKg: 75,
      healthConsent: true,
    });
    const preferences = {
      activityLevel: "moderate" as const,
      dietaryPreferences: "",
      allergies: "",
      energyGoal: "gentle_loss" as const,
      calculationSex: "male" as const,
      nutritionEligibility: "standard_adult" as const,
    };
    const plan = {
      createdAt: "2026-10-15T00:00:00Z",
      nutrition: {
        status: "general_guidance",
        energy: {
          status: "available",
          goal: "gentle_loss",
          targetKcal: { min: 1800, max: 2300 },
          inputKey: energyInputKey(state.profile, preferences),
        },
      },
    } as unknown as AIStarterPlan;
    state.aiSetup = {
      mode: "self_hosted",
      preferences,
      englishSample: "",
      plan,
    };
    state.current.fitness = {
      ...state.current.fitness,
      breakfast: "Original full-day food",
      coverage: true,
      analyzed: true,
      confirmed: true,
      reviewed: true,
      reflection: "I checked all my food entries.",
      completed: true,
      quality: 100,
      reviewVersion: FITNESS_REVIEW_VERSION,
      aiAnalysis: {
        originalFood: "Original full-day food",
        coverage: "complete",
        language: { status: "english" },
        clarificationAnswers: [],
        clarificationQuestions: [],
        unresolvedFoods: [],
        recordedTotals: { kcal: { min: 1900, max: 2200 } },
      } as unknown as AINutritionResult,
    };
    state.current.fitness.reviewKey = fitnessReviewFingerprint(
      state.current.fitness,
      plan,
    );
    for (const component of [
      "vocabulary",
      "listening",
      "reading",
      "writing",
      "speaking",
    ] as const)
      state.current.learning[component] = 80;
    return state;
  }
  it("requires current review evidence when claiming, not only completed=true", () => {
    const state = ready();
    expect(isFitnessComplete(state)).toBe(true);
    expect(claimDemo(state).xp).toBe(90);
    state.current.fitness.aiAnalysis!.recordedTotals.kcal = {
      min: 160,
      max: 180,
    };
    expect(isFitnessComplete(state)).toBe(false);
    expect(() => claimDemo(state)).toThrow();
  });
  it("locks a numerical-plan day and keeps a 170 kcal record unclaimable after disconnecting AI", () => {
    const state = ready();
    state.current.fitness.aiAnalysis!.recordedTotals.kcal = {
      min: 160,
      max: 180,
    };
    const locked = normalizeDemoState(state);
    expect(locked.current.fitnessReviewRequired).toBe(true);
    locked.aiSetup!.mode = "demo";
    locked.current.fitness.completed = true; // A stale demo callback is insufficient.
    expect(requiresFitnessReview(locked)).toBe(true);
    expect(isFitnessComplete(locked)).toBe(false);
    expect(() => claimDemo(locked)).toThrow();
    const normalized = normalizeDemoState(locked);
    expect(normalized.current.fitness.completed).toBe(false);
    expect(normalized.current.fitness.aiAnalysis!.recordedTotals.kcal).toEqual({
      min: 160,
      max: 180,
    });
    expect(normalized.current.learning).toEqual(state.current.learning);
  });
  it("requires review before normalization when an existing numerical plan is switched to demo", () => {
    const state = ready();
    state.aiSetup!.mode = "demo";
    delete state.current.fitness.reviewVersion;
    expect(requiresFitnessReview(state)).toBe(true);
    expect(isFitnessComplete(state)).toBe(false);
    expect(normalizeDemoState(state).current.fitnessReviewRequired).toBe(true);
  });
  it("keeps the lock when a numerical plan becomes stale or is removed", () => {
    const state = normalizeDemoState(ready());
    state.aiSetup!.mode = "demo";
    state.profile.weightKg = 76;
    expect(isFitnessComplete(state)).toBe(false);
    state.aiSetup = undefined;
    expect(requiresFitnessReview(state)).toBe(true);
    expect(normalizeDemoState(state).current.fitnessReviewRequired).toBe(true);
    expect(isFitnessComplete(state)).toBe(false);
  });
  it("does not allow switching to tracking to bypass an already numerical-plan day, but releases it on a new day", () => {
    const locked = normalizeDemoState(ready());
    locked.aiSetup!.preferences.energyGoal = "tracking";
    const plan = locked.aiSetup!.plan!;
    plan.nutrition.status = "tracking_only";
    plan.nutrition.energy = {
      ...plan.nutrition.energy!,
      status: "tracking_only",
      goal: "tracking",
      targetKcal: null,
      inputKey: energyInputKey(locked.profile, locked.aiSetup!.preferences),
    };
    locked.current.fitness.reviewKey = fitnessReviewFingerprint(
      locked.current.fitness,
      plan,
    );
    expect(isFitnessComplete(locked)).toBe(false);
    expect(() => claimDemo(locked)).toThrow();
    const next = rollDemo(locked, "2099-10-16");
    expect(next.current.fitnessReviewRequired).not.toBe(true);
    expect(next.history[0].fitnessReviewRequired).toBe(true);
    next.current.fitness = { ...locked.current.fitness };
    expect(isFitnessComplete(next)).toBe(true);
  });
  it("locks the new day independently when a numerical plan is still selected", () => {
    const next = rollDemo(normalizeDemoState(ready()), "2099-10-16");
    expect(next.current.fitnessReviewRequired).toBe(true);
    expect(next.current.fitness.completed).toBe(false);
  });
  it("keeps a pure demo unlatched and still allows its explicit demonstration completion", () => {
    const state = newDemo(defaultProfile());
    state.current.fitness.completed = true;
    state.current.fitness.quality = 100;
    for (const key of [
      "vocabulary",
      "listening",
      "reading",
      "writing",
      "speaking",
    ] as const)
      state.current.learning[key] = 80;
    expect(requiresFitnessReview(state)).toBe(false);
    expect(normalizeDemoState(state)).toBe(state);
    expect(state.current.fitnessReviewRequired).not.toBe(true);
    expect(isFitnessComplete(state)).toBe(true);
    expect(claimDemo(state).xp).toBe(90);
  });
  it("migrates unclaimed legacy AI completion without deleting food or English work", () => {
    const state = ready();
    delete state.current.fitness.reviewVersion;
    const migrated = normalizeDemoState(state);
    expect(migrated.current.fitness.completed).toBe(false);
    expect(migrated.current.fitness.breakfast).toBe(
      state.current.fitness.breakfast,
    );
    expect(migrated.current.fitness.aiAnalysis).toEqual(
      state.current.fitness.aiAnalysis,
    );
    expect(migrated.current.learning).toEqual(state.current.learning);
    expect(migrated.xp).toBe(state.xp);
  });
  it("preserves already claimed history and does not undo XP after a rules upgrade", () => {
    const state = claimDemo(ready());
    delete state.current.fitness.reviewVersion;
    expect(normalizeDemoState(state)).toBe(state);
    expect(claimDemo(state)).toBe(state);
    expect(state.xp).toBe(90);
  });
  it("invalidates old targets after profile, preferences or latest measured weight changes", () => {
    const profile = ready();
    profile.profile.heightCm = 180;
    expect(applicableAIPlan(profile)).toBeUndefined();
    expect(isFitnessComplete(profile)).toBe(false);
    const preference = ready();
    preference.aiSetup!.preferences.activityLevel = "light";
    expect(isFitnessComplete(preference)).toBe(false);
    const measured = ready();
    measured.measurements = [
      {
        id: "new",
        date: "2026-10-15",
        weightKg: 70,
        bodyFatPercent: null,
        waistCm: null,
        method: "scale",
      },
    ];
    expect(effectivePlanningProfile(measured).weightKg).toBe(70);
    expect(isFitnessComplete(measured)).toBe(false);
    measured.planningWeightOverride = 75;
    expect(effectivePlanningProfile(measured).weightKg).toBe(75);
    expect(measured.measurements[0].weightKg).toBe(70);
  });
});
