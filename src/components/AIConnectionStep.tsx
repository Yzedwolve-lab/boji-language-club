"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Settings2,
  MessageCircle,
  KeyRound,
} from "lucide-react";
import type {
  SelfHostedAIConfiguration,
  SelfHostedAIStatus,
} from "@/lib/ai-types";
import AIConfigForm from "./AIConfigForm";
import ChatGPTConnection from "./ChatGPTConnection";
import "./onboarding-ai.css";

export type AIConnectionStepProps = {
  onConnected: () => void;
  onSkip?: () => void;
  onDemo?: () => void;
  busy?: boolean;
  continueLabel?: string;
};

export default function AIConnectionStep({
  onConnected,
  onSkip,
  onDemo,
  busy = false,
  continueLabel = "继续使用 AI",
}: AIConnectionStepProps) {
  const [status, setStatus] = useState<SelfHostedAIStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [configuration, setConfiguration] =
    useState<SelfHostedAIConfiguration | null>(null);
  const [configurationLoading, setConfigurationLoading] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [method, setMethod] = useState<"chatgpt" | "api_key">("chatgpt");
  const [chatgptBusy, setChatgptBusy] = useState(false);
  const [callbackError, setCallbackError] = useState("");
  const mounted = useRef(false);
  const passwordInput = useRef<HTMLInputElement>(null);

  const checkStatus = useCallback(async (signal?: AbortSignal) => {
    setChecking(true);
    setError("");
    try {
      const response = await fetch("/api/self-hosted/status", {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error("status_unavailable");
      const next = (await response.json()) as SelfHostedAIStatus;
      if (!mounted.current || signal?.aborted) return;
      if (
        typeof next.connected !== "boolean" ||
        typeof next.configured !== "boolean"
      ) {
        throw new Error("status_unavailable");
      }
      setStatus(next);
    } catch {
      if (mounted.current && !signal?.aborted) {
        setStatus(null);
        setError(
          "暂时读不到服务状态。检查本地服务后重试；也可以先进入记录模式。",
        );
      }
    } finally {
      if (mounted.current && !signal?.aborted) setChecking(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("setup");
    if (token !== null) {
      fragment.delete("setup");
      const remaining = fragment.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ""}`,
      );
      if (token && token.length <= 2048) setSetupToken(token);
    }
    const chatgptResult = fragment.get("chatgpt");
    if (chatgptResult !== null) {
      const reason = fragment.get("reason");
      fragment.delete("chatgpt");
      fragment.delete("reason");
      const remaining = fragment.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ""}`,
      );
      setMethod("chatgpt");
      if (chatgptResult === "error") {
        const messages: Record<string, string> = {
          chatgpt_login_cancelled:
            "你取消了登录或套餐授权，没关系，准备好后再来。",
          chatgpt_login_expired: "登录等待太久已过期，请重新打开官方登录页。",
          chatgpt_auth_invalid_response: "这次官方登录验证未通过，请重新登录。",
          chatgpt_auth_unavailable:
            "官方登录服务暂时没连上，请检查网络后重试。",
          chatgpt_session_expired: "ChatGPT 登录已过期，请重新登录。",
          chatgpt_access_denied:
            "你取消了登录或套餐授权，没关系，准备好后再来。",
          chatgpt_state_invalid: "这次登录验证未通过，请重新点击登录。",
          chatgpt_sign_in_expired: "登录等待太久已过期，请重新打开官方登录页。",
          chatgpt_network_error: "官方登录服务暂时没连上，请检查网络后重试。",
          configuration_in_progress: "另一项连接操作正在进行，请稍后重新登录。",
          access_denied: "你取消了登录或套餐授权，没关系，准备好后再来。",
          login_cancelled: "登录已取消，你的资料还在。准备好后再试。",
          expired: "登录等待太久已过期，请重新打开官方登录页。",
          invalid_state: "这次登录验证未通过，请重新点击登录。",
          chatgpt_plan_not_shared:
            "已登录，但没有授权套餐使用。请重新登录并在官方页面授权。",
        };
        setCallbackError(
          messages[reason ?? ""] ??
            "这次 ChatGPT 登录没有完成，请重新登录；你的记录还在。",
        );
      }
    }
    const controller = new AbortController();
    void checkStatus(controller.signal);
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [checkStatus]);

  async function connect() {
    if (!password.trim()) {
      setError("口令还没来，AI 先等等你 🔐 请输入服务端设置的访问口令。");
      return;
    }
    setConnecting(true);
    setError("");
    try {
      const response = await fetch("/api/self-hosted/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!mounted.current) return;
      if (!response.ok || data.connected !== true) {
        setError(
          typeof data.message === "string"
            ? data.message
            : "连接没有完成。核对访问口令、服务端配置与额度后再试，资料不会丢。",
        );
        return;
      }
      if (passwordInput.current) passwordInput.current.value = "";
      setPassword("");
      setStatus(data as SelfHostedAIStatus);
      onConnected();
    } catch {
      if (mounted.current)
        setError("AI 暂时掉线了，不是你的错 🛠️ 输入保留着，请检查网络后重试。");
    } finally {
      if (mounted.current) setConnecting(false);
    }
  }

  async function editConfiguration(usePassword = false) {
    if (usePassword && !password.trim()) {
      setError(
        "先输入服务访问口令，就能修改配置；这一步不需要旧 AI 接口在线 🔐",
      );
      return;
    }
    setConfigurationLoading(true);
    setError("");
    try {
      const response = await fetch("/api/self-hosted/configuration", {
        cache: "no-store",
        ...(usePassword
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password }),
            }
          : {}),
      });
      const data = await response.json();
      if (!mounted.current) return;
      if (
        !response.ok ||
        typeof data.baseUrl !== "string" ||
        typeof data.hasApiKey !== "boolean"
      ) {
        setError(
          typeof data.message === "string"
            ? data.message
            : "暂时无法读取配置。核对访问口令与本机服务后重试。",
        );
        return;
      }
      if (passwordInput.current) passwordInput.current.value = "";
      setPassword("");
      setConfiguration(data as SelfHostedAIConfiguration);
    } catch {
      if (mounted.current)
        setError("配置暂时读不到，检查本机服务后再试。现有连接未改变。");
    } finally {
      if (mounted.current) setConfigurationLoading(false);
    }
  }

  async function continueWithApiKey() {
    // Older status responses only supported API Key and had no provider field.
    if (status?.provider === undefined || status.provider === "api_key") {
      onConnected();
      return;
    }
    setConnecting(true);
    setError("");
    try {
      const response = await fetch("/api/self-hosted/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "api_key" }),
      });
      const data = await response.json();
      if (!mounted.current) return;
      if (
        !response.ok ||
        data.connected !== true ||
        data.provider !== "api_key"
      ) {
        setError(
          typeof data.message === "string"
            ? data.message
            : "这次切换没完成，请重新验证 API Key 连接。",
        );
        return;
      }
      setStatus(data as SelfHostedAIStatus);
      onConnected();
    } catch {
      if (mounted.current)
        setError("本机服务暂时没回应，连接尚未切换，请重试。");
    } finally {
      if (mounted.current) setConnecting(false);
    }
  }

  const disabled =
    busy ||
    checking ||
    connecting ||
    configBusy ||
    configurationLoading ||
    chatgptBusy;
  const apiConfigured =
    status?.apiKey?.configured ??
    (status?.provider !== "chatgpt" && status?.configured);
  const apiConnected =
    status?.apiKey?.connected ??
    (status?.provider !== "chatgpt" && status?.connected);

  return (
    <section className="ai-connection" aria-labelledby="ai-connection-heading">
      <div className="ai-connection-buddy" aria-hidden="true">
        🤖
      </div>
      <p className="eyebrow">BRING YOUR OWN AI</p>
      <h2 id="ai-connection-heading">先把 AI 队友拉进来？</h2>
      <p className="ai-connection-intro">
        Your AI, your club. 选一种方式连接，AI
        队友就能帮你做饮食记录和英语起步计划。
      </p>

      <div
        className="ai-method-selector"
        role="group"
        aria-label="选择 AI 连接方式"
      >
        <button
          type="button"
          aria-label="使用 ChatGPT 登录"
          className={`ai-method-option ${method === "chatgpt" ? "selected" : ""}`}
          aria-pressed={method === "chatgpt"}
          aria-controls="chatgpt-connection-panel"
          disabled={disabled}
          onClick={() => {
            setMethod("chatgpt");
            setError("");
          }}
        >
          <MessageCircle size={23} aria-hidden="true" />
          <span>
            <strong>ChatGPT 登录</strong>
            <small>有套餐？登录授权就好</small>
          </span>
        </button>
        <button
          type="button"
          aria-label="使用 API Key"
          className={`ai-method-option ${method === "api_key" ? "selected" : ""}`}
          aria-pressed={method === "api_key"}
          aria-controls="api-key-connection-panel"
          disabled={disabled}
          onClick={() => {
            setMethod("api_key");
            setError("");
          }}
        >
          <KeyRound size={23} aria-hidden="true" />
          <span>
            <strong>API Key 接入</strong>
            <small>支持 OpenAI 兼容接口</small>
          </span>
        </button>
      </div>
      <div id="chatgpt-connection-panel" hidden={method !== "chatgpt"}>
        <ChatGPTConnection
          status={status?.chatgpt}
          checking={checking}
          disabled={busy || configBusy || connecting || configurationLoading}
          active={method === "chatgpt"}
          callbackError={callbackError}
          continueLabel={continueLabel}
          selectedProvider={status?.provider}
          onBusyChange={setChatgptBusy}
          onStatus={setStatus}
          onConnected={onConnected}
        />
      </div>
      <div id="api-key-connection-panel" hidden={method !== "api_key"}>
        <div
          className={`ai-connection-status ${apiConnected ? "connected" : ""}`}
          role="status"
        >
          {apiConnected ? <CheckCircle2 size={21} /> : <PlugZap size={21} />}
          <div>
            <strong>
              {checking
                ? "正在检查服务端配置…"
                : apiConnected
                  ? "AI 已连接 · 队友就位 ✨"
                  : apiConfigured
                    ? "配置已就绪 · 还需要连接测试"
                    : status
                      ? "还没连接？在这里配好就行"
                      : "连接状态暂不可用"}
            </strong>
            <p>
              API Key
              通过本应用交给你自己的服务端保管，不写入浏览器存储或导出文件。
            </p>
          </div>
        </div>

        {!checking && status && (!apiConfigured || configuration) && (
          <AIConfigForm
            key={configuration ? "edit" : "initial"}
            initial={configuration ?? undefined}
            setupToken={setupToken}
            setupAvailable={status.setup?.available ?? false}
            disabled={busy || connecting}
            onBusyChange={setConfigBusy}
            onCancel={configuration ? () => setConfiguration(null) : undefined}
            onConfigured={(next) => {
              if (!mounted.current) return;
              setSetupToken("");
              setPassword("");
              setConfiguration(null);
              setStatus(next);
              onConnected();
            }}
          />
        )}

        {!checking && apiConfigured && !apiConnected && !configuration && (
          <form
            className="ai-connect-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!disabled) void connect();
            }}
          >
            <label className="field">
              服务访问口令
              <input
                ref={passwordInput}
                type="password"
                autoComplete="off"
                value={password}
                disabled={disabled}
                maxLength={1024}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="你在自己的服务端设置的口令"
                aria-describedby="ai-connect-cost"
              />
            </label>
            <p id="ai-connect-cost" className="ai-privacy-note">
              点击连接会向你的 AI
              服务商发送一次短测试请求，可能产生少量费用；这一步不会发送身体资料或英语样本。
            </p>
            <button
              className="button primary"
              type="submit"
              disabled={disabled}
            >
              <PlugZap size={18} />
              {connecting ? "正在连接并测试…" : "连接并测试 AI"}
            </button>
            <div className="ai-connection-actions">
              <button
                className="button secondary"
                type="button"
                disabled={disabled}
                onClick={() => void editConfiguration(true)}
              >
                <Settings2 size={17} />
                {configurationLoading ? "正在验证口令…" : "用口令修改配置"}
              </button>
              <p className="ai-privacy-note">
                旧密钥失效或接口掉线？这里仅验证访问口令、读取配置，不调用
                AI。保存修改时再测试新配置。
              </p>
            </div>
          </form>
        )}

        <div className="ai-connection-actions">
          {!checking && apiConnected && !configuration && (
            <button
              className="button primary"
              type="button"
              disabled={disabled}
              onClick={() => void continueWithApiKey()}
            >
              {connecting ? "正在切换连接…" : continueLabel}
              <ArrowRight size={18} />
            </button>
          )}
          {!checking && apiConnected && !configuration && (
            <button
              className="button secondary"
              type="button"
              disabled={disabled}
              onClick={() => void editConfiguration()}
            >
              <Settings2 size={17} />
              {configurationLoading ? "正在读取配置…" : "修改 AI 配置"}
            </button>
          )}
          {!checking &&
            !apiConnected &&
            !configuration &&
            (apiConfigured || !status) && (
              <button
                className="button secondary"
                type="button"
                disabled={disabled}
                onClick={() => void checkStatus()}
              >
                <RefreshCw size={17} />
                重新检查配置
              </button>
            )}
        </div>
      </div>

      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {!checking && !status && method === "chatgpt" && (
        <button
          className="button secondary"
          type="button"
          disabled={disabled}
          onClick={() => void checkStatus()}
        >
          <RefreshCw size={17} />
          重新检查连接
        </button>
      )}
      <div className="ai-connection-actions">
        {onSkip && !(method === "api_key" && configuration) && (
          <button
            className="button secondary"
            type="button"
            disabled={busy || connecting || configBusy || chatgptBusy}
            onClick={onSkip}
          >
            先用记录模式，继续填写
            <ArrowRight size={17} />
          </button>
        )}
        {onDemo && !(method === "api_key" && configuration) && (
          <button
            className="text-button demo-quick"
            type="button"
            disabled={busy || connecting || configBusy || chatgptBusy}
            onClick={onDemo}
          >
            {busy ? "正在验证…" : "先用虚构资料体验"}
            <ArrowRight size={16} />
          </button>
        )}
      </div>
      <p className="ai-privacy-note">
        <ShieldCheck size={17} />
        连接 ≠ 已完成评估。填写资料后，你会确认发送内容，再生成真实 AI 计划。
      </p>
    </section>
  );
}
