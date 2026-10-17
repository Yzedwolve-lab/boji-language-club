import { CLUB_TIME_ZONE, calculateXP, clubDate, type Profile } from "./domain";
import type {
  AIOnboardingResult,
  AINutritionResult,
  AIStarterPlan,
} from "./ai-types";
import type { BodyMeasurement } from "./body-measurements";
import {
  FITNESS_REVIEW_VERSION,
  evaluateFitnessReview,
  fitnessReviewFingerprint,
} from "./fitness-review";
import { validReflection } from "./fitness";
import { energyInputKey } from "./energy-plan";
import { planningInputKey } from "./plan-input";
import {
  emptyLearningProgress,
  learningAverage,
  learningPassed,
  type LearningProgress,
} from "./lessons";
export const STORAGE_KEY = "boji.club.demo.v1";
export type FitnessState = {
  breakfast: string;
  lunch: string;
  dinner: string;
  snacks: string;
  drinks: string;
  activity: string;
  activityMinutes: string;
  met: string;
  reflection: string;
  confirmed: boolean;
  reviewed: boolean;
  coverage: boolean;
  analyzed: boolean;
  completed: boolean;
  quality: number;
  portionNote: string;
  aiAnalysis?: AINutritionResult;
  clarificationAnswers?: Array<{
    sourceText: string;
    question: string;
    answer: string;
  }>;
  aiAnalysisHistory?: AINutritionResult[];
  clarificationDraftHistory?: Array<{
    food: string;
    answers: Array<{ sourceText: string; question: string; answer: string }>;
    archivedAt: string;
  }>;
  reviewVersion?: string;
  reviewKey?: string;
};
export type DemoPeriod = {
  id: string;
  date: string;
  dayIndex: number;
  status: "active" | "claimed" | "archived_unclaimed";
  fitness: FitnessState;
  learning: LearningProgress;
  awardedXP: number;
  claimedAt?: string;
  /** Fixed-zone settlement day; also keeps demo day offsets independent of wall time. */
  claimedClubDate?: string;
  /** Latched for this training day once a numerical plan has been selected. */
  fitnessReviewRequired?: boolean;
};
export type DemoState = {
  schema: 1;
  profile: Profile;
  cardId: string;
  joinedAt: string;
  xp: number;
  completedDays: number;
  current: DemoPeriod;
  history: DemoPeriod[];
  ledger: Array<{ source: string; xp: number; date: string; dayIndex: number }>;
  dayOffset: number;
  plan: { version: number; compression: number; baselineId: string };
  goalHistory: Array<{ goal: Profile["goal"]; date: string }>;
  aiSetup?: AIOnboardingResult;
  aiPlanHistory?: AIStarterPlan[];
  measurements?: BodyMeasurement[];
  planningWeightOverride?: number | null;
};
export function defaultProfile(): Profile {
  return {
    nickname: "",
    gender: "unspecified",
    age: 25,
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
    goal: "user",
    healthConsent: false,
  };
}
export function emptyFitness(): FitnessState {
  return {
    breakfast: "",
    lunch: "",
    dinner: "",
    snacks: "",
    drinks: "",
    activity: "",
    activityMinutes: "",
    met: "",
    reflection: "",
    confirmed: false,
    reviewed: false,
    coverage: false,
    analyzed: false,
    completed: false,
    quality: 0,
    portionNote: "",
  };
}
function makePeriod(date: string, dayIndex: number): DemoPeriod {
  return {
    id: `demo-${date}-${dayIndex}`,
    date,
    dayIndex,
    status: "active",
    fitness: emptyFitness(),
    learning: emptyLearningProgress(),
    awardedXP: 0,
  };
}
export function newDemo(profile: Profile, now = new Date()): DemoState {
  return {
    schema: 1,
    profile: {
      ...profile,
      timeZone: CLUB_TIME_ZONE,
      nickname:
        profile.nickname.trim() ||
        `俱乐部新朋友${Math.floor(Math.random() * 900 + 100)}`,
    },
    cardId: `BJ-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    joinedAt: now.toISOString(),
    xp: 0,
    completedDays: 0,
    current: makePeriod(clubDate(now, CLUB_TIME_ZONE), 1),
    history: [],
    ledger: [],
    dayOffset: 0,
    plan: {
      version: 1,
      compression: 0,
      baselineId: "awaiting-independent-evidence",
    },
    goalHistory: [{ goal: profile.goal, date: now.toISOString() }],
  };
}
export function languageSummary(learning: LearningProgress) {
  const scores = [
    learning.vocabulary,
    learning.listening,
    learning.reading,
    learning.writing,
    learning.speaking,
  ];
  const completed = scores.filter(
    (x) => x !== null && Number.isFinite(x) && x >= 60 && x <= 100,
  ).length;
  return {
    completed,
    average: learningAverage(learning),
    passed: learningPassed(learning),
  };
}
/** Local progress consistency only; browser storage is not a trusted public ledger. */
export function effectivePlanningProfile(state: DemoState): Profile {
  const latestWeight = [...(state.measurements ?? [])]
    .sort((a, b) => b.date.localeCompare(a.date))
    .find((item) => item.weightKg !== null)?.weightKg;
  return {
    ...state.profile,
    weightKg:
      state.planningWeightOverride !== undefined
        ? state.planningWeightOverride
        : (latestWeight ?? state.profile.weightKg),
  };
}
export function applicableAIPlan(state: DemoState): AIStarterPlan | undefined {
  const setup = state.aiSetup;
  const plan = setup?.plan;
  if (!plan?.nutrition.energy || !setup) return undefined;
  return plan.nutrition.energy.inputKey ===
    energyInputKey(effectivePlanningProfile(state), setup.preferences)
    ? plan
    : undefined;
}
/** Even a now-stale numerical plan proves this day entered numerical review.
 * Disconnecting or later editing a profile cannot turn it into a demo day. */
function hasNumericalPlan(state: DemoState): boolean {
  const energy = state.aiSetup?.plan?.nutrition.energy;
  const target = energy?.targetKcal;
  return (
    energy?.status === "available" &&
    !!target &&
    Number.isFinite(target.min) &&
    Number.isFinite(target.max) &&
    target.min > 0 &&
    target.max >= target.min
  );
}
export function requiresFitnessReview(state: DemoState): boolean {
  return (
    state.current.fitnessReviewRequired === true ||
    state.aiSetup?.mode === "self_hosted" ||
    hasNumericalPlan(state)
  );
}
export function isFitnessComplete(state: DemoState): boolean {
  const value = state.current.fitness;
  if (!value.completed) return false;
  if (state.current.status === "claimed" || !requiresFitnessReview(state))
    return true;
  const plan = applicableAIPlan(state);
  return (
    value.reviewVersion === FITNESS_REVIEW_VERSION &&
    value.reviewKey === fitnessReviewFingerprint(value, plan) &&
    value.confirmed &&
    value.reviewed &&
    validReflection(value.reflection) &&
    evaluateFitnessReview(
      value,
      plan,
      state.current.fitnessReviewRequired === true || hasNumericalPlan(state),
    ).canComplete
  );
}

/** Update only the timezone and a still-current plan's input checksum. Original
 * period dates, evidence, plan history and already-awarded XP remain immutable. */
function migrateClubTimeZone(state: DemoState): DemoState {
  if (state.profile.timeZone === CLUB_TIME_ZONE) return state;
  const migrated = {
    ...state,
    profile: { ...state.profile, timeZone: CLUB_TIME_ZONE },
  };
  const setup = state.aiSetup;
  const plan = setup?.plan;
  if (
    setup &&
    plan?.inputKey &&
    plan.inputKey ===
      planningInputKey({
        profile: effectivePlanningProfile(state),
        preferences: setup.preferences,
        englishSample: setup.englishSample,
      })
  ) {
    migrated.aiSetup = {
      ...setup,
      plan: {
        ...plan,
        inputKey: planningInputKey({
          profile: effectivePlanningProfile(migrated),
          preferences: setup.preferences,
          englishSample: setup.englishSample,
        }),
      },
    };
  }
  return migrated;
}

/** Preserve all claimed history; an outdated unclaimed flag cannot authorize XP. */
export function normalizeDemoState(input: DemoState): DemoState {
  const state = migrateClubTimeZone(input);
  if (state.current.status !== "active") return state;
  const normalized =
    !state.current.fitnessReviewRequired && hasNumericalPlan(state)
      ? {
          ...state,
          current: { ...state.current, fitnessReviewRequired: true },
        }
      : state;
  if (!normalized.current.fitness.completed || isFitnessComplete(normalized))
    return normalized;
  return {
    ...normalized,
    current: {
      ...normalized.current,
      fitness: {
        ...normalized.current.fitness,
        completed: false,
        quality: 0,
        reviewVersion: undefined,
        reviewKey: undefined,
      },
    },
  };
}
/** Legacy settlements predate the fixed-zone field. Derive their Beijing day
 * from the saved instant without rewriting the original period or ledger. */
function settledClubDate(period: DemoPeriod): string {
  if (period.claimedClubDate) return period.claimedClubDate;
  if (period.claimedAt && Number.isFinite(Date.parse(period.claimedAt)))
    return clubDate(new Date(period.claimedAt), CLUB_TIME_ZONE);
  return period.date;
}

export function claimDemo(state: DemoState, now = new Date()): DemoState {
  if (state.ledger.some((x) => x.source === state.current.id)) return state;
  const today = demoDate(state, now);
  if (state.current.date > today)
    throw new Error("北京时间尚未进入这个训练日，请在凌晨 03:00 后继续领取。");
  if (
    state.history.some(
      (period) =>
        period.status === "claimed" &&
        [state.current.date, today].includes(settledClubDate(period)),
    )
  )
    throw new Error(
      "本北京时间训练日已领取过经验，请在次日凌晨 03:00 后继续。",
    );
  const language = languageSummary(state.current.learning);
  if (
    !isFitnessComplete(state) ||
    !language.passed ||
    state.current.status !== "active"
  )
    throw new Error("请先完成薄肌与语言两项活动。");
  const xp = calculateXP(state.current.fitness.quality, language.average!);
  return {
    ...state,
    xp: state.xp + xp,
    completedDays: state.completedDays + 1,
    current: {
      ...state.current,
      status: "claimed",
      awardedXP: xp,
      claimedAt: now.toISOString(),
      claimedClubDate: state.current.date,
    },
    ledger: [
      ...state.ledger,
      {
        source: state.current.id,
        xp,
        date: state.current.date,
        dayIndex: state.current.dayIndex,
      },
    ],
  };
}
export function rollDemo(input: DemoState, date: string): DemoState {
  const state = normalizeDemoState(input);
  if (date <= state.current.date) return state;
  if (
    state.current.status === "claimed" &&
    date <= settledClubDate(state.current)
  )
    return state;
  const current = makePeriod(
    date,
    state.current.dayIndex + (state.current.status === "claimed" ? 1 : 0),
  );
  current.learning.words = state.current.learning.words;
  return normalizeDemoState({
    ...state,
    history: [
      ...state.history,
      {
        ...state.current,
        status:
          state.current.status === "claimed" ? "claimed" : "archived_unclaimed",
      },
    ],
    current,
  });
}
export function demoDate(state: DemoState, now = new Date()) {
  return clubDate(
    new Date(now.getTime() + state.dayOffset * 86400000),
    CLUB_TIME_ZONE,
  );
}
export function nextCalendarDate(date: string) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + 86400000)
    .toISOString()
    .slice(0, 10);
}
export function streak(state: DemoState) {
  if (!state.ledger.length) return 0;
  const dates = state.ledger.map((x) => x.date).sort();
  const last = dates.at(-1)!;
  if (
    last !== state.current.date &&
    nextCalendarDate(last) !== state.current.date
  )
    return 0;
  let count = 1;
  for (let i = dates.length - 2; i >= 0; i--) {
    if (nextCalendarDate(dates[i]) !== dates[i + 1]) break;
    count++;
  }
  return count;
}
