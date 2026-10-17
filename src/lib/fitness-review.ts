import type { AIStarterPlan } from "./ai-types";
import type { FitnessState } from "./demo-store";

export const FITNESS_REVIEW_VERSION = "fitness-review-v2";
type Range = { min: number; max: number };
export type FitnessReviewStatus =
  | "plan_required"
  | "partial"
  | "pending_analysis"
  | "needs_clarification"
  | "english_revision"
  | "unknown"
  | "below_range"
  | "above_range"
  | "boundary_uncertain"
  | "within_range"
  | "tracking_only";
export interface FitnessReview {
  status: FitnessReviewStatus;
  canComplete: boolean;
  message: string;
  targetKcal: Range | null;
  intakeKcal: Range | null;
}
export function fitnessFoodText(value: FitnessState) {
  return [
    value.breakfast,
    value.lunch,
    value.dinner,
    value.snacks,
    value.drinks,
  ]
    .filter(Boolean)
    .join(", ");
}
function validRange(value: Range | null | undefined): value is Range {
  return (
    !!value &&
    Number.isFinite(value.min) &&
    Number.isFinite(value.max) &&
    value.min >= 0 &&
    value.max >= value.min
  );
}

/** Plan adherence is an estimate comparison, never a nutrition/medical verdict. */
export function evaluateFitnessReview(
  value: FitnessState,
  plan?: AIStarterPlan,
  requireEnergyPlan = false,
): FitnessReview {
  const energy = plan?.nutrition.energy;
  const target =
    energy?.status === "available" && validRange(energy.targetKcal)
      ? energy.targetKcal
      : null;
  const estimate = value.aiAnalysis?.recordedTotals.kcal;
  const intake = validRange(estimate) ? estimate : null;
  const result = (
    status: FitnessReviewStatus,
    message: string,
    canComplete = false,
  ): FitnessReview => ({
    status,
    canComplete,
    message,
    targetKcal: target,
    intakeKcal: intake,
  });
  const tracking =
    plan?.nutrition.status === "tracking_only" || energy?.goal === "tracking";
  if (requireEnergyPlan && tracking)
    return result(
      "plan_required",
      "今天已启用饮食区间审核。切换记录模式会从下个训练日生效；今天的真实记录仍保留，不会改为演示通关。",
    );
  if (!plan || (!target && !tracking))
    return result(
      "plan_required",
      "先到“我的计划”补充资料并生成适用的每日计划，再核对今天的记录。",
    );
  if (!tracking && !value.coverage)
    return result(
      "partial",
      "还没确认这是否是今天的全部饮食。不要求填满三餐：今天只吃一顿也可以，记全后勾选下方确认，再按全天总量核对。",
    );
  if (!value.analyzed)
    return result(
      "pending_analysis",
      "记录已保存，请先让 AI 解读当前这一版记录。",
    );
  const food = fitnessFoodText(value);
  if (tracking && !food.trim() && value.activity.trim())
    return result(
      "tracking_only",
      "当前完成的是活动记录与复盘，没有评价全天饮食是否符合计划。",
      true,
    );
  const analysis = value.aiAnalysis;
  if (
    !analysis ||
    analysis.originalFood !== food ||
    analysis.coverage !== (value.coverage ? "complete" : "partial") ||
    JSON.stringify(analysis.clarificationAnswers ?? []) !==
      JSON.stringify(value.clarificationAnswers ?? [])
  )
    return result(
      "pending_analysis",
      "食物、全天确认或补充回答有更新，请重新解读后再审核，旧结果不会代替本次记录。",
    );
  if ((analysis.clarificationQuestions?.length ?? 0) > 0)
    return result(
      "needs_clarification",
      "AI 还需要一条线索。请用英文回答下方问题，再重新分析。",
    );
  if (analysis.language.status !== "english")
    return result(
      "english_revision",
      "先核对食物的英文表达，保留真实食物内容，再重新解读。",
    );
  if (tracking)
    return result(
      "tracking_only",
      "当前是记录与复盘模式。完成记录不代表热量达标，也不评价饮食是否健康。",
      true,
    );
  if (!intake || analysis.unresolvedFoods.length)
    return result(
      "unknown",
      "还有未识别食物或无法估算的热量，请补充必要线索。未知项不会被当成 0。",
    );
  if (intake.max < target!.min)
    return result(
      "below_range",
      "已记录的全天估算低于计划参考范围，请核对漏记、份量和单位。真实记录照常保留，不要为了通关改写或补偿饮食。",
    );
  if (intake.min > target!.max)
    return result(
      "above_range",
      "已记录的全天估算高于计划参考范围，本日不标记计划达标。保留真实记录，按正常节奏继续，不需要通过少吃或额外运动补偿。",
    );
  if (intake.min < target!.min || intake.max > target!.max)
    return result(
      "boundary_uncertain",
      "估算范围跨过了计划边界，目前无法确定贴合程度。核对主要份量或油料即可，不必追求逐克精确。",
    );
  return result(
    "within_range",
    "完整记录的估算区间位于计划参考范围内。核对假设并完成英文复盘后，可以提交今日薄肌任务。",
    true,
  );
}

/** A non-security checksum for stale local UI snapshots, not an authorization token. */
export function fitnessReviewFingerprint(
  value: FitnessState,
  plan?: AIStarterPlan,
): string {
  const raw = JSON.stringify({
    version: FITNESS_REVIEW_VERSION,
    food: fitnessFoodText(value),
    activity: value.activity,
    coverage: value.coverage,
    answers: value.clarificationAnswers ?? [],
    analysis: value.aiAnalysis,
    planCreatedAt: plan?.createdAt,
    energy: plan?.nutrition.energy,
    nutritionStatus: plan?.nutrition.status,
  });
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index++)
    hash = Math.imul(hash ^ raw.charCodeAt(index), 16777619);
  return `${FITNESS_REVIEW_VERSION}:${(hash >>> 0).toString(16)}:${raw.length}`;
}
