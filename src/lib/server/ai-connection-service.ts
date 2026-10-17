import "server-only";
import { createSelfHostedService } from "./self-hosted";
import {
  createChatGPTService,
  providerCookie,
  requestCookie,
  PROVIDER_COOKIE,
  type ChatGPTServiceOptions,
} from "./chatgpt-service";
import type { SelfHostedAIStatus, ChatGPTConnectionStatus } from "../ai-types";
import { ApiError, errorResponse, jsonBody } from "./errors";
import type { ResolveHost } from "./self-hosted-transport";
import { setupRequestOrigin } from "./self-hosted-configuration";
import { z } from "zod";

export function createAIConnectionService(
  options: ChatGPTServiceOptions & { resolveHost?: ResolveHost } = {},
) {
  const api = createSelfHostedService(options);
  const chatgpt = createChatGPTService(options);
  async function combinedStatus(
    request: Request,
    override?: {
      api?: SelfHostedAIStatus;
      chatgpt?: ChatGPTConnectionStatus;
      provider?: "chatgpt" | "api_key" | null;
    },
  ): Promise<SelfHostedAIStatus> {
    const apiResponse = override?.api
      ? null
      : await api.handle(request, "status");
    const apiStatus =
      override?.api ??
      (apiResponse?.ok
        ? ((await apiResponse.json()) as SelfHostedAIStatus)
        : {
            mode: "demo" as const,
            configured: false,
            connected: false,
            authenticated: false,
          });
    const gpt =
      override?.chatgpt ??
      (await chatgpt
        .status(request)
        .catch(() => ({
          available: false,
          signedIn: false,
          sharing: false,
          connected: false,
          message:
            "ChatGPT 本机连接记录暂不可读写，请检查存储权限；API Key 入口仍可使用。",
        })));
    const preference = requestCookie(request, PROVIDER_COOKIE);
    // A selected provider failing must never silently consume another provider's funds.
    const provider =
      override && "provider" in override
        ? override.provider
        : preference === "chatgpt" || preference === "api_key"
          ? preference
          : preference === "none"
            ? null
            : apiStatus.connected
              ? "api_key"
              : gpt.connected
                ? "chatgpt"
                : null;
    const connected =
      provider === "chatgpt"
        ? gpt.connected
        : provider === "api_key"
          ? apiStatus.connected
          : false;
    return {
      ...apiStatus,
      mode: connected ? "self_hosted" : apiStatus.mode,
      configured: apiStatus.configured || gpt.signedIn,
      authenticated: connected,
      connected,
      provider: provider ?? null,
      apiKey: {
        configured: !!apiStatus.configured,
        connected: !!apiStatus.connected,
      },
      chatgpt: gpt,
    };
  }
  return {
    async handle(request: Request, path: string): Promise<Response> {
      let response: Response;
      try {
        if (request.method === "GET" && path === "status") {
          response = Response.json(await combinedStatus(request));
        } else if (request.method === "POST" && path === "select") {
          setupRequestOrigin(request);
          if (
            request.headers
              .get("content-type")
              ?.split(";")[0]
              .trim()
              .toLowerCase() !== "application/json"
          )
            throw new ApiError(415, "json_required", "请发送 JSON 请求。");
          const input = z
            .object({ provider: z.enum(["chatgpt", "api_key"]) })
            .strict()
            .safeParse(await jsonBody(request));
          if (!input.success)
            throw new ApiError(400, "invalid_input", "请选择一种已连接的 AI。");
          const summary = await combinedStatus(request, {
            provider: input.data.provider,
          });
          if (!summary.connected)
            throw new ApiError(
              401,
              "authentication_required",
              "请先完成所选 AI 的登录或连接测试。",
            );
          response = Response.json(summary, {
            headers: { "Set-Cookie": providerCookie(input.data.provider) },
          });
        } else if (path.startsWith("chatgpt/")) {
          const action = path.slice("chatgpt/".length);
          response = await chatgpt.handle(request, action);
          if (
            response.ok &&
            request.method === "POST" &&
            (action === "connect" || action === "disconnect")
          ) {
            const data = (await response.json()) as ChatGPTConnectionStatus & {
              remoteRevocationConfirmed?: boolean;
            };
            response = Response.json(
              {
                ...(await combinedStatus(request, {
                  chatgpt: data,
                  provider: action === "connect" ? "chatgpt" : null,
                })),
                ...(action === "disconnect"
                  ? {
                      remoteRevocationConfirmed: data.remoteRevocationConfirmed,
                    }
                  : {}),
              },
              { headers: response.headers },
            );
          }
        } else if (
          request.method === "POST" &&
          ["nutrition", "plan", "disconnect"].includes(path) &&
          requestCookie(request, PROVIDER_COOKIE) === "chatgpt"
        ) {
          response = await chatgpt.handle(request, path);
        } else if (
          request.method === "POST" &&
          ["nutrition", "plan"].includes(path) &&
          requestCookie(request, PROVIDER_COOKIE) === "none"
        ) {
          response = Response.json(
            {
              error: "authentication_required",
              message: "请先选择并连接 AI，原始记录已保留。",
            },
            { status: 401 },
          );
        } else {
          response = await api.handle(request, path);
          if (
            response.ok &&
            request.method === "POST" &&
            ["configure", "connect", "disconnect"].includes(path)
          ) {
            const data = (await response.json()) as SelfHostedAIStatus;
            const provider = path === "disconnect" ? null : "api_key";
            response = Response.json(
              await combinedStatus(request, { api: data, provider }),
              { headers: response.headers },
            );
            response.headers.append(
              "Set-Cookie",
              providerCookie(provider ?? "none"),
            );
          }
        }
      } catch (error) {
        response = errorResponse(error);
      }
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Vary", "Cookie");
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    },
  };
}
