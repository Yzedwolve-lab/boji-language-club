"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  AudioLines,
  BookOpen,
  BookmarkPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Headphones,
  History,
  Lightbulb,
  LockKeyhole,
  Mic,
  Pause,
  PenLine,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Upload,
  Volume2,
} from "lucide-react";
import {
  addSavedWord,
  AudioDataDeletedError,
  countWords,
  emptyLearningProgress,
  evaluateObjective,
  getAudioGeneration,
  getLesson,
  learningAverage,
  learningPassed,
  markWordReviewed,
  normalizeAnswer,
  planVocabulary,
  readRecordingBlob,
  saveRecordingBlob,
  TASKS,
  wordId,
  type LearningProgress,
  type Question,
  type Recording,
  type TaskKey,
  type Word,
} from "../lib/lessons";
import "./learning.css";
import type { AIStarterPlan } from "@/lib/ai-types";

export { emptyLearningProgress };
export type { LearningProgress };
type Props = {
  value: LearningProgress;
  onChange: (next: LearningProgress) => void;
  timeBudget: 30 | 60 | 120 | 240;
  disabled?: boolean;
  dayIndex: number;
  aiPlan?: AIStarterPlan;
};
const DETAILS = {
  vocabulary: { label: "词汇", english: "Vocabulary", icon: BookOpen },
  listening: { label: "听力", english: "Listening", icon: Headphones },
  reading: { label: "阅读", english: "Reading", icon: BookOpen },
  writing: { label: "写作", english: "Writing", icon: PenLine },
  speaking: { label: "口语", english: "Speaking", icon: Mic },
};
const MINUTES = {
  30: [4, 4, 3, 5, 5],
  60: [8, 10, 7, 12, 10],
  120: [12, 22, 16, 24, 24],
  240: [20, 40, 35, 45, 40],
};
const WRITING_CHECKS = [
  ["writing-content", "内容：我回应了题目要求的每个要点。"],
  ["writing-structure", "组织：我按“行动 → 原因 → 调整”的顺序检查了表达。"],
  ["writing-grammar", "语法：我检查了时态、主谓一致和句子是否完整。"],
  ["writing-words", "词汇：我确认用词符合自己想表达的意思。"],
] as const;
const BUDDY_STARTERS: Record<TaskKey, { title: string; message: string }> = {
  vocabulary: {
    title: "New words just dropped. 👀",
    message: "先和新词混个脸熟，再收起词卡试着回忆。我在，卡住就一起拆招。",
  },
  listening: {
    title: "Headphones on. Detective mode. 🎧",
    message:
      "找出时间、动作和原因这些小线索。没听清就再来一遍，这里没有抢答倒计时。",
  },
  reading: {
    title: "The clues are literally right here. 🔎",
    message: "答案线索都在文章里。遇到不认识的词，选中它就能收进生词本。",
  },
  writing: {
    title: "Your draft has entered the chat. ✍️",
    message:
      "先把你的想法写出来，再做四步自查。现在完成的是自评练习，还没有 AI 作文评分。",
  },
  speaking: {
    title: "Mic check. Main character moment. 🎙️",
    message:
      "录一段，听一遍，也可以先写英文提纲。录音会留在本机，发音和流利度暂时不能评分。",
  },
};

function outcomeLine(task: TaskKey, score: number | null, failures: number) {
  if (score === null) return "The tech needs a minute. You're good. 🛠️";
  if (score >= 60) {
    if (task === "writing" || task === "speaking")
      return "You showed up. That's a W. ✨";
    return score === 100
      ? "You ate that. No crumbs. ✨"
      : "Progress unlocked. Keep cooking. 🚀";
  }
  return failures > 1
    ? "Okay, plot twist. Let's switch the strategy. 🧩"
    : "Plot twist: this one needs a remix. 😏";
}

function aliases(word: Word): string[] {
  if (word.lemma === "organize" || word.lemma === "organise")
    return ["organize", "organise"];
  if (word.lemma === "practice" || word.lemma === "practise")
    return ["practice", "practise"];
  return [word.lemma];
}

function RecordingPlayer({ recording }: { recording: Recording }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    let objectUrl = "";
    readRecordingBlob(recording.id)
      .then((blob) => {
        if (!live) return;
        if (!blob) {
          setError("本地音频已清理，请重新录音或使用替代活动。");
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (live) setError("本地音频读取失败。替代活动仍然可用。");
      });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [recording.id]);
  return (
    <div className="learning-recording">
      <div>
        <AudioLines size={17} />
        <span>{recording.name}</span>
        <small>{Math.round(recording.size / 1024)} KB · 仅保存在此浏览器</small>
      </div>
      {url && (
        <audio
          controls
          src={url}
          aria-label={`Play ${recording.name}`}
          onError={() =>
            setError(
              "音频无法解码，不计为学习失败。请换用其他格式或完成替代活动。",
            )
          }
        />
      )}
      {error && (
        <p role="status" className="learning-warning">
          {error}
        </p>
      )}
    </div>
  );
}

export function HistoricalRecordings({
  recordings = [],
}: {
  recordings?: Recording[];
}) {
  return recordings.length ? (
    <section
      className="learning learning-archived-audio"
      aria-label="历史录音回放"
    >
      <h4>历史录音 · 仅本地回放</h4>
      <p className="learning-muted">
        原始音频保留在此浏览器；录音没有发音或流利度评分。清除本机数据后音频不可恢复。
      </p>
      {recordings.map((recording) => (
        <RecordingPlayer key={recording.id} recording={recording} />
      ))}
    </section>
  ) : null;
}

/** Checks that this browser can decode the file. It does not evaluate speech. */
function validatePlayableAudio(blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(blob);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      audio.oncanplay = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve();
    };
    const timeout = window.setTimeout(
      () =>
        finish(
          new Error("音频加载超时，尚未保存。请换用其他格式或完成替代活动。"),
        ),
      8000,
    );
    audio.preload = "auto";
    audio.oncanplay = () => finish();
    audio.onerror = () =>
      finish(
        new Error(
          "音频无法解码，未保存且不计为学习失败。请换用有效音频或完成替代活动。",
        ),
      );
    audio.src = url;
    audio.load();
  });
}

export default function LearningPanel({
  value,
  onChange,
  timeBudget,
  disabled = false,
  dayIndex,
  aiPlan,
}: Props) {
  const lesson = getLesson(dayIndex);
  const plannedTasks = aiPlan?.english.tasks;
  const minutes = TASKS.map(
    (key, index) =>
      plannedTasks?.find((task) => task.component === key)?.minutes ??
      MINUTES[timeBudget][index],
  );
  const [active, setActive] = useState<TaskKey>("vocabulary");
  const [initialPlan] = useState(() =>
    planVocabulary(
      value.words ?? [],
      lesson.words,
      timeBudget === 30
        ? 3
        : timeBudget === 60
          ? 6
          : timeBudget === 120
            ? 9
            : 12,
      new Date().toISOString(),
    ),
  );
  const studyWords = value.vocabularySet ?? [
    ...initialPlan.review,
    ...initialPlan.fresh,
  ];
  const reviewIds =
    value.vocabularyReviewIds ?? initialPlan.review.map((word) => word.id);
  const [showVocabulary, setShowVocabulary] = useState(true);
  const [speechStatus, setSpeechStatus] = useState<
    "idle" | "playing" | "error"
  >("idle");
  const [recorderStatus, setRecorderStatus] = useState<
    "idle" | "requesting" | "recording" | "saving" | "error"
  >("idle");
  const [recordingError, setRecordingError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [prepSeconds, setPrepSeconds] = useState<number | null>(null);
  const [selectedWord, setSelectedWord] = useState("");
  const [wordMeaning, setWordMeaning] = useState("");
  const [notice, setNotice] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingRequestRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  }, [value, onChange]);
  const mounted = useRef(true);
  const drafts = value.drafts ?? {};
  const checks = value.checked ?? {};
  const attempts = value.attempts ?? [];
  const failures = attempts.filter(
    (attempt) =>
      attempt.task === active && attempt.score !== null && attempt.score < 60,
  ).length;
  const retry = failures >= 2;
  const currentScore = value[active];
  const passed = currentScore !== null && currentScore >= 60;
  const finished = learningPassed(value);
  const average = learningAverage(value);
  const completedCount = TASKS.filter(
    (key) => value[key] !== null && value[key]! >= 60,
  ).length;
  const currentAttempt = [...attempts]
    .reverse()
    .find(
      (attempt) =>
        attempt.task === active &&
        (currentScore === null || attempt.score !== null),
    );
  const hasSystemIssue =
    (active === "speaking" && Boolean(recordingError)) ||
    (active === "listening" && speechStatus === "error");
  const buddyTone = hasSystemIssue
    ? "hint"
    : currentAttempt
      ? passed
        ? "win"
        : currentAttempt.score === null
          ? "hint"
          : "retry"
      : "hint";
  const buddyTitle = hasSystemIssue
    ? "It's a tech wobble, not a you problem. 🛠️"
    : currentAttempt
      ? outcomeLine(active, currentAttempt.score, failures)
      : BUDDY_STARTERS[active].title;
  const buddyMessage = hasSystemIssue
    ? "设备或播放服务打了个盹，不算你答错。草稿还在，按下方提示重试，或选替代活动继续。"
    : currentAttempt
      ? passed
        ? active === "writing" || active === "speaking"
          ? "替代活动完成，认真练习这件事值得一个 high five！具体能力还需要真实评估。"
          : "这一项已经拿下！完成的结果会保留，下一项等你来。"
        : currentAttempt.score === null
          ? "素材已经保存，但评估服务还没接上。先回放自检，或用替代活动继续，不会把系统问题算成你的错。"
          : failures > 1
            ? "这题有点黏人。先看讲解，再试下方同难度的新题；已经完成的项目不用重来。"
            : "这是错滴，答案先别急着出道 😂 看看标出的提示，再改这一项就好。我还在，陪你重来。"
      : BUDDY_STARTERS[active].message;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recordingRequestRef.current += 1;
      if (recorderRef.current?.state === "recording")
        recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);
  useEffect(() => {
    if (recorderStatus !== "recording") return;
    const timer = window.setInterval(
      () => setSeconds((elapsed) => elapsed + 1),
      1000,
    );
    const limit = window.setTimeout(() => {
      if (recorderRef.current?.state === "recording")
        recorderRef.current.stop();
    }, 90000);
    return () => {
      clearInterval(timer);
      clearTimeout(limit);
    };
  }, [recorderStatus]);
  useEffect(() => {
    if (prepSeconds === null || prepSeconds <= 0) return;
    const timer = window.setTimeout(
      () =>
        setPrepSeconds((remaining) =>
          remaining === null ? null : Math.max(0, remaining - 1),
        ),
      1000,
    );
    return () => clearTimeout(timer);
  }, [prepSeconds]);

  function change(patch: Partial<LearningProgress>) {
    onChange({ ...value, ...patch });
  }
  function selectActivity(key: TaskKey, focusTab = false) {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeechStatus("idle");
    if (active === "speaking" && key !== active) {
      recordingRequestRef.current += 1;
      if (recorderRef.current?.state === "recording")
        recorderRef.current.stop();
      if (recorderStatus === "requesting") setRecorderStatus("idle");
    }
    setActive(key);
    setNotice("");
    if (focusTab) document.getElementById(`tab-${key}`)?.focus();
  }
  function saveDraft(key: string, text: string) {
    change({
      drafts: { ...drafts, [key]: text },
      ...(active === "vocabulary"
        ? { vocabularySet: studyWords, vocabularyReviewIds: reviewIds }
        : {}),
    });
  }
  function toggle(key: string) {
    change({ checked: { ...checks, [key]: !checks[key] } });
  }
  function appendAttempt(
    task: TaskKey,
    input: string,
    score: number | null,
    feedback: string,
    kind: string,
    patch: Partial<LearningProgress> = {},
  ) {
    const attempt = {
      id: crypto.randomUUID(),
      task,
      input,
      score,
      createdAt: new Date().toISOString(),
      feedback,
      kind: value.answersRevealed ? `post_reveal_${kind}` : kind,
    };
    change({ ...patch, [task]: score, attempts: [...attempts, attempt] });
    setNotice("Saved. 这次尝试收好啦，其他项目的进度也都还在。💾");
  }

  function vocabularyQuestions(): Question[] {
    const isOriginal =
      studyWords.length === lesson.words.length &&
      studyWords.every(
        (word, index) => wordId(word) === wordId(lesson.words[index]),
      );
    if (isOriginal)
      return retry ? lesson.vocabularyRetry : lesson.vocabularyQuestions;
    return studyWords.map((word) => ({
      id: `${lesson.id}-${wordId(word)}-${retry ? "parallel" : "review"}`,
      prompt: retry
        ? `Complete the expression: ${word.collocation.replace(new RegExp(word.lemma.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "______")}`
        : `Write the word meaning “${word.meaning}”.`,
      answers: aliases(word),
      hint: `以 ${word.lemma[0]} 开头；${word.part}。${word.meaning}`,
      explanation: `${word.lemma} — ${word.meaning}。${word.example}`,
    }));
  }
  const questions =
    active === "vocabulary"
      ? vocabularyQuestions()
      : active === "listening"
        ? retry
          ? lesson.listeningRetry
          : lesson.listeningQuestions
        : active === "reading"
          ? retry
            ? lesson.readingRetry
            : lesson.readingQuestions
          : [];

  function submitObjective(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      disabled ||
      passed ||
      (active === "listening" &&
        value.listeningMode !== "text" &&
        (!value.playbackCount || speechStatus === "error"))
    )
      return;
    const result = evaluateObjective(questions, drafts);
    const now = new Date().toISOString();
    let words = value.words ?? [];
    if (active === "vocabulary") {
      studyWords.forEach((word, index) => {
        words = addSavedWord(
          words,
          word,
          `Day ${dayIndex} · ${lesson.title} · vocabulary`,
          now,
        );
        words = words.map((saved) =>
          saved.id === wordId(word)
            ? markWordReviewed(
                saved,
                !result.wrongIds.includes(questions[index].id),
                now,
              )
            : saved,
        );
      });
    }
    const feedback =
      result.score >= 60
        ? `${questions.length - result.wrongIds.length}/${questions.length} 项正确。${active === "listening" && value.listeningMode === "text" ? "本次为文字阅读替代，不作为听辨能力证据。" : "按题目接受的答案变体判定。"}`
        : `${questions.length - result.wrongIds.length}/${questions.length} 项正确。请复习标出的提示，然后只重做这一项。`;
    appendAttempt(
      active,
      questions.map((q) => `${q.prompt}\n${drafts[q.id] ?? ""}`).join("\n\n"),
      result.score,
      feedback,
      active === "listening" && value.listeningMode === "text"
        ? "accessible_reading"
        : "objective_practice",
      active === "vocabulary"
        ? { words, vocabularySet: studyWords, vocabularyReviewIds: reviewIds }
        : {},
    );
  }

  function speak(text: string, isListening = false) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSpeechStatus("error");
      setNotice(
        "此浏览器无法播放合成语音。请使用文字阅读替代；系统问题不计为答错。",
      );
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB";
    utterance.rate = 0.9;
    utterance.onstart = () => {
      if (mounted.current) setSpeechStatus("playing");
    };
    utterance.onend = () => {
      if (mounted.current) setSpeechStatus("idle");
    };
    utterance.onerror = (event) => {
      if (event.error === "canceled" || event.error === "interrupted") return;
      if (mounted.current) {
        setSpeechStatus("error");
        setNotice("合成语音播放失败。可直接切换文字阅读替代，不计为学习失败。");
      }
    };
    if (isListening) change({ playbackCount: (value.playbackCount ?? 0) + 1 });
    window.speechSynthesis.speak(utterance);
  }

  async function storeAudio(blob: Blob, name: string, generation: number) {
    if (!blob.size) {
      if (mounted.current) {
        setRecordingError("没有录到有效音频。请检查设备或使用替代活动。");
        setRecorderStatus("error");
      }
      return;
    }
    if (blob.size > 10 * 1024 * 1024) {
      if (mounted.current) {
        setRecordingError("请选择 10 MB 以内的音频。原有录音保留。");
        setRecorderStatus("error");
      }
      return;
    }
    const recording: Recording = {
      id: crypto.randomUUID(),
      name,
      size: blob.size,
      type: blob.type,
      createdAt: new Date().toISOString(),
    };
    if (mounted.current) setRecorderStatus("saving");
    try {
      await validatePlayableAudio(blob);
      await saveRecordingBlob(recording.id, blob, generation);
      const current = latest.current.value;
      latest.current.onChange({
        ...current,
        recordings: [...(current.recordings ?? []), recording],
        pronunciation: null,
        fluency: null,
        attempts: [
          ...current.attempts,
          {
            id: crypto.randomUUID(),
            task: "speaking",
            input: `Local audio: ${recording.id} · ${name}`,
            score: null,
            createdAt: recording.createdAt,
            feedback:
              "音频仅本地保存；音频评估服务未配置，发音与流利度不可评估。",
            kind: "audio_unavailable",
          },
        ],
      });
      if (mounted.current) {
        setRecorderStatus("idle");
        setRecordingError("");
        setNotice(
          "Voice note secured. 🎙️ 录音已保存在此浏览器，回放听听自己的表达；此操作不产生口语分数。",
        );
      }
    } catch (error) {
      if (mounted.current) {
        setRecorderStatus("error");
        setRecordingError(
          error instanceof AudioDataDeletedError ||
            (error instanceof Error && /音频/.test(error.message))
            ? error.message
            : "本地存储失败，可能已达到浏览器容量限制。可重试或完成替代活动。",
        );
      }
    }
  }

  async function uploadAudio(file: File) {
    setRecorderStatus("saving");
    setRecordingError("");
    try {
      const generation = await getAudioGeneration();
      await storeAudio(file, file.name, generation);
    } catch {
      if (mounted.current) {
        setRecorderStatus("error");
        setRecordingError(
          "本地音频存储不可用。请检查浏览器设置或选择替代活动。",
        );
      }
    }
  }

  async function startRecording() {
    if (
      disabled ||
      recorderStatus === "recording" ||
      recorderStatus === "requesting" ||
      recorderStatus === "saving"
    )
      return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setRecorderStatus("error");
      setRecordingError(
        "当前浏览器不支持录音。可以上传自己的录音，或选择下方无障碍替代活动。",
      );
      return;
    }
    const requestId = ++recordingRequestRef.current;
    setRecorderStatus("requesting");
    setRecordingError("");
    try {
      const generation = await getAudioGeneration();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || requestId !== recordingRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setRecorderStatus("error");
        setRecordingError(
          "录音设备出现问题。此状态不计为答错，请重试或选择替代活动。",
        );
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        void storeAudio(
          new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          }),
          `Practice ${new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}`,
          generation,
        );
      };
      recorder.start();
      setSeconds(0);
      setRecorderStatus("recording");
    } catch (error) {
      if (!mounted.current || requestId !== recordingRequestRef.current) return;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setRecorderStatus("error");
      setRecordingError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "麦克风权限被拒绝。可以在浏览器设置中重新授权，也可以上传录音或完成下方替代活动。"
          : "无法连接麦克风。请检查设备，或使用下方替代活动。",
      );
    }
  }

  function saveSelectedWord() {
    if (!selectedWord || !wordMeaning.trim() || disabled) return;
    const word: Word = {
      lemma: selectedWord.toLowerCase(),
      sense: normalizeAnswer(wordMeaning),
      meaning: wordMeaning.trim(),
      part: "自选词义",
      collocation: selectedWord,
      example:
        lesson.reading
          .split(/(?<=[.!?])\s+/)
          .find((sentence) =>
            sentence.toLowerCase().includes(selectedWord.toLowerCase()),
          ) ?? lesson.reading,
    };
    change({
      words: addSavedWord(
        value.words ?? [],
        word,
        `Day ${dayIndex} · 原创阅读 ${lesson.id}`,
        new Date().toISOString(),
      ),
    });
    setNotice(
      `Word collected. ✨ “${selectedWord}”已加入生词本，原句和出处也收好了。它会占用后续计划配额，收藏不等于已掌握。`,
    );
    setSelectedWord("");
    setWordMeaning("");
  }

  function submitWriting(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      disabled ||
      passed ||
      countWords(drafts.writing ?? "") < 30 ||
      !WRITING_CHECKS.every(([key]) => checks[key])
    )
      return;
    appendAttempt(
      "writing",
      drafts.writing,
      80,
      "自评替代练习已完成（固定活动完成分 80）。已保存你的原稿和自查确认；未进行 AI 内容、组织、语法或词汇评分。这不能证明作文质量或考试水平。",
      "self_review_alternative",
    );
  }
  function submitSpeaking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      disabled ||
      passed ||
      countWords(drafts.speaking ?? "") < 15 ||
      !checks["speaking-outline"] ||
      !checks["speaking-review"]
    )
      return;
    appendAttempt(
      "speaking",
      drafts.speaking,
      80,
      "表达准备替代活动已完成（固定活动完成分 80）。仅记录提纲与自查，不评估口语能力。发音：不可评估；流利度：不可评估。",
      "accessible_outline",
      { pronunciation: null, fluency: null },
    );
  }

  function renderQuestions() {
    return (
      <form onSubmit={submitObjective} className="learning-question-form">
        <fieldset disabled={disabled || passed}>
          {questions.map((question, index) => {
            const hasAnswer = Boolean(drafts[question.id]?.trim());
            const wrong =
              currentScore !== null &&
              currentScore < 60 &&
              !question.answers.some(
                (answer) =>
                  normalizeAnswer(answer) ===
                  normalizeAnswer(drafts[question.id] ?? ""),
              );
            return (
              <div
                key={question.id}
                className={`learning-question ${wrong ? "learning-question-needs-review" : ""}`}
              >
                <label htmlFor={question.id}>
                  <span className="learning-question-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {question.prompt}
                </label>
                {question.options ? (
                  <div
                    className="learning-options"
                    role="group"
                    aria-label={question.prompt}
                  >
                    {question.options.map((option) => (
                      <label
                        key={option}
                        className={
                          drafts[question.id] === option ? "is-selected" : ""
                        }
                      >
                        <input
                          type="radio"
                          name={question.id}
                          required
                          value={option}
                          checked={drafts[question.id] === option}
                          onChange={() => saveDraft(question.id, option)}
                        />
                        <span>{option}</span>
                        {drafts[question.id] === option && <Check size={15} />}
                      </label>
                    ))}
                  </div>
                ) : (
                  <input
                    id={question.id}
                    className="learning-input"
                    value={drafts[question.id] ?? ""}
                    onChange={(event) =>
                      saveDraft(question.id, event.target.value)
                    }
                    placeholder="Type your answer…"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    maxLength={100}
                  />
                )}
                {wrong && (
                  <small className="learning-hint">
                    <Lightbulb size={14} />
                    {question.hint}
                  </small>
                )}
                {!hasAnswer && passed && (
                  <small className="learning-muted">
                    此项目已完成，记录见下方历史尝试。
                  </small>
                )}
              </div>
            );
          })}
          {!passed && (
            <button
              type="submit"
              className="learning-primary"
              disabled={
                questions.some((question) => !drafts[question.id]?.trim()) ||
                (active === "listening" &&
                  value.listeningMode !== "text" &&
                  (!value.playbackCount || speechStatus === "error"))
              }
            >
              {currentScore === null ? "检查我的答案" : "重做这一项"}
              <ArrowRight size={16} />
            </button>
          )}
        </fieldset>
      </form>
    );
  }

  return (
    <section className="learning" aria-labelledby="learning-title">
      <div className="learning-heading">
        <div>
          <span className="learning-eyebrow">
            LANGUAGE CLUB / LET&apos;S TALK
          </span>
          <h2 id="learning-title">
            语言局，开麦啦<span> ✦</span>
          </h2>
          <p>五个小关卡，我陪你练。今天的英语，主角是你。😎</p>
        </div>
        <span className="learning-day">
          DAY {String(dayIndex).padStart(2, "0")}
          <small>原创微练习</small>
        </span>
      </div>
      <div className="learning-summary">
        <div className="learning-summary-track">
          <span style={{ width: `${(completedCount / 5) * 100}%` }} />
        </div>
        <span>
          <strong>{completedCount}</strong> / 5 项完成
        </span>
        <span className="learning-summary-time">
          <Clock3 size={14} />
          {minutes.reduce((sum, value) => sum + value, 0)} 分钟语言预算
        </span>
      </div>
      <div
        className="learning-tabs"
        role="tablist"
        aria-label="语言训练项目"
        onKeyDown={(event) => {
          const index = TASKS.indexOf(active);
          const nextIndex =
            event.key === "ArrowRight"
              ? (index + 1) % TASKS.length
              : event.key === "ArrowLeft"
                ? (index + TASKS.length - 1) % TASKS.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? TASKS.length - 1
                    : null;
          if (nextIndex !== null) {
            event.preventDefault();
            selectActivity(TASKS[nextIndex], true);
          }
        }}
      >
        {TASKS.map((key, index) => {
          const Icon = DETAILS[key].icon;
          const done = value[key] !== null && value[key]! >= 60;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              tabIndex={active === key ? 0 : -1}
              aria-selected={active === key}
              aria-controls={`learning-${key}`}
              id={`tab-${key}`}
              onClick={() => selectActivity(key)}
              className={`${active === key ? "is-active" : ""} ${done ? "is-done" : ""}`}
            >
              <span className="learning-tab-icon">
                {done ? <CheckCircle2 size={18} /> : <Icon size={18} />}
              </span>
              <span>
                {DETAILS[key].label}
                <small>{minutes[index]} MIN</small>
              </span>
            </button>
          );
        })}
      </div>
      <div
        className={`learning-buddy is-${buddyTone}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="learning-buddy-avatar" aria-hidden="true">
          {buddyTone === "win" ? "😎" : buddyTone === "retry" ? "🤨" : "👾"}
        </span>
        <div className="learning-buddy-bubble">
          <span className="learning-buddy-name">BOJI / 你的嘴替搭子</span>
          <strong lang="en">{buddyTitle}</strong>
          <p>{buddyMessage}</p>
        </div>
      </div>
      <article
        className="learning-activity"
        id={`learning-${active}`}
        role="tabpanel"
        aria-labelledby={`tab-${active}`}
      >
        <div className="learning-activity-heading">
          <div>
            <span className="learning-kicker">
              {String(TASKS.indexOf(active) + 1).padStart(2, "0")} /{" "}
              {DETAILS[active].english}
            </span>
            <h3>
              {active === "vocabulary"
                ? "新词来串门，认识一下？"
                : active === "listening"
                  ? "Listen for the little details."
                  : active === "reading"
                    ? lesson.title
                    : active === "writing"
                      ? "Your words. Your main character arc."
                      : "Your voice has entered the chat."}
            </h3>
          </div>
          <span className={`learning-status ${passed ? "is-complete" : ""}`}>
            {passed ? (
              <>
                <CheckCircle2 size={14} />
                已完成
              </>
            ) : (
              <>
                <Clock3 size={14} />
                {minutes[TASKS.indexOf(active)]} 分钟
              </>
            )}
          </span>
        </div>
        {plannedTasks && (
          <div className="learning-info ai-daily-instruction" role="note">
            <div>
              <strong>
                已保存的 AI 练习安排 · {aiPlan?.forDate ?? "日期待更新"} ·{" "}
                {minutes[TASKS.indexOf(active)]} 分钟
              </strong>
              <p lang="en">
                {
                  plannedTasks.find((task) => task.component === active)
                    ?.instruction
                }
              </p>
              <small>
                按这条安排练习；下方题目仍是固定原创演示练习，未由 AI
                生成，也不等于 AI 能力评分。
              </small>
            </div>
          </div>
        )}
        {disabled && (
          <p className="learning-info">
            <LockKeyhole size={16} />
            本期已结算，原始尝试已锁定。可以查看复盘和回放。
          </p>
        )}
        {retry && !passed && (
          <div className="learning-scaffold">
            <Lightbulb size={18} />
            <div>
              <strong>New strategy just dropped. 🧩</strong>
              <p>
                先回看词义或原文，留意时间、动作和因果。下面已换成同难度的新题；已经完成的项目会保留。
              </p>
            </div>
          </div>
        )}

        {active === "vocabulary" && (
          <>
            <p className="learning-muted">
              {reviewIds.length
                ? `${reviewIds.length} 个到期复习优先，剩余配额安排新词。`
                : "先认识词义与搭配，再收起词卡进行回忆练习。"}{" "}
              词卡语音为浏览器合成语音。
            </p>
            <button
              className="learning-text-button"
              type="button"
              onClick={() => setShowVocabulary(!showVocabulary)}
            >
              <ChevronDown size={16} />
              {showVocabulary ? "收起词卡，开始回忆" : "展开词卡复习"}
              <span>{studyWords.length} WORDS</span>
            </button>
            {showVocabulary && (
              <div className="learning-word-grid">
                {studyWords.map((word, index) => (
                  <div className="learning-word-card" key={wordId(word)}>
                    <div className="learning-word-top">
                      <span>
                        {reviewIds.includes(wordId(word))
                          ? "REVIEW / 复习"
                          : "NEW / 新词"}{" "}
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <button
                        type="button"
                        title={`Play ${word.lemma} (synthetic voice)`}
                        aria-label={`Play ${word.lemma} (synthetic voice)`}
                        onClick={() => speak(word.lemma)}
                      >
                        <Volume2 size={16} />
                      </button>
                    </div>
                    <h4>{word.lemma}</h4>
                    <p className="learning-word-meaning">
                      <em>{word.part}</em> {word.meaning}
                    </p>
                    <p className="learning-collocation">{word.collocation}</p>
                    <p className="learning-example">{word.example}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="learning-grammar">
              <Sparkles size={17} />
              <div>
                <strong>今日一个结构 · Present simple</strong>
                <p>
                  用一般现在时描述习惯。I practise every morning. / She
                  practises every morning.
                </p>
              </div>
            </div>
            {initialPlan.deferred > 0 && (
              <p className="learning-muted">
                另有 {initialPlan.deferred} 个词留待后续，今天不追加预算。
              </p>
            )}
            {renderQuestions()}
          </>
        )}

        {active === "listening" && (
          <>
            <p className="learning-muted">
              原创短音频 · 浏览器合成语音 · 首听抓主旨，复听找细节。
            </p>
            <div className="learning-audio-player">
              <button
                type="button"
                className="learning-play"
                aria-label={
                  speechStatus === "playing"
                    ? "Pause listening audio"
                    : "Play listening audio"
                }
                onClick={() => {
                  if (speechStatus === "playing") {
                    window.speechSynthesis.cancel();
                    setSpeechStatus("idle");
                  } else speak(lesson.transcript, true);
                }}
              >
                {speechStatus === "playing" ? (
                  <Pause size={21} fill="currentColor" />
                ) : (
                  <Play size={21} fill="currentColor" />
                )}
              </button>
              <div
                className={`learning-wave ${speechStatus === "playing" ? "is-playing" : ""}`}
                aria-hidden="true"
              >
                {Array.from({ length: 32 }, (_, index) => (
                  <i
                    key={index}
                    style={{
                      height: `${[12, 24, 37, 18, 30, 43, 20, 34][index % 8]}px`,
                      animationDelay: `${index * 25}ms`,
                    }}
                  />
                ))}
              </div>
              <div className="learning-audio-caption">
                <strong>Listening note</strong>
                <small>
                  {value.playbackCount
                    ? `播放请求 ${value.playbackCount} 次`
                    : "准备好，就开始"}
                </small>
              </div>
            </div>
            <div className="learning-audio-help">
              <span>播放故障不算答错。</span>
              <button
                type="button"
                className="learning-text-button"
                disabled={disabled || passed}
                onClick={() =>
                  change({
                    listeningMode:
                      value.listeningMode === "text" ? "audio" : "text",
                  })
                }
              >
                {value.listeningMode === "text"
                  ? "切回音频练习"
                  : "无法播放？使用文字替代"}
                <ArrowRight size={14} />
              </button>
            </div>
            {speechStatus === "error" && (
              <p className="learning-warning" role="status">
                系统播放不可用。请使用文字阅读替代；你的草稿已保留。
              </p>
            )}
            {value.listeningMode === "text" && (
              <div className="learning-transcript">
                <span className="learning-kicker">
                  无障碍文字阅读替代 · 不评估听辨能力
                </span>
                <p lang="en">{lesson.transcript}</p>
              </div>
            )}
            {renderQuestions()}
          </>
        )}

        {active === "reading" && (
          <>
            <p className="learning-muted">
              {lesson.subtitle} 阅读时选中一个英文单词，可加入生词本。
            </p>
            <div
              className="learning-passage"
              lang="en"
              onMouseUp={(event) => {
                const selection = window.getSelection();
                if (
                  !selection?.anchorNode ||
                  !event.currentTarget.contains(selection.anchorNode)
                )
                  return;
                const text = selection.toString().trim();
                if (
                  /^[A-Za-z]+(?:['’-][A-Za-z]+)?$/.test(text) &&
                  text.length < 40
                )
                  setSelectedWord(text);
              }}
            >
              <span className="learning-passage-mark">
                READING NOTE / {countWords(lesson.reading)} WORDS
              </span>
              <p>{lesson.reading}</p>
              <footer>BOJI ORIGINALS · 原创材料，非考试真题</footer>
            </div>
            <details
              className="learning-add-word"
              open={selectedWord ? true : undefined}
            >
              <summary>
                <BookmarkPlus size={16} />
                加入生词（也支持键盘输入）
              </summary>
              <div className="learning-word-inputs">
                <label>
                  Word
                  <input
                    value={selectedWord}
                    onChange={(event) => setSelectedWord(event.target.value)}
                    maxLength={40}
                    placeholder="e.g. gradual"
                    disabled={disabled}
                  />
                </label>
                <label>
                  目标词义
                  <input
                    value={wordMeaning}
                    onChange={(event) => setWordMeaning(event.target.value)}
                    maxLength={80}
                    placeholder="你想学习的中文词义"
                    disabled={disabled}
                  />
                </label>
                <button
                  type="button"
                  className="learning-secondary"
                  disabled={
                    disabled ||
                    !/^[A-Za-z]+(?:['’-][A-Za-z]+)?$/.test(selectedWord) ||
                    !wordMeaning.trim() ||
                    !lesson.reading
                      .toLowerCase()
                      .includes(selectedWord.toLowerCase())
                  }
                  onClick={saveSelectedWord}
                >
                  <BookmarkPlus size={16} />
                  保存
                </button>
              </div>
              <small>
                保存原句与出处，按“词形 +
                目标词义”去重。加入不代表已掌握；占用后续新词配额。
              </small>
            </details>
            {renderQuestions()}
          </>
        )}

        {active === "writing" && (
          <>
            <div className="learning-task-prompt">
              <span className="learning-kicker">
                FOUNDATION PARAGRAPH · 30–100 WORDS
              </span>
              <p lang="en">{lesson.writingPrompt}</p>
            </div>
            <p className="learning-info">
              <PenLine size={16} />
              演示模式：完成原稿与四项自评。未连接 AI，不生成作文质量分。
            </p>
            <form onSubmit={submitWriting}>
              <fieldset disabled={disabled || passed}>
                <label className="learning-field-label" htmlFor="writing-draft">
                  Your draft <span>每次提交保留原稿</span>
                </label>
                <textarea
                  id="writing-draft"
                  value={drafts.writing ?? ""}
                  onChange={(event) => saveDraft("writing", event.target.value)}
                  rows={7}
                  maxLength={4000}
                  placeholder="One small habit I want to build is…"
                  required
                />
                <div className="learning-word-count">
                  <span>{countWords(drafts.writing ?? "")} words</span>
                  <span>至少 30 词仅为格式要求，不代表质量通过</span>
                </div>
                <div className="learning-rubric">
                  <strong>提交前，亲自检查这四件事</strong>
                  {WRITING_CHECKS.map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={checks[key] ?? false}
                        onChange={() => toggle(key)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                {!passed && (
                  <button
                    className="learning-primary"
                    type="submit"
                    disabled={
                      countWords(drafts.writing ?? "") < 30 ||
                      !WRITING_CHECKS.every(([key]) => checks[key])
                    }
                  >
                    完成自评替代练习
                    <ArrowRight size={16} />
                  </button>
                )}
              </fieldset>
            </form>
            <details className="learning-help">
              <summary>
                <Lightbulb size={16} />
                需要一点写作支架？
              </summary>
              <p>
                先用自己的话回答：What will I do? → When and why? → What if my
                plan changes? 最后检查句子是否围绕同一个主题。
              </p>
              <p>
                活动完成分固定为
                80，仅记录自评任务完成。正式内容、组织、语法、词汇评分均不可用；不能用字数推断写作水平。
              </p>
            </details>
          </>
        )}

        {active === "speaking" && (
          <>
            <div className="learning-task-prompt">
              <span className="learning-kicker">
                SPEAKING PROMPT · PRACTISE AT YOUR PACE
              </span>
              <p lang="en">{lesson.speakingPrompt}</p>
            </div>
            <div className="learning-recording-studio">
              <div
                className={`learning-mic-orb ${recorderStatus === "recording" ? "is-recording" : ""}`}
              >
                <Mic size={26} />
              </div>
              <strong>
                {recorderStatus === "recording"
                  ? `Recording · ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
                  : recorderStatus === "saving"
                    ? "正在检查并保存到本地…"
                    : recorderStatus === "requesting"
                      ? "等待麦克风授权…"
                      : "Mic is yours. Take your time. 🎙️"}
              </strong>
              <p>录音与回放仅在此浏览器；每次录音最长 90 秒。</p>
              <div className="learning-record-controls">
                {recorderStatus === "recording" ? (
                  <button
                    className="learning-primary"
                    type="button"
                    onClick={() => recorderRef.current?.stop()}
                  >
                    <Square size={15} fill="currentColor" />
                    停止并保存
                  </button>
                ) : (
                  <button
                    className="learning-primary"
                    type="button"
                    disabled={
                      disabled ||
                      recorderStatus === "requesting" ||
                      recorderStatus === "saving"
                    }
                    onClick={() => void startRecording()}
                  >
                    <Mic size={16} />
                    {value.recordings?.length ? "再录一次" : "开始录音"}
                  </button>
                )}
                <label
                  className={`learning-secondary learning-upload ${disabled ? "is-disabled" : ""}`}
                >
                  <Upload size={16} />
                  上传录音
                  <input
                    type="file"
                    accept="audio/*,.webm,.ogg,.wav,.mp3,.m4a"
                    aria-label="Upload your own audio"
                    disabled={
                      disabled ||
                      recorderStatus === "recording" ||
                      recorderStatus === "saving"
                    }
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      if (
                        !file.type.startsWith("audio/") &&
                        !/\.(webm|ogg|wav|mp3|m4a)$/i.test(file.name)
                      ) {
                        setRecordingError("请选择音频文件。");
                        return;
                      }
                      void uploadAudio(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              <button
                type="button"
                className="learning-text-button"
                disabled={disabled || (prepSeconds !== null && prepSeconds > 0)}
                onClick={() => setPrepSeconds(30)}
              >
                <Clock3 size={14} />
                {prepSeconds === null
                  ? "开始 30 秒准备计时"
                  : prepSeconds > 0
                    ? `准备时间 ${prepSeconds}s`
                    : "准备时间结束 · 可自由开始"}
              </button>
            </div>
            {recordingError && (
              <p role="status" className="learning-warning">
                {recordingError}
              </p>
            )}
            {(value.recordings ?? []).map((recording) => (
              <RecordingPlayer key={recording.id} recording={recording} />
            ))}
            <div className="learning-audio-evidence">
              <span>
                发音 <strong>不可评估</strong>
              </span>
              <span>
                流利度 <strong>不可评估</strong>
              </span>
              <p>
                未配置音频评估服务。文件存在、录音时长或文字提纲均不能证明口语能力。
              </p>
            </div>
            <form onSubmit={submitSpeaking}>
              <fieldset disabled={disabled || passed}>
                <div className="learning-accessible-heading">
                  <span className="learning-kicker">
                    ACCESSIBLE ALTERNATIVE
                  </span>
                  <h4>表达准备 · 无障碍替代活动</h4>
                  <p>
                    用英文写下三个要点，再自行朗读或默读检查。不需要麦克风；仅记录学习习惯完成，不作为录音评分。
                  </p>
                </div>
                <label
                  className="learning-field-label"
                  htmlFor="speaking-outline"
                >
                  Your outline <span>至少 15 个英文单词</span>
                </label>
                <textarea
                  id="speaking-outline"
                  value={drafts.speaking ?? ""}
                  onChange={(event) =>
                    saveDraft("speaking", event.target.value)
                  }
                  rows={4}
                  maxLength={2000}
                  required
                  placeholder="What I do… / When I do it… / Why it helps…"
                />
                <div className="learning-word-count">
                  <span>{countWords(drafts.speaking ?? "")} words</span>
                </div>
                <div className="learning-rubric">
                  <label>
                    <input
                      type="checkbox"
                      checked={checks["speaking-outline"] ?? false}
                      onChange={() => toggle("speaking-outline")}
                    />
                    <span>我检查了提纲包含题目要求的三个要点。</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={checks["speaking-review"] ?? false}
                      onChange={() => toggle("speaking-review")}
                    />
                    <span>
                      我已用适合自己的方式朗读或默读，并调整不清楚的表达。
                    </span>
                  </label>
                </div>
                {!passed && (
                  <button
                    className="learning-primary"
                    type="submit"
                    disabled={
                      countWords(drafts.speaking ?? "") < 15 ||
                      !checks["speaking-outline"] ||
                      !checks["speaking-review"]
                    }
                  >
                    完成表达准备替代活动
                    <ArrowRight size={16} />
                  </button>
                )}
              </fieldset>
            </form>
          </>
        )}

        {currentAttempt && (
          <div
            className={`learning-feedback ${passed ? "is-passed" : ""}`}
            role="status"
          >
            {passed ? <CheckCircle2 size={19} /> : <Lightbulb size={19} />}
            <div>
              <strong>
                <span className="learning-feedback-line" lang="en">
                  {outcomeLine(active, currentAttempt.score, failures)}
                </span>
                {passed
                  ? active === "writing" || active === "speaking"
                    ? "替代活动已完成"
                    : "这一关，拿下！"
                  : currentAttempt.score === null
                    ? "评估服务不可用 · 不计为答错"
                    : "再 remix 一次，看看下面的提示"}
                {currentScore !== null && (
                  <span>
                    {currentScore} / 100{" "}
                    {active === "writing" || active === "speaking"
                      ? "活动完成分"
                      : "练习分"}
                  </span>
                )}
              </strong>
              <p>{currentAttempt.feedback}</p>
            </div>
          </div>
        )}
        {passed && active !== "speaking" && (
          <button
            className="learning-next"
            type="button"
            onClick={() =>
              selectActivity(TASKS[TASKS.indexOf(active) + 1], true)
            }
          >
            继续：{DETAILS[TASKS[TASKS.indexOf(active) + 1]].label}
            <ArrowRight size={17} />
          </button>
        )}
      </article>
      {notice && (
        <p className="learning-toast" role="status">
          <Check size={15} />
          {notice}
        </p>
      )}
      <div className={`learning-unlock ${finished ? "is-ready" : ""}`}>
        <div>
          {finished ? <Sparkles size={21} /> : <LockKeyhole size={21} />}
          <span>
            <strong>
              {finished
                ? "GG！今日完整复盘已解锁 ✨"
                : "集齐五项，完整复盘就到手啦 🔓"}
            </strong>
            <small>
              {finished
                ? `综合活动分 ${average} · 含自评与无障碍替代，不代表考试成绩`
                : "每项 ≥ 60，综合 ≥ 70 · 保留已通过项目，只重做需要帮助的部分"}
            </small>
          </span>
        </div>
        <button
          type="button"
          className="learning-secondary"
          disabled={!finished}
          onClick={() => change({ answersRevealed: true })}
        >
          {value.answersRevealed ? "已解锁" : "查看复盘"}
          <ArrowRight size={15} />
        </button>
      </div>
      {value.answersRevealed && finished && (
        <div className="learning-full-review">
          <h3>
            <Sparkles size={20} />
            今日完整复盘
          </h3>
          <p className="learning-muted">
            你已经查看答案。之后的练习会标记为看过答案后的练习，不作为首次独立能力证据，也不重复发
            XP。
          </p>
          <details open>
            <summary>词汇、听力与阅读答案</summary>
            {[
              [
                "词汇",
                [...lesson.vocabularyQuestions, ...lesson.vocabularyRetry],
              ],
              [
                "听力",
                [...lesson.listeningQuestions, ...lesson.listeningRetry],
              ],
              ["阅读", [...lesson.readingQuestions, ...lesson.readingRetry]],
            ].map(([label, items]) => (
              <div key={label as string}>
                <h4>{label as string}</h4>
                {(items as Question[]).map((question) => (
                  <p key={question.id}>
                    <strong>{question.prompt}</strong>
                    <br />
                    {question.answers.join(" / ")} — {question.explanation}
                  </p>
                ))}
              </div>
            ))}
          </details>
          <details>
            <summary>听力逐字稿</summary>
            <p lang="en">{lesson.transcript}</p>
          </details>
          <details>
            <summary>写作参考 · 原创示例，非对你的原稿的修改</summary>
            <p lang="en">{lesson.writingModel}</p>
          </details>
          <details>
            <summary>口语参考 · 原创文字示例，非音频评分</summary>
            <p lang="en">{lesson.speakingExample}</p>
            <button
              type="button"
              className="learning-text-button"
              onClick={() => speak(lesson.speakingExample)}
            >
              <Volume2 size={15} />
              播放合成语音示例
            </button>
          </details>
        </div>
      )}
      <div className="learning-bottom-tools">
        <button
          type="button"
          className="learning-text-button"
          onClick={() => setShowHistory(!showHistory)}
        >
          <History size={16} />
          历史尝试 <span>{attempts.length}</span>
          <ChevronDown size={14} />
        </button>
        <span>
          <RotateCcw size={14} />
          复习间隔 +1 / 3 / 7 / 14 / 30 天
        </span>
      </div>
      {showHistory && (
        <div className="learning-history">
          {attempts.length ? (
            [...attempts].reverse().map((attempt) => (
              <details key={attempt.id}>
                <summary>
                  <span>
                    {DETAILS[attempt.task as TaskKey]?.label ?? attempt.task} ·{" "}
                    {new Date(attempt.createdAt).toLocaleString("zh-CN")}
                  </span>
                  <strong>
                    {attempt.score === null
                      ? "不可评估"
                      : `${attempt.score} 活动分`}
                  </strong>
                </summary>
                <pre>{attempt.input}</pre>
                <p>{attempt.feedback}</p>
                <small>证据类型：{attempt.kind}</small>
              </details>
            ))
          ) : (
            <p className="learning-muted">还没有提交记录，草稿会自动保留。</p>
          )}
          {Boolean(value.words?.length) && (
            <div className="learning-word-history">
              <h4>生词本 · {value.words?.length} 个</h4>
              {value.words?.map((word) => (
                <div key={word.id}>
                  <strong>{word.lemma}</strong>
                  <span>{word.meaning}</span>
                  <small>
                    {word.nextReviewAt
                      ? `下次复习 ${new Date(word.nextReviewAt).toLocaleDateString("zh-CN")}`
                      : "已收藏，尚未学习"}
                  </small>
                  <p>{word.example}</p>
                  <small>{word.sources.join(" · ")}</small>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="learning-footnote">
        演示模式 · 非真实 AI 测评。原创材料仅作日常练习；目标称号与活动分不构成
        IELTS / PTE 成绩认证。
      </p>
    </section>
  );
}
