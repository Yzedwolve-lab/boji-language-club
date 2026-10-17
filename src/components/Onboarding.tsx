"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Sparkles,
  ShieldCheck,
  Timer,
  Target,
  BookOpen,
  UserRound,
  Activity,
} from "lucide-react";
import {
  GOALS,
  TIME_TEMPLATES,
  validateProfile,
  type Profile,
  type ExamType,
} from "@/lib/domain";
import { defaultProfile } from "@/lib/demo-store";
import type { AIOnboardingResult, AIStarterPlan } from "@/lib/ai-types";
import AIConnectionStep from "./AIConnectionStep";
import "./onboarding-ai.css";

const emptyAIPreferences: AIOnboardingResult["preferences"] = {
  activityLevel: "unspecified",
  energyGoal: "gentle_loss",
  calculationSex: "unspecified",
  nutritionEligibility: "unspecified",
  dietaryPreferences: "",
  allergies: "",
};
const englishWordCount = (text: string) =>
  (text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;

const steps = ["认识你", "英语起点", "选择目标", "领取会员卡"];
const examOptions: Array<[ExamType, string]> = [
  ["none", "不提供成绩"],
  ["ielts", "IELTS · 0–9"],
  ["pte_academic", "PTE Academic · 10–90"],
  ["toefl_legacy_total", "TOEFL 旧制 · 0–120"],
  ["toefl_2026_band", "TOEFL 2026 新制 · 1–6"],
  ["cet4", "CET-4"],
  ["cet6", "CET-6"],
];
export default function Onboarding({
  onComplete,
}: {
  onComplete: (p: Profile, aiSetup?: AIOnboardingResult) => void;
}) {
  const [profile, setProfile] = useState<Profile>({
    ...defaultProfile(),
    age: 0,
  });
  const [step, setStep] = useState(-1);
  const [aiMode, setAIMode] = useState<AIOnboardingResult["mode"]>("demo");
  const [preferences, setPreferences] = useState(emptyAIPreferences);
  const [englishSample, setEnglishSample] = useState("");
  const [planConsent, setPlanConsent] = useState(false);
  const [planFailed, setPlanFailed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      const draft = localStorage.getItem("boji.onboarding.draft");
      if (draft) setProfile(JSON.parse(draft));
      else
        setProfile((p) => ({
          ...p,
          timeZone:
            Intl.DateTimeFormat().resolvedOptions().timeZone ||
            "Australia/Brisbane",
        }));
      const aiDraft = localStorage.getItem("boji.onboarding.ai-draft");
      if (aiDraft) {
        const parsed = JSON.parse(aiDraft);
        if (parsed.preferences && typeof parsed.preferences === "object") {
          setPreferences({
            activityLevel: [
              "unspecified",
              "sedentary",
              "light",
              "moderate",
              "active",
            ].includes(parsed.preferences.activityLevel)
              ? parsed.preferences.activityLevel
              : "unspecified",
            energyGoal: ["gentle_loss", "maintain", "tracking"].includes(
              parsed.preferences.energyGoal,
            )
              ? parsed.preferences.energyGoal
              : "gentle_loss",
            calculationSex: ["male", "female", "unspecified"].includes(
              parsed.preferences.calculationSex,
            )
              ? parsed.preferences.calculationSex
              : "unspecified",
            nutritionEligibility: [
              "standard_adult",
              "specialist_guidance",
              "unspecified",
            ].includes(parsed.preferences.nutritionEligibility)
              ? parsed.preferences.nutritionEligibility
              : "unspecified",
            dietaryPreferences:
              typeof parsed.preferences.dietaryPreferences === "string"
                ? parsed.preferences.dietaryPreferences.slice(0, 1000)
                : "",
            allergies:
              typeof parsed.preferences.allergies === "string"
                ? parsed.preferences.allergies.slice(0, 1000)
                : "",
          });
        }
        if (typeof parsed.englishSample === "string")
          setEnglishSample(parsed.englishSample.slice(0, 4000));
      }
    } catch {
      /* No personal data is required to keep trying. */
    }
  }, []);
  const update = (patch: Partial<Profile>) => {
    const next = { ...profile, ...patch };
    setProfile(next);
    setErrors({});
    try {
      localStorage.setItem("boji.onboarding.draft", JSON.stringify(next));
    } catch {
      setErrors({
        storage: "浏览器暂不能保存草稿，当前输入仍保留在页面中。请勿关闭页面。",
      });
    }
  };
  function updateAIDraft(
    nextPreferences = preferences,
    nextSample = englishSample,
  ) {
    setPreferences(nextPreferences);
    setEnglishSample(nextSample);
    setErrors({});
    setPlanFailed(false);
    try {
      localStorage.setItem(
        "boji.onboarding.ai-draft",
        JSON.stringify({
          preferences: nextPreferences,
          englishSample: nextSample,
        }),
      );
    } catch {
      setErrors({
        storage: "浏览器暂不能保存草稿，当前输入仍保留在页面中。请勿关闭页面。",
      });
    }
  }

  async function join(p = profile, useAI = aiMode === "self_hosted") {
    if (useAI && !planConsent) {
      setErrors({ consent: "先确认下面的资料发送说明，再让 AI 开工 🤝" });
      return;
    }
    if (useAI && englishSample.trim() && englishWordCount(englishSample) < 20) {
      setErrors({
        englishSample: "英文样本需要至少 20 个英文单词；也可以清空后跳过。",
      });
      setStep(1);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      const data = await response.json();
      if (!response.ok) {
        setErrors(
          data.errors || { form: data.error || "资料未通过验证，请检查输入。" },
        );
        return;
      }
      const validatedProfile: Profile = data.profile || p;
      let plan: AIStarterPlan | undefined;
      if (useAI) {
        const planResponse = await fetch("/api/self-hosted/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: validatedProfile,
            preferences,
            englishSample,
          }),
        });
        const planData = await planResponse.json();
        if (!planResponse.ok) {
          setPlanFailed(true);
          setErrors({
            form:
              typeof planData.message === "string"
                ? planData.message
                : "AI 计划暂未生成，资料已保留。可以重试，或先进入记录模式。",
          });
          return;
        }
        plan = planData as AIStarterPlan;
      }
      try {
        localStorage.removeItem("boji.onboarding.draft");
        localStorage.removeItem("boji.onboarding.ai-draft");
      } catch {
        /* In-memory onboarding still works when storage is unavailable. */
      }
      onComplete(validatedProfile, {
        mode: useAI ? "self_hosted" : "demo",
        preferences: p !== profile && !useAI ? emptyAIPreferences : preferences,
        englishSample: p !== profile && !useAI ? "" : englishSample,
        ...(plan ? { plan } : {}),
      });
    } catch {
      if (useAI) setPlanFailed(true);
      setErrors({ form: "服务连接失败，草稿已保留，请重试。" });
    } finally {
      setBusy(false);
    }
  }
  function next() {
    const all = validateProfile(profile);
    const fields =
      step === 0
        ? [
            "nickname",
            "age",
            "weightKg",
            "heightCm",
            "bodyFatPercent",
            "timeZone",
            "timeBudget",
          ]
        : step === 1
          ? [
              "examScore",
              "examType",
              "examDate",
              "comparableToeflScore",
              "cetStatus",
            ]
          : [];
    const selected = Object.fromEntries(
      Object.entries(all).filter(([key]) => fields.includes(key)),
    );
    if (
      step === 1 &&
      aiMode === "self_hosted" &&
      englishSample.trim() &&
      englishWordCount(englishSample) < 20
    ) {
      selected.englishSample =
        "英文样本需要至少 20 个英文单词；也可以清空后跳过。";
    }
    if (Object.keys(selected).length) {
      setErrors(selected);
      return;
    }
    setStep(step + 1);
  }
  const goal = GOALS.find((g) => g.id === profile.goal)!;
  const template = TIME_TEMPLATES[profile.timeBudget];
  const fieldError = (name: string) =>
    errors[name] ? (
      <small className="field-error" role="alert">
        {errors[name]}
      </small>
    ) : null;
  return (
    <div className="onboarding-shell">
      <header className="welcome-top">
        <Link className="brand" href="/">
          <span className="brand-mark">
            B<span>↗</span>
          </span>
          <span>
            薄肌语言俱乐部<small>BOJI LANGUAGE CLUB</small>
          </span>
        </Link>
        <span className="outline-pill">
          <span className="live-dot" />{" "}
          {aiMode === "self_hosted"
            ? "YOUR AI / 个人自托管"
            : "BOJI / 先选你的模式"}
        </span>
      </header>
      <main className="onboarding-layout">
        <section className="welcome-story">
          <p className="eyebrow">
            <span /> A LITTLE BETTER, EVERY DAY
          </p>
          <h1>
            练习表达。
            <br />
            记录生活。
            <br />
            <em>成为更好的自己。</em>
          </h1>
          <p className="welcome-copy">
            不必一开始就很厉害。
            <br />
            从今天的一餐、一句英文开始，
            <br />
            让每一次认真，都被看见。
          </p>
          <div className="welcome-benefits">
            <span>
              <Activity size={17} />
              薄肌 · 真实记录
            </span>
            <span>
              <BookOpen size={17} />
              语言 · 每日五练
            </span>
          </div>
          <div className="mini-membership">
            <span className="card-topline">
              BOJI CLUB <span>MEMBERSHIP</span>
            </span>
            <span className="mini-orbit" />
            <strong>{goal.label}</strong>
            <div>
              <span>SILVER / 银色</span>
              <span>NO. BJ—YOUR—STORY</span>
            </div>
          </div>
          <p className="tiny muted">
            <ShieldCheck size={13} />{" "}
            {aiMode === "self_hosted"
              ? "资料与计划保存在此浏览器；AI 请求通过你自己的服务端发送。"
              : "记录模式仅保存在此浏览器。体验时建议使用虚构资料。"}
          </p>
        </section>
        <section className="onboarding-form panel">
          {step === -1 ? (
            <AIConnectionStep
              busy={busy}
              continueLabel="已连接，继续填写资料"
              onConnected={() => {
                setAIMode("self_hosted");
                setStep(0);
                setErrors({});
              }}
              onSkip={() => {
                setAIMode("demo");
                setStep(0);
                setErrors({});
              }}
              onDemo={() =>
                void join(
                  {
                    ...defaultProfile(),
                    nickname: "薄肌练习生",
                    age: 25,
                    goal: "member",
                  },
                  false,
                )
              }
            />
          ) : (
            <>
              <button
                className="text-button ai-onboarding-switch"
                type="button"
                disabled={busy}
                onClick={() => {
                  setStep(-1);
                  setErrors({});
                }}
              >
                <ArrowLeft size={16} />
                {aiMode === "self_hosted"
                  ? "AI 已连接 · 管理连接"
                  : "当前为记录模式 · 连接 AI"}
              </button>
              <div className="step-indicator">
                {steps.map((label, i) => (
                  <div
                    key={label}
                    className={i === step ? "current" : i < step ? "done" : ""}
                  >
                    <span>{i < step ? <Check size={14} /> : i + 1}</span>
                    <small>{label}</small>
                  </div>
                ))}
              </div>
              <div className="step-body" key={step} inert={busy}>
                <p className="eyebrow">STEP 0{step + 1} / 04</p>
                <h2>
                  {
                    [
                      "先从认识你开始",
                      "每个起点，都值得认真",
                      "选择你想靠近的目标",
                      "你的俱乐部旅程，准备好了",
                    ][step]
                  }
                </h2>
                <p className="muted">
                  {
                    [
                      "这里不需要完美的数字，只需要真实的你。",
                      "成绩是自报背景，不是官方认证；也可以从零开始。",
                      "目标是一种方向，会员卡材质由日常积累决定。",
                      "从银卡开始，把每天的小行动变成可见的成长。",
                    ][step]
                  }
                </p>
                {step === 0 && (
                  <>
                    <div className="form-grid">
                      <label className="field full">
                        俱乐部昵称 <span>选填</span>
                        <input
                          autoComplete="nickname"
                          value={profile.nickname}
                          onChange={(e) => update({ nickname: e.target.value })}
                          placeholder="给自己起个喜欢的名字"
                          maxLength={24}
                        />
                        {fieldError("nickname")}
                      </label>
                      <label className="field">
                        年龄
                        <input
                          type="number"
                          min="1"
                          max="120"
                          value={profile.age || ""}
                          onChange={(e) =>
                            update({
                              age: e.target.value ? Number(e.target.value) : 0,
                            })
                          }
                          placeholder="请输入整数年龄"
                        />
                        {fieldError("age")}
                      </label>
                      <label className="field">
                        性别
                        <select
                          value={profile.gender}
                          onChange={(e) =>
                            update({
                              gender: e.target.value as Profile["gender"],
                            })
                          }
                        >
                          <option value="unspecified">不提供</option>
                          <option value="male">男</option>
                          <option value="female">女</option>
                        </select>
                      </label>
                    </div>
                    <fieldset className="choice-field">
                      <legend>每天给自己多少时间？</legend>
                      <div className="time-choices">
                        {([30, 60, 120, 240] as const).map((time) => (
                          <button
                            type="button"
                            className={
                              profile.timeBudget === time ? "selected" : ""
                            }
                            onClick={() => update({ timeBudget: time })}
                            key={time}
                          >
                            <strong>{time}</strong>
                            <span>分钟 / 天</span>
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <details
                      className="optional-details"
                      open={aiMode === "self_hosted" || undefined}
                    >
                      <summary>
                        身体资料与时区{" "}
                        <span>
                          {aiMode === "self_hosted"
                            ? "生成饮食范围需身高、体重"
                            : "可选 · 不影响升级"}
                        </span>
                      </summary>
                      <div className="form-grid">
                        {(
                          [
                            ["weightKg", "体重 kg"],
                            ["heightCm", "身高 cm"],
                            ["bodyFatPercent", "体脂 %"],
                          ] as const
                        ).map(([key, label]) => (
                          <label className="field" key={key}>
                            {label}
                            <input
                              type="number"
                              step="0.1"
                              value={profile[key] ?? ""}
                              placeholder="未知可留空"
                              onChange={(e) =>
                                update({
                                  [key]:
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value),
                                })
                              }
                            />
                            {fieldError(key)}
                          </label>
                        ))}
                        {aiMode === "demo" && (
                          <label className="field">
                            日常活动量
                            <select
                              value={profile.activityLevel}
                              onChange={(e) =>
                                update({ activityLevel: e.target.value })
                              }
                            >
                              <option value="">不提供</option>
                              <option value="sedentary">久坐</option>
                              <option value="light">轻度</option>
                              <option value="moderate">中度</option>
                              <option value="high">较高</option>
                            </select>
                          </label>
                        )}
                        <label className="field full">
                          训练时区
                          <input
                            value={profile.timeZone}
                            onChange={(e) =>
                              update({ timeZone: e.target.value })
                            }
                          />
                          {fieldError("timeZone")}
                        </label>
                      </div>
                      <p className="tiny muted">
                        身体资料可随时不提供。AI
                        会标明缺少的依据，不从资料直接断言体脂变化。本版能量公式用于符合条件的
                        19–78 岁成人；不适用时保留记录与学习。
                      </p>
                      {aiMode === "demo" && (
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={profile.healthConsent}
                            onChange={(e) =>
                              update({ healthConsent: e.target.checked })
                            }
                          />
                          我愿意在策略通过审核后，自主选择健康建议（当前不启用）
                        </label>
                      )}
                    </details>
                    {aiMode === "self_hosted" && (
                      <div className="ai-profile-extra">
                        <label className="check-label ai-health-choice">
                          <input
                            type="checkbox"
                            checked={profile.healthConsent}
                            onChange={(event) =>
                              update({ healthConsent: event.target.checked })
                            }
                          />
                          我愿意让 AI 结合我提供的资料给出一般饮食建议
                        </label>
                        <p className="ai-privacy-note">
                          可选。不勾选仍可生成英语计划。先估算日常消耗，再按目标安排参考范围；
                          每日时间用于分配训练任务，不会因为时间短就加大热量缺口。
                        </p>
                        <label className="field">
                          饮食计划目标
                          <select
                            value={preferences.energyGoal ?? "gentle_loss"}
                            onChange={(event) =>
                              updateAIDraft({
                                ...preferences,
                                energyGoal: event.target.value as
                                  "gentle_loss" | "maintain" | "tracking",
                              })
                            }
                          >
                            <option value="gentle_loss">温和减脂 · 默认</option>
                            <option value="maintain">维持与训练</option>
                            <option value="tracking">只记录饮食</option>
                          </select>
                        </label>
                        <label className="field">
                          能量公式计算参数
                          <select
                            value={preferences.calculationSex ?? "unspecified"}
                            onChange={(event) =>
                              updateAIDraft({
                                ...preferences,
                                calculationSex: event.target.value as
                                  "male" | "female" | "unspecified",
                              })
                            }
                          >
                            <option value="unspecified">暂不提供</option>
                            <option value="male">男参数</option>
                            <option value="female">女参数</option>
                          </select>
                          <small className="muted">
                            只用于公式，不根据上方性别自动选择；不提供则不计算热量范围。
                          </small>
                        </label>
                        <label className="field">
                          能量计划适用情况
                          <select
                            value={
                              preferences.nutritionEligibility ?? "unspecified"
                            }
                            onChange={(event) =>
                              updateAIDraft({
                                ...preferences,
                                nutritionEligibility: event.target.value as
                                  | "standard_adult"
                                  | "specialist_guidance"
                                  | "unspecified",
                              })
                            }
                          >
                            <option value="unspecified">
                              暂不确认 / 不确定
                            </option>
                            <option value="standard_adult">
                              成人、非孕哺期、无需要遵循的医嘱饮食限制
                            </option>
                            <option value="specialist_guidance">
                              孕哺期或需专业指导
                            </option>
                          </select>
                          <small className="muted">
                            不确定或不适用时，继续真实记录，不生成数值减脂目标。
                          </small>
                        </label>
                        <label className="field">
                          AI 计划活动参考 <span>选填</span>
                          <select
                            value={preferences.activityLevel}
                            onChange={(event) =>
                              updateAIDraft({
                                ...preferences,
                                activityLevel: event.target
                                  .value as AIOnboardingResult["preferences"]["activityLevel"],
                              })
                            }
                          >
                            <option value="unspecified">不提供</option>
                            <option value="sedentary">久坐</option>
                            <option value="light">轻度活动</option>
                            <option value="moderate">中度活动</option>
                            <option value="active">较高活动</option>
                          </select>
                        </label>
                        <label className="field">
                          饮食偏好 <span>选填</span>
                          <textarea
                            value={preferences.dietaryPreferences}
                            maxLength={1000}
                            onChange={(event) =>
                              updateAIDraft({
                                ...preferences,
                                dietaryPreferences: event.target.value,
                              })
                            }
                            placeholder="例如：偏爱家常菜、素食、希望做饭简单一些"
                          />
                        </label>
                        <label className="field">
                          过敏与需要避开的食物 <span>选填</span>
                          <textarea
                            value={preferences.allergies}
                            maxLength={1000}
                            onChange={(event) =>
                              updateAIDraft({
                                ...preferences,
                                allergies: event.target.value,
                              })
                            }
                            placeholder="只写你希望 AI 了解的信息；不确定可留空"
                          />
                          <small className="muted">
                            AI
                            建议需要你核对食材与包装标签，未知信息不会被当作“没有过敏”。
                          </small>
                        </label>
                      </div>
                    )}
                  </>
                )}
                {step === 1 && (
                  <>
                    <label className="field">
                      当前训练参考
                      <select
                        value={profile.examType}
                        onChange={(e) =>
                          update({
                            examType: e.target.value as ExamType,
                            examScore: null,
                            examDate: "",
                            comparableToeflScore: null,
                            cetStatus: "not_provided",
                          })
                        }
                      >
                        {examOptions.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!["none", "cet4", "cet6"].includes(profile.examType) && (
                      <div className="form-grid">
                        <label className="field">
                          总分 ·{" "}
                          {
                            examOptions.find(
                              ([v]) => v === profile.examType,
                            )?.[1]
                          }
                          <input
                            type="number"
                            step={
                              ["ielts", "toefl_2026_band"].includes(
                                profile.examType,
                              )
                                ? ".5"
                                : "1"
                            }
                            value={profile.examScore ?? ""}
                            onChange={(e) =>
                              update({
                                examScore:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              })
                            }
                            placeholder="输入对应量表的分数"
                          />
                          {fieldError("examScore")}
                        </label>
                        <label className="field">
                          考试日期 <span>TOEFL 请核对</span>
                          <input
                            type="date"
                            value={profile.examDate}
                            onChange={(e) =>
                              update({ examDate: e.target.value })
                            }
                          />
                          {fieldError("examDate")}
                        </label>
                        {profile.examType === "toefl_2026_band" && (
                          <label className="field full">
                            报告可比总分 · 0–120 <span>选填</span>
                            <input
                              type="number"
                              value={profile.comparableToeflScore ?? ""}
                              onChange={(e) =>
                                update({
                                  comparableToeflScore:
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value),
                                })
                              }
                            />
                            {fieldError("comparableToeflScore")}
                            <small className="muted">
                              2026-01-21 起使用 1–6 新量表；可比总分单独保存。
                            </small>
                          </label>
                        )}
                      </div>
                    )}
                    {["cet4", "cet6"].includes(profile.examType) && (
                      <label className="field">
                        自报状态
                        <select
                          value={profile.cetStatus}
                          onChange={(e) =>
                            update({ cetStatus: e.target.value })
                          }
                        >
                          <option value="not_provided">不提供</option>
                          <option value="at_least_425">达到 425 分</option>
                          <option value="below_425">未达到 425 分</option>
                          <option value="not_taken">未参加</option>
                        </select>
                        <small className="muted">
                          官方不设及格线，不换算为 IELTS 分数。
                        </small>
                      </label>
                    )}
                    <div className="info-box">
                      <BookOpen size={21} />
                      <div>
                        <strong>
                          {profile.examType === "none"
                            ? "还没有成绩？完全没关系。"
                            : "你的起点，不是你的上限。"}
                        </strong>
                        <p>
                          先完成五项微练习，再了解自己的薄弱项。当前能力与目标分数分别记录，站内活动分不代表考试成绩。
                        </p>
                      </div>
                    </div>
                    {aiMode === "self_hosted" && (
                      <div className="ai-english-sample">
                        <label className="field">
                          给 AI 一段英文小样本{" "}
                          <span>选填 · 至少 20 个英文单词</span>
                          <textarea
                            value={englishSample}
                            maxLength={4000}
                            onChange={(event) =>
                              updateAIDraft(preferences, event.target.value)
                            }
                            placeholder="Tell me about a typical day and one thing you want to improve. 用自己的英语写就好，不必追求完美。"
                          />
                          <small className="muted">
                            {englishWordCount(englishSample)} words ·
                            只评估这段写作证据，不推断听力、口语或官方考试分数。留空会从待诊断计划开始。
                          </small>
                          {fieldError("englishSample")}
                        </label>
                      </div>
                    )}
                  </>
                )}
                {step === 2 && (
                  <>
                    <div className="goal-options">
                      {GOALS.map((g, i) => (
                        <button
                          type="button"
                          key={g.id}
                          className={`goal-option ${profile.goal === g.id ? "selected" : ""}`}
                          onClick={() => update({ goal: g.id })}
                        >
                          <span className="goal-symbol">
                            {["↗", "✦", "◈", "✳"][i]}
                          </span>
                          <div>
                            <strong>{g.label}</strong>
                            <small>目标 IELTS {g.ieltsTarget.toFixed(1)}</small>
                          </div>
                          <span className="radio-dot">
                            {profile.goal === g.id && <Check size={13} />}
                          </span>
                        </button>
                      ))}
                    </div>
                    <p className="tiny muted">
                      所有目标都从银卡开始。会员 /
                      股东为游戏称号，无付费、股权或投资权益。身体参考值为可选主题信息，不参与升级。
                    </p>
                  </>
                )}
                {step === 3 && (
                  <>
                    <div className="plan-summary">
                      <div>
                        <Target size={20} />
                        <small>挑战目标</small>
                        <strong>{goal.label}</strong>
                      </div>
                      <div>
                        <Timer size={20} />
                        <small>每日预算</small>
                        <strong>{profile.timeBudget} 分钟</strong>
                      </div>
                      <div>
                        <UserRound size={20} />
                        <small>当前水平</small>
                        <strong>
                          {profile.examScore === null
                            ? "待诊断"
                            : "自报 · 未核验"}
                        </strong>
                      </div>
                    </div>
                    <div className="budget-list">
                      {Object.entries(template)
                        .filter(([k]) => !["totalMinutes"].includes(k))
                        .map(([key, value]) => (
                          <div key={key}>
                            <span>
                              {{
                                vocabulary: "词汇 / 语法",
                                listening: "听力",
                                reading: "阅读",
                                writing: "写作",
                                speaking: "口语",
                                loggingReflection: "记录 / 复盘",
                                retryBreakReserve: "重做 / 休息预留",
                              }[key] || key}
                            </span>
                            <span>{value} min</span>
                          </div>
                        ))}
                    </div>
                    <div className="notice">
                      <Sparkles size={17} />
                      <p>
                        预计完成时间：<strong>评估中</strong>
                        。先积累真实练习证据，再复评计划，不承诺提分或身体变化日期。
                      </p>
                    </div>
                    {aiMode === "self_hosted" ? (
                      <div className="ai-plan-consent">
                        <strong>Ready? 先确认，再让 AI 开工 🤝</strong>
                        <p>
                          接下来会实际调用你配置的 AI
                          服务，可能计费。上面的时长表是基础安排；生成后的计划会说明使用了哪些资料、哪些能力仍待诊断。
                        </p>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={planConsent}
                            onChange={(event) =>
                              setPlanConsent(event.target.checked)
                            }
                          />
                          我同意将填写的资料（含可选身体数据）、饮食偏好、过敏信息和英文样本发送给自己配置的
                          AI 服务商，生成起步计划。
                        </label>
                        <p>
                          只填写一次身高体重无法判断日后体脂是否下降；需要后续实测记录。AI
                          不会把预测当作已经发生的变化。
                        </p>
                      </div>
                    ) : (
                      <p className="tiny muted">
                        加入即开始本地记录与演示练习。AI
                        分析未启用，数据仅存此浏览器；可以随时导出或删除。
                      </p>
                    )}
                  </>
                )}
              </div>
              {Object.keys(errors).length > 0 && (
                <p className="error-box" role="alert">
                  {Object.values(errors).join(" ")}
                </p>
              )}
              <div className="wizard-actions">
                {step >= 0 && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      setStep(step - 1);
                      setErrors({});
                    }}
                  >
                    <ArrowLeft size={16} />
                    上一步
                  </button>
                )}
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => (step === 3 ? join() : next())}
                >
                  {busy
                    ? aiMode === "self_hosted"
                      ? "正在验证并生成计划…"
                      : "正在验证…"
                    : step === 3
                      ? aiMode === "self_hosted"
                        ? planFailed
                          ? "重试生成 AI 计划"
                          : "生成 AI 计划并加入"
                        : "领取我的银色会员卡"
                      : "继续"}
                  <ArrowRight size={17} />
                </button>
              </div>
              {planFailed && step === 3 && (
                <div className="ai-plan-fallback">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void join(profile, false)}
                  >
                    保留资料，进入记录模式
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setStep(-1);
                      setErrors({});
                    }}
                  >
                    重新检查 AI 连接
                  </button>
                </div>
              )}
              <div className="onboarding-footnote">
                <ShieldCheck size={14} />
                不要求身体数据 · 不需要考试成绩 · 每天都能重新开始
              </div>
            </>
          )}
          {step === -1 && Object.keys(errors).length > 0 && (
            <p className="error-box" role="alert">
              {Object.values(errors).join(" ")}
            </p>
          )}
        </section>
      </main>
      <footer className="welcome-footer">
        <span>© 2026 BOJI LANGUAGE CLUB</span>
        <span>
          {aiMode === "self_hosted"
            ? "个人自托管 · 计划生成前需确认"
            : "记录模式不启用真实 AI 测评"}
        </span>
        <span>SMALL STEPS. REAL PROGRESS.</span>
      </footer>
    </div>
  );
}
