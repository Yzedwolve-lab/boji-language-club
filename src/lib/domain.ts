/**
 * Versioned product rules, not medical policy or official exam certification.
 * Pure transitions below model trusted server state. Production settlement must
 * additionally use authentication, row locks and unique ledger constraints.
 */
export const RULES_VERSION = "boji-2026-10-15-v1";
/** All current product training days use Beijing time, independent of the device. */
export const CLUB_TIME_ZONE = "Asia/Shanghai";

export type GoalId = "user" | "member" | "shareholder" | "alan";
export type ExamType =
  | "none"
  | "ielts"
  | "pte_academic"
  | "toefl_legacy_total"
  | "toefl_2026_band"
  | "cet4"
  | "cet6";
export type TimeBudget = 30 | 60 | 120 | 240;

export interface Profile {
  nickname: string;
  gender: "male" | "female" | "unspecified";
  age: number;
  weightKg: number | null;
  heightCm: number | null;
  bodyFatPercent: number | null;
  activityLevel: string;
  timeBudget: TimeBudget;
  timeZone: string;
  examType: ExamType;
  examScore: number | null;
  examDate: string;
  comparableToeflScore: number | null;
  cetStatus: string;
  goal: GoalId;
  healthConsent: boolean;
}

/** Separate score-scale records prevent implicit PTE/IELTS/TOEFL conversions. */
export type ExamRecord =
  | { type: "none"; score: null }
  | { type: "ielts" | "pte_academic"; score: number; date: string | null }
  | { type: "toefl_legacy_total"; score: number; date: string | null }
  | {
      type: "toefl_2026_band";
      score: number;
      date: string | null;
      comparableTotal: number | null;
    }
  | {
      type: "cet4" | "cet6";
      score: null;
      status: "at_least_425" | "below_425" | "not_taken" | "not_provided";
    };

export const GOALS: readonly {
  id: GoalId;
  label: string;
  ieltsTarget: number;
}[] = Object.freeze([
  { id: "user", label: "薄肌用户", ieltsTarget: 6.5 },
  { id: "member", label: "薄肌会员", ieltsTarget: 7 },
  { id: "shareholder", label: "薄肌股东", ieltsTarget: 7.5 },
  { id: "alan", label: "薄肌教父", ieltsTarget: 8 },
]);

export interface TimeTemplate {
  vocabulary: number;
  listening: number;
  reading: number;
  writing: number;
  speaking: number;
  loggingReflection: number;
  retryBreakReserve: number;
}

export const TIME_TEMPLATES: Readonly<
  Record<TimeBudget, Readonly<TimeTemplate>>
> = Object.freeze({
  30: Object.freeze({
    vocabulary: 4,
    listening: 4,
    reading: 3,
    writing: 5,
    speaking: 5,
    loggingReflection: 4,
    retryBreakReserve: 5,
  }),
  60: Object.freeze({
    vocabulary: 8,
    listening: 10,
    reading: 7,
    writing: 12,
    speaking: 10,
    loggingReflection: 5,
    retryBreakReserve: 8,
  }),
  120: Object.freeze({
    vocabulary: 12,
    listening: 22,
    reading: 16,
    writing: 24,
    speaking: 24,
    loggingReflection: 8,
    retryBreakReserve: 14,
  }),
  240: Object.freeze({
    vocabulary: 20,
    listening: 40,
    reading: 35,
    writing: 45,
    speaking: 40,
    loggingReflection: 15,
    retryBreakReserve: 45,
  }),
});

const EXAM_SCALES = {
  ielts: { min: 0, max: 9, step: 0.5, label: "IELTS" },
  pte_academic: { min: 10, max: 90, step: 1, label: "PTE Academic" },
  toefl_legacy_total: { min: 0, max: 120, step: 1, label: "TOEFL 0–120" },
  toefl_2026_band: { min: 1, max: 6, step: 0.5, label: "TOEFL 1–6" },
} as const;

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function validateExam(
  type: ExamType,
  score: number | null,
  date = "",
  comparable: number | null = null,
): string | null {
  if (date && (typeof date !== "string" || !validCalendarDate(date)))
    return "Please enter a valid exam date (YYYY-MM-DD).";
  if (comparable !== null && type !== "toefl_2026_band")
    return "The comparable 0–120 score belongs only to the TOEFL 2026 report.";
  if (type === "none" || type === "cet4" || type === "cet6") {
    return score === null
      ? null
      : "Clear the previous numerical score when changing the exam type.";
  }
  if (!Object.hasOwn(EXAM_SCALES, type))
    return "Please choose a supported exam scale.";
  const scale = EXAM_SCALES[type as keyof typeof EXAM_SCALES];
  if (
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    score < scale.min ||
    score > scale.max ||
    !Number.isInteger(score / scale.step)
  ) {
    return `${scale.label}: enter ${scale.min}–${scale.max}, in ${scale.step === 1 ? "whole numbers" : "0.5 increments"}.`;
  }
  if (type === "toefl_2026_band" && date && date < "2026-01-21")
    return "Please check the scale: TOEFL 1–6 began on 2026-01-21.";
  if (
    comparable !== null &&
    (!Number.isInteger(comparable) || comparable < 0 || comparable > 120)
  ) {
    return "The separately reported comparable TOEFL total must be an integer from 0 to 120.";
  }
  return null;
}

export function validateProfile(profile: Profile): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!profile || typeof profile !== "object")
    return { form: "Please provide your profile." };
  if (
    typeof profile.nickname !== "string" ||
    [...profile.nickname.trim()].length > 24 ||
    /[\p{Cc}\p{Cf}]/u.test(profile.nickname)
  ) {
    errors.nickname = "昵称请使用不超过 24 个可显示字符；也可以留空。";
  }
  if (!["male", "female", "unspecified"].includes(profile.gender))
    errors.gender = "请选择性别或不提供。";
  if (!Number.isInteger(profile.age) || profile.age < 1 || profile.age > 130)
    errors.age = "请输入 1–130 之间的整数年龄。";
  for (const [key, unit] of [
    ["weightKg", "kg"],
    ["heightCm", "cm"],
    ["bodyFatPercent", "%"],
  ] as const) {
    const value = profile[key];
    if (
      value !== null &&
      (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    )
      errors[key] = `请输入有效的正数（${unit}），未知请留空。`;
  }
  if (profile.bodyFatPercent !== null && profile.bodyFatPercent >= 100)
    errors.bodyFatPercent = "请核对体脂百分比，或留空使用记录模式。";
  if (
    typeof profile.activityLevel !== "string" ||
    profile.activityLevel.length > 80
  )
    errors.activityLevel = "请选择活动量，或留空。";
  if (![30, 60, 120, 240].includes(profile.timeBudget))
    errors.timeBudget = "请选择每日 30、60、120 或 240 分钟。";
  if (profile.timeZone !== CLUB_TIME_ZONE)
    errors.timeZone = "俱乐部统一使用北京时间，请刷新页面后重试。";
  const examError = validateExam(
    profile.examType,
    profile.examScore,
    profile.examDate,
    profile.comparableToeflScore,
  );
  if (examError) errors.examScore = examError;
  if (typeof profile.examDate !== "string")
    errors.examDate = "考试日期请使用 YYYY-MM-DD，或留空。";
  if (
    (profile.examType === "cet4" || profile.examType === "cet6") &&
    !["at_least_425", "below_425", "not_taken", "not_provided"].includes(
      profile.cetStatus,
    )
  ) {
    errors.cetStatus =
      "请选择达到 425 分、未达到 425 分、未参加或不提供。官方不设及格线。";
  }
  if (!GOALS.some((goal) => goal.id === profile.goal))
    errors.goal = "请选择俱乐部目标。";
  if (typeof profile.healthConsent !== "boolean")
    errors.healthConsent = "请确认健康建议偏好。";
  return errors;
}

export function nutritionMode(profile: Profile): {
  mode: "tracking_only";
  reason: string;
} {
  if (profile.age < 18)
    return {
      mode: "tracking_only",
      reason: "未满 18 岁：支持语言与习惯记录，不提供减脂或身体目标处方。",
    };
  if (!profile.healthConsent)
    return {
      mode: "tracking_only",
      reason: "未启用健康个性化；可以记录、复盘并获得全部记录任务经验。",
    };
  if (
    profile.weightKg === null ||
    profile.heightCm === null ||
    !profile.activityLevel
  ) {
    return {
      mode: "tracking_only",
      reason: "个人估算资料不足；未知热量目标和运动消耗保持未知。",
    };
  }
  return {
    mode: "tracking_only",
    reason: "营养推荐策略尚未完成专业审查，目前提供中性的记录与复盘。",
  };
}

export interface CardTier {
  id: "silver" | "gold" | "diamond" | "black_gold";
  label: string;
  minXp: number;
  nextXp: number | null;
}
const CARD_TIERS: readonly CardTier[] = [
  { id: "silver", label: "银色", minXp: 0, nextXp: 700 },
  { id: "gold", label: "金色", minXp: 700, nextXp: 3000 },
  { id: "diamond", label: "钻石", minXp: 3000, nextXp: 9000 },
  { id: "black_gold", label: "黑金", minXp: 9000, nextXp: null },
];

export function cardTier(xp: number): CardTier {
  if (!Number.isSafeInteger(xp) || xp < 0)
    throw new RangeError("XP must be a nonnegative safe integer.");
  return {
    ...CARD_TIERS.find((tier) => tier.nextXp === null || xp < tier.nextXp)!,
  };
}

function assertScore(score: number, label: string): void {
  if (
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 100
  )
    throw new RangeError(`${label} must be a finite score from 0 to 100.`);
}

export function calculateXP(
  fitnessQuality: number,
  languageScore: number,
): number {
  assertScore(fitnessQuality, "Fitness quality");
  assertScore(languageScore, "Language score");
  return (
    Math.round((40 * fitnessQuality) / 100) +
    Math.round((50 * languageScore) / 100) +
    10
  );
}

function addCalendarDays(date: string, days: number): string {
  if (!validCalendarDate(date))
    throw new RangeError("Expected a real YYYY-MM-DD calendar date.");
  const calendar = new Date(`${date}T12:00:00Z`);
  calendar.setUTCDate(calendar.getUTCDate() + days);
  return calendar.toISOString().slice(0, 10);
}

/** Compare local wall-clock hour, then move the calendar date, not the instant.
 * Subtracting 3 elapsed hours incorrectly crosses DST at the wrong boundary.
 */
export function clubDate(date: Date, timeZone: string): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime()))
    throw new RangeError("Invalid timestamp.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)!.value;
  const localDate = `${value("year")}-${value("month")}-${value("day")}`;
  return Number(value("hour")) < 3 ? addCalendarDays(localDate, -1) : localDate;
}

export interface CompressionPreview {
  feasible: boolean;
  message: string;
  remainingDays: number | null;
  ratio: number;
}

/** baselineDays MUST be from the independent, versioned unaccelerated forecast. */
export function previewCompression(
  baselineDays: number | null,
  ratio: number,
  timeBudget: number,
  requiredMinutes: number,
): CompressionPreview {
  const unavailable = (message: string): CompressionPreview => ({
    feasible: false,
    message,
    remainingDays: null,
    ratio,
  });
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 0.4)
    return unavailable("加速请求须在 0%–40% 之间。");
  if (baselineDays === null)
    return unavailable(
      "评估中：没有独立基线，暂不生成完成日期；继续诊断与复评。",
    );
  if (!Number.isSafeInteger(baselineDays) || baselineDays < 1)
    return unavailable("基线无效，请先完成独立预测。");
  if (
    !Number.isFinite(timeBudget) ||
    !Number.isFinite(requiredMinutes) ||
    timeBudget <= 0 ||
    requiredMinutes < 0
  )
    return unavailable("任务时间必须是有效的分钟数。");
  if (requiredMinutes > timeBudget)
    return unavailable(
      `必做任务需要 ${requiredMinutes} 分钟，超出每日 ${timeBudget} 分钟预算，保留原计划。`,
    );
  return {
    feasible: true,
    remainingDays: Math.ceil(baselineDays * (1 - ratio)),
    ratio,
    message:
      "已通过比例与时间校验；这是规划预览，仍需独立学习证据和复习安排支持，不保证达标日期。",
  };
}

export type EnglishLogStatus =
  "valid" | "empty" | "needs_english" | "needs_clarification";
export interface EnglishLogValidation {
  valid: boolean;
  status: EnglishLogStatus;
  message: string | null;
  normalized: string;
}
const FOOD_WORDS = new Set(
  "egg eggs rice chicken tofu beef pork fish salmon tuna pasta bread toast noodle noodles oats oatmeal yogurt yoghurt milk cheese beans lentils apple apples banana bananas orange oranges fruit berries vegetables broccoli salad potato potatoes soup sandwich wrap pizza burger chocolate coffee cafe latte tea water juice soda cake cookie cookies nuts butter oil quinoa cereal hummus avocado spinach peanut peanuts dumpling dumplings sushi miso ramen curry currywurst croissant paella biryani congee matcha kimchi kombucha kefir protein".split(
    " ",
  ),
);
const ACTIVITY_WORDS = new Set(
  "walk walking walked jog jogging jogged run running ran cycle cycling cycled bike biking swim swimming swam stair stairs climbing climb workout training weights yoga pilates dance dancing exercise rest resting stretch stretching hike hiking treadmill rowing elliptical cardio".split(
    " ",
  ),
);

function isSmallSpellingVariation(word: string, expected: string): boolean {
  if (word.length < 4 || Math.abs(word.length - expected.length) > 1)
    return false;
  let i = 0,
    j = 0,
    differences = 0;
  while (i < word.length && j < expected.length) {
    if (word[i] === expected[j]) {
      i++;
      j++;
      continue;
    }
    if (++differences > 1) return false;
    if (word.length >= expected.length) i++;
    if (word.length <= expected.length) j++;
  }
  return differences + (word.length - i) + (expected.length - j) <= 1;
}

/** A conservative local input check, not an AI semantic/nutrition assessment.
 * Unrecognized names ask for clarification; callers always retain the raw draft.
 */
export function validateEnglishLog(
  text: string,
  kind: "food" | "activity" = "food",
): EnglishLogValidation {
  const normalized =
    typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
  const result = (
    status: EnglishLogStatus,
    message: string | null,
  ): EnglishLogValidation => ({
    valid: status === "valid",
    status,
    message,
    normalized,
  });
  if (!/\p{L}/u.test(normalized))
    return result(
      "empty",
      "Log at least one meal or activity before submitting.",
    );
  if (normalized.length > 3000)
    return result(
      "needs_clarification",
      "Please keep each description under 3,000 characters. Your draft can be kept.",
    );
  const letters = normalized.match(/\p{L}/gu) ?? [];
  if (letters.some((letter) => !/\p{Script=Latin}/u.test(letter)))
    return result(
      "needs_english",
      "Please describe your meal or exercise in English.",
    );
  const tokens =
    normalized
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[a-z]+/g) ?? [];
  const dictionary = kind === "food" ? FOOD_WORDS : ACTIVITY_WORDS;
  if (
    !tokens.some(
      (token) =>
        dictionary.has(token) ||
        [...dictionary].some((word) => isSmallSpellingVariation(token, word)),
    )
  ) {
    return result(
      "needs_clarification",
      kind === "food"
        ? "Please name a food and add a portion, for example: 2 eggs or 150 g cooked rice. Unrecognized food names need confirmation."
        : "Please describe the activity, for example: brisk walking for 30 minutes.",
    );
  }
  return result("valid", null);
}

export interface FitnessLog {
  breakfast?: string;
  lunch?: string;
  dinner?: string;
  snacks?: string;
  drinks?: string;
  activity?: string;
  activityMinutes?: number | null;
}

export function validateFitnessLog(log: FitnessLog): Record<string, string> {
  const errors: Record<string, string> = {};
  let hasRecord = false;
  for (const field of [
    "breakfast",
    "lunch",
    "dinner",
    "snacks",
    "drinks",
    "activity",
  ] as const) {
    const raw = log[field];
    if (raw === undefined || (typeof raw === "string" && !raw.trim())) continue;
    const check = validateEnglishLog(
      raw ?? "",
      field === "activity" ? "activity" : "food",
    );
    if (!check.valid) errors[field] = check.message!;
    else hasRecord = true;
  }
  if (!hasRecord && Object.keys(errors).length === 0)
    errors.form = "Log at least one meal or activity before submitting.";
  if (
    log.activityMinutes !== null &&
    log.activityMinutes !== undefined &&
    (!Number.isFinite(log.activityMinutes) ||
      log.activityMinutes < 0 ||
      log.activityMinutes > 1440)
  ) {
    errors.activityMinutes =
      "Activity duration must be between 0 and 1,440 minutes.";
  }
  return errors;
}

/** Generic MET arithmetic only; callers must show the source and uncertainty.
 * Do not add this again if an activity factor already included the exercise.
 */
export function estimateExerciseEnergy(
  met: number,
  minutes: number,
  weightKg: number | null,
): { grossKcal: number; netKcal: number } | null {
  if (
    !Number.isFinite(met) ||
    met < 1 ||
    met > 30 ||
    !Number.isFinite(minutes) ||
    minutes < 0 ||
    minutes > 1440
  )
    throw new RangeError("Invalid MET or exercise duration.");
  if (weightKg === null) return null;
  if (!Number.isFinite(weightKg) || weightKg <= 0)
    throw new RangeError("Weight must be known and positive.");
  return {
    grossKcal: Math.round(((met * 3.5 * weightKg) / 200) * minutes),
    netKcal: Math.round((((met - 1) * 3.5 * weightKg) / 200) * minutes),
  };
}

export function scheduleReviewDates(actualStudiedOn: string | null): string[] {
  return actualStudiedOn === null
    ? []
    : [1, 3, 7, 14, 30].map((interval) =>
        addCalendarDays(actualStudiedOn, interval),
      );
}

export type PeriodStatus =
  | "active"
  | "reviewing"
  | "ready_to_claim"
  | "claimed"
  | "archived_unclaimed"
  | "carried_for_system_review";
export interface PeriodEvidence {
  fitnessComplete: boolean;
  languagePassed: boolean;
  fitnessQuality: number | null;
  languageScore: number | null;
  /** Authoritative receipt of ALL required submissions before the boundary. */
  submittedBeforeBoundary: boolean;
  reviewPending: boolean;
}
export interface ActivityPeriod extends PeriodEvidence {
  id: string;
  clubDate: string;
  dayIndex: number;
  status: PeriodStatus;
  reviewCompletedAt: string | null;
  claimWindowEndsAt: string | null;
  claimedAt: string | null;
  claimedClubDate: string | null;
  awardedXp: number | null;
}
export interface ClubState {
  current: ActivityPeriod;
  history: ActivityPeriod[];
  totalXp: number;
  completedDays: number;
}

export function createPeriod(
  id: string,
  date: string,
  dayIndex = 1,
): ActivityPeriod {
  if (
    !id ||
    !validCalendarDate(date) ||
    !Number.isSafeInteger(dayIndex) ||
    dayIndex < 1
  )
    throw new RangeError("Invalid period identity, date or Day.");
  return {
    id,
    clubDate: date,
    dayIndex,
    status: "active",
    fitnessComplete: false,
    languagePassed: false,
    fitnessQuality: null,
    languageScore: null,
    submittedBeforeBoundary: false,
    reviewPending: false,
    reviewCompletedAt: null,
    claimWindowEndsAt: null,
    claimedAt: null,
    claimedClubDate: null,
    awardedXp: null,
  };
}

export function updatePeriodEvidence(
  period: ActivityPeriod,
  evidence: Partial<PeriodEvidence>,
): ActivityPeriod {
  if (period.status === "claimed" || period.status === "archived_unclaimed")
    throw new Error(
      "Finalized periods are immutable; use a separate audited correction.",
    );
  const next = { ...period, ...evidence };
  if (next.fitnessQuality !== null)
    assertScore(next.fitnessQuality, "Fitness quality");
  if (next.languageScore !== null)
    assertScore(next.languageScore, "Language score");
  if (next.reviewPending)
    next.status =
      period.status === "carried_for_system_review"
        ? "carried_for_system_review"
        : "reviewing";
  else if (
    next.fitnessComplete &&
    next.languagePassed &&
    next.fitnessQuality !== null &&
    next.languageScore !== null
  )
    next.status = "ready_to_claim";
  else next.status = "active";
  return next;
}

export function rolloverPeriod(
  state: ClubState,
  now: Date,
  timeZone: string,
  newPeriodId: string,
): ClubState {
  const date = clubDate(now, timeZone);
  const period = state.current;
  const lastDate = period.claimedClubDate ?? period.clubDate;
  if (date < lastDate)
    throw new Error(
      "A period cannot travel backwards; timezone changes need a future effective boundary.",
    );
  if (date === lastDate) return state;
  if (period.reviewPending && period.submittedBeforeBoundary) {
    return period.status === "carried_for_system_review"
      ? state
      : {
          ...state,
          current: { ...period, status: "carried_for_system_review" },
        };
  }
  if (
    period.status !== "claimed" &&
    period.claimWindowEndsAt &&
    now.getTime() < Date.parse(period.claimWindowEndsAt)
  )
    return state;
  if (
    newPeriodId === period.id ||
    state.history.some((prior) => prior.id === newPeriodId)
  )
    throw new Error("Each period requires a new unique identity.");
  const archived: ActivityPeriod =
    period.status === "claimed"
      ? period
      : { ...period, status: "archived_unclaimed" };
  return {
    ...state,
    history: [...state.history, archived],
    current: createPeriod(
      newPeriodId,
      date,
      period.dayIndex + (period.status === "claimed" ? 1 : 0),
    ),
  };
}

export function completeSystemReview(
  period: ActivityPeriod,
  evidence: Partial<PeriodEvidence>,
  now: Date,
): ActivityPeriod {
  if (!Number.isFinite(now.getTime()))
    throw new RangeError("Invalid review timestamp.");
  if (period.reviewCompletedAt !== null) return period; // A retry never extends the deadline.
  if (!period.reviewPending || !period.submittedBeforeBoundary)
    throw new Error(
      "A fair review window requires timely, server-recorded submissions.",
    );
  const reviewed = updatePeriodEvidence(period, {
    ...evidence,
    reviewPending: false,
  });
  return {
    ...reviewed,
    reviewCompletedAt: now.toISOString(),
    claimWindowEndsAt: new Date(
      now.getTime() + 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

export function claimPeriod(
  state: ClubState,
  now: Date,
  timeZone: string,
): ClubState {
  const period = state.current;
  if (period.status === "claimed") return state; // Same snapshot, even after a lost response.
  const date = clubDate(now, timeZone);
  if (date < period.clubDate) throw new Error("Cannot settle a future period.");
  if (
    period.claimWindowEndsAt &&
    now.getTime() >= Date.parse(period.claimWindowEndsAt)
  )
    throw new Error("The review claim window has ended.");
  if (date !== period.clubDate && !period.claimWindowEndsAt)
    throw new Error(
      "This period has ended; archive it before opening the next one.",
    );
  if (
    period.status !== "ready_to_claim" ||
    period.reviewPending ||
    !period.fitnessComplete ||
    !period.languagePassed ||
    period.fitnessQuality === null ||
    period.languageScore === null
  ) {
    throw new Error(
      "Both modules need completed, authoritative evaluations before claiming.",
    );
  }
  const award = calculateXP(period.fitnessQuality, period.languageScore);
  return {
    ...state,
    totalXp: state.totalXp + award,
    completedDays: state.completedDays + 1,
    current: {
      ...period,
      status: "claimed",
      claimedAt: now.toISOString(),
      claimedClubDate: date,
      awardedXp: award,
    },
  };
}
