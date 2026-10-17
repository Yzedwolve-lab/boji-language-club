"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Compass,
  Dumbbell,
  Flame,
  History,
  Home,
  Info,
  Layers,
  Leaf,
  LogOut,
  Settings2,
  Share2,
  ShieldCheck,
  Target,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import Onboarding from "./Onboarding";
import FitnessPanel from "./FitnessPanel";
import LearningPanel, { HistoricalRecordings } from "./LearningPanel";
import AIConnectionStep from "./AIConnectionStep";
import AIUsageBadge from "./AIUsageBadge";
import AIPlanPanel, { AIPlanHighlights, emptyAISetup } from "./AIPlanPanel";
import BodyMeasurements from "./BodyMeasurements";
import { selfHostedRequest } from "@/lib/ai-client";
import { isAIPlanCurrent } from "@/lib/plan-input";
import { clearLearningAudio } from "@/lib/lessons";
import {
  GOALS,
  TIME_TEMPLATES,
  cardTier,
  previewCompression,
} from "@/lib/domain";
import {
  STORAGE_KEY,
  newDemo,
  rollDemo,
  claimDemo,
  languageSummary,
  demoDate,
  nextCalendarDate,
  streak,
  isFitnessComplete,
  requiresFitnessReview,
  normalizeDemoState,
  applicableAIPlan,
  effectivePlanningProfile as planningProfile,
  type DemoState,
} from "@/lib/demo-store";
type Page =
  "overview" | "fitness" | "language" | "history" | "plan" | "settings";
const navItems = [
  {
    id: "overview" as const,
    label: "训练总览",
    english: "Club home",
    icon: Home,
  },
  {
    id: "fitness" as const,
    label: "薄肌",
    english: "BODY MODE 💪",
    icon: Dumbbell,
  },
  {
    id: "language" as const,
    label: "语言",
    english: "ENGLISH MODE 🗣️",
    icon: BookOpen,
  },
];
const pageTitles: Record<Page, string> = {
  overview: "训练总览",
  fitness: "薄肌 · 生活记录",
  language: "语言 · 每日练习",
  history: "成长记录",
  plan: "我的计划",
  settings: "设置与隐私",
};
function saveDownload(
  name: string,
  content: string,
  type = "application/json",
) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([content], { type }));
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog className="modal" ref={ref} onCancel={onClose} aria-label={title}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="关闭对话框"
        >
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function MembershipCard({
  state,
  share = false,
}: {
  state: DemoState;
  share?: boolean;
}) {
  const tier = cardTier(state.xp);
  return (
    <div className={`membership-card ${tier.id}`}>
      <div className="member-card-top">
        <span className="member-card-brand">
          BOJI<span>CLUB</span>
        </span>
        <span className="card-chip">
          <span />
          <span />
        </span>
      </div>
      <div className="card-orbits">
        <i />
        <i />
        <i />
      </div>
      <div className="card-material">
        <span /> {tier.id.replace("_", " ").toUpperCase()} MEMBERSHIP
      </div>
      <h3>{state.profile.nickname}</h3>
      <p className="card-goal">
        {GOALS.find((g) => g.id === state.profile.goal)?.label}
        <span>目标称号</span>
      </p>
      <div className="card-number">{state.cardId}</div>
      <div className="card-bottom">
        <span>MEMBER SINCE {state.joinedAt.slice(0, 7).replace("-", ".")}</span>
        <span>{share ? `${state.xp} XP` : "薄肌语言俱乐部"}</span>
      </div>
    </div>
  );
}
export default function ClubApp() {
  const [state, setState] = useState<DemoState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState<Page>("overview");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<"share" | "delete" | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [aiConnectionVersion, setAIConnectionVersion] = useState(0);
  useEffect(() => {
    if (
      new URLSearchParams(window.location.hash.slice(1)).has("setup") ||
      new URLSearchParams(window.location.hash.slice(1)).has("chatgpt")
    )
      setPage("settings");
    if (window.location.hash === "#ai-settings") {
      setPage("settings");
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as DemoState;
        if (
          stored.schema === 1 &&
          stored.profile &&
          stored.current &&
          Array.isArray(stored.ledger) &&
          Number.isSafeInteger(stored.xp) &&
          stored.xp >= 0
        )
          setState(normalizeDemoState(rollDemo(stored, demoDate(stored))));
        else setToast("旧的演示数据格式无法读取，请重新开始。");
      }
    } catch {
      setToast("演示数据暂时无法读取，请检查浏览器存储权限。");
    }
    setLoaded(true);
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        try {
          setState(
            event.newValue
              ? normalizeDemoState(JSON.parse(event.newValue))
              : null,
          );
        } catch {
          setToast("其他标签页数据未能同步。");
        }
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!loaded || !state) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      setToast("本机存储空间不足，新的修改尚未保存；请导出当前数据。");
    }
  }, [state, loaded]);
  useEffect(() => {
    const timer = setInterval(
      () => setState((s) => (s ? rollDemo(s, demoDate(s)) : s)),
      30000,
    );
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const notify = (message: string) => setToast(message);
  if (!loaded)
    return (
      <div className="app-loading">
        <span className="brand-mark">
          B<span>↗</span>
        </span>
        <p>准备好，开始今天的小进步。</p>
      </div>
    );
  if (!state)
    return (
      <>
        <Onboarding
          onComplete={(profile, aiSetup) => {
            setState(normalizeDemoState({ ...newDemo(profile), aiSetup }));
            if (aiSetup?.plan) setPage("plan");
            requestAnimationFrame(() =>
              window.scrollTo({ top: 0, behavior: "instant" }),
            );
            notify("欢迎加入俱乐部。你的银卡已准备好。");
          }}
        />
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </>
    );
  const current = state.current,
    fitnessDone = isFitnessComplete(state),
    lang = languageSummary(current.learning),
    tier = cardTier(state.xp),
    done = fitnessDone && lang.passed,
    claimed = current.status === "claimed",
    completedModules = Number(fitnessDone) + Number(lang.passed),
    template = TIME_TEMPLATES[state.profile.timeBudget],
    goal = GOALS.find((g) => g.id === state.profile.goal)!;
  const progress =
    tier.nextXp === null
      ? 100
      : Math.min(
          100,
          ((state.xp - tier.minXp) / (tier.nextXp - tier.minXp)) * 100,
        );
  const currentLearningPlan =
    state.aiSetup &&
    isAIPlanCurrent(state.aiSetup.plan, {
      profile: planningProfile(state),
      preferences: state.aiSetup.preferences,
      englishSample: state.aiSetup.englishSample,
    })
      ? state.aiSetup.plan
      : undefined;
  function patchState(update: (s: DemoState) => DemoState) {
    setState((s) => (s ? normalizeDemoState(update(s)) : s));
  }
  async function claim() {
    setClaimBusy(true);
    try {
      const run = () => {
        const raw = localStorage.getItem(STORAGE_KEY);
        const stored = raw ? (JSON.parse(raw) as DemoState) : state!;
        const latest = normalizeDemoState(rollDemo(stored, demoDate(stored)));
        if (latest.current.id !== stored.current.id) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(latest));
          setState(latest);
          throw new Error(
            "已经进入新的训练日，昨日未领取的记录已归档，请继续今天的任务。",
          );
        }
        const next = claimDemo(latest);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setState(next);
        notify(
          `今日活动已结算，+${next.current.awardedXP} XP。下个训练日继续！`,
        );
      };
      if (navigator.locks)
        await navigator.locks.request("boji-demo-claim", run);
      else run();
    } catch (error) {
      notify(error instanceof Error ? error.message : "结算未完成，请重试。");
    } finally {
      setClaimBusy(false);
    }
  }
  function changePage(next: Page) {
    setPage(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function shareCard() {
    const escape = (value: string) =>
      value.replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&apos;",
          })[c]!,
      );
    saveDownload(
      "boji-membership.svg",
      `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600"><rect width="1000" height="600" rx="40" fill="#dedde9"/><circle cx="820" cy="170" r="230" fill="none" stroke="#bab7d0" stroke-width="2"/><circle cx="820" cy="170" r="180" fill="none" stroke="#bab7d0" stroke-width="2"/><g fill="#2d2645" font-family="Arial,sans-serif"><text x="64" y="95" font-size="36">BOJI CLUB · 薄肌语言俱乐部</text><text x="64" y="210" font-size="25">${escape(tier.label)} MEMBERSHIP · DEMO</text><text x="64" y="300" font-size="52">${escape(state!.profile.nickname)}</text><text x="64" y="370" font-size="30">${escape(goal.label)} · 目标称号</text><text x="64" y="490" font-size="25">${state!.xp} XP · ${state!.completedDays} completed days</text><text x="64" y="550" font-size="20">SMALL STEPS. REAL PROGRESS.</text></g></svg>`,
      "image/svg+xml",
    );
    notify("分享卡已生成；不含身体数据、考试成绩或录音。");
    setModal(null);
  }
  return (
    <div className="club-app">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <Link
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            changePage("overview");
          }}
        >
          <span className="brand-mark">
            B<span>↗</span>
          </span>
          <span>
            薄肌语言
            <br />
            俱乐部<small>BOJI CLUB</small>
          </span>
        </Link>
        <div className="sidebar-section-label">今天，玩哪一关？</div>
        <nav aria-label="主要导航">
          {navItems.map(({ id, label, english, icon: Icon }) => (
            <button
              key={id}
              onClick={() => changePage(id)}
              className={`nav-item ${id === "overview" ? "nav-home" : `nav-primary nav-${id}`} ${page === id ? "active" : ""}`}
              aria-label={label}
            >
              <Icon size={20} />
              <span>
                {label}
                <small>{english}</small>
              </span>
              {id === "overview" && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-section-label journey-label">你的成长存档</div>
        <nav aria-label="成长与设置">
          {(
            [
              { id: "history", label: "成长记录", icon: History },
              { id: "plan", label: "我的计划", icon: Compass },
              { id: "settings", label: "设置与隐私", icon: Settings2 },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item compact ${page === id ? "active" : ""}`}
              onClick={() => changePage(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-spark" aria-hidden="true">
            😎
          </span>
          <strong>进来就算开了个好头。</strong>
          <p>
            Main character energy.
            <br />
            Your pace, your rules.
          </p>
        </div>
        <div className="sidebar-profile">
          <span className="avatar">{state.profile.nickname.slice(0, 1)}</span>
          <div>
            <strong>{state.profile.nickname}</strong>
            <small>
              {goal.label} · {tier.label}卡
            </small>
          </div>
          <button
            aria-label="打开设置与隐私"
            className="icon-button"
            onClick={() => changePage("settings")}
          >
            <Settings2 size={16} />
          </button>
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <div className="breadcrumb">
            <span>俱乐部</span>
            <ChevronRight size={14} />
            <strong>{pageTitles[page]}</strong>
          </div>
          <div className="topbar-right">
            <span className="date-label">
              <CalendarDays size={15} />
              {current.date.replaceAll("-", ".")}
            </span>
            <span className="outline-pill small">
              <span className="live-dot" />
              {state.aiSetup?.mode === "self_hosted" ? "SELF-HOSTED" : "DEMO"}
            </span>
            <span className="avatar small">
              {state.profile.nickname.slice(0, 1)}
            </span>
          </div>
        </header>
        <div className="mode-banner">
          <span>
            <Info size={14} />
            <strong>
              {state.aiSetup?.mode === "self_hosted"
                ? "个人自托管 · AI 按需调用，非官方测评"
                : "演示模式，非真实 AI 测评"}
            </strong>
          </span>
          {state.aiSetup?.mode === "self_hosted" && (
            <AIUsageBadge revision={`${page}:${aiConnectionVersion}`} />
          )}
          <span>
            {state.aiSetup?.mode === "self_hosted"
              ? "进度保存在此浏览器 · 发送前由你确认"
              : "进度保存在此浏览器 · 不调用收费服务"}
          </span>
        </div>
        <div className="workspace">
          <main id="main-content" className="main-content" tabIndex={-1}>
            {page === "overview" && (
              <>
                <div className="greeting">
                  <div>
                    <p className="eyebrow">HEY, YOU’RE HERE! ✨</p>
                    <h1>
                      嗨，{state.profile.nickname}
                      <span className="greeting-spark" aria-hidden="true">
                        👋
                      </span>
                    </h1>
                    <p>薄肌和英语，今天想先宠幸谁？</p>
                  </div>
                  <span className="day-badge">
                    DAY{" "}
                    <strong>{String(current.dayIndex).padStart(2, "0")}</strong>
                  </span>
                </div>
                <section className="hero-panel">
                  <div className="hero-copy">
                    <span className="hero-tag">
                      <span />
                      YOUR DAILY SIDE QUEST
                    </span>
                    <h2>
                      练一点，
                      <br />
                      就很有戏。
                    </h2>
                    <p>
                      记录今天吃了啥，顺便让英文开个机。
                      <br />
                      No pressure. Let’s cook. 🔥
                    </p>
                    <button
                      className="button light"
                      onClick={() =>
                        changePage(!fitnessDone ? "fitness" : "language")
                      }
                    >
                      {claimed
                        ? "回顾今日练习"
                        : completedModules
                          ? "继续今日训练"
                          : "开始今日训练"}
                      <ArrowUpRight size={17} />
                    </button>
                  </div>
                  <div className="club-buddy">
                    <span className="buddy-face" aria-hidden="true">
                      😎
                    </span>
                    <div className="buddy-bubble">
                      <span>BOJI ONLINE</span>
                      <strong>
                        今天练哪边？
                        <br />
                        我都陪你。
                      </strong>
                      <small>Small steps. Big energy ✨</small>
                    </div>
                  </div>
                </section>
                <div className="section-header">
                  <div>
                    <h2>今天的两大主场</h2>
                    <span>CHOOSE YOUR MODE</span>
                  </div>
                  <span>
                    <Clock3 size={14} />
                    {state.profile.timeBudget} 分钟预算
                  </span>
                </div>
                <div className="training-grid">
                  <button
                    className={`training-card fitness ${fitnessDone ? "complete" : ""}`}
                    onClick={() => changePage("fitness")}
                  >
                    <div className="training-card-top">
                      <span className="module-icon">
                        <Dumbbell size={25} />
                      </span>
                      <span className="module-label">BODY MODE 💪</span>
                    </div>
                    <div className="module-heading">
                      <h3>薄肌</h3>
                      {fitnessDone && <CheckCircle2 size={19} />}
                    </div>
                    <p>吃了啥？动了啥？用英文聊两句。</p>
                    <span className="module-dialogue">
                      “Plot twist: 这顿饭也是英语题。” 👀
                    </span>
                    <div className="module-tags">
                      <span>饮食记录</span>
                      <span>运动 & 复盘</span>
                    </div>
                    <div className="task-card-bottom">
                      <span>
                        <Clock3 size={13} />
                        {template.loggingReflection} min <i />
                        最多 40 XP
                      </span>
                      <span className="circle-arrow">
                        <ArrowUpRight size={18} />
                      </span>
                    </div>
                    <div className="module-progress">
                      <i
                        style={{
                          width: fitnessDone
                            ? "100%"
                            : current.fitness.analyzed
                              ? "60%"
                              : "0%",
                        }}
                      />
                    </div>
                  </button>
                  <button
                    className={`training-card language ${lang.passed ? "complete" : ""}`}
                    onClick={() => changePage("language")}
                  >
                    <div className="training-card-top">
                      <span className="module-icon">
                        <BookOpen size={25} />
                      </span>
                      <span className="module-label">ENGLISH MODE 🗣️</span>
                    </div>
                    <div className="module-heading">
                      <h3>语言</h3>
                      {lang.passed && <CheckCircle2 size={19} />}
                    </div>
                    <p>听说读写一起练，开口就是主角。</p>
                    <span className="module-dialogue">
                      “Your English era starts here.” ✨
                    </span>
                    <div className="module-tags">
                      <span>听说读写</span>
                      <span>词汇 & 语法</span>
                    </div>
                    <div className="task-card-bottom">
                      <span>
                        <Clock3 size={13} />
                        {template.vocabulary +
                          template.listening +
                          template.reading +
                          template.writing +
                          template.speaking}{" "}
                        min <i />
                        {lang.completed}/5 已完成
                      </span>
                      <span className="circle-arrow">
                        <ArrowUpRight size={18} />
                      </span>
                    </div>
                    <div className="module-progress">
                      <i style={{ width: `${lang.completed * 20}%` }} />
                    </div>
                  </button>
                </div>
                <div className="overview-stats">
                  <div>
                    <span className="stat-icon violet">
                      <CalendarDays size={19} />
                    </span>
                    <div>
                      <small>已结算训练日</small>
                      <strong>
                        {state.completedDays}
                        <span>天</span>
                      </strong>
                    </div>
                  </div>
                  <div>
                    <span className="stat-icon orange">
                      <Flame size={19} />
                    </span>
                    <div>
                      <small>连续完成</small>
                      <strong>
                        {streak(state)}
                        <span>天</span>
                      </strong>
                    </div>
                  </div>
                  <div>
                    <span className="stat-icon green">
                      <Zap size={19} />
                    </span>
                    <div>
                      <small>累计经验</small>
                      <strong>
                        {state.xp}
                        <span>XP</span>
                      </strong>
                    </div>
                  </div>
                </div>
                <div className="daily-note">
                  <span>“</span>
                  <div>
                    <p>Progress unlocked. Perfection optional. 🎮</p>
                    <small>练对了我夸，卡住了我陪。今天不用满分登场。</small>
                  </div>
                  <Leaf size={25} />
                </div>
                <section className="claim-strip">
                  <span className={`claim-icon ${done ? "ready" : ""}`}>
                    <Trophy size={25} />
                  </span>
                  <div>
                    <h3>
                      {claimed
                        ? "今天的认真，已经记入成长。"
                        : done
                          ? "今天的双份成长，可以领取了。"
                          : "完成两项活动，点亮今天。"}
                    </h3>
                    <p>
                      {claimed
                        ? `已领取 ${current.awardedXP} XP · 下一训练日在北京时间 03:00 开启`
                        : done
                          ? "经验依据记录质量与练习完成计算；重做不重复发放。"
                          : `薄肌${fitnessDone ? "已完成" : "待完成"} · 语言 ${lang.completed}/5 · 领取奖励 +10 XP`}
                    </p>
                  </div>
                  {done && !claimed && (
                    <button
                      className="button primary"
                      disabled={claimBusy}
                      onClick={claim}
                    >
                      {claimBusy ? "正在结算…" : "提交当日俱乐部活动经验"}
                      <ArrowRight size={16} />
                    </button>
                  )}
                  {claimed && (
                    <span className="soft-badge green">
                      <CheckCircle2 size={15} />
                      已结算
                    </span>
                  )}
                </section>
              </>
            )}
            {page === "fitness" && (
              <FitnessPanel
                key={current.id}
                value={current.fitness}
                profile={state.profile}
                disabled={claimed}
                aiMode={requiresFitnessReview(state)}
                requireEnergyPlan={!!state.current.fitnessReviewRequired}
                plan={applicableAIPlan(state)}
                onOpenPlan={() => changePage("plan")}
                onChange={(fitness, expected) =>
                  patchState((s) =>
                    s.current.id !== current.id ||
                    s.current.status === "claimed" ||
                    (expected !== undefined &&
                      (s.aiSetup?.mode !== "self_hosted" ||
                        JSON.stringify(s.current.fitness) !==
                          JSON.stringify(expected)))
                      ? s
                      : { ...s, current: { ...s.current, fitness } },
                  )
                }
              />
            )}
            {page === "language" && (
              <>
                {currentLearningPlan && (
                  <AIPlanHighlights plan={currentLearningPlan} englishOnly />
                )}
                {state.aiSetup?.plan && !currentLearningPlan && (
                  <div className="panel">
                    <p>
                      资料或英文样本有更新，之前的计划已保留。请先更新计划，再使用新的个性化任务。
                    </p>
                    <button
                      className="button secondary"
                      onClick={() => changePage("plan")}
                    >
                      更新我的计划
                    </button>
                  </div>
                )}
                <LearningPanel
                  key={current.id}
                  value={current.learning}
                  timeBudget={state.profile.timeBudget}
                  dayIndex={current.dayIndex}
                  aiPlan={currentLearningPlan}
                  disabled={claimed}
                  onChange={(learning) =>
                    patchState((s) =>
                      s.current.id !== current.id
                        ? s
                        : {
                            ...s,
                            current: {
                              ...s.current,
                              learning:
                                s.current.status === "claimed"
                                  ? {
                                      ...s.current.learning,
                                      answersRevealed:
                                        s.current.learning.answersRevealed ||
                                        learning.answersRevealed,
                                    }
                                  : learning,
                            },
                          },
                    )
                  }
                />
              </>
            )}
            {page === "history" && <HistoryPanel state={state} />}
            {page === "plan" && (
              <>
                <AIPlanPanel
                  profile={planningProfile(state)}
                  setup={state.aiSetup}
                  onProfileChange={(profile) =>
                    patchState((s) => ({
                      ...s,
                      profile,
                      planningWeightOverride:
                        profile.weightKg !== planningProfile(s).weightKg
                          ? profile.weightKg
                          : s.planningWeightOverride,
                    }))
                  }
                  onHealthConsentChange={(healthConsent) =>
                    patchState((s) => ({
                      ...s,
                      profile: { ...s.profile, healthConsent },
                    }))
                  }
                  onNeedConnection={() => setPage("settings")}
                  onChange={(aiSetup, expected) =>
                    patchState((s) => {
                      // Another tab may have changed a draft, consent or weight
                      // while this request was running. Never restore its snapshot.
                      if (
                        expected &&
                        (JSON.stringify(s.aiSetup) !==
                          JSON.stringify(expected.setup) ||
                          JSON.stringify(planningProfile(s)) !==
                            JSON.stringify(expected.profile))
                      )
                        return s;
                      return {
                        ...s,
                        aiSetup,
                        aiPlanHistory:
                          s.aiSetup?.plan && aiSetup.plan !== s.aiSetup.plan
                            ? [...(s.aiPlanHistory ?? []), s.aiSetup.plan]
                            : s.aiPlanHistory,
                      };
                    })
                  }
                />
                <BodyMeasurements
                  value={state.measurements ?? []}
                  onChange={(measurements) =>
                    patchState((s) => ({
                      ...s,
                      measurements,
                      planningWeightOverride: undefined,
                    }))
                  }
                />
                <PlanPanel state={state} onChange={setState} notify={notify} />
              </>
            )}
            {page === "settings" && (
              <section className="settings-page">
                <p className="eyebrow">YOUR DATA, YOUR CHOICE</p>
                <h1>设置与隐私</h1>
                <p className="muted">你的练习，你做主。</p>
                <div className="panel settings-section ai-connection-note">
                  <AIConnectionStep
                    key={aiConnectionVersion}
                    onConnected={() => {
                      patchState((s) => ({
                        ...s,
                        aiSetup: {
                          ...(s.aiSetup ?? emptyAISetup()),
                          mode: "self_hosted",
                        },
                      }));
                      notify("AI 连接已确认，可以到我的计划生成建议。");
                      setPage("plan");
                    }}
                    continueLabel="使用此连接，查看我的计划"
                  />
                  {state.aiSetup?.mode === "self_hosted" && (
                    <button
                      className="button secondary ai-disconnect"
                      onClick={async () => {
                        try {
                          await selfHostedRequest("disconnect");
                          setAIConnectionVersion((version) => version + 1);
                          patchState((s) => ({
                            ...s,
                            aiSetup: {
                              ...(s.aiSetup ?? emptyAISetup()),
                              mode: "demo",
                            },
                          }));
                          notify("已断开 AI 会话，已保存的计划和记录仍保留。");
                        } catch {
                          notify("断开会话未完成，请检查服务后重试。");
                        }
                      }}
                    >
                      断开 AI，回到记录模式
                    </button>
                  )}
                </div>
                <div className="panel settings-section">
                  <h3>
                    <ShieldCheck size={19} />
                    数据与隐私
                  </h3>
                  <p>
                    档案、饮食、AI
                    建议、测量与作文草稿保存在此浏览器；录音存于本机私有浏览器存储，不上传。启用自托管
                    AI
                    后，仅在你主动提交时把对应内容发往自己的服务端及所配置的模型服务。不要在共用设备上留下敏感资料。
                  </p>
                  <div className="setting-row">
                    <div>
                      <strong>导出我的演示数据</strong>
                      <small>
                        档案、记录、历次尝试与积分账本 · JSON；不含音频文件
                      </small>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() =>
                        saveDownload(
                          "boji-demo-export.json",
                          JSON.stringify(state, null, 2),
                        )
                      }
                    >
                      <ArrowDownToLine size={16} />
                      导出数据
                    </button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>删除本机演示数据</strong>
                      <small>清除档案、学习记录、草稿与录音，无法撤销</small>
                    </div>
                    <button
                      className="button danger"
                      onClick={() => {
                        setDeleteText("");
                        setModal("delete");
                      }}
                    >
                      删除数据
                    </button>
                  </div>
                </div>
                <div className="panel settings-section">
                  <h3>
                    <Clock3 size={19} />
                    训练日期
                  </h3>
                  <div className="setting-row">
                    <div>
                      <strong>每天北京时间 03:00 刷新</strong>
                      <small>
                        当前 Day {current.dayIndex} · {current.date}
                      </small>
                    </div>
                  </div>
                  <p className="tiny muted">
                    凌晨 3
                    点前的记录归入前一个训练日，已领取的经验不会重复发放。
                  </p>
                  <div className="demo-controls">
                    <span className="soft-badge">DEMO 控制</span>
                    <p>
                      模拟日期向前一天，体验已领取与未领取的两种跨日流程。不会生成虚假的完成记录。
                    </p>
                    <button
                      className="button secondary"
                      onClick={() => {
                        patchState((s) => ({
                          ...rollDemo(s, nextCalendarDate(s.current.date)),
                          dayOffset: s.dayOffset + 1,
                        }));
                        notify(
                          claimed
                            ? "下一训练日已开启，Day +1。"
                            : "旧期已归档；未领取经验，保持相同 Day。",
                        );
                      }}
                    >
                      模拟进入下一训练日
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
                <div className="panel settings-section legal-copy">
                  <h3>使用说明与服务状态</h3>
                  <details open>
                    <summary>AI 与考试说明</summary>
                    <p>
                      未连接 AI 时提供演示练习；自托管 AI
                      计划会明确标明样本依据。客观题按原创题目规则判断；写作与口语替代活动仅确认学习过程，不认证能力。IELTS、PTE、TOEFL
                      均为各自权利人商标，本站无官方隶属关系。
                    </p>
                  </details>
                  <details>
                    <summary>健康与营养说明</summary>
                    <p>
                      真实饮食始终可以保存。演示数字与 AI
                      模型估算分别标明；当前没有经过审核的精确个人营养目标。实际测量与模型建议分开，不能用模型估算声称体脂已经下降。
                    </p>
                  </details>
                  <details>
                    <summary>真实服务的数据与删除政策草稿</summary>
                    <p>
                      未来真实模式需要单独同意后才向选定 AI
                      供应商传输必要的练习内容；写作评分不需要身体数据。私有音频默认保留
                      30
                      天，可提前删除。生产账号删除、对象清理和备份清除周期须按发布门槛验证后开放。
                    </p>
                  </details>
                  <details>
                    <summary>来源与授权</summary>
                    <p>
                      练习文章、题目和视觉图形为本项目原创演示内容。浏览器朗读明确标注合成语音，供应商声音使用权需独立确认。代码许可待所有者决定，第三方依赖各遵循原许可证。
                    </p>
                  </details>
                </div>
              </section>
            )}
            {page !== "overview" && done && !claimed && (
              <div className="sticky-claim">
                <CheckCircle2 size={18} />
                <span>今日双模块已完成</span>
                <button
                  className="button primary"
                  disabled={claimBusy}
                  onClick={claim}
                >
                  提交当日俱乐部活动经验
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
            <footer className="app-footer">
              <span>
                薄肌语言俱乐部 <i /> SMALL STEPS. REAL PROGRESS.
              </span>
              <span>原创微练习 · 非官方考试产品</span>
            </footer>
          </main>
          <aside className="right-rail">
            <div className="rail-section-title">
              <h2>我的俱乐部卡</h2>
              <button
                className="icon-button"
                aria-label="分享卡片"
                onClick={() => setModal("share")}
              >
                <Share2 size={16} />
              </button>
            </div>
            <MembershipCard state={state} />
            <div className="card-growth">
              <div>
                <span>{tier.label}卡</span>
                <strong>
                  {state.xp}
                  <span> / {tier.nextXp ?? "MAX"} XP</span>
                </strong>
              </div>
              <div className="progress-track">
                <i style={{ width: `${progress}%` }} />
              </div>
              <p>
                {tier.nextXp === null
                  ? "每一次认真，都在这张卡片上。"
                  : `再积累 ${tier.nextXp - state.xp} XP，解锁${tier.id === "silver" ? "金色" : tier.id === "gold" ? "钻石" : "黑金"}卡`}
              </p>
            </div>
            <div className="rail-divider" />
            <section className="today-progress">
              <div className="rail-section-title">
                <h2>今天，走到哪里了？</h2>
                <span>{completedModules}/2</span>
              </div>
              <div className="progress-step">
                <span className="step-state done">
                  <Check size={14} />
                </span>
                <div>
                  <strong>来到俱乐部</strong>
                  <small>很高兴今天见到你</small>
                </div>
                <span className="tiny muted">完成</span>
              </div>
              <div className="progress-step">
                <span className={`step-state ${fitnessDone ? "done" : ""}`}>
                  {fitnessDone ? <Check size={14} /> : <Dumbbell size={14} />}
                </span>
                <div>
                  <strong>薄肌 · 记录与复盘</strong>
                  <small>
                    {fitnessDone
                      ? "真实记录，是一种进步"
                      : "关注习惯，不追求更低数字"}
                  </small>
                </div>
              </div>
              <div className="progress-step">
                <span className={`step-state ${lang.passed ? "done" : ""}`}>
                  {lang.passed ? <Check size={14} /> : <BookOpen size={14} />}
                </span>
                <div>
                  <strong>语言 · 五项练习</strong>
                  <small>{lang.completed}/5 完成，每一小步都算数</small>
                </div>
              </div>
              <div className="progress-step last">
                <span className={`step-state ${claimed ? "done" : ""}`}>
                  {claimed ? <Check size={14} /> : <Trophy size={14} />}
                </span>
                <div>
                  <strong>领取今日经验</strong>
                  <small>
                    {claimed
                      ? `已领取 ${current.awardedXP} XP`
                      : "双模块完成后点亮"}
                  </small>
                </div>
              </div>
            </section>
            <div className="goal-mini">
              <div>
                <span className="icon-box">
                  <Target size={18} />
                </span>
                <span>我的挑战目标</span>
                <ArrowUpRight size={15} />
              </div>
              <h3>
                {goal.label}
                <span>IELTS {goal.ieltsTarget.toFixed(1)}</span>
              </h3>
              <div>
                <span>当前能力</span>
                <strong>
                  {state.profile.examScore === null ? "待诊断" : "自报，未核验"}
                </strong>
              </div>
              <div>
                <span>预计完成</span>
                <strong>评估中</strong>
              </div>
              <button
                className="text-button"
                onClick={() => changePage("plan")}
              >
                查看我的计划
                <ArrowRight size={14} />
              </button>
            </div>
            <div className="rail-bottom">
              <ShieldCheck size={14} />
              <span>成长属于你。数据默认私有。</span>
            </div>
          </aside>
        </div>
      </div>
      <nav className="mobile-nav" aria-label="移动端导航">
        {[
          ...navItems,
          { id: "history" as const, label: "成长", english: "", icon: History },
          {
            id: "settings" as const,
            label: "设置",
            english: "",
            icon: Settings2,
          },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`${id === "fitness" || id === "language" ? `mobile-primary mobile-${id}` : ""} ${page === id ? "active" : ""}`}
            aria-label={label}
            onClick={() => changePage(id)}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {modal === "share" && (
        <Modal title="分享卡片预览" onClose={() => setModal(null)}>
          <p className="muted">
            只包含昵称、游戏称号、材质和累计经验。身体资料、具体考试成绩、邮箱与录音默认隐藏。
          </p>
          <MembershipCard state={state} share />
          <button className="button primary full-button" onClick={shareCard}>
            <Share2 size={16} />
            确认并下载分享卡
          </button>
        </Modal>
      )}
      {modal === "delete" && (
        <Modal title="删除本机演示数据" onClose={() => setModal(null)}>
          <p>
            这将删除本浏览器中的演示档案、草稿、历史与录音。可以先关闭此窗口并导出数据。
          </p>
          <label className="field">
            输入“删除”以确认
            <input
              autoFocus
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder="删除"
            />
          </label>
          <button
            className="button danger full-button"
            disabled={deleteText !== "删除"}
            onClick={async () => {
              try {
                await clearLearningAudio();
                localStorage.removeItem(STORAGE_KEY);
                localStorage.removeItem("boji.onboarding.draft");
                localStorage.removeItem("boji.onboarding.ai-draft");
                void selfHostedRequest("disconnect").catch(() => {});
                setState(null);
                setPage("overview");
                setModal(null);
                notify("本机演示数据和录音已删除。");
              } catch {
                notify(
                  "录音清理失败，尚未删除档案。请关闭其他使用录音的页面后重试。",
                );
              }
            }}
          >
            <LogOut size={16} />
            确认删除全部本机数据
          </button>
        </Modal>
      )}
    </div>
  );
}
function HistoryPanel({ state }: { state: DemoState }) {
  const periods = [
    ...state.history,
    ...(state.current.status === "claimed" ? [state.current] : []),
  ].reverse();
  return (
    <section className="history-page">
      <p className="eyebrow">EVERY SMALL STEP MATTERS</p>
      <h1>成长有迹可循。</h1>
      <p className="muted">
        每一次原始记录、每一个认真练习的瞬间，都值得留下。
      </p>
      <div className="history-summary">
        <div>
          <Trophy size={24} />
          <strong>
            {state.xp}
            <span>累计 XP</span>
          </strong>
        </div>
        <div>
          <CalendarDays size={24} />
          <strong>
            {state.completedDays}
            <span>已结算训练日</span>
          </strong>
        </div>
        <div>
          <Layers size={24} />
          <strong>
            {periods.length}
            <span>已保存训练期</span>
          </strong>
        </div>
      </div>
      {!periods.length ? (
        <div className="panel empty-state">
          <span className="empty-orbit">
            <History size={38} />
          </span>
          <h3>你的故事，正在开始。</h3>
          <p>
            完成今日活动或进入下一训练日后，记录会出现在这里。
            <br />
            未领取的训练期也会保留，不扣除历史经验。
          </p>
        </div>
      ) : (
        <div className="history-list">
          {periods.map((period) => (
            <details className="panel history-entry" key={period.id}>
              <summary>
                <div className="history-day">
                  D{String(period.dayIndex).padStart(2, "0")}
                </div>
                <div>
                  <strong>
                    Day {period.dayIndex} · {period.date}
                  </strong>
                  <small>
                    {period.status === "claimed"
                      ? "已领取 · 完成记录已锁定"
                      : "未领取 · 原始内容已归档"}
                  </small>
                </div>
                <span
                  className={period.status === "claimed" ? "xp-value" : "muted"}
                >
                  {period.status === "claimed"
                    ? `+${period.awardedXP} XP`
                    : "保留历史"}
                </span>
                <ChevronRight size={16} />
              </summary>
              <div className="history-detail">
                <h4>薄肌原始记录</h4>
                {Object.entries(period.fitness)
                  .filter(
                    ([key, value]) =>
                      [
                        "breakfast",
                        "lunch",
                        "dinner",
                        "snacks",
                        "drinks",
                        "activity",
                        "reflection",
                      ].includes(key) && value,
                  )
                  .map(([key, value]) => (
                    <p key={key}>
                      <strong>{key}:</strong> {String(value)}
                    </p>
                  ))}
                <HistoricalRecordings recordings={period.learning.recordings} />
                <h4>语言尝试 · {period.learning.attempts.length} 次</h4>
                {period.learning.attempts.map((attempt) => (
                  <div key={attempt.id} className="attempt-record">
                    <strong>
                      {attempt.task} ·{" "}
                      {attempt.score === null
                        ? "未评分"
                        : `${attempt.score} 活动分`}
                    </strong>
                    <p>{attempt.input}</p>
                    <small>{attempt.feedback}</small>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
      <div className="notice">
        <Info size={17} />
        <p>
          当日领取不立即开启下一 Day。未领取跨日时保留原
          Day，旧记录归档；不会累计必须补完的任务。
        </p>
      </div>
    </section>
  );
}
function PlanPanel({
  state,
  onChange,
  notify,
}: {
  state: DemoState;
  onChange: (s: DemoState) => void;
  notify: (s: string) => void;
}) {
  const [ratio, setRatio] = useState(state.plan.compression);
  const [fictional, setFictional] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [bodyReference, setBodyReference] = useState(false);
  const template = TIME_TEMPLATES[state.profile.timeBudget],
    goal = GOALS.find((g) => g.id === state.profile.goal)!;
  const preview = previewCompression(
    fictional ? 100 : null,
    ratio,
    state.profile.timeBudget,
    Object.values(template).reduce((a, b) => a + b, 0),
  );
  return (
    <section className="plan-page">
      <p className="eyebrow">A PLAN THAT FITS YOUR LIFE</p>
      <h1>你的节奏，你的方向。</h1>
      <p className="muted">计划服务于生活。留出复习，也留出休息。</p>
      <div className="panel plan-main">
        <div className="panel-heading">
          <div>
            <span className="icon-box">
              <Target size={21} />
            </span>
            <h3>我的挑战目标</h3>
          </div>
          <span className="soft-badge">计划 v{state.plan.version}</span>
        </div>
        <div className="goal-options compact-goals">
          {GOALS.map((g, i) => (
            <button
              key={g.id}
              className={`goal-option ${g.id === state.profile.goal ? "selected" : ""}`}
              onClick={() => {
                onChange({
                  ...state,
                  profile: { ...state.profile, goal: g.id },
                  goalHistory: [
                    ...state.goalHistory,
                    { goal: g.id, date: new Date().toISOString() },
                  ],
                  plan: {
                    ...state.plan,
                    version: state.plan.version + 1,
                    compression: 0,
                  },
                });
                setRatio(0);
                notify("目标已更新，原选择历史已保留，经验值不变。");
              }}
            >
              <span className="goal-symbol">{["↗", "✦", "◈", "✳"][i]}</span>
              <div>
                <strong>{g.label}</strong>
                <small>IELTS {g.ieltsTarget.toFixed(1)}</small>
              </div>
              {g.id === state.profile.goal && <Check size={17} />}
            </button>
          ))}
        </div>
        <div className="forecast-box">
          <span className="forecast-symbol">↗</span>
          <div>
            <strong>预计完成时间 · 评估中</strong>
            <p>
              语言：待积累独立练习证据。身体：记录模式，不预测体脂达标日期。
            </p>
            <small>
              下次复评：完成 3 个训练日后 ·
              当前证据仅用于演示，不形成真实能力预测。
            </small>
          </div>
        </div>
        {state.profile.age >= 18 && (
          <details className="optional-details">
            <summary>
              可选身体主题参考 <span>不参与升级</span>
            </summary>
            <label className="check-label">
              <input
                type="checkbox"
                checked={bodyReference}
                onChange={(e) => setBodyReference(e.target.checked)}
              />
              我理解这只是主题参考，不是健康处方或越低越好的标准
            </label>
            {bodyReference && (
              <p>
                {state.profile.gender === "unspecified"
                  ? "未提供性别，不生成对应主题值。"
                  : `${goal.label}主题参考：${state.profile.gender === "male" ? { user: 18, member: 15, shareholder: 12, alan: 10 }[state.profile.goal] : { user: 28, member: 25, shareholder: 22, alan: 20 }[state.profile.goal]}%。`}
                可以一直采用记录与维持习惯模式，获得任何材质的卡片。
              </p>
            )}
          </details>
        )}
      </div>
      <div className="panel plan-time">
        <div className="panel-heading">
          <div>
            <Clock3 size={20} />
            <h3>每日 {state.profile.timeBudget} 分钟分配</h3>
          </div>
        </div>
        <div className="time-bar">
          {Object.entries(template).map(([key, value], i) => (
            <span
              key={key}
              style={{
                width: `${(value / state.profile.timeBudget) * 100}%`,
                background: [
                  "#9d7bf0",
                  "#c3b0ef",
                  "#7a65a9",
                  "#9883bf",
                  "#bfa0dd",
                  "#7dab9b",
                  "#4d455e",
                ][i],
              }}
            />
          ))}
        </div>
        <div className="budget-list">
          {Object.entries(template).map(([key, value]) => (
            <div key={key}>
              <span>
                {
                  {
                    vocabulary: "词汇 / 语法",
                    listening: "听力",
                    reading: "阅读",
                    writing: "写作",
                    speaking: "口语",
                    loggingReflection: "记录 / 复盘",
                    retryBreakReserve: "重做 / 休息预留",
                  }[key]
                }
              </span>
              <strong>{value} min</strong>
            </div>
          ))}
        </div>
        <p className="tiny muted">
          这是网页任务预算，不包含做饭和自行运动。未用完的预留时间无需刷题填满。
        </p>
      </div>
      <div className="panel acceleration-panel">
        <div className="panel-heading">
          <div>
            <Zap size={20} />
            <h3>想加快一点？先看可行性。</h3>
          </div>
          <span className="soft-badge">最多 40%</span>
        </div>
        <p className="muted">
          缩短比例始终基于独立的未加速预测，不连续折算。不会增加每日预算、删掉复习或要求更激进节食。
        </p>
        <div className="compression-options">
          {[0, 0.1, 0.2, 0.3, 0.4].map((value) => (
            <button
              key={value}
              className={ratio === value ? "selected" : ""}
              onClick={() => {
                setRatio(value);
                setShowPreview(false);
              }}
            >
              {value * 100}%
            </button>
          ))}
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={fictional}
            onChange={(e) => {
              setFictional(e.target.checked);
              setShowPreview(false);
            }}
          />
          使用虚构的 100 天基线演示约束计算（不是真实预测）
        </label>
        <button
          className="button secondary"
          onClick={() => setShowPreview(true)}
        >
          预览计划调整
          <ArrowRight size={16} />
        </button>
        {showPreview && (
          <div className="plan-preview">
            <strong>
              {preview.feasible
                ? `演示请求：100 天 → ${preview.remainingDays} 天`
                : "暂不能生成加速计划"}
            </strong>
            <p>{preview.message}</p>
            <p>
              每日 {state.profile.timeBudget} 分钟 · 复习与休息预留不变 ·
              实际预测仍为评估中
            </p>
            {preview.feasible && (
              <button
                className="button primary"
                onClick={() => {
                  onChange({
                    ...state,
                    plan: {
                      version: state.plan.version + 1,
                      compression: ratio,
                      baselineId: "fictional-independent-100-days-v1",
                    },
                  });
                  notify("已保存演示请求；不代表学习或身体达标承诺。");
                  setShowPreview(false);
                }}
              >
                确认演示调整
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
