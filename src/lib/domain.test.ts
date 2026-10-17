import { describe, expect, it } from "vitest";
import {
  CLUB_TIME_ZONE,
  GOALS,
  TIME_TEMPLATES,
  calculateXP,
  cardTier,
  claimPeriod,
  clubDate,
  completeSystemReview,
  createPeriod,
  estimateExerciseEnergy,
  nutritionMode,
  previewCompression,
  rolloverPeriod,
  scheduleReviewDates,
  updatePeriodEvidence,
  validateEnglishLog,
  validateExam,
  validateFitnessLog,
  validateProfile,
  type ClubState,
  type ExamType,
  type Profile,
} from "./domain";

const profile: Profile = {
  nickname: "",
  gender: "unspecified",
  age: 24,
  weightKg: null,
  heightCm: null,
  bodyFatPercent: null,
  activityLevel: "",
  timeBudget: 30,
  timeZone: CLUB_TIME_ZONE,
  examType: "none",
  examScore: null,
  examDate: "",
  comparableToeflScore: null,
  cetStatus: "not_provided",
  goal: "alan",
  healthConsent: false,
};

describe("self-reported exam scales remain distinct", () => {
  it.each<[ExamType, number]>([
    ["ielts", 0],
    ["ielts", 6.5],
    ["ielts", 9],
    ["pte_academic", 10],
    ["pte_academic", 90],
    ["toefl_legacy_total", 0],
    ["toefl_legacy_total", 120],
    ["toefl_2026_band", 1],
    ["toefl_2026_band", 5.5],
  ])("accepts %s = %s", (type, score) =>
    expect(validateExam(type, score)).toBeNull(),
  );
  it.each<[ExamType, number | null]>([
    ["ielts", 100],
    ["ielts", 9.5],
    ["ielts", 6.3],
    ["ielts", NaN],
    ["ielts", null],
    ["pte_academic", 0],
    ["pte_academic", 91],
    ["pte_academic", 65.5],
    ["pte_academic", 8],
    ["toefl_legacy_total", 121],
    ["toefl_legacy_total", -1],
    ["toefl_2026_band", 6.5],
    ["toefl_2026_band", 5.2],
    ["toefl_2026_band", Infinity],
  ])("rejects %s = %s", (type, score) =>
    expect(validateExam(type, score)).toBeTypeOf("string"),
  );
  it("retains a separately typed comparable TOEFL score and checks its bounds", () => {
    expect(validateExam("toefl_2026_band", 5.5, "2026-02-01", 110)).toBeNull();
    expect(
      validateExam("toefl_2026_band", 5.5, "2026-02-01", 121),
    ).toBeTruthy();
    expect(validateExam("ielts", 6.5, "", 110)).toBeTruthy();
  });
  it("rejects a new-scale TOEFL before introduction and invalid calendar dates", () => {
    expect(validateExam("toefl_2026_band", 5.5, "2026-01-20")).toContain(
      "2026-01-21",
    );
    expect(validateExam("toefl_2026_band", 5.5, "2026-01-21")).toBeNull();
    expect(validateExam("ielts", 6.5, "2026-02-30")).toBeTruthy();
  });
  it("allows no score but rejects stale values after deselecting an exam", () => {
    expect(validateExam("none", null)).toBeNull();
    expect(validateExam("none", 8)).toBeTruthy();
    expect(validateExam("cet4", null)).toBeNull();
  });
});

describe("optional health fields and independent goal labels", () => {
  it("can join without health data or an exam", () =>
    expect(validateProfile(profile)).toEqual({}));
  it("selecting the highest goal gives no material upgrade", () => {
    expect(GOALS.find((goal) => goal.id === "alan")?.ieltsTarget).toBe(8);
    expect(cardTier(0).id).toBe("silver");
  });
  it.each(["weightKg", "heightCm", "bodyFatPercent"] as const)(
    "does not accept invalid %s as unknown",
    (field) => {
      expect(validateProfile({ ...profile, [field]: NaN })[field]).toBeTruthy();
      expect(validateProfile({ ...profile, [field]: -5 })[field]).toBeTruthy();
      expect(validateProfile({ ...profile, [field]: 0 })[field]).toBeTruthy();
    },
  );
  it("requires an integer age and the fixed China club timezone", () => {
    expect(validateProfile({ ...profile, age: 24.5 }).age).toBeTruthy();
    expect(
      validateProfile({ ...profile, timeZone: "not/a-zone" }).timeZone,
    ).toBeTruthy();
    expect(
      validateProfile({ ...profile, timeZone: "Australia/Brisbane" }).timeZone,
    ).toBeTruthy();
    expect(CLUB_TIME_ZONE).toBe("Asia/Shanghai");
  });
  it("keeps unusual positive measurements usable in tracking mode", () => {
    expect(
      validateProfile({ ...profile, heightCm: 270, weightKg: 400 }),
    ).toEqual({});
    expect(
      nutritionMode({ ...profile, healthConsent: true, age: 16 }).mode,
    ).toBe("tracking_only");
    expect(nutritionMode(profile).reason).toBeTruthy();
  });
});

describe("fixed XP rules and non-compounding forecast preview", () => {
  it.each([
    [699, "silver"],
    [700, "gold"],
    [2999, "gold"],
    [3000, "diamond"],
    [8999, "diamond"],
    [9000, "black_gold"],
  ] as const)("maps %s XP to %s", (xp, tier) =>
    expect(cardTier(xp).id).toBe(tier),
  );
  it("calculates rounded component awards and caps the maximum naturally", () => {
    expect(calculateXP(100, 100)).toBe(100);
    expect(calculateXP(75, 82)).toBe(81);
    expect(calculateXP(0, 0)).toBe(10);
  });
  it.each([NaN, Infinity, -1, 101])(
    "rejects an untrusted score %s",
    (score) => {
      expect(() => calculateXP(score, 80)).toThrow();
      expect(() => calculateXP(80, score)).toThrow();
    },
  );
  it("never changes the independent baseline when previewing repeatedly", () => {
    const baseline = 100;
    expect(previewCompression(baseline, 0.4, 60, 45).remainingDays).toBe(60);
    expect(previewCompression(baseline, 0.4, 60, 45).remainingDays).toBe(60);
    expect(previewCompression(101, 0.4, 60, 45).remainingDays).toBe(61);
  });
  it("refuses requests above 40%, unknown baselines and infeasible budgets", () => {
    expect(previewCompression(100, 0.41, 60, 45).feasible).toBe(false);
    expect(previewCompression(100, 0.4, 30, 45).feasible).toBe(false);
    expect(previewCompression(null, 0.4, 60, 45)).toMatchObject({
      feasible: false,
      remainingDays: null,
    });
    expect(previewCompression(NaN, 0.4, 60, 45).feasible).toBe(false);
  });
  it("reserves time inside every chosen budget", () => {
    for (const [budget, template] of Object.entries(TIME_TEMPLATES)) {
      expect(Object.values(template).reduce((sum, n) => sum + n, 0)).toBe(
        Number(budget),
      );
      expect(template.retryBreakReserve).toBeGreaterThan(0);
    }
  });
});

describe("local 03:00 training boundaries with daylight savings", () => {
  it.each([
    ["2026-10-14T18:59:59Z", "Asia/Shanghai", "2026-10-14"],
    ["2026-10-14T19:00:00Z", "Asia/Shanghai", "2026-10-15"],
    ["2026-10-14T16:59:59Z", "Australia/Brisbane", "2026-10-14"],
    ["2026-10-14T17:00:00Z", "Australia/Brisbane", "2026-10-15"],
    ["2026-10-03T15:59:59Z", "Australia/Sydney", "2026-10-03"],
    ["2026-10-03T16:00:00Z", "Australia/Sydney", "2026-10-04"],
    ["2026-04-04T15:59:59Z", "Australia/Sydney", "2026-04-04"],
    ["2026-04-04T16:59:59Z", "Australia/Sydney", "2026-04-04"],
    ["2026-04-04T17:00:00Z", "Australia/Sydney", "2026-04-05"],
    ["2026-03-08T06:59:59Z", "America/New_York", "2026-03-07"],
    ["2026-03-08T07:00:00Z", "America/New_York", "2026-03-08"],
    ["2026-11-01T07:59:59Z", "America/New_York", "2026-10-31"],
    ["2026-11-01T08:00:00Z", "America/New_York", "2026-11-01"],
    ["2026-01-01T01:00:00Z", "UTC", "2025-12-31"],
  ])("%s in %s belongs to %s", (instant, zone, expected) => {
    expect(clubDate(new Date(instant), zone)).toBe(expected);
  });
  it("rejects invalid instants and zones rather than using server timezone", () => {
    expect(() => clubDate(new Date("bad"), "UTC")).toThrow();
    expect(() => clubDate(new Date(), "bad")).toThrow();
  });
});

describe("honest food and activity records", () => {
  it.each([
    "2 eggs",
    "150 g rice",
    "mapo tofu",
    "a bowl of rice",
    "café latte",
  ])("accepts simple known food phrases: %s", (text) => {
    expect(validateEnglishLog(text).valid).toBe(true);
  });
  it("distinguishes empty, Chinese and unresolved descriptions", () => {
    expect(validateEnglishLog("   ... ").status).toBe("empty");
    expect(validateEnglishLog("两碗米饭").status).toBe("needs_english");
    expect(validateEnglishLog("abcxyz pinyin garbage").status).toBe(
      "needs_clarification",
    );
  });
  it("allows activity-only records without inventing dietary evaluation", () => {
    expect(
      validateFitnessLog({ activity: "Brisk walking", activityMinutes: 30 }),
    ).toEqual({});
    expect(validateFitnessLog({})).toHaveProperty("form");
    expect(
      validateFitnessLog({ activity: "jogging", activityMinutes: -1 }),
    ).toHaveProperty("activityMinutes");
  });
  it("does not make record acceptance conditional on calorie intake", () => {
    expect(
      validateFitnessLog({
        breakfast: "8 eggs, 1000 g rice and 400 g chicken",
      }),
    ).toEqual({});
    expect(validateFitnessLog({ breakfast: "one apple" })).toEqual({});
  });
  it("preserves missing weight, separates gross/net and rejects invalid measures", () => {
    expect(estimateExerciseEnergy(4, 30, null)).toBeNull();
    expect(estimateExerciseEnergy(4, 30, 60)).toEqual({
      grossKcal: 126,
      netKcal: 95,
    });
    expect(() => estimateExerciseEnergy(4, -30, 60)).toThrow();
  });
  it("starts reviews from actual learning, never the assignment date", () => {
    expect(scheduleReviewDates(null)).toEqual([]);
    expect(scheduleReviewDates("2026-10-17")).toEqual([
      "2026-10-18",
      "2026-10-20",
      "2026-10-24",
      "2026-10-31",
      "2026-11-16",
    ]);
  });
});

const ready = () =>
  updatePeriodEvidence(createPeriod("period-1", "2026-10-15"), {
    fitnessComplete: true,
    languagePassed: true,
    fitnessQuality: 100,
    languageScore: 80,
  });
const state = (current = ready()): ClubState => ({
  current,
  history: [],
  totalXp: 0,
  completedDays: 0,
});
const now = new Date("2026-10-15T10:00:00Z");

describe("immutable period transitions (trusted-state model, not a database transaction)", () => {
  it("cannot claim only one module or override eligibility with a score", () => {
    const incomplete = updatePeriodEvidence(createPeriod("a", "2026-10-15"), {
      fitnessComplete: true,
      fitnessQuality: 100,
      languageScore: 100,
    });
    expect(() => claimPeriod(state(incomplete), now, "UTC")).toThrow();
  });
  it("returns the identical settlement for repeat requests and keeps Day N until the boundary", () => {
    const original = state();
    const claimed = claimPeriod(original, now, "UTC");
    expect(claimed.totalXp).toBe(90);
    expect(claimed.completedDays).toBe(1);
    expect(claimPeriod(claimed, now, "UTC")).toBe(claimed);
    expect(
      rolloverPeriod(claimed, new Date("2026-10-16T02:59:59Z"), "UTC", "p2"),
    ).toBe(claimed);
    expect(original.current.status).toBe("ready_to_claim");
    expect(original.totalXp).toBe(0);
  });
  it("archives claimed history and starts Day N+1 once at the next boundary", () => {
    const claimed = claimPeriod(state(), now, "UTC");
    const next = rolloverPeriod(
      claimed,
      new Date("2026-10-16T03:00:00Z"),
      "UTC",
      "period-2",
    );
    expect(next.current).toMatchObject({
      id: "period-2",
      dayIndex: 2,
      status: "active",
    });
    expect(next.history).toHaveLength(1);
    expect(next.history[0].awardedXp).toBe(90);
    expect(
      rolloverPeriod(next, new Date("2026-10-16T15:00:00Z"), "UTC", "period-3"),
    ).toBe(next);
  });
  it("archives a missed day without incrementing Day or generating fake missed periods", () => {
    const next = rolloverPeriod(
      state(),
      new Date("2026-10-20T10:00:00Z"),
      "UTC",
      "period-2",
    );
    expect(next.current.dayIndex).toBe(1);
    expect(next.current.clubDate).toBe("2026-10-20");
    expect(next.history).toHaveLength(1);
    expect(next.history[0].status).toBe("archived_unclaimed");
    expect(next.totalXp).toBe(0);
    expect(next.completedDays).toBe(0);
  });
  it("refuses to settle an expired normal period", () => {
    expect(() =>
      claimPeriod(state(), new Date("2026-10-16T10:00:00Z"), "UTC"),
    ).toThrow();
  });
  it("carries timely server-recorded submissions, gives one fixed review window and prevents same-day next Day", () => {
    const pending = updatePeriodEvidence(
      createPeriod("pending", "2026-10-15"),
      {
        submittedBeforeBoundary: true,
        reviewPending: true,
      },
    );
    const carried = rolloverPeriod(
      state(pending),
      new Date("2026-10-16T03:00:00Z"),
      "UTC",
      "unused",
    );
    expect(carried.current.status).toBe("carried_for_system_review");
    expect(carried.current.id).toBe("pending");
    expect(carried.history).toHaveLength(0);
    const reviewedAt = new Date("2026-10-16T09:00:00Z");
    const reviewed = completeSystemReview(
      carried.current,
      {
        fitnessComplete: true,
        languagePassed: true,
        fitnessQuality: 100,
        languageScore: 80,
      },
      reviewedAt,
    );
    expect(reviewed.claimWindowEndsAt).toBe("2026-10-17T09:00:00.000Z");
    expect(
      completeSystemReview(reviewed, {}, new Date("2026-10-16T10:00:00Z")),
    ).toBe(reviewed);
    const claimed = claimPeriod(
      { ...carried, current: reviewed },
      reviewedAt,
      "UTC",
    );
    expect(
      rolloverPeriod(
        claimed,
        new Date("2026-10-16T12:00:00Z"),
        "UTC",
        "unused",
      ),
    ).toBe(claimed);
    expect(
      rolloverPeriod(claimed, new Date("2026-10-17T03:00:00Z"), "UTC", "next")
        .current.dayIndex,
    ).toBe(2);
  });
  it("does not grant a fair-review extension without timely submission evidence", () => {
    const pending = updatePeriodEvidence(createPeriod("late", "2026-10-15"), {
      reviewPending: true,
      submittedBeforeBoundary: false,
    });
    expect(
      rolloverPeriod(
        state(pending),
        new Date("2026-10-16T04:00:00Z"),
        "UTC",
        "next",
      ).history[0].status,
    ).toBe("archived_unclaimed");
  });
  it("preserves review-required work until its window then archives it once", () => {
    const pending = updatePeriodEvidence(
      createPeriod("pending", "2026-10-15"),
      { submittedBeforeBoundary: true, reviewPending: true },
    );
    const carried = rolloverPeriod(
      state(pending),
      new Date("2026-10-16T03:00:00Z"),
      "UTC",
      "unused",
    );
    const reviewed = completeSystemReview(
      carried.current,
      {
        fitnessComplete: true,
        languagePassed: false,
        fitnessQuality: 100,
        languageScore: 50,
      },
      new Date("2026-10-16T09:00:00Z"),
    );
    const waiting = { ...carried, current: reviewed };
    expect(
      rolloverPeriod(
        waiting,
        new Date("2026-10-17T08:00:00Z"),
        "UTC",
        "unused",
      ),
    ).toBe(waiting);
    const expired = rolloverPeriod(
      waiting,
      new Date("2026-10-17T09:00:00Z"),
      "UTC",
      "next",
    );
    expect(expired.history[0].status).toBe("archived_unclaimed");
    expect(expired.current.dayIndex).toBe(1);
  });
  it("refuses to silently rewrite a settled period", () => {
    const claimed = claimPeriod(state(), now, "UTC");
    expect(() =>
      updatePeriodEvidence(claimed.current, { languageScore: 100 }),
    ).toThrow();
  });
});
