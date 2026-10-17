"use client";
import type { AINutritionResult } from "@/lib/ai-types";
import type { evaluateFitnessReview } from "@/lib/fitness-review";
import "./ai-plan.css";
function showRange(
  value: { min: number; max: number } | null | undefined,
  step = 1,
) {
  if (!value) return "未估算";
  const min = Math.floor(value.min / step) * step,
    max = Math.ceil(value.max / step) * step;
  return min === max ? String(min) : `${min}–${max}`;
}
export default function AINutritionView({
  result,
  busy,
  analyzed,
  review,
  coverage = false,
  onCoverageChange,
  disabled = false,
}: {
  result?: AINutritionResult;
  busy: boolean;
  analyzed: boolean;
  review?: ReturnType<typeof evaluateFitnessReview>;
  coverage?: boolean;
  onCoverageChange?: (complete: boolean) => void;
  disabled?: boolean;
}) {
  const partial =
    !result ||
    Object.values(result.recordedTotals).some((value) => value === null);
  return (
    <section className="ai-nutrition" aria-label="AI 营养估算">
      <div className="tracking-banner">
        <div>
          <strong>你的 AI 来解读，原文照样保留 🤖</strong>
          <p>
            点击分析才发送当前食物原文与补充回答，使用你的 AI
            额度。热量以约数和区间展示，未知部分保持未知。
          </p>
        </div>
      </div>
      {review && (
        <div
          className={`fitness-daily-review review-${review.status}`}
          role="status"
          data-testid="fitness-daily-review"
        >
          <strong>
            {review.status === "within_range"
              ? "每日饮食范围已核对 ✓"
              : review.status === "tracking_only"
                ? "今日仅记录 · 不评价饮食达标"
                : "每日饮食计划 · 还需要核对"}
          </strong>
          <div className="fitness-comparison">
            <span>
              计划范围
              <strong>
                {review.targetKcal
                  ? `约 ${showRange(review.targetKcal, 10)} kcal`
                  : "尚无适用范围"}
              </strong>
            </span>
            <span>
              {review.status === "needs_clarification"
                ? "记录待澄清"
                : review.status === "partial"
                  ? "已记录部分"
                  : "全天记录"}
              <strong>
                {analyzed &&
                !busy &&
                review.intakeKcal &&
                review.status !== "needs_clarification"
                  ? `约 ${showRange(review.intakeKcal, 10)} kcal`
                  : "待核对当前记录"}
              </strong>
            </span>
          </div>
          <p>{review.message}</p>
          {onCoverageChange && (
            <div className="fitness-coverage-choice">
              <label className="check-label">
                <input
                  id="fitness-day-complete"
                  type="checkbox"
                  checked={coverage}
                  disabled={busy || disabled}
                  onChange={(event) => onCoverageChange(event.target.checked)}
                />
                今天吃的都记完了（一餐也可以）
              </label>
              <p className="tiny muted">
                记上实际吃过的食物、零食和饮料即可，没吃的餐次留空。确认或修改后，点击“AI
                解读这份记录”核对当前版本。
              </p>
            </div>
          )}
        </div>
      )}
      <div className="nutrient-grid">
        {(
          [
            ["已知部分热量", "kcal", "kcal"],
            ["碳水化合物", "g", "carbsG"],
            ["蛋白质", "g", "proteinG"],
            ["脂肪", "g", "fatG"],
          ] as const
        ).map(([name, unit, key]) => {
          const range = result?.knownSubtotal[key];
          return (
            <div
              className="nutrient-stat"
              key={key}
              data-estimate-state={
                busy || !analyzed
                  ? "pending"
                  : !range
                    ? "unestimated"
                    : partial
                      ? "partial"
                      : "estimated"
              }
            >
              <small>{name}</small>
              <div>
                <strong className="ai-range" data-testid={`nutrition-${key}`}>
                  {busy
                    ? "解读中…"
                    : !analyzed
                      ? "待分析"
                      : `${range && key === "kcal" ? "约 " : ""}${showRange(range, key === "kcal" ? 10 : 1)}`}
                </strong>
                {range && analyzed && !busy && <span>{unit}</span>}
              </div>
              <p className="metric-state">
                {range && analyzed && !busy
                  ? `${partial ? "仅已知部分 · " : ""}模型估算`
                  : "未知 ≠ 0"}
              </p>
            </div>
          );
        })}
      </div>
      {result && (
        <div className="estimate-explainer">
          <p>
            <strong>英文反馈：</strong>
            {result.language.explanation}
          </p>
          {!!result.language.corrections.length && (
            <p>
              可参考：
              {result.language.corrections
                .map((c) => `${c.original} → ${c.suggested}`)
                .join("；")}
              。原文没有被改写。
            </p>
          )}
          <details>
            <summary>核对份量、生熟状态与未知项</summary>
            {result.items.map((item, i) => (
              <article key={i}>
                <strong>{item.name}</strong>
                <p>原文：{item.sourceText}</p>
                <p>
                  份量：
                  {item.quantity === null
                    ? "未知"
                    : `${item.quantity} ${item.unit}`}{" "}
                  ·{" "}
                  {
                    { raw: "生重", cooked: "熟重", unspecified: "生熟未明确" }[
                      item.preparation
                    ]
                  }{" "}
                  · {item.nutrition.kcal ? "约 " : ""}
                  {showRange(item.nutrition.kcal, 10)}
                  {item.nutrition.kcal ? " kcal" : ""}
                </p>
                {item.assumption && <p>假设：{item.assumption}</p>}
                {item.preparationAssumption && (
                  <p>生熟说明：{item.preparationAssumption}</p>
                )}
              </article>
            ))}
            {result.unresolvedFoods.map((item, i) => (
              <p className="unknown-food" key={i}>
                <strong>未估算：{item.sourceText}</strong> · {item.reason}
              </p>
            ))}
            {result.uncertainties.map((item, i) => (
              <p key={i}>{item}</p>
            ))}
          </details>
          <p className="muted">
            区间未经过统计校准，不能视为精确营养数据库结果。未标为全天完整记录或存在未知项时，不计算全天总量。核对后再完成复盘。
          </p>
        </div>
      )}
    </section>
  );
}
