"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  LogOut,
  SlidersHorizontal,
} from "lucide-react";
import type {
  ChatGPTConnectionStatus,
  SelfHostedAIStatus,
} from "@/lib/ai-types";

type Props = {
  status?: ChatGPTConnectionStatus;
  checking: boolean;
  active: boolean;
  disabled?: boolean;
  callbackError?: string;
  continueLabel: string;
  selectedProvider?: "chatgpt" | "api_key" | null;
  onStatus: (status: SelfHostedAIStatus) => void;
  onConnected: () => void;
  onBusyChange: (busy: boolean) => void;
};

const usageUrl = "https://chatgpt.com/settings/usage";

export default function ChatGPTConnection({
  status,
  checking,
  active,
  disabled = false,
  callbackError = "",
  continueLabel,
  selectedProvider,
  onStatus,
  onConnected,
  onBusyChange,
}: Props) {
  const [pending, setPending] = useState<
    "login" | "connect" | "disconnect" | "select" | null
  >(null);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [models, setModels] = useState<
    NonNullable<ChatGPTConnectionStatus["models"]>
  >([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const welcome = useRef<HTMLDialogElement>(null);
  const welcomeAcknowledged = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active || !status?.signedIn || !status.sharing) return;
    let seen = welcomeAcknowledged.current;
    try {
      seen ||= localStorage.getItem("boji.chatgpt.plan-welcome.v1") === "seen";
    } catch {
      /* Storage is optional. */
    }
    if (!seen && !welcome.current?.open) welcome.current?.showModal();
  }, [active, status?.signedIn, status?.sharing]);

  function dismissWelcome() {
    welcomeAcknowledged.current = true;
    try {
      localStorage.setItem("boji.chatgpt.plan-welcome.v1", "seen");
    } catch {
      /* No credential or identity is persisted here. */
    }
    welcome.current?.close();
  }

  const availableModels = models.length ? models : (status?.models ?? []);
  const selectedModel = model ?? status?.model ?? "";
  const blocked = disabled || checking || Boolean(pending) || loadingModels;
  const limitReached = /limit|quota/.test(errorCode);
  const shownError = error || callbackError;

  async function request(
    action: "start" | "connect" | "disconnect",
    input: object,
  ) {
    const response = await fetch(`/api/self-hosted/chatgpt/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok) {
      if (mounted.current) {
        setErrorCode(typeof result.error === "string" ? result.error : "");
        setError(
          typeof result.message === "string"
            ? result.message
            : "这次连接没完成，稍后再试；你的记录还在。🛠️",
        );
      }
      return null;
    }
    return result;
  }

  async function signIn(newAccount = false) {
    setPending("login");
    onBusyChange(true);
    setError("");
    setErrorCode("");
    setNotice("");
    let navigating = false;
    try {
      const result = await request("start", { newAccount });
      if (!mounted.current || !result) return;
      const url = new URL(result.authorizationUrl);
      if (
        url.origin !== "https://auth.openai.com" ||
        url.username ||
        url.password
      ) {
        throw new Error("invalid_authorization_url");
      }
      window.location.assign(url.href);
      navigating = true;
    } catch {
      if (mounted.current)
        setError("暂时打不开官方登录页，请检查本机服务和网络后重试。");
    } finally {
      if (!navigating) {
        if (mounted.current) setPending(null);
        onBusyChange(false);
      }
    }
  }

  async function continueWithChatGPT() {
    if (selectedProvider === "chatgpt") {
      onConnected();
      return;
    }
    setPending("select");
    onBusyChange(true);
    setError("");
    setErrorCode("");
    try {
      const response = await fetch("/api/self-hosted/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "chatgpt" }),
      });
      const result = await response.json();
      if (!mounted.current) return;
      if (
        !response.ok ||
        result.connected !== true ||
        result.provider !== "chatgpt"
      ) {
        setError(
          typeof result.message === "string"
            ? result.message
            : "这次切换没完成，请重新登录并测试 ChatGPT 连接。",
        );
        return;
      }
      onStatus(result as SelfHostedAIStatus);
      onConnected();
    } catch {
      if (mounted.current)
        setError("本机服务暂时没回应，连接尚未切换，请重试。");
    } finally {
      if (mounted.current) setPending(null);
      onBusyChange(false);
    }
  }

  async function connect() {
    setPending("connect");
    onBusyChange(true);
    setError("");
    setErrorCode("");
    try {
      const result = await request(
        "connect",
        selectedModel ? { model: selectedModel } : {},
      );
      if (!mounted.current || !result) return;
      if (result.connected !== true || result.provider !== "chatgpt") {
        setError(
          "登录成功，但 AI 连接尚未通过测试。请重试，不会丢失你的资料。",
        );
        return;
      }
      onStatus(result as SelfHostedAIStatus);
      onConnected();
    } catch {
      if (mounted.current)
        setError("AI 队友暂时掉线，别怪自己 🛠️ 检查网络后再测试。");
    } finally {
      if (mounted.current) setPending(null);
      onBusyChange(false);
    }
  }

  async function disconnect() {
    setPending("disconnect");
    onBusyChange(true);
    setError("");
    setErrorCode("");
    try {
      const result = await request("disconnect", {});
      if (!mounted.current || !result) return;
      setModel(null);
      setModels([]);
      onStatus(result as SelfHostedAIStatus);
      setNotice(
        result.remoteRevocationConfirmed === false
          ? "本机已断开；可到 ChatGPT 设置撤销授权。"
          : "本机已断开 ChatGPT。你也可以在官方设置中查看和撤销应用授权。",
      );
    } catch {
      if (mounted.current) setError("本机服务暂时没回应，断开未完成，请重试。");
    } finally {
      if (mounted.current) setPending(null);
      onBusyChange(false);
    }
  }

  async function loadModels() {
    setLoadingModels(true);
    onBusyChange(true);
    setError("");
    try {
      const response = await fetch("/api/self-hosted/chatgpt/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = await response.json();
      if (!mounted.current) return;
      if (!response.ok || !Array.isArray(result.models)) {
        setError(
          typeof result.message === "string"
            ? result.message
            : "模型列表暂时没拿到，可以稍后重试。",
        );
        return;
      }
      setModels(
        result.models.filter(
          (item: { slug?: unknown; displayName?: unknown }) =>
            typeof item.slug === "string" &&
            typeof item.displayName === "string",
        ),
      );
    } catch {
      if (mounted.current) setError("模型列表暂时没拿到，请检查网络后重试。");
    } finally {
      if (mounted.current) setLoadingModels(false);
      onBusyChange(false);
    }
  }

  return (
    <div className="chatgpt-connection">
      <dialog
        ref={welcome}
        className="chatgpt-welcome"
        aria-labelledby="chatgpt-welcome-title"
        onCancel={dismissWelcome}
      >
        <span className="chatgpt-simple-badge">账号已就位 ✨</span>
        <h3 id="chatgpt-welcome-title">You&apos;re using your ChatGPT plan</h3>
        <p>
          接下来的 AI 请求会使用你的 ChatGPT 套餐，与 Codex／ChatGPT Work
          共用额度。你可以随时在官方设置里管理本应用的使用上限。
        </p>
        <a href={usageUrl} target="_blank" rel="noopener noreferrer">
          Manage usage · 管理套餐用量
        </a>
        <button
          className="button primary"
          type="button"
          autoFocus
          onClick={dismissWelcome}
        >
          Got it · 知道啦
        </button>
      </dialog>
      <div className="chatgpt-connection-heading">
        <span className="chatgpt-simple-badge">免填密钥 · 几步就好</span>
        <h3>你的账号，直接拉队友入场 ✨</h3>
        <p>使用自己的 ChatGPT 账号，让饮食记录和英语计划用上你的套餐额度。</p>
      </div>

      {checking ? (
        <p className="ai-connection-status" role="status">
          正在检查登录状态…
        </p>
      ) : status?.signedIn ? (
        <div
          className={`ai-connection-status ${status.connected ? "connected" : ""}`}
          role="status"
        >
          <CheckCircle2 size={21} />
          <div>
            <strong>
              {status.connected
                ? selectedProvider === "chatgpt"
                  ? "ChatGPT 已连接 · 队友就位 ✨"
                  : "ChatGPT 已就绪 · 可以切换 ✨"
                : "ChatGPT 已登录 · 再测试一下就好"}
            </strong>
            {(status.email || status.name) && (
              <p className="chatgpt-account">{status.email || status.name}</p>
            )}
            <p>
              {status.sharing
                ? selectedProvider === "chatgpt"
                  ? "Using ChatGPT plan · 使用你的 ChatGPT 套餐"
                  : "套餐授权已就绪；连接后将使用你的 ChatGPT 套餐。"
                : "还未授权使用套餐额度，请重新登录并在官方页面授权。"}
            </p>
          </div>
        </div>
      ) : null}

      {!checking && status?.available === false && (
        <p className="ai-config-key-change" role="status">
          {status.message ||
            "请在自己的电脑上启动薄肌俱乐部后使用 ChatGPT 登录。也可以选择上方的 API Key 接入。"}
        </p>
      )}

      {!status?.signedIn || !status.sharing ? (
        <>
          <button
            className="chatgpt-signin-button"
            type="button"
            disabled={blocked || !status?.available}
            onClick={() => void signIn()}
          >
            {pending === "login"
              ? "正在打开官方登录页…"
              : "Continue with ChatGPT"}
            <ArrowRight size={19} aria-hidden="true" />
          </button>
          <p className="chatgpt-signin-helper">
            使用自己的 ChatGPT 账号 · 将前往 OpenAI 官方页面登录并授权
          </p>
        </>
      ) : (
        <>
          {status.connected ? (
            <button
              className="button primary"
              type="button"
              disabled={blocked}
              onClick={() => void continueWithChatGPT()}
            >
              {pending === "select" ? "正在切换连接…" : continueLabel}
              <ArrowRight size={18} />
            </button>
          ) : (
            <>
              <p className="chatgpt-test-note">
                点击下方按钮会发送一次短测试，使用少量套餐额度；不会发送身体资料或英语样本。
              </p>
              <button
                className="button primary"
                type="button"
                disabled={blocked}
                onClick={() => void connect()}
              >
                {pending === "connect"
                  ? "正在连接并测试…"
                  : "连接并测试（使用少量套餐额度）"}
                <ArrowRight size={18} />
              </button>
            </>
          )}
          <details className="ai-config-advanced chatgpt-model-settings">
            <summary>
              <SlidersHorizontal size={17} />
              模型设置 · 可选
            </summary>
            <label className="field">
              ChatGPT 模型
              <select
                aria-label="ChatGPT 模型"
                value={selectedModel}
                disabled={blocked}
                onChange={(event) => setModel(event.target.value)}
              >
                <option value="">自动选择可用模型</option>
                {selectedModel &&
                  !availableModels.some(
                    (item) => item.slug === selectedModel,
                  ) && <option value={selectedModel}>{selectedModel}</option>}
                {availableModels.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="text-button"
              type="button"
              disabled={blocked}
              onClick={() => void loadModels()}
            >
              {loadingModels ? "正在读取…" : "刷新可用模型"}
            </button>
            {status.connected &&
              model !== null &&
              selectedModel !== status.model && (
                <button
                  className="button secondary"
                  type="button"
                  disabled={blocked}
                  onClick={() => void connect()}
                >
                  切换并测试（使用少量套餐额度）
                </button>
              )}
          </details>
        </>
      )}
      {status?.signedIn && (
        <div className="chatgpt-account-actions">
          <button
            className="text-button"
            type="button"
            disabled={blocked}
            onClick={() => void signIn(true)}
          >
            更换 ChatGPT 账号
          </button>
          <button
            className="text-button"
            type="button"
            disabled={blocked}
            onClick={() => void disconnect()}
          >
            <LogOut size={16} />
            {pending === "disconnect" ? "正在断开…" : "断开 ChatGPT"}
          </button>
        </div>
      )}

      {shownError && (
        <p className="error-box" role="alert">
          {shownError}
        </p>
      )}
      {notice && (
        <div className="chatgpt-usage-note" role="status">
          <p>{notice}</p>
          <a
            className="chatgpt-usage-link"
            href="https://chatgpt.com/settings/security"
            target="_blank"
            rel="noopener noreferrer"
          >
            查看 ChatGPT 应用授权
            <ExternalLink size={15} aria-hidden="true" />
          </a>
        </div>
      )}
      <div
        className={`chatgpt-usage-note ${limitReached ? "limit-reached" : ""}`}
      >
        <p>
          适用于符合条件的 Plus／Pro 账号；与 Codex／ChatGPT Work
          共用套餐额度，额度和模型以官方授权结果为准。
        </p>
        <a
          className={limitReached ? "button primary" : "chatgpt-usage-link"}
          href={usageUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Manage usage · 管理套餐用量
          <ExternalLink size={15} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
