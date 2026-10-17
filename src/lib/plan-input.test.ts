import { describe, expect, it } from "vitest";
import type { AIPlanningInput, AIStarterPlan } from "./ai-types";
import { defaultProfile } from "./demo-store";
import { isAIPlanCurrent, planningInputKey } from "./plan-input";

const input = (): AIPlanningInput => ({
  profile: {
    ...defaultProfile(),
    nickname: "Private nickname",
    age: 28,
    heightCm: 170,
    weightKg: 65,
    healthConsent: true,
  },
  preferences: {
    activityLevel: "light",
    dietaryPreferences: "vegetarian",
    allergies: "peanuts",
  },
  englishSample: "I enjoy writing about my daily routine.",
});
const plan = (source: AIPlanningInput): AIStarterPlan => ({
  basis: "model_guidance",
  createdAt: "2026-10-15T00:00:00Z",
  forDate: "2026-10-15",
  inputKey: planningInputKey(source),
  nutrition: {
    status: "general_guidance",
    summary: "Saved meal ideas",
    mealIdeas: [],
  },
  english: {
    basis: "unavailable",
    summary: "Saved practice",
    strengths: [],
    focusAreas: [],
    tasks: [],
  },
  limits: [],
});

describe("complete AI plan input freshness", () => {
  it.each([
    [
      "allergies",
      (value: AIPlanningInput) => {
        value.preferences.allergies = "peanuts and milk";
      },
    ],
    [
      "dietary preferences",
      (value: AIPlanningInput) => {
        value.preferences.dietaryPreferences = "vegan";
      },
    ],
    [
      "English sample",
      (value: AIPlanningInput) => {
        value.englishSample = "A different writing sample with new evidence.";
      },
    ],
    [
      "English goal",
      (value: AIPlanningInput) => {
        value.profile.goal = "member";
      },
    ],
    [
      "time budget",
      (value: AIPlanningInput) => {
        value.profile.timeBudget = 60;
      },
    ],
    [
      "exam context",
      (value: AIPlanningInput) => {
        value.profile.examType = "ielts";
        value.profile.examScore = 6;
      },
    ],
    [
      "body context",
      (value: AIPlanningInput) => {
        value.profile.heightCm = 175;
      },
    ],
    [
      "health consent",
      (value: AIPlanningInput) => {
        value.profile.healthConsent = false;
      },
    ],
    [
      "calculation parameter",
      (value: AIPlanningInput) => {
        value.preferences.calculationSex = "female";
      },
    ],
  ] as const)(
    "marks the saved plan stale after changing %s",
    (_name, change) => {
      const original = input();
      const saved = plan(original);
      expect(isAIPlanCurrent(saved, original)).toBe(true);
      const changed = structuredClone(original);
      change(changed);
      expect(isAIPlanCurrent(saved, changed)).toBe(false);
    },
  );
  it("ignores identity labels, JSON property order and server-normalized sample whitespace", () => {
    const original = input();
    const changed = structuredClone(original);
    changed.profile.nickname = "Another nickname";
    changed.profile.gender = "female";
    changed.profile = Object.fromEntries(
      Object.entries(changed.profile).reverse(),
    ) as typeof changed.profile;
    changed.preferences = Object.fromEntries(
      Object.entries(changed.preferences).reverse(),
    ) as typeof changed.preferences;
    changed.englishSample = `  ${changed.englishSample}\n`;
    expect(planningInputKey(changed)).toBe(planningInputKey(original));
  });
  it("matches omitted preference defaults to the server's parsed defaults", () => {
    const original = input();
    const parsed = structuredClone(original);
    Object.assign(parsed.preferences, {
      energyGoal: "gentle_loss",
      calculationSex: "unspecified",
      nutritionEligibility: "unspecified",
    });
    expect(isAIPlanCurrent(plan(parsed), original)).toBe(true);
  });
  it("does not present legacy plans without provenance as current", () => {
    const source = input();
    const saved = plan(source);
    delete saved.inputKey;
    expect(isAIPlanCurrent(saved, source)).toBe(false);
    expect(isAIPlanCurrent(undefined, source)).toBe(false);
    expect(isAIPlanCurrent(null, source)).toBe(false);
  });
  it("allows an unchanged reusable plan across dates without including raw private text in its checksum", () => {
    const source = input();
    const saved = plan(source);
    saved.forDate = "2026-10-01";
    expect(isAIPlanCurrent(saved, source)).toBe(true);
    expect(saved.inputKey).not.toContain(source.englishSample);
    expect(saved.inputKey).not.toContain("peanuts");
    expect(saved.inputKey).not.toContain("Private nickname");
  });
});
