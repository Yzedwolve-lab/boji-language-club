"use client";
import { useEffect, useState } from "react";
import type { SelfHostedAIStatus } from "@/lib/ai-types";

/** Live server state, never a provider inferred from a saved onboarding draft. */
export default function AIUsageBadge({ revision }: { revision: string }) {
  const [status, setStatus] = useState<SelfHostedAIStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/self-hosted/status", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as SelfHostedAIStatus;
        if (!controller.signal.aborted) setStatus(data);
      } catch {
        /* Connection controls and submission show actionable failures. */
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("boji:ai-connection-change", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("boji:ai-connection-change", refresh);
    };
  }, [revision]);
  if (!status?.connected) return null;
  if (status.provider === "chatgpt")
    return (
      <span>
        Using ChatGPT plan ·{" "}
        <a
          href="https://chatgpt.com/settings/usage"
          target="_blank"
          rel="noopener noreferrer"
        >
          Manage usage · 管理用量 ↗
        </a>
      </span>
    );
  return <span>使用 API Key · 用量由所选服务商计费</span>;
}
