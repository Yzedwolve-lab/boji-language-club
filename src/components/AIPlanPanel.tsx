"use client";
import { useEffect, useRef, useState } from "react";
import type { Profile } from "@/lib/domain";
import type { AIOnboardingResult, AIStarterPlan } from "@/lib/ai-types";
import { selfHostedRequest } from "@/lib/ai-client";
import { isAIPlanCurrent } from "@/lib/plan-input";
import "./ai-plan.css";

export const emptyAISetup = (): AIOnboardingResult => ({
  mode: "demo",
  preferences: {
    activityLevel: "unspecified",
    dietaryPreferences: "",
    allergies: "",
    energyGoal: "gentle_loss",
    calculationSex: "unspecified",
    nutritionEligibility: "unspecified",
  },
  englishSample: "",
});

const taskNames: Record<string, string> = {
  vocabulary: "词汇 / 语法",
  listening: "听力",
  reading: "阅读",
  writing: "写作",
  speaking: "口语",
};
const calorieRange = (range: { min: number; max: number }) =>
  `约 ${Math.floor(range.min / 10) * 10}–${Math.ceil(range.max / 10) * 10} kcal`;

export function AIPlanHighlights({
  plan,
  englishOnly = false,
}: {
  plan: AIStarterPlan;
  englishOnly?: boolean;
}) {
  return (
    <section className="panel ai-plan-results" aria-label="AI 计划建议">
      <p className="eyebrow">YOUR AI, YOUR NEXT STEP 🤖</p>
      <h2>{englishOnly ? "你的英语练习路线" : "你的每日饮食与英语计划"}</h2>
      <p className="muted">
        生成于 {new Date(plan.createdAt).toLocaleString("zh-CN")} ·
        模型建议，非官方测评
        {plan.forDate && ` · 训练日 ${plan.forDate}`}
        。这是已保存的计划，跨日不会自动重新生成。
      </p>
      {!englishOnly && (
        <div className="ai-plan-section">
          <h3>吃饭这件事，先找适合你的节奏 🍽️</h3>
          <p>{plan.nutrition.summary}</p>
          {plan.nutrition.energy && (
            <div className="ai-energy-plan">
              <div className="ai-energy-metrics">
                <article>
                  <small>基础 / 静息估算</small>
                  <strong>
                    {plan.nutrition.energy.restingKcal === null
                      ? "资料不足"
                      : `约 ${Math.round(plan.nutrition.energy.restingKcal / 10) * 10} kcal`}
                  </strong>
                </article>
                <article>
                  <small>维持消耗估算</small>
                  <strong>
                    {plan.nutrition.energy.maintenanceKcal === null
                      ? "资料不足"
                      : `约 ${Math.round(plan.nutrition.energy.maintenanceKcal / 10) * 10} kcal`}
                  </strong>
                </article>
                <article>
                  <small>本次规划缺口</small>
                  <strong>
                    {plan.nutrition.energy.deficitKcal === null
                      ? "未设置"
                      : `约 ${Math.round(plan.nutrition.energy.deficitKcal / 10) * 10} kcal`}
                  </strong>
                </article>
                <article className="ai-energy-target">
                  <small>每日产品规划区间</small>
                  <strong>
                    {plan.nutrition.energy.targetKcal
                      ? calorieRange(plan.nutrition.energy.targetKcal)
                      : "暂不生成数值目标"}
                  </strong>
                </article>
              </div>
              {plan.nutrition.energy.reasons.map((reason) => (
                <p key={reason}>{reason}</p>
              ))}
              <details>
                <summary>查看估算依据与限制</summary>
                {plan.nutrition.energy.assumptions.map((assumption) => (
                  <p key={assumption}>{assumption}</p>
                ))}
              </details>
            </div>
          )}
          {plan.nutrition.status === "tracking_only" && (
            <span className="soft-badge">仅记录，未生成个性化饮食建议</span>
          )}
          <div className="ai-meal-ideas">
            {plan.nutrition.mealIdeas.map((meal, i) => (
              <article key={`${meal.meal}-${i}`}>
                <strong>
                  {
                    { breakfast: "早餐", lunch: "午餐", dinner: "晚餐" }[
                      meal.meal
                    ]
                  }
                </strong>
                <p>{meal.idea}</p>
                {meal.budgetKcal && (
                  <strong>
                    计划预算：{calorieRange(meal.budgetKcal)}
                    <small>非菜谱实测热量</small>
                  </strong>
                )}
                <small>{meal.note}</small>
              </article>
            ))}
          </div>
        </div>
      )}
      <div className="ai-plan-section">
        <h3>Your English arc starts here. ✨</h3>
        <span className="soft-badge">
          {plan.english.basis === "written_sample"
            ? "依据本次英文写作样本"
            : "尚无诊断样本 · 通用练习安排"}
        </span>
        <p>{plan.english.summary}</p>
        {!!plan.english.strengths.length && (
          <p>
            <strong>已经做得不错：</strong>
            {plan.english.strengths.join("；")}
          </p>
        )}
        {!!plan.english.focusAreas.length && (
          <p>
            <strong>下一步练：</strong>
            {plan.english.focusAreas.join("；")}
          </p>
        )}
        <div className="ai-task-list">
          {plan.english.tasks.map((task) => (
            <article key={task.component}>
              <div>
                <strong>{taskNames[task.component]}</strong>
                <span>{task.minutes} min</span>
              </div>
              <p>{task.instruction}</p>
            </article>
          ))}
        </div>
        <p className="muted">
          听力、口语能力仍待对应证据；文字样本不产生发音、流利度或官方考试分数。此处是
          AI 计划，下面的固定练习另标演示。
        </p>
      </div>
      {!englishOnly && (
        <div className="ai-plan-limits">
          {plan.limits.map((limit, i) => (
            <p key={i}>{limit}</p>
          ))}
        </div>
      )}
    </section>
  );
}

export default function AIPlanPanel({
  profile,
  setup,
  onChange,
  onNeedConnection,
  onHealthConsentChange,
  onProfileChange,
}: {
  profile: Profile;
  setup?: AIOnboardingResult;
  onChange: (
    next: AIOnboardingResult,
    expected?: { setup: AIOnboardingResult | undefined; profile: Profile },
  ) => void;
  onNeedConnection: () => void;
  onHealthConsentChange: (value: boolean) => void;
  onProfileChange?: (profile: Profile) => void;
}) {
  const current = setup ?? emptyAISetup();
  const planStale = Boolean(
    current.plan &&
    !isAIPlanCurrent(current.plan, {
      profile,
      preferences: current.preferences,
      englishSample: current.englishSample,
    }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function generate() {
    if (!consent || busy) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const plan = await selfHostedRequest<AIStarterPlan>(
        "plan",
        {
          profile,
          preferences: current.preferences,
          englishSample: current.englishSample,
        },
        controller.signal,
      );
      if (!controller.signal.aborted)
        onChange({ ...current, plan }, { setup, profile });
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "生成未完成，之前的计划和草稿仍保留。",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="ai-plan-panel">
      <section className="panel ai-plan-editor">
        <h2>
          {current.plan
            ? "调整资料，更新今天的计划 🔄"
            : "先填这几项，让今天有个计划 🎯"}
        </h2>
        <p>
          饮食建议参考你提供的身体资料、活动和偏好；英语计划参考目标、每日时间与本次写作样本。不会靠身高体重猜体脂变化。
        </p>
        {current.mode !== "self_hosted" ? (
          <>
            <p className="ai-status-note">
              当前是记录体验模式。先在设置中连接你的 AI，再生成专属建议。
            </p>
            <button className="button primary" onClick={onNeedConnection}>
              去连接我的 AI
            </button>
          </>
        ) : (
          <>
            <fieldset className="bare-fieldset" disabled={busy}>
              <p className="muted">
                当前参考：身高{" "}
                {profile.heightCm === null
                  ? "未提供"
                  : `${profile.heightCm} cm`}{" "}
                · 体重{" "}
                {profile.weightKg === null
                  ? "未提供"
                  : `${profile.weightKg} kg`}
                。新的实际体重记录会在下一次生成时作为参考。
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={profile.healthConsent}
                  onChange={(e) => onHealthConsentChange(e.target.checked)}
                />
                允许 AI 参考身体资料给出饮食建议，并使用程序估算的产品规划区间
              </label>
              <div className="form-grid">
                {onProfileChange && (
                  <>
                    <label className="field">
                      计划参考身高（cm）
                      <input
                        aria-label="计划参考身高（cm）"
                        type="number"
                        min={100}
                        max={230}
                        value={profile.heightCm ?? ""}
                        onChange={(event) => {
                          setConsent(false);
                          onProfileChange({
                            ...profile,
                            heightCm:
                              event.target.value === ""
                                ? null
                                : Number(event.target.value),
                          });
                        }}
                      />
                    </label>
                    <label className="field">
                      计划参考体重（kg）
                      <input
                        aria-label="计划参考体重（kg）"
                        type="number"
                        min={30}
                        max={350}
                        step="0.1"
                        value={profile.weightKg ?? ""}
                        onChange={(event) => {
                          setConsent(false);
                          onProfileChange({
                            ...profile,
                            weightKg:
                              event.target.value === ""
                                ? null
                                : Number(event.target.value),
                          });
                        }}
                      />
                    </label>
                  </>
                )}
                <label className="field">
                  饮食目标
                  <select
                    aria-label="饮食目标"
                    value={current.preferences.energyGoal ?? "gentle_loss"}
                    onChange={(event) => {
                      setConsent(false);
                      onChange({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          energyGoal: event.target.value as
                            "gentle_loss" | "maintain" | "tracking",
                        },
                      });
                    }}
                  >
                    <option value="gentle_loss">温和减脂 · 默认</option>
                    <option value="maintain">维持当前体重</option>
                    <option value="tracking">仅记录，不设热量目标</option>
                  </select>
                </label>
                <label className="field">
                  能量公式计算参数
                  <select
                    aria-label="能量公式计算参数"
                    value={current.preferences.calculationSex ?? "unspecified"}
                    onChange={(event) => {
                      setConsent(false);
                      onChange({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          calculationSex: event.target.value as
                            "male" | "female" | "unspecified",
                        },
                      });
                    }}
                  >
                    <option value="unspecified">暂不提供</option>
                    <option value="male">使用男性公式参数</option>
                    <option value="female">使用女性公式参数</option>
                  </select>
                  <small>
                    只用于能量公式，不根据个人身份自动选择；不提供则不计算数值范围。
                  </small>
                </label>
                <label className="field full">
                  饮食规划适用情况
                  <select
                    aria-label="饮食规划适用情况"
                    value={
                      current.preferences.nutritionEligibility ?? "unspecified"
                    }
                    onChange={(event) => {
                      setConsent(false);
                      onChange({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          nutritionEligibility: event.target.value as
                            | "standard_adult"
                            | "specialist_guidance"
                            | "unspecified",
                        },
                      });
                    }}
                  >
                    <option value="unspecified">请确认适用情况</option>
                    <option value="standard_adult">
                      我是成年人，非孕哺期，没有需要遵循的医嘱饮食限制
                    </option>
                    <option value="specialist_guidance">
                      有特殊情况或正在接受专业饮食指导
                    </option>
                  </select>
                </label>
                <label className="field">
                  日常活动程度
                  <select
                    value={current.preferences.activityLevel}
                    onChange={(e) =>
                      onChange({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          activityLevel: e.target
                            .value as AIOnboardingResult["preferences"]["activityLevel"],
                        },
                      })
                    }
                  >
                    <option value="unspecified">暂不确定</option>
                    <option value="sedentary">以坐着为主</option>
                    <option value="light">轻度活动</option>
                    <option value="moderate">中等活动</option>
                    <option value="active">活动较多</option>
                  </select>
                </label>
                <label className="field">
                  饮食偏好
                  <input
                    maxLength={500}
                    value={current.preferences.dietaryPreferences}
                    onChange={(e) =>
                      onChange({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          dietaryPreferences: e.target.value,
                        },
                      })
                    }
                    placeholder="例如：素食、家常中餐、做饭时间较少"
                  />
                </label>
                <label className="field full">
                  食物过敏 / 需要避开的食物
                  <input
                    maxLength={500}
                    value={current.preferences.allergies}
                    onChange={(e) =>
                      onChange({
                        ...current,
                        preferences: {
                          ...current.preferences,
                          allergies: e.target.value,
                        },
                      })
                    }
                    placeholder="如实填写；模型不能保证识别全部过敏原"
                  />
                </label>
                <label className="field full">
                  给 AI 的英文写作样本
                  <textarea
                    rows={5}
                    maxLength={4000}
                    value={current.englishSample}
                    onChange={(e) =>
                      onChange({ ...current, englishSample: e.target.value })
                    }
                    placeholder="Write at least 20 words about your routine, your goals, or something you enjoy. 也可以留空，先得到通用练习安排。"
                  />
                </label>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                同意将上述资料、已填身体信息（含最新实测体重）及英文样本发送到我配置的
                AI 服务（可能产生 API 费用）
              </label>
              <button
                className="button primary"
                disabled={!consent}
                onClick={() => void generate()}
              >
                {busy ? "AI 正在整理建议…" : "生成 / 更新 AI 计划"}
              </button>
            </fieldset>
            <p className="muted">
              保存的资料不会自动发给
              AI；只有你点击生成才发送。新请求失败时保留上次计划。
            </p>
          </>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error} 草稿仍在；连接过期时请到设置重新连接。
          </p>
        )}
      </section>
      {current.plan && (
        <>
          {planStale && (
            <p className="ai-status-note" role="status">
              资料或规划条件已变化，请重新生成计划。下方菜单与英语建议仅供历史参考；当前热量审核范围以薄肌页为准。
            </p>
          )}
          <AIPlanHighlights plan={current.plan} />
        </>
      )}
    </div>
  );
}
