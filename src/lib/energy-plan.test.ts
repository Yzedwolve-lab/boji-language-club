import { describe, expect, it } from "vitest";
import type { Profile } from "./domain";
import { calculateEnergyReference, energyInputKey } from "./energy-plan";

const profile = (): Profile => ({
  nickname: "Test",
  gender: "unspecified",
  age: 30,
  weightKg: 80,
  heightCm: 180,
  bodyFatPercent: null,
  activityLevel: "light",
  timeBudget: 30,
  timeZone: "Australia/Brisbane",
  examType: "none",
  examScore: null,
  examDate: "",
  comparableToeflScore: null,
  cetStatus: "not_provided",
  goal: "user",
  healthConsent: true,
});
const preferences = () => ({
  activityLevel: "light" as const,
  calculationSex: "male" as const,
  nutritionEligibility: "standard_adult" as const,
  energyGoal: "gentle_loss" as const,
});

describe("deterministic product energy planning", () => {
  it("distinguishes resting energy, maintenance and the bounded gentle deficit", () => {
    const result = calculateEnergyReference(profile(), preferences());
    expect(result).toMatchObject({
      status: "available",
      restingKcal: 1780,
      maintenanceKcal: 2448,
      deficitKcal: 245,
      activityFactor: 1.375,
      appliedGoal: "gentle_loss",
    });
    expect(result.targetKcal).toEqual({ min: 1983, max: 2423 });
    expect(
      result.mealBudgets.reduce((sum, item) => sum + item.kcal.min, 0),
    ).toBe(result.targetKcal!.min);
    expect(
      result.mealBudgets.reduce((sum, item) => sum + item.kcal.max, 0),
    ).toBe(result.targetKcal!.max);
    expect(result.assumptions.join(" ")).toContain("产品");
  });
  it("uses the separately supplied formula parameter and never infers it from identity", () => {
    const p = profile();
    p.gender = "male";
    expect(
      calculateEnergyReference(p, {
        activityLevel: "light",
        nutritionEligibility: "standard_adult",
      }).status,
    ).toBe("missing_context");
    expect(
      calculateEnergyReference(p, {
        ...preferences(),
        calculationSex: "female",
        energyGoal: "maintain",
      }).restingKcal,
    ).toBe(1614);
  });
  it.each(["sedentary", "light", "moderate", "active"] as const)(
    "uses explicit %s activity without adding exercise twice",
    (activityLevel) => {
      const result = calculateEnergyReference(profile(), {
        ...preferences(),
        activityLevel,
      });
      const factor = {
        sedentary: 1.2,
        light: 1.375,
        moderate: 1.55,
        active: 1.725,
      }[activityLevel];
      expect(result.maintenanceKcal).toBe(Math.round(1780 * factor));
      expect(result.deficitKcal).toBeLessThanOrEqual(250);
      expect(result.targetKcal!.min).toBeGreaterThanOrEqual(1800);
      expect(result.targetKcal!.max).toBeLessThanOrEqual(
        result.maintenanceKcal!,
      );
    },
  );
  it("supports a maintenance goal without a calorie deficit", () => {
    const result = calculateEnergyReference(profile(), {
      ...preferences(),
      energyGoal: "maintain",
    });
    expect(result).toMatchObject({
      status: "available",
      appliedGoal: "maintain",
      deficitKcal: 0,
    });
    expect(result.targetKcal!.min).toBeLessThan(result.maintenanceKcal!);
    expect(result.targetKcal!.max).toBeGreaterThan(result.maintenanceKcal!);
  });
  it.each(["height", "weight", "activity", "eligibility", "sex"])(
    "keeps missing %s unknown",
    (field) => {
      const p = profile();
      const pref = { ...preferences() } as Parameters<
        typeof calculateEnergyReference
      >[1];
      if (field === "height") p.heightCm = null;
      if (field === "weight") p.weightKg = null;
      if (field === "activity") pref.activityLevel = "unspecified";
      if (field === "eligibility") pref.nutritionEligibility = "unspecified";
      if (field === "sex") pref.calculationSex = "unspecified";
      expect(calculateEnergyReference(p, pref)).toMatchObject({
        status: "missing_context",
        targetKcal: null,
        restingKcal: null,
        maintenanceKcal: null,
      });
    },
  );
  it.each([17, 18, 79])(
    "does not extrapolate the adult formula at age %s",
    (age) => {
      expect(
        calculateEnergyReference({ ...profile(), age }, preferences()),
      ).toMatchObject({ status: "not_applicable", targetKcal: null });
    },
  );
  it("preserves opt-out and specialist guidance without numerical targets", () => {
    expect(
      calculateEnergyReference(
        { ...profile(), healthConsent: false },
        preferences(),
      ).status,
    ).toBe("tracking_only");
    expect(
      calculateEnergyReference(profile(), {
        ...preferences(),
        energyGoal: "tracking",
      }).status,
    ).toBe("tracking_only");
    expect(
      calculateEnergyReference(profile(), {
        ...preferences(),
        nutritionEligibility: "specialist_guidance",
      }),
    ).toMatchObject({ status: "not_applicable", targetKcal: null });
  });
  it.each([NaN, Infinity, -1, 0, 900])(
    "does not turn invalid or unsupported measurements %s into a target",
    (weightKg) => {
      expect(
        calculateEnergyReference({ ...profile(), weightKg }, preferences())
          .targetKcal,
      ).toBeNull();
    },
  );
  it("blocks low BMI loss and does not clamp an unsupported low energy need into a fake target", () => {
    expect(
      calculateEnergyReference({ ...profile(), weightKg: 50 }, preferences())
        .targetKcal,
    ).toBeNull();
    expect(
      calculateEnergyReference({ ...profile(), weightKg: 63 }, preferences())
        .targetKcal,
    ).toBeNull();
    expect(
      calculateEnergyReference(
        { ...profile(), age: 78, weightKg: 50, heightCm: 150 },
        {
          ...preferences(),
          calculationSex: "female",
          activityLevel: "sedentary",
        },
      ).targetKcal,
    ).toBeNull();
  });
  it("invalidates a plan on relevant input changes, but not nickname or display identity", () => {
    const key = energyInputKey(profile(), preferences());
    expect(calculateEnergyReference(profile(), preferences()).inputKey).toBe(
      key,
    );
    expect(
      energyInputKey({ ...profile(), weightKg: 81 }, preferences()),
    ).not.toBe(key);
    expect(
      energyInputKey(
        { ...profile(), nickname: "Another", gender: "female" },
        preferences(),
      ),
    ).toBe(key);
    expect(
      energyInputKey(profile(), {
        ...preferences(),
        nutritionEligibility: "unspecified",
      }),
    ).not.toBe(key);
  });
});
