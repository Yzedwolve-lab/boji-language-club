"use client";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { X, ArrowRight } from "lucide-react";
export type FoodDialogueContent = {
  kind:
    "english" | "spelling" | "empty" | "clarify" | "reflection" | "followup";
  title: string;
  message: string;
  help: string;
  suggestions?: Array<{ original: string; suggestion: string }>;
};
export default function FoodDialogue({
  content,
  onClose,
  onKeepOriginal,
  questions = [],
  onAnswerChange,
  onSubmitAnswers,
  onEditOriginal,
  busy = false,
  error,
}: {
  content: FoodDialogueContent;
  onClose: () => void;
  onKeepOriginal?: () => void;
  questions?: Array<{ sourceText: string; question: string; answer: string }>;
  onAnswerChange?: (index: number, answer: string) => void;
  onSubmitAnswers?: () => void;
  onEditOriginal?: () => void;
  busy?: boolean;
  error?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement)
        queueMicrotask(() => {
          if (trigger.isConnected) trigger.focus({ preventScroll: true });
        });
    };
  }, []);
  function keepFocusInside(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const buttons = event.currentTarget.querySelectorAll<HTMLElement>(
      "button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]",
    );
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  return (
    <dialog
      ref={dialogRef}
      className={`food-dialogue food-dialogue-${content.kind}`}
      aria-labelledby="food-dialogue-title"
      aria-describedby="food-dialogue-message"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={keepFocusInside}
    >
      <div className="food-dialogue-top">
        <span>BOJI HAS ENTERED THE CHAT</span>
        <button className="icon-button" aria-label="关闭提醒" onClick={onClose}>
          <X size={23} />
        </button>
      </div>
      <div className="food-dialogue-face" aria-hidden="true">
        {content.kind === "spelling"
          ? "🤨"
          : content.kind === "english"
            ? "🙈"
            : "🫠"}
      </div>
      <h2 id="food-dialogue-title">{content.title}</h2>
      <p id="food-dialogue-message" className="food-dialogue-english">
        {content.message}
      </p>
      {content.suggestions?.length ? (
        <div className="food-corrections">
          {content.suggestions.map((item) => (
            <p key={item.original}>
              <span>{item.original}</span>
              <ArrowRight size={17} />
              <strong>{item.suggestion}</strong>
            </p>
          ))}
        </div>
      ) : null}
      <p className="food-dialogue-help">{content.help}</p>
      {content.kind === "followup" && (
        <div className="food-followup-questions">
          {questions.map((item, index) => (
            <label
              className="field"
              key={`${item.sourceText}-${item.question}`}
            >
              <small>About: {item.sourceText}</small>
              <strong lang="en">{item.question}</strong>
              <textarea
                aria-label={`English answer ${index + 1}`}
                lang="en"
                rows={3}
                maxLength={500}
                value={item.answer}
                disabled={busy}
                onChange={(event) =>
                  onAnswerChange?.(index, event.target.value)
                }
                placeholder="e.g. About 150 g cooked rice, with one teaspoon of oil."
              />
            </label>
          ))}
          {error && (
            <p className="error-box" role="alert">
              {error}
            </p>
          )}
          <button
            className="button primary full-button"
            disabled={busy}
            onClick={onSubmitAnswers}
          >
            {busy ? "Checking your answers…" : "Send answers · 补充后重新分析"}
          </button>
          <p className="tiny muted">
            只发送原始食物记录和这些补充回答；会使用一次 AI 请求额度。
          </p>
          {onEditOriginal && (
            <button
              className="button secondary full-button"
              disabled={busy}
              onClick={onEditOriginal}
            >
              返回食物记录，补充完整描述
            </button>
          )}
        </div>
      )}
      {content.kind !== "followup" && (
        <>
          <p className="food-dialogue-example">
            Try:{" "}
            <strong>
              {content.kind === "reflection"
                ? "I will note the portion size next time."
                : "2 boiled eggs and 150 g cooked rice."}
            </strong>
          </p>
          <button className="button primary full-button" onClick={onClose}>
            OK bestie，我改 ✍️
          </button>
          {onKeepOriginal && (
            <button
              className="text-button keep-original"
              onClick={onKeepOriginal}
            >
              按原文保留并继续，不自动改字
            </button>
          )}
        </>
      )}
    </dialog>
  );
}
