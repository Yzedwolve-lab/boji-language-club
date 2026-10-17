"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, LockKeyhole, SlidersHorizontal } from "lucide-react";
import type {
  SelfHostedAIConfiguration,
  SelfHostedAIConfigureInput,
  SelfHostedAIStatus,
} from "@/lib/ai-types";

type Props = {
  initial?: SelfHostedAIConfiguration;
  setupToken: string;
  setupAvailable: boolean;
  disabled?: boolean;
  onConfigured: (status: SelfHostedAIStatus) => void;
  onCancel?: () => void;
  onBusyChange: (busy: boolean) => void;
};

export default function AIConfigForm({
  initial,
  setupToken,
  setupAvailable,
  disabled = false,
  onConfigured,
  onCancel,
  onBusyChange,
}: Props) {
  const editing = Boolean(initial);
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [dailyLimit, setDailyLimit] = useState(
    String(initial?.dailyLimit ?? 40),
  );
  const [tokenParameter, setTokenParameter] = useState<
    "max_tokens" | "max_completion_tokens"
  >(initial?.tokenParameter ?? "max_tokens");
  const [allowLocal, setAllowLocal] = useState(initial?.allowLocal ?? false);
  const [hostConfirmed, setHostConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const apiKeyInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const currentPasswordInput = useRef<HTMLInputElement>(null);
  const setupCodeInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const sensitiveInputs = [
      apiKeyInput.current,
      passwordInput.current,
      currentPasswordInput.current,
      setupCodeInput.current,
    ];
    return () => {
      mounted.current = false;
      for (const input of sensitiveInputs) if (input) input.value = "";
    };
  }, []);

  function clearSensitiveInputs() {
    for (const ref of [
      apiKeyInput,
      passwordInput,
      currentPasswordInput,
      setupCodeInput,
    ]) {
      if (ref.current) ref.current.value = "";
    }
  }

  let target: URL | null = null;
  try {
    target = new URL(baseUrl.trim());
  } catch {
    // An incomplete address is ordinary input, not a connection attempt.
  }
  const endpointChanged = editing && baseUrl.trim() !== initial?.baseUrl;
  const localTarget =
    target && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  const mayOmitLocalKey = Boolean(
    allowLocal && localTarget && !endpointChanged,
  );
  const blocked = disabled || saving;

  async function save() {
    setError("");
    if (
      !target ||
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      (target.protocol !== "https:" &&
        !(target.protocol === "http:" && allowLocal && localTarget))
    ) {
      setError(
        "请填写完整的 HTTPS 接口地址，不要包含账号、密码、查询参数或片段。本机 HTTP 模型需在高级设置中开启回环接口。",
      );
      return;
    }
    if (!model.trim()) {
      setError(
        "模型名称还没填，AI 不知道该叫谁出场 🤖 请使用服务商提供的准确模型名。",
      );
      return;
    }
    if (!editing && !(setupToken || setupCodeInput.current?.value.trim())) {
      setError(
        "请用本机启动器打开首次配置页，或在下方填写启动器提供的一次性配置码。",
      );
      return;
    }
    if (
      (endpointChanged ||
        ((!editing || !initial?.hasApiKey) && !mayOmitLocalKey)) &&
      !apiKeyInput.current?.value.trim()
    ) {
      setError(
        endpointChanged
          ? "接口地址已改变，请重新填写 API Key；旧密钥不会发送到新地址。"
          : "请填写 API Key，它只会通过本应用交给你自己的服务端保存。",
      );
      return;
    }
    if (editing && !currentPasswordInput.current?.value) {
      setError(
        "修改配置需要当前服务访问口令。口令只用于这次验证，不会保存在浏览器。",
      );
      return;
    }
    const nextPassword = passwordInput.current?.value ?? "";
    if ((!editing || nextPassword) && nextPassword.length < 16) {
      setError("服务访问口令至少需要 16 个字符。试试一整句只有你知道的话 🔐");
      return;
    }
    const limit = Number(dailyLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      setError(
        "每日 AI 请求上限请填写 1–1000 的整数；本次连接测试也需要可用额度。",
      );
      return;
    }
    if (!hostConfirmed) {
      setError("先核对下方显示的目标服务，再确认发送一次可能计费的测试请求。");
      return;
    }
    setSaving(true);
    onBusyChange(true);
    try {
      const input: SelfHostedAIConfigureInput = {
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        dailyLimit: limit,
        tokenParameter,
        allowLocal,
        ...(apiKeyInput.current?.value.trim()
          ? { apiKey: apiKeyInput.current.value.trim() }
          : {}),
        ...(nextPassword ? { password: nextPassword } : {}),
        ...(editing
          ? { currentPassword: currentPasswordInput.current?.value ?? "" }
          : {
              setupToken:
                setupCodeInput.current?.value.trim() || setupToken || "",
            }),
      };
      const response = await fetch("/api/self-hosted/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json();
      if (!mounted.current) return;
      if (!response.ok || data.connected !== true) {
        setError(
          typeof data.message === "string"
            ? data.message
            : "配置还没有保存成功。核对接口、模型、密钥与额度后重试，当前输入已保留。",
        );
        return;
      }
      clearSensitiveInputs();
      onConfigured(data as SelfHostedAIStatus);
    } catch {
      if (mounted.current)
        setError(
          "这次没连上，别急着重填 🛠️ 当前输入还在，请检查本机服务后重试。",
        );
    } finally {
      if (mounted.current) setSaving(false);
      onBusyChange(false);
    }
  }

  return (
    <form
      className="ai-config-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocked) void save();
      }}
    >
      <div className="ai-config-heading">
        <strong>
          {editing ? "给 AI 队友换个配置 🔧" : "填好这几项，AI 队友就能上线 ✨"}
        </strong>
        <p>
          {editing
            ? "先测试，成功后才替换配置。留空的 API Key 和新口令会保留原值。"
            : "不用改配置文件。填写你的兼容接口，本应用会在自己的服务端测试并保存。"}
        </p>
      </div>
      {!editing && !setupToken && (
        <div className="ai-config-unlock">
          <LockKeyhole size={20} />
          <div>
            <strong>请使用本机启动器打开首次配置页</strong>
            <p>
              {setupAvailable
                ? "请重新双击桌面上的「薄肌俱乐部」，或项目里的「启动薄肌俱乐部.cmd」，在自动打开的新页面继续。配置码会自动读取，无需手填；刷新页面会清除本页临时配置码。"
                : "请双击桌面上的「薄肌俱乐部」，或项目里的「启动薄肌俱乐部.cmd」。启动器会生成并自动填写配置码，它不是 OpenAI API Key，也不用自己设置。"}
            </p>
            <details>
              <summary>输入一次性配置码</summary>
              <label className="field">
                一次性配置码
                <input
                  ref={setupCodeInput}
                  type="password"
                  autoComplete="off"
                  maxLength={2048}
                  disabled={blocked}
                  placeholder="粘贴本机启动器提供的配置码"
                />
              </label>
            </details>
          </div>
        </div>
      )}
      {!editing && setupToken && (
        <div>
          <p className="ai-config-unlocked">
            <LockKeyhole size={17} />
            已读取首次配置码 · 保存时会验证，配置码已从网址移除
          </p>
          <details className="ai-config-code-replace">
            <summary>更换一次性配置码</summary>
            <label className="field">
              一次性配置码
              <input
                ref={setupCodeInput}
                type="password"
                autoComplete="off"
                maxLength={2048}
                disabled={blocked}
                placeholder="配置码过期时可粘贴启动器的新码"
              />
            </label>
          </details>
        </div>
      )}
      <fieldset disabled={blocked} className="ai-config-fields">
        <label className="field">
          Base URL
          <input
            type="url"
            aria-label="Base URL"
            value={baseUrl}
            autoComplete="off"
            spellCheck={false}
            maxLength={2048}
            placeholder="https://api.your-provider.com/v1"
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setHostConfirmed(false);
            }}
          />
          <small>填写兼容 OpenAI 的接口根地址，通常以 /v1 结尾。</small>
        </label>
        <label className="field">
          模型名称
          <input
            value={model}
            aria-label="模型名称"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            placeholder="使用服务商提供的模型名称"
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
        <label className="field">
          API Key{" "}
          {mayOmitLocalKey && !initial?.hasApiKey && (
            <span>本机免密钥服务可留空</span>
          )}
          {editing && !endpointChanged && initial?.hasApiKey && (
            <span>留空保留原密钥</span>
          )}
          <input
            ref={apiKeyInput}
            aria-label="API Key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            maxLength={4096}
            placeholder={
              editing && !endpointChanged && initial?.hasApiKey
                ? "已有密钥，页面不会读取它"
                : "粘贴你的 API Key"
            }
          />
          <small>
            只提交给本应用服务端，不存入浏览器本地存储、分享链接或导出文件。
            {mayOmitLocalKey &&
              !initial?.hasApiKey &&
              " 本机服务如需密钥，请仍然填写。"}
          </small>
        </label>
        {endpointChanged && (
          <p className="ai-config-key-change" role="status">
            接口地址已改变，请重新填写 API Key；旧密钥不会发送到新地址。
          </p>
        )}
        {editing && (
          <label className="field">
            当前服务访问口令
            <input
              ref={currentPasswordInput}
              aria-label="当前服务访问口令"
              type="password"
              autoComplete="off"
              maxLength={1024}
              placeholder="验证本次配置修改"
            />
          </label>
        )}
        <label className="field">
          {editing ? "新的服务访问口令" : "设置服务访问口令"}{" "}
          {editing && <span>选填</span>}
          <input
            ref={passwordInput}
            aria-label={editing ? "新的服务访问口令" : "设置服务访问口令"}
            type="password"
            autoComplete="new-password"
            minLength={16}
            maxLength={1024}
            placeholder={
              editing ? "留空保留原口令" : "至少 16 个字符，用一句话也可以"
            }
          />
          <small>这是本应用的访问口令，和 AI 服务商的 API Key 是两回事。</small>
        </label>
        <details className="ai-config-advanced">
          <summary>
            <SlidersHorizontal size={17} />
            高级设置
          </summary>
          <label className="field">
            每日 AI 请求上限
            <input
              type="number"
              aria-label="每日 AI 请求上限"
              min={1}
              max={1000}
              step={1}
              value={dailyLimit}
              onChange={(event) => setDailyLimit(event.target.value)}
            />
            <small>
              默认 40 次。限制请求次数，不代表固定金额；测试也占用额度。
            </small>
          </label>
          <label className="field">
            Token 参数
            <select
              aria-label="Token 参数"
              value={tokenParameter}
              onChange={(event) =>
                setTokenParameter(event.target.value as typeof tokenParameter)
              }
            >
              <option value="max_tokens">max_tokens</option>
              <option value="max_completion_tokens">
                max_completion_tokens
              </option>
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={allowLocal}
              onChange={(event) => {
                setAllowLocal(event.target.checked);
                setHostConfirmed(false);
              }}
            />
            允许本机回环接口（仅用于本地模型）
          </label>
          <p className="ai-privacy-note">
            仅用于 localhost、127.0.0.1 或 ::1 的本机模型服务。远程服务仍使用
            HTTPS。
          </p>
        </details>
        <div className="ai-config-destination">
          <span>本应用服务端将连接</span>
          <strong data-testid="ai-config-host">
            {target ? `${target.protocol}//${target.host}` : "先填写 Base URL"}
          </strong>
          <label className="check-label">
            <input
              type="checkbox"
              checked={hostConfirmed}
              disabled={!target}
              onChange={(event) => setHostConfirmed(event.target.checked)}
            />
            我已核对目标服务，同意发送一次可能计费的 AI 测试请求
          </label>
          <p>这次只测试连接，不发送身体资料或英语样本。</p>
        </div>
      </fieldset>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <div className="ai-config-actions">
        <button className="button primary" type="submit" disabled={blocked}>
          {saving
            ? "正在测试并保存…"
            : editing
              ? "保存修改并测试 AI"
              : "保存并测试 AI"}
          <ArrowRight size={18} />
        </button>
        {onCancel && (
          <button
            className="button secondary"
            type="button"
            disabled={blocked}
            onClick={onCancel}
          >
            取消修改
          </button>
        )}
      </div>
    </form>
  );
}
