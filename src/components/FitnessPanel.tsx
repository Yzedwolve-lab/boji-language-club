"use client";
import { useEffect, useRef, useState } from "react";
import {
  Apple,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Coffee,
  Flame,
  Info,
  Leaf,
  NotebookPen,
  Save,
  Sun,
  Utensils,
  Footprints,
} from "lucide-react";
import {
  validateFitnessLog,
  estimateExerciseEnergy,
  type Profile,
} from "@/lib/domain";
import {
  estimateRecordedFood,
  fitnessQuality,
  validReflection,
  foodSpellingSuggestions,
} from "@/lib/fitness";
import type { FitnessState } from "@/lib/demo-store";
import FoodDialogue, { type FoodDialogueContent } from "./FoodDialogue";
import AINutritionView from "./AINutritionView";
import { selfHostedRequest } from "@/lib/ai-client";
import type { AINutritionResult, AIStarterPlan } from "@/lib/ai-types";
import {
  evaluateFitnessReview,
  FITNESS_REVIEW_VERSION,
  fitnessReviewFingerprint,
} from "@/lib/fitness-review";
import "./fitness.css";
export default function FitnessPanel({
  value,
  onChange,
  profile,
  disabled = false,
  aiMode = false,
  requireEnergyPlan = false,
  plan,
  onOpenPlan,
}: {
  value: FitnessState;
  onChange: (v: FitnessState, expected?: FitnessState) => void;
  profile: Profile;
  disabled?: boolean;
  aiMode?: boolean;
  requireEnergyPlan?: boolean;
  plan?: AIStarterPlan;
  onOpenPlan?: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [extra, setExtra] = useState(!!(value.snacks || value.drinks));
  const [dialogue, setDialogue] = useState<FoodDialogueContent | null>(null);
  const [aiBusy, setAIBusy] = useState(false);
  const [followupQuestions, setFollowupQuestions] = useState<
    Array<{ sourceText: string; question: string }>
  >([]);
  const request = useRef<AbortController | null>(null);
  const completionGuidance = useRef<HTMLDivElement | null>(null);
  const latestValue = useRef(value);
  useEffect(() => {
    latestValue.current = value;
  }, [value]);
  useEffect(() => () => request.current?.abort(), []);
  const [buddy, setBuddy] = useState<{
    mood: "ready" | "hint" | "win";
    line: string;
    help: string;
  } | null>(null);
  const update = (patch: Partial<FitnessState>, invalidate = false) => {
    const foodChanged = [
      "breakfast",
      "lunch",
      "dinner",
      "snacks",
      "drinks",
    ].some((key) => key in patch);
    onChange({
      ...value,
      ...patch,
      ...(invalidate
        ? {
            analyzed: false,
            completed: false,
            quality: 0,
            confirmed: false,
            reviewed: false,
            aiAnalysis: undefined,
            reviewVersion: undefined,
            clarificationAnswers: foodChanged ? [] : value.clarificationAnswers,
            clarificationDraftHistory:
              foodChanged && value.clarificationAnswers?.length
                ? [
                    ...(value.clarificationDraftHistory ?? []),
                    {
                      food: foodText,
                      answers: value.clarificationAnswers.map((answer) => ({
                        ...answer,
                      })),
                      archivedAt: new Date().toISOString(),
                    },
                  ]
                : value.clarificationDraftHistory,
            aiAnalysisHistory: value.aiAnalysis
              ? [...(value.aiAnalysisHistory ?? []), value.aiAnalysis].slice(
                  -20,
                )
              : value.aiAnalysisHistory,
          }
        : {}),
    });
    setSaved(false);
    setErrors({});
    if (invalidate) {
      setBuddy(null);
      request.current?.abort();
      setAIBusy(false);
      if (foodChanged) {
        setDialogue(null);
        setFollowupQuestions([]);
      }
    }
  };
  const foodText = [
    value.breakfast,
    value.lunch,
    value.dinner,
    value.snacks,
    value.drinks,
  ]
    .filter(Boolean)
    .join(", ");
  const estimate = estimateRecordedFood(foodText);
  const review = aiMode
    ? evaluateFitnessReview(value, plan, requireEnergyPlan)
    : null;
  function focusControl(id: string) {
    const control = document.getElementById(id);
    control?.scrollIntoView({ block: "center", behavior: "instant" });
    control?.focus({ preventScroll: true });
  }
  function openFoodFollowup() {
    setFollowupQuestions(value.aiAnalysis?.clarificationQuestions ?? []);
    setDialogue({
      kind: "followup",
      title: "One more clue, bestie 👀",
      message: "Tell me a little more about your food.",
      help: "用英文补充细节；不会覆盖原始记录。",
    });
  }
  let energy: ReturnType<typeof estimateExerciseEnergy> = null;
  try {
    if (value.met && value.activityMinutes)
      energy = estimateExerciseEnergy(
        Number(value.met),
        Number(value.activityMinutes),
        profile.weightKg,
      );
  } catch {
    /* Preserve invalid raw drafts; render unknown until corrected. */
  }
  async function analyze(
    ignoreSpelling = false,
    answers = value.clarificationAnswers ?? [],
  ) {
    if (aiBusy || disabled) return;
    const suggestions = foodSpellingSuggestions(foodText);
    if (!ignoreSpelling && suggestions.length) {
      setDialogue({
        kind: "spelling",
        title: "你的键盘是不是有自己的想法？🤨",
        message: "Close, bestie. Tiny typo, easy fix. ✍️",
        help: "发现几个常见拼写。可以改一下，也可以按原文继续；品牌和菜名不在这个小词表里，就不会被自动判错。",
        suggestions,
      });
      return;
    }
    // A user may explicitly keep a common typo. Validate its meaning using a
    // temporary copy; never replace the stored draft or estimate corrected food.
    const validationValue = { ...value };
    if (ignoreSpelling) {
      for (const field of [
        "breakfast",
        "lunch",
        "dinner",
        "snacks",
        "drinks",
      ] as const) {
        for (const { original, suggestion } of suggestions) {
          validationValue[field] = validationValue[field].replace(
            new RegExp(`\\b${original}\\b`, "gi"),
            suggestion,
          );
        }
      }
    }
    const result = validateFitnessLog({
      ...validationValue,
      activityMinutes: value.activityMinutes
        ? Number(value.activityMinutes)
        : undefined,
    });
    if (aiMode) {
      // The model can interpret unfamiliar English food names; local vocabulary
      // coverage must not prevent an authorized AI request for a genuine log.
      for (const field of ["breakfast", "lunch", "dinner", "snacks", "drinks"])
        if (result[field]?.includes("Please name a food")) delete result[field];
    }
    if (Object.keys(result).length) {
      setErrors(result);
      const combined = Object.values(result).join(" ");
      if (combined.includes("Please describe your meal or exercise in English"))
        setDialogue({
          kind: "english",
          title: "如果你没说对，那我不要和你说话 🙈",
          message: "English mode, bestie. Give me a little remix 😏",
          help: "嘴上这么说，草稿我已经替你留好了。把食物或运动改成英文，我们马上继续～",
        });
      else if (combined.includes("Log at least"))
        setDialogue({
          kind: "empty",
          title: "空白消息？这波我接不住 🫥",
          message: "Bestie, the chat is empty. Drop one log first ✨",
          help: "现在还没有可分析的记录。这不是说你没吃饭；写下一条食物或活动就可以。",
        });
      else if (
        combined.includes("Please name") ||
        combined.includes("Please describe the activity")
      )
        setDialogue({
          kind: "clarify",
          title: "新菜名，还是键盘 freestyle？🤔",
          message: "You lost me for a second. One more clue? 👀",
          help: "我还没识别出这条记录，不能断定你写错了。试着加上食物类别、份量或活动名称；原文已经保留。",
        });
      return;
    }
    if (aiMode && foodText.trim()) {
      const controller = new AbortController();
      request.current = controller;
      setAIBusy(true);
      if (dialogue?.kind !== "followup") setDialogue(null);
      setErrors({});
      const pendingValue: FitnessState = {
        ...value,
        analyzed: false,
        completed: false,
        confirmed: false,
        reviewed: false,
        clarificationAnswers: answers,
        reviewVersion: undefined,
        aiAnalysisHistory: value.aiAnalysis
          ? [...(value.aiAnalysisHistory ?? []), value.aiAnalysis].slice(-20)
          : value.aiAnalysisHistory,
      };
      onChange(pendingValue);
      try {
        const aiAnalysis = await selfHostedRequest<AINutritionResult>(
          "nutrition",
          {
            food: foodText,
            coverage: value.coverage ? "complete" : "partial",
            clarificationAnswers: answers,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (
          JSON.stringify(latestValue.current) !== JSON.stringify(pendingValue)
        )
          return;
        onChange(
          {
            ...pendingValue,
            analyzed: true,
            completed: false,
            confirmed: false,
            reviewed: false,
            aiAnalysis,
          },
          pendingValue,
        );
        setSaved(true);
        const questions = aiAnalysis.clarificationQuestions ?? [];
        if (questions.length) {
          setFollowupQuestions(questions);
          setDialogue({
            kind: "followup",
            title: "Hold up, bestie. One more detail? 👀",
            message: "A little context makes a better estimate.",
            help: "先补充这几个细节，我再估算。问题只针对不确定的地方；原始食物记录不会被改写。",
          });
        } else setDialogue(null);
        setBuddy({
          mood: questions.length ? "hint" : "win",
          line: questions.length
            ? "One more clue, then we do the math 🔎"
            : "Your AI brought receipts. Time to check them 🧾",
          help: "模型已返回解读。请核对份量、假设和未知项；原始食物记录没有被改写。",
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          setErrors({
            ai:
              error instanceof Error
                ? error.message
                : "AI 暂时没有回应，原始记录仍保留。",
          });
          setBuddy({
            mood: "hint",
            line: "The AI took a timeout. You didn’t fail 🫶",
            help: "这是服务状态，不是你的英语错了。记录仍在，可以重试；会话过期时到设置重新连接。",
          });
        }
      } finally {
        if (!controller.signal.aborted) setAIBusy(false);
      }
      return;
    }
    update({ analyzed: true, completed: false });
    setSaved(true);
    setDialogue(null);
    setBuddy(
      !foodText
        ? {
            mood: "win",
            line: "Movement logged. We see you 😎",
            help: "运动记录收到。没提供饮食，就不猜全天摄入。",
          }
        : estimate.kcal === null
          ? {
              mood: "hint",
              line: "I got the story. The calories? Not yet 🤔",
              help: "记录收到了，但这版演示还没有识别出可计算的份量。下面会明确显示“未估算”，不是 0。",
            }
          : estimate.partial
            ? {
                mood: "hint",
                line: "Some receipts found. Still a plot hole 🧾",
                help: `已算出 ${estimate.matchedItems.length} 项示例数据；还有内容未估算，不会冒充整餐热量。`,
              }
            : {
                mood: "win",
                line: "Numbers updated. We love receipts. 🧾✨",
                help: `已重新计算 ${estimate.matchedItems.length} 项示例数据。记录与复盘才是通关重点。`,
              },
    );
  }
  function complete() {
    if (aiBusy || disabled || value.completed) return;
    if (aiMode && !review?.canComplete) {
      setErrors({
        review: review?.message ?? "请先生成每日计划并核对饮食记录。",
      });
      requestAnimationFrame(() => {
        completionGuidance.current?.scrollIntoView({
          block: "center",
          behavior: "instant",
        });
        completionGuidance.current?.focus({ preventScroll: true });
      });
      return;
    }
    if (
      !value.confirmed ||
      !value.reviewed ||
      !validReflection(value.reflection)
    ) {
      setErrors({
        reflection: "请确认记录与反馈，再写一句至少 4 个单词的可行英文反思。",
      });
      setDialogue({
        kind: "reflection",
        title: "先别跑路，还有一句话啦 👀",
        message: "One tiny reflection. Then we call it a win ✨",
        help: "确认你读过反馈，再写一句至少 4 个单词的英文小行动，例如：I will note the portion size next time.",
      });
      return;
    }
    update({
      completed: true,
      ...(aiMode
        ? {
            reviewVersion: FITNESS_REVIEW_VERSION,
            reviewKey: fitnessReviewFingerprint(value, plan),
          }
        : {}),
      quality: fitnessQuality(
        true,
        value.confirmed,
        value.reviewed,
        value.reflection,
      ),
    });
    setBuddy({
      mood: "win",
      line: "Solid work, bestie. That’s a habit W 🏆",
      help: "薄肌活动完成！40 XP 等你和语言任务一起领取。记录得认真，比数字好看更重要。",
    });
  }
  const hasDraft = Boolean(foodText.trim() || value.activity.trim());
  const activeBuddy =
    buddy ??
    (value.completed
      ? {
          mood: "win",
          line: "Solid work, bestie. That’s a habit W 🏆",
          help: "薄肌活动完成，40 XP 待领取。去语言区接着拿下～",
        }
      : value.analyzed && aiMode
        ? {
            mood: "hint",
            line: "Keep the log. Check the assumptions. 🧾",
            help: "AI 解读来自你配置的服务；没有响应的数据保持未知，原文始终保留。",
          }
        : value.analyzed
          ? {
              mood: "hint",
              line:
                estimate.kcal === null
                  ? "The log is saved. The math is still loading… conceptually 🤔"
                  : "Your food diary has receipts 🧾",
              help:
                estimate.kcal === null
                  ? "没有可估算的食物数据；原始记录保留，不会用 0 敷衍你。"
                  : "下方数字仅是明确识别出的演示条目；未识别内容另列说明。",
            }
          : {
              mood: "ready",
              line: "Food diary, but make it English. 🍳",
              help: hasDraft
                ? "看到你的输入了。点“查看记录反馈”，我再重新计算；现在不会沿用旧数字。"
                : "用英文记一餐或者一次活动。拼写翻车没关系，我们一起修。",
            });
  return (
    <div className="fitness-panel">
      <div className="section-intro">
        <div>
          <p className="eyebrow">BODY MODE · LET’S LOG THIS 💪</p>
          <h2>今天吃了啥？交出英文日记 🍳</h2>
          <p className="muted">
            我可以嘴贫，记录必须真实。Let’s do this, bestie.
          </p>
        </div>
        <span className="soft-badge green">
          <Leaf size={14} />
          记录与维持习惯
        </span>
      </div>
      <div
        className={`food-buddy ${activeBuddy.mood}`}
        role="status"
        aria-live="polite"
      >
        <span className="food-buddy-face" aria-hidden="true">
          {activeBuddy.mood === "win"
            ? "😎"
            : activeBuddy.mood === "hint"
              ? "🤔"
              : "👋"}
        </span>
        <div>
          <span className="food-buddy-name">BOJI · 你的嘴硬搭子</span>
          <strong>{activeBuddy.line}</strong>
          <p>{activeBuddy.help}</p>
        </div>
      </div>
      {aiMode ? (
        <>
          {(review?.status === "plan_required" || !plan) && (
            <div className="fitness-plan-prompt">
              <strong>先定今天的计划，再来核对饮食 🎯</strong>
              <p>
                填写身高、体重、活动和目标，生成可核对的每日饮食与英语安排。
              </p>
              <button className="button primary" onClick={onOpenPlan}>
                填写资料并生成每日计划
                <ArrowRight size={17} />
              </button>
            </div>
          )}
          <AINutritionView
            result={
              value.analyzed && value.aiAnalysis?.originalFood === foodText
                ? value.aiAnalysis
                : undefined
            }
            busy={aiBusy}
            analyzed={value.analyzed}
            review={review ?? undefined}
            coverage={value.coverage}
            onCoverageChange={(coverage) => update({ coverage }, true)}
            disabled={disabled}
          />
          {!!value.aiAnalysis?.clarificationQuestions?.length &&
            value.aiAnalysis.originalFood === foodText && (
              <button
                className="button secondary fitness-clarify-button"
                disabled={aiBusy || disabled}
                onClick={openFoodFollowup}
              >
                补充食物细节 · Continue the chat
              </button>
            )}
        </>
      ) : (
        <>
          <div className="tracking-banner">
            <Info size={18} />
            <div>
              <strong>记录模式 · 没接 AI，也不装懂 🤖</strong>
              <p>
                目前是有限食物样例的演示计算。可以在设置中连接个人自托管
                AI；未识别的食物不会被悄悄算成 0。
              </p>
            </div>
          </div>
          <div className="nutrient-grid">
            {[
              ["已估算部分热量", "kcal", estimate.kcal, Flame],
              ["碳水化合物", "g", estimate.carbs, Apple],
              ["蛋白质", "g", estimate.protein, Utensils],
              ["脂肪", "g", estimate.fat, Leaf],
            ].map(([title, unit, amount, Icon]) => {
              const Mark = Icon as typeof Flame;
              return (
                <div
                  className="nutrient-stat"
                  key={String(title)}
                  data-estimate-state={
                    !value.analyzed
                      ? "pending"
                      : amount === null
                        ? "unestimated"
                        : estimate.partial
                          ? "partial"
                          : "estimated"
                  }
                >
                  <Mark size={16} />
                  <small>{String(title)}</small>
                  <div>
                    <strong
                      className={
                        !value.analyzed || amount === null ? "metric-label" : ""
                      }
                      data-testid={`nutrition-${String(unit) === "kcal" ? "kcal" : String(title)}`}
                    >
                      {value.analyzed && amount !== null
                        ? Math.round(Number(amount))
                        : !value.analyzed
                          ? "待分析"
                          : "未估算"}
                    </strong>
                    {value.analyzed && amount !== null && (
                      <span>{String(unit)}</span>
                    )}
                  </div>
                  <p className="metric-state">
                    {!value.analyzed
                      ? "修改后需重新分析"
                      : amount === null
                        ? "未知 ≠ 0"
                        : estimate.partial
                          ? "仅部分条目 · 示例"
                          : "本次记录 · 示例"}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="estimate-explainer">
            <details
              open={value.analyzed && estimate.partial ? true : undefined}
            >
              <summary>热量为什么有时没变？👀</summary>
              <p>
                现在没有真实 AI。只会计算少量明确份量的演示条目，比如{" "}
                <strong>2 boiled eggs</strong>、
                <strong>100 g cooked rice</strong>、
                <strong>100 g raw rice</strong>、<strong>150 g chicken</strong>{" "}
                或 <strong>40 g oats</strong>
                。你写的其他食物照样保存，但不会编一个热量。
              </p>
              <p>
                这些数字来自预设演示样例，不是食物数据库结果，也不是全天摄入。改了输入后，先显示“待分析”；点击“查看记录反馈”才会更新。
              </p>
              {value.analyzed && (
                <>
                  <div className="estimate-breakdown">
                    {estimate.matchedItems.map((item, i) => (
                      <div key={`${item.description}-${i}`}>
                        <span>{item.description}</span>
                        <strong>
                          {Math.round(item.nutrients.kcal)} kcal{" "}
                          <small>示例</small>
                        </strong>
                      </div>
                    ))}
                  </div>
                  {estimate.partial && (
                    <p className="unknown-food">
                      <strong>还没估算：</strong>
                      {estimate.unestimatedText || "份量不明确的条目"}
                      。补充份量，或先保留记录。
                    </p>
                  )}
                </>
              )}
            </details>
          </div>
        </>
      )}
      <section className="panel meal-editor">
        <div className="panel-heading">
          <div>
            <span className="icon-box">
              <NotebookPen size={19} />
            </span>
            <div>
              <h3>把今天的菜单丢过来 👇</h3>
              <p>ENGLISH MODE: ON</p>
            </div>
          </div>
          <span className="tiny muted">
            <span className="live-dot" />
            草稿自动保存在本机
          </span>
        </div>
        <fieldset disabled={disabled || aiBusy} className="bare-fieldset">
          <div className="meal-fields">
            {(
              [
                [
                  "breakfast",
                  "Breakfast",
                  "早餐",
                  Coffee,
                  "e.g. 2 boiled eggs and 40 g oats",
                ],
                [
                  "lunch",
                  "Lunch",
                  "午餐",
                  Sun,
                  "e.g. 150 g cooked rice and 200 g grilled chicken",
                ],
                [
                  "dinner",
                  "Dinner",
                  "晚餐",
                  Utensils,
                  "e.g. a small bowl of mapo tofu",
                ],
              ] as const
            ).map(([key, title, cn, Icon]) => (
              <label className="meal-field" key={key}>
                <span className="meal-label">
                  <Icon size={17} />
                  <strong>{title}</strong>
                  <small>{cn} · 选填</small>
                </span>
                <textarea
                  aria-label={title}
                  rows={2}
                  value={value[key]}
                  onChange={(e) => update({ [key]: e.target.value }, true)}
                  placeholder={
                    cn === "早餐"
                      ? "Drop your breakfast: 2 boiled eggs and 40 g oats"
                      : title === "Lunch"
                        ? "Lunch plot: 150 g cooked rice and 200 g chicken"
                        : "Dinner reveal: a small bowl of mapo tofu"
                  }
                />
                <small className="input-example">
                  {title === "Breakfast"
                    ? "Tiny sentence. Big diary energy. 🍳"
                    : title === "Lunch"
                      ? "Got the portion? Drop it here. 🧾"
                      : "No perfect meals. Just honest logs. ✨"}
                </small>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="text-button extra-toggle"
            onClick={() => setExtra(!extra)}
          >
            <ChevronDown size={16} />
            {extra ? "收起" : "添加"} Snacks / Drinks{" "}
            <span className="muted">零食与饮品</span>
          </button>
          {extra && (
            <div className="form-grid">
              {(["snacks", "drinks"] as const).map((key) => (
                <label className="field" key={key}>
                  {key === "snacks" ? "Snacks" : "Drinks"}
                  <textarea
                    value={value[key]}
                    onChange={(e) => update({ [key]: e.target.value }, true)}
                    placeholder={
                      key === "snacks"
                        ? "e.g. one apple"
                        : "e.g. a cup of coffee with milk"
                    }
                  />
                </label>
              ))}
            </div>
          )}
          <div className="exercise-heading">
            <Footprints size={19} />
            <div>
              <h3>Movement & rest</h3>
              <p>散步也行，休息也行。No guilt, just logs. 😌</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field full">
              Cardio / Activity <span>选填</span>
              <input
                value={value.activity}
                onChange={(e) => update({ activity: e.target.value }, true)}
                placeholder="e.g. Brisk walking, jogging, or rest day"
              />
            </label>
            <label className="field">
              Duration · minutes
              <input
                type="number"
                min="0"
                max="600"
                value={value.activityMinutes}
                onChange={(e) =>
                  update({ activityMinutes: e.target.value }, true)
                }
                placeholder="运动时填写，休息日可留空"
              />
            </label>
            <label className="field">
              MET assumption <span>可选</span>
              <input
                type="number"
                min="1"
                max="20"
                step="0.1"
                value={value.met}
                onChange={(e) => update({ met: e.target.value }, true)}
                placeholder="仅在已知活动 MET 时填写"
              />
            </label>
          </div>
          <p className="tiny muted">
            {profile.weightKg === null
              ? "未提供体重：无法个性化估算运动消耗。"
              : energy
                ? `按你提供的 MET 假设估算：总消耗约 ${Math.round(energy.grossKcal)} kcal，额外消耗约 ${Math.round(energy.netKcal)} kcal。`
                : "强度不确定时，运动消耗保持未知。"}{" "}
            不以运动抵扣饮食。
          </p>
          <div className="meal-actions">
            <button
              className="button secondary"
              onClick={() => {
                setSaved(true);
                setBuddy({
                  mood: "win",
                  line: "Saved. Your diary has a backup bestie 🫶",
                  help: "原始记录保留好了。英文分析慢慢来，不用为了通关改掉真实吃过的食物。",
                });
              }}
            >
              <Save size={15} />
              保存原始记录
            </button>
            <button
              id="fitness-analyze-record"
              className="button primary"
              onClick={() => analyze()}
            >
              {aiBusy
                ? "AI 正在解读…"
                : aiMode
                  ? "AI 解读这份记录"
                  : "查看记录反馈"}
              <ArrowRight size={16} />
            </button>
          </div>
        </fieldset>
        {saved && (
          <p className="saved-hint" role="status">
            <CheckCircle2 size={15} />
            记录已保存在此浏览器。不因摄入高低阻止保存。
          </p>
        )}
        {Object.keys(errors).some((key) => key !== "review") && (
          <div className="error-box" role="alert">
            {Object.entries(errors)
              .filter(([key]) => key !== "review")
              .map(([key, error]) => (
                <p key={key}>{error}</p>
              ))}
            <p>
              草稿已保留。例如：2 boiled eggs / Brisk walking for 30 minutes.
            </p>
          </div>
        )}
      </section>
      {(aiMode || value.analyzed) && (
        <section className="panel reflection-panel">
          <div className="panel-heading">
            <div>
              <span className="icon-box green">
                <ClipboardCheck size={20} />
              </span>
              <div>
                <h3>
                  {aiMode
                    ? "核对今天的记录，再写一句复盘 🧾"
                    : "最后一句，今天就算你赢 ✨"}
                </h3>
                <p>REFLECT, DON’T ROAST YOURSELF</p>
              </div>
            </div>
            <span className="soft-badge">
              {aiMode ? "模型解读 · 请核对" : "演示反馈"}
            </span>
          </div>
          <div className="feedback-copy">
            <p>
              {aiMode
                ? review?.message
                : foodText
                  ? "已保存你的饮食记录。没有适用的营养目标，计划贴合度为“未评价”。"
                  : "未提供饮食，无法评价全天摄入。活动记录仍可用于完成复盘。"}
            </p>
            <p>
              记录不完整时，不把未记录部分当作
              0。保持真实记录，无需补偿运动，也无需为了通关修改实际吃过的食物。
            </p>
            {foodText && !aiMode && (
              <details>
                <summary>查看演示份量假设与不确定性</summary>
                <ul>
                  {estimate.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
                {estimate.partial && (
                  <p>
                    有未估算内容：上述数字只包含支持的条目；碗的大小、调味料与油量仍需补充。
                  </p>
                )}
                <label className="field">
                  Portion notes · 份量补充
                  <input
                    disabled={disabled || value.completed}
                    value={value.portionNote}
                    onChange={(e) =>
                      update({ portionNote: e.target.value, confirmed: false })
                    }
                    placeholder="e.g. one bowl = about 150 g cooked rice"
                  />
                </label>
                <small>
                  份量补充随记录保存；重新估算请在原文中使用明确的 g 数量。
                </small>
              </details>
            )}
          </div>
          <fieldset
            className="bare-fieldset"
            disabled={disabled || value.completed || aiBusy}
          >
            {!aiMode && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={value.coverage}
                  onChange={(e) =>
                    update({ coverage: e.target.checked }, aiMode)
                  }
                />
                这是全天完整记录（选填，不影响经验）
              </label>
            )}
            <label className="check-label">
              <input
                type="checkbox"
                checked={value.confirmed}
                onChange={(e) => update({ confirmed: e.target.checked })}
              />
              我已核对原文与假设，理解未知项未被估算
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={value.reviewed}
                onChange={(e) => update({ reviewed: e.target.checked })}
              />
              我已读完反馈，知道任务依据真实记录与复盘完成
            </label>
            <label className="field reflection-field">
              One small step for tomorrow
              <textarea
                value={value.reflection}
                onChange={(e) => update({ reflection: e.target.value })}
                placeholder="e.g. I will note the portion size next time."
                rows={2}
              />
              <small className="muted">
                写一句至少 4
                个英文单词的可行反思；草稿随输入保留，不需要少吃或额外运动。
              </small>
            </label>
            {aiBusy && (
              <p role="status">AI 正在解读，复盘草稿已保留，返回后继续填写。</p>
            )}
            {aiMode && !value.completed && review && !review.canComplete && (
              <div
                ref={completionGuidance}
                id="fitness-completion-guidance"
                data-testid="fitness-completion-guidance"
                className="fitness-completion-guidance"
                tabIndex={-1}
                role={errors.review ? "alert" : undefined}
              >
                <strong>
                  {errors.review
                    ? "还差这一步，记录没有丢 👀"
                    : "完成前还需要核对"}
                </strong>
                <p>{review.message}</p>
                <p className="muted">
                  复盘可以先写并保留；满足审核条件后才标记任务完成。
                </p>
                {review.status === "plan_required" ? (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={onOpenPlan}
                  >
                    去生成 / 更新计划
                  </button>
                ) : review.status === "partial" ? (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => focusControl("fitness-day-complete")}
                  >
                    确认全天记录
                  </button>
                ) : review.status === "needs_clarification" ? (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={openFoodFollowup}
                  >
                    回答食物追问
                  </button>
                ) : review.status === "pending_analysis" ? (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => focusControl("fitness-analyze-record")}
                  >
                    去分析当前记录
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      const field = document.querySelector<HTMLTextAreaElement>(
                        '.fitness-panel textarea[aria-label="Breakfast"]',
                      );
                      field?.scrollIntoView({
                        block: "center",
                        behavior: "instant",
                      });
                      field?.focus({ preventScroll: true });
                    }}
                  >
                    查看食物记录
                  </button>
                )}
              </div>
            )}
            <button
              className={`button ${value.completed ? "success" : "primary"}`}
              onClick={complete}
              disabled={aiBusy || disabled || value.completed}
              aria-describedby={
                aiMode && !value.completed && !review?.canComplete
                  ? "fitness-completion-guidance"
                  : undefined
              }
            >
              {value.completed ? (
                <>
                  <Check size={17} />
                  薄肌活动已完成 · 40 XP 待领取
                </>
              ) : (
                <>
                  完成记录与复盘
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </fieldset>
        </section>
      )}
      {dialogue && (
        <FoodDialogue
          content={dialogue}
          onClose={() => setDialogue(null)}
          onKeepOriginal={
            dialogue.kind === "spelling" ? () => analyze(true) : undefined
          }
          busy={aiBusy}
          questions={followupQuestions.map((question) => ({
            ...question,
            answer:
              value.clarificationAnswers?.find(
                (answer) =>
                  answer.sourceText === question.sourceText &&
                  answer.question === question.question,
              )?.answer ?? "",
          }))}
          onAnswerChange={(index, answer) => {
            const question = followupQuestions[index];
            const previous = value.clarificationAnswers ?? [];
            onChange({
              ...value,
              analyzed: false,
              completed: false,
              quality: 0,
              confirmed: false,
              reviewed: false,
              reviewVersion: undefined,
              clarificationAnswers: [
                ...previous.filter(
                  (item) =>
                    item.sourceText !== question.sourceText ||
                    item.question !== question.question,
                ),
                { ...question, answer },
              ],
            });
            setErrors({});
          }}
          onSubmitAnswers={() => {
            const answers = followupQuestions.map((question) => ({
              ...question,
              answer:
                value.clarificationAnswers
                  ?.find(
                    (item) =>
                      item.sourceText === question.sourceText &&
                      item.question === question.question,
                  )
                  ?.answer.trim() ?? "",
            }));
            if (
              answers.some(
                (item) =>
                  !/[a-z]/i.test(item.answer) ||
                  /[\u4e00-\u9fff]/.test(item.answer),
              )
            ) {
              setErrors({
                clarification:
                  "English, bestie ✍️ 请用英文回答每个问题，原文和回答都会保留。",
              });
              return;
            }
            const allAnswers = [
              ...(value.clarificationAnswers ?? []).filter(
                (item) =>
                  !answers.some(
                    (answer) =>
                      answer.sourceText === item.sourceText &&
                      answer.question === item.question,
                  ),
              ),
              ...answers,
            ];
            if (allAnswers.length > 3) {
              setErrors({
                clarification:
                  "这条记录已累计较多补充。请返回上方食物记录，把确认的份量和做法写成更完整的英文描述，再重新分析；旧分析和回答会保留在历史中。",
              });
              return;
            }
            void analyze(true, allAnswers);
          }}
          onEditOriginal={() => {
            setDialogue(null);
            requestAnimationFrame(() => {
              const field =
                document.querySelector<HTMLTextAreaElement>(
                  '.fitness-panel textarea[aria-label="Breakfast"]',
                ) ??
                document.querySelector<HTMLTextAreaElement>(
                  ".fitness-panel .meal-card textarea",
                );
              field?.focus();
              field?.scrollIntoView({ behavior: "smooth", block: "center" });
            });
          }}
          error={errors.clarification || errors.ai}
        />
      )}
    </div>
  );
}
