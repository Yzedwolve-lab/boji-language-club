import type { Profile } from "./domain";

export type EnergyGoal = "gentle_loss" | "maintain" | "tracking";
export type CalculationSex = "male" | "female" | "unspecified";
export type NutritionEligibility =
  "standard_adult" | "specialist_guidance" | "unspecified";
export type EnergyActivity =
  "unspecified" | "sedentary" | "light" | "moderate" | "active";
export interface EnergyPreferences {
  activityLevel: EnergyActivity;
  energyGoal?: EnergyGoal;
  calculationSex?: CalculationSex;
  nutritionEligibility?: NutritionEligibility;
}
export interface KcalRange {
  min: number;
  max: number;
}
export interface EnergyReference {
  status: "available" | "missing_context" | "tracking_only" | "not_applicable";
  goal: EnergyGoal;
  appliedGoal: "gentle_loss" | "maintain" | null;
  restingKcal: number | null;
  maintenanceKcal: number | null;
  deficitKcal: number | null;
  activityFactor: number | null;
  targetKcal: KcalRange | null;
  mealBudgets: Array<{
    meal: "breakfast" | "lunch" | "dinner";
    share: number;
    kcal: KcalRange;
  }>;
  reasons: string[];
  assumptions: string[];
  version: string;
  inputKey: string;
}

export const ENERGY_PLAN_VERSION = "mifflin-product-plan-2026-10-15-v1";
/** The Mifflin equation predicts resting energy, not total daily expenditure.
 * Primary study: https://pubmed.ncbi.nlm.nih.gov/2305711/?dopt=Abstract
 * Studied healthy adults aged 19–78, including normal-weight and obese adults.
 * The multipliers, deficit cap, floors, BMI 20 guard and display band BELOW are
 * explicit product defaults, not parameters validated by that study or a
 * professionally reviewed clinical prescription. Activity already includes
 * habitual exercise; do not add exercise calories again.
 * Applicability: https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner
 * BMI screening: https://www.nhlbi.nih.gov/health/overweight-and-obesity/symptoms
 */
const ACTIVITY_FACTORS = Object.freeze({
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
});
const PRODUCT_FLOORS = Object.freeze({ male: 1800, female: 1500 });

/** A canonical comparison key, not a security hash. Keep it with private plans;
 * never send it to the model or logs. Identity and exam data do not affect it. */
export function energyInputKey(
  profile: Profile,
  preferences: EnergyPreferences,
): string {
  return JSON.stringify([
    ENERGY_PLAN_VERSION,
    profile.age,
    profile.heightCm,
    profile.weightKg,
    preferences.calculationSex ?? "unspecified",
    preferences.activityLevel,
    preferences.energyGoal ?? "gentle_loss",
    preferences.nutritionEligibility ?? "unspecified",
    profile.healthConsent,
  ]);
}

export function calculateEnergyReference(
  profile: Profile,
  preferences: EnergyPreferences,
): EnergyReference {
  const goal = preferences.energyGoal ?? "gentle_loss";
  const result: EnergyReference = {
    status: "missing_context",
    goal,
    appliedGoal: null,
    restingKcal: null,
    maintenanceKcal: null,
    deficitKcal: null,
    activityFactor: null,
    targetKcal: null,
    mealBudgets: [],
    reasons: [],
    version: ENERGY_PLAN_VERSION,
    inputKey: energyInputKey(profile, preferences),
    assumptions: [
      "Mifflin–St Jeor 估算静息能量（REE，常称基础代谢估算）；它不等于全天维持消耗，本版仅用于 19–78 岁的适用成人。",
      "活动系数为产品规划近似：久坐 1.2、轻度 1.375、中度 1.55、较高 1.725；已包含日常活动与运动，不再抵扣运动热量。",
      "温和减脂中心默认比维持估算低 10%，缺口最多 250 kcal；中心上下 10% 是产品浮动带，不是统计置信区间或医学安全范围。",
      "产品规划下限取静息估算与男参数 1800／女参数 1500 kcal 的较高值；这不是个人最低安全摄入量，也不代表适合所有人。",
      "三餐预算按 30%／40%／30% 分配，零食饮料可在全天内灵活安排；菜谱份量是 AI 搭配建议，预算不是菜谱经过核验的实际热量。",
      "仅作可调整的产品规划估算；一天的记录不能证明营养充分、体脂下降或健康状况，不因少吃或补偿运动获得奖励。",
    ],
  };
  const unavailable = (
    status: EnergyReference["status"],
    reasons: string[],
  ) => ({ ...result, status, reasons });
  if (!profile.healthConsent || goal === "tracking")
    return unavailable("tracking_only", [
      !profile.healthConsent
        ? "未同意健康建议，仅记录真实饮食。"
        : "已选择只记录，不设置热量目标。",
    ]);
  if (!Number.isInteger(profile.age) || profile.age < 19 || profile.age > 78)
    return unavailable("not_applicable", [
      "本版公式只覆盖 19–78 岁；其他年龄保留记录与一般饮食提示，不自动生成减脂区间。",
    ]);
  if (preferences.nutritionEligibility === "specialist_guidance")
    return unavailable("not_applicable", [
      "孕期、哺乳期、医嘱饮食或其他需专业指导的情况不启用自动能量规划，请沿用适合自己的专业建议。",
    ]);
  const missing: string[] = [];
  if (profile.heightCm === null) missing.push("请提供身高（cm）。");
  if (profile.weightKg === null) missing.push("请提供体重（kg）。");
  if (
    !preferences.calculationSex ||
    preferences.calculationSex === "unspecified"
  )
    missing.push("请单独选择公式计算参数；页面性别不会代替这一选择。");
  if (preferences.activityLevel === "unspecified")
    missing.push("请确认日常活动量。");
  if (preferences.nutritionEligibility !== "standard_adult")
    missing.push(
      "请确认是适用成人，非孕哺期且没有需遵循的医嘱饮食限制；不确定时可继续只记录。",
    );
  if (missing.length) return unavailable("missing_context", missing);
  const height = profile.heightCm!;
  const weight = profile.weightKg!;
  if (
    !Number.isFinite(height) ||
    !Number.isFinite(weight) ||
    height < 120 ||
    height > 230 ||
    weight < 35 ||
    weight > 250
  )
    return unavailable("not_applicable", [
      "资料超出本版产品支持的估算范围（身高 120–230 cm、体重 35–250 kg），请核对单位；真实记录仍可保存。",
    ]);
  const bmi = weight / (height / 100) ** 2;
  if (bmi < 18.5 || (goal === "gentle_loss" && bmi < 20))
    return unavailable("not_applicable", [
      bmi < 18.5
        ? "身高体重计算值偏低，本版不自动提供能量目标；BMI 仅是筛查信息，不是诊断。"
        : "本版产品对 BMI 低于 20 的情况不自动设置减脂缺口；可选择维持或只记录，这不是健康诊断。",
    ]);
  const sex = preferences.calculationSex as "male" | "female";
  const activityFactor =
    ACTIVITY_FACTORS[
      preferences.activityLevel as keyof typeof ACTIVITY_FACTORS
    ];
  if (!Number.isFinite(activityFactor) || !(sex in PRODUCT_FLOORS))
    return unavailable("missing_context", ["请确认公式参数与日常活动量。"]);
  const restingKcal = Math.round(
    10 * weight + 6.25 * height - 5 * profile.age + (sex === "male" ? 5 : -161),
  );
  const maintenanceKcal = Math.round(restingKcal * activityFactor);
  const floor = Math.max(restingKcal, PRODUCT_FLOORS[sex]);
  if (maintenanceKcal <= floor)
    return unavailable("not_applicable", [
      "维持估算已接近本版保守规划下限，不生成数值目标；请改用记录与专业个体化建议。",
    ]);
  const requestedDeficit =
    goal === "gentle_loss"
      ? Math.min(250, Math.round(maintenanceKcal * 0.1))
      : 0;
  const center = Math.max(floor, maintenanceKcal - requestedDeficit);
  const deficitKcal = maintenanceKcal - center;
  const targetKcal = {
    min: Math.max(floor, Math.round(center * 0.9)),
    max: Math.min(
      goal === "gentle_loss" ? maintenanceKcal : Number.MAX_SAFE_INTEGER,
      Math.round(center * 1.1),
    ),
  };
  const breakfast = {
    min: Math.round(targetKcal.min * 0.3),
    max: Math.round(targetKcal.max * 0.3),
  };
  const lunch = {
    min: Math.round(targetKcal.min * 0.4),
    max: Math.round(targetKcal.max * 0.4),
  };
  return {
    ...result,
    status: "available",
    appliedGoal: goal === "maintain" ? "maintain" : "gentle_loss",
    restingKcal,
    maintenanceKcal,
    deficitKcal,
    activityFactor,
    targetKcal,
    reasons:
      deficitKcal < requestedDeficit
        ? ["为遵守本版产品规划下限，已缩小默认缺口。"]
        : [],
    mealBudgets: [
      { meal: "breakfast", share: 0.3, kcal: breakfast },
      { meal: "lunch", share: 0.4, kcal: lunch },
      {
        meal: "dinner",
        share: 0.3,
        kcal: {
          min: targetKcal.min - breakfast.min - lunch.min,
          max: targetKcal.max - breakfast.max - lunch.max,
        },
      },
    ],
  };
}
