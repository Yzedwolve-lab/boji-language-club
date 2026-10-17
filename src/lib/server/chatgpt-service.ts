import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import type { ChatGPTConnectionStatus } from "../ai-types";
import { createChatGPTAuth } from "./chatgpt-auth";
import { createChatGPTClient, listChatGPTModels } from "./chatgpt-client";
import { ChatGPTAppStore, type ChatGPTAppState } from "./chatgpt-app-store";
import { ApiError, errorResponse, jsonBody } from "./errors";
import { SelfHostedStore } from "./self-hosted-store";
import {
  privateConfigurationDirectory,
  withConfigurationMutation,
  type Environment,
} from "./self-hosted-configuration";
import {
  analyzeNutritionWithCompatibleAI,
  parseNutritionInput,
} from "./nutrition-adapter";
import { createAIStarterPlan, parseAIPlanningInput } from "./ai-planning";
import type { Fetcher } from "./supabase";

const COOKIE = "boji_chatgpt";
const ATTEMPT_COOKIE = "boji_chatgpt_attempt";
export const PROVIDER_COOKIE = "boji_ai_provider";
const SESSION_MS = 30 * 24 * 60 * 60_000;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function requestCookie(request: Request, name: string) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ""
  );
}
export function providerCookie(provider: "chatgpt" | "api_key" | "none") {
  return `${PROVIDER_COOKIE}=${provider}; Path=/api/self-hosted; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`;
}
function localOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (
    url.protocol !== "http:" ||
    !host ||
    !/^127\.0\.0\.1:\d{1,5}$/.test(host) ||
    new URL(`http://${host}`).port !== url.port
  )
    throw new ApiError(
      403,
      "chatgpt_local_only",
      "请用本机启动器打开 127.0.0.1 页面，再连接 ChatGPT。此登录入口仅供本机使用。",
    );
  return `http://${host}`;
}
function checkMutation(request: Request) {
  const origin = localOrigin(request);
  if (
    request.headers.get("origin") !== origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ApiError(
      403,
      "origin_denied",
      "请在本机薄肌俱乐部页面操作 ChatGPT 连接。",
    );
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new ApiError(415, "json_required", "请发送 JSON 请求。");
  return origin;
}
function browserCookie(value: string, clear = false) {
  return `${COOKIE}=${value}; Path=/api/self-hosted; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_MS / 1000}`;
}
function attemptCookie(value: string, clear = false) {
  return `${ATTEMPT_COOKIE}=${value}; Path=/api/self-hosted/chatgpt; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 600}`;
}
const emptyBody = z.object({}).strict();
type Auth = Pick<
  ReturnType<typeof createChatGPTAuth>,
  "start" | "complete" | "getSummary" | "getAccessToken" | "signOut" | "cancel"
>;
export interface ChatGPTServiceOptions {
  env?: Environment;
  now?: () => number;
  fetcher?: Fetcher;
  /** Dependency injection for isolated tests; never populated by request data. */
  auth?: Auth;
}

export function createChatGPTService(options: ChatGPTServiceOptions = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const directory = resolve(
    /* turbopackIgnore: true */ privateConfigurationDirectory(env),
    "chatgpt",
  );
  const auth =
    options.auth ??
    createChatGPTAuth({ directory, fetcher: options.fetcher, now });
  const appStore = new ChatGPTAppStore(directory);
  const usage = new SelfHostedStore(directory);
  function available(request: Request) {
    if (env.APP_MODE === "production") return false;
    try {
      localOrigin(request);
      return true;
    } catch {
      return false;
    }
  }
  function sessionFor(request: Request, state: ChatGPTAppState) {
    const token = requestCookie(request, COOKIE);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const session = state.sessions[hash(token)];
    if (
      !session ||
      session.expires <= now() ||
      session.origin !== localOrigin(request)
    )
      return null;
    return session;
  }
  async function status(request: Request): Promise<ChatGPTConnectionStatus> {
    if (!available(request))
      return {
        available: false,
        signedIn: false,
        sharing: false,
        connected: false,
        message:
          "ChatGPT 登录请使用本机启动器打开的 127.0.0.1 页面；远程部署可以继续使用 API Key。",
      };
    const state = await appStore.read(now());
    if (!sessionFor(request, state))
      return {
        available: true,
        signedIn: false,
        sharing: false,
        connected: false,
      };
    const summary = await auth.getSummary();
    if (sessionFor(request, state)?.accountId !== summary.accountId)
      return {
        available: true,
        signedIn: false,
        sharing: false,
        connected: false,
      };
    return {
      available: true,
      signedIn: summary.signedIn,
      sharing: summary.sharing,
      email: summary.email,
      name: summary.name,
      connected: !!(
        summary.signedIn &&
        summary.sharing &&
        sessionFor(request, state)?.connected &&
        state.model
      ),
      model: state.model ?? undefined,
      models: state.models,
    };
  }
  async function requireSession(request: Request, connected = false) {
    const state = await appStore.read(now());
    const session = sessionFor(request, state);
    const summary = session ? await auth.getSummary() : null;
    if (
      !session ||
      !summary?.signedIn ||
      session.accountId !== summary.accountId
    )
      throw new ApiError(
        401,
        "chatgpt_sign_in_required",
        "请重新登录 ChatGPT，原始记录和草稿都已保留。",
      );
    if (!summary.sharing)
      throw new ApiError(
        403,
        "chatgpt_sharing_required",
        "账号已登录，但尚未授权使用 ChatGPT 套餐。请重新登录并开启套餐使用权限。",
      );
    if (connected && (!session.connected || !state.model))
      throw new ApiError(
        409,
        "chatgpt_test_required",
        "请先在连接页面测试 ChatGPT，再生成分析或计划。",
      );
    return { state, session };
  }
  function client(model: string) {
    return createChatGPTClient({
      getAccessToken: () => auth.getAccessToken(),
      model,
      fetcher: options.fetcher,
    });
  }
  async function handle(request: Request, path: string): Promise<Response> {
    let response: Response;
    try {
      if (!available(request))
        throw new ApiError(
          403,
          "chatgpt_local_only",
          "ChatGPT 登录仅供本机运行的个人版本使用，请从本机启动器进入。",
        );
      if (request.method === "GET" && path === "status") {
        response = Response.json(await status(request));
      } else if (request.method === "GET" && path === "callback") {
        const origin = localOrigin(request);
        let result = "connected";
        let reason = "";
        let token: string | undefined;
        try {
          const attemptId = requestCookie(request, ATTEMPT_COOKIE);
          if (!attemptId || attemptId.length > 200)
            throw new ApiError(
              400,
              "chatgpt_state_invalid",
              "登录页面已过期，请重新登录。",
            );
          await withConfigurationMutation(directory, async () => {
            const identity = await auth.complete({
              url: `${origin}${new URL(request.url).pathname}${new URL(request.url).search}`,
              attemptId,
            });
            if (!identity.accountId)
              throw new ApiError(
                502,
                "chatgpt_auth_invalid_response",
                "无法验证登录账号，请重新登录。",
              );
            const candidate = randomBytes(32).toString("base64url");
            // Every successful sign-in replaces the local browser authorization.
            // Old sessions cannot spend a newly selected account's allowance.
            await appStore.write({
              version: 1,
              model: null,
              models: [],
              sessions: {
                [hash(candidate)]: {
                  expires: now() + SESSION_MS,
                  origin,
                  accountId: identity.accountId,
                  connected: false,
                },
              },
            });
            token = candidate;
          });
        } catch (error) {
          result = "error";
          const known = new Set([
            "chatgpt_login_cancelled",
            "chatgpt_login_expired",
            "chatgpt_auth_invalid_response",
            "chatgpt_auth_unavailable",
            "chatgpt_session_expired",
            "chatgpt_state_invalid",
            "configuration_in_progress",
          ]);
          reason =
            error instanceof ApiError && known.has(error.code)
              ? error.code
              : "chatgpt_sign_in_failed";
        }
        response = new Response(null, {
          status: 303,
          headers: {
            Location: `${origin}/#chatgpt=${result}${reason ? `&reason=${reason}` : ""}`,
          },
        });
        response.headers.append("Set-Cookie", attemptCookie("", true));
        if (token) response.headers.append("Set-Cookie", browserCookie(token));
      } else if (request.method === "POST") {
        const origin = checkMutation(request);
        response = await withConfigurationMutation(directory, async () => {
          const body = await jsonBody(request);
          if (path === "start") {
            const input = z
              .object({ newAccount: z.boolean().optional() })
              .strict()
              .safeParse(body);
            if (!input.success)
              throw new ApiError(
                400,
                "invalid_input",
                "请重新点击 ChatGPT 登录。",
              );
            await usage.consumeConnectionAttempt(now());
            const previous = requestCookie(request, ATTEMPT_COOKIE);
            if (previous) await auth.cancel(previous);
            const attempt = await auth.start({
              redirectUri: `${origin}/api/self-hosted/chatgpt/callback`,
              newAccount: input.data.newAccount,
            });
            return Response.json(
              { authorizationUrl: attempt.authorizationUrl },
              { headers: { "Set-Cookie": attemptCookie(attempt.attemptId) } },
            );
          }
          if (path === "disconnect") {
            if (!emptyBody.safeParse(body).success)
              throw new ApiError(400, "invalid_input", "请重新点击退出连接。");
            const state = await appStore.read(now());
            const browserSession = sessionFor(request, state);
            const identity = browserSession ? await auth.getSummary() : null;
            if (
              !browserSession ||
              (identity?.signedIn &&
                browserSession.accountId !== identity.accountId)
            )
              throw new ApiError(
                401,
                "chatgpt_sign_in_required",
                "请先登录自己的 ChatGPT 账号。",
              );
            // Clear all browser grants even when remote token revocation is unavailable.
            await appStore.write({
              version: 1,
              model: null,
              models: [],
              sessions: {},
            });
            const revoked = await auth.signOut();
            const result = Response.json({
              ...(await status(request)),
              remoteRevocationConfirmed: revoked.remoteRevocationConfirmed,
            });
            result.headers.append("Set-Cookie", browserCookie("", true));
            result.headers.append("Set-Cookie", providerCookie("none"));
            return result;
          }
          if (path === "models") {
            if (!emptyBody.safeParse(body).success)
              throw new ApiError(400, "invalid_input", "请重新加载模型列表。");
            const { state } = await requireSession(request);
            await usage.consumeConnectionAttempt(now());
            state.models = await listChatGPTModels(
              () => auth.getAccessToken(),
              options.fetcher,
            );
            await appStore.write(state);
            return Response.json({ models: state.models });
          }
          if (path === "connect") {
            const input = z
              .object({ model: z.string().min(1).max(200).optional() })
              .strict()
              .safeParse(body);
            if (!input.success)
              throw new ApiError(
                400,
                "invalid_input",
                "请从可用模型中选择后再试。",
              );
            const { state, session } = await requireSession(request);
            await usage.consumeConnectionAttempt(now());
            // Discover from the authorized account, never assume a model entitlement.
            const models = await listChatGPTModels(
              () => auth.getAccessToken(),
              options.fetcher,
            );
            const model =
              input.data.model ??
              models.find((item) => item.slug === state.model)?.slug ??
              models[0]?.slug;
            if (!model || !models.some((item) => item.slug === model))
              throw new ApiError(
                400,
                "chatgpt_model_unavailable",
                "此账号没有该可用模型，请刷新模型列表或更换账号。",
              );
            await usage.reserveCall(now(), 40);
            await client(model).completeJson({
              system:
                'This is a connection check. Return only {"connected":true}.',
              user: { action: "connection_test" },
              schema: z.object({ connected: z.literal(true) }).strict(),
            });
            state.models = models;
            state.model = model;
            session.connected = true;
            await appStore.write(state);
            const result = Response.json(await status(request));
            result.headers.append("Set-Cookie", providerCookie("chatgpt"));
            return result;
          }
          if (path === "nutrition" || path === "plan") {
            const { state } = await requireSession(request, true);
            const ai = client(state.model!);
            if (path === "nutrition") {
              const input = parseNutritionInput(body);
              await usage.reserveCall(now(), 40);
              return Response.json(
                await analyzeNutritionWithCompatibleAI(input, {
                  client: ai,
                }),
              );
            }
            const input = parseAIPlanningInput(body);
            await usage.reserveCall(now(), 40);
            return Response.json(
              await createAIStarterPlan(input, {
                client: ai,
                now: new Date(now()),
              }),
            );
          }
          throw new ApiError(404, "not_found", "没有这个接口。");
        });
      } else throw new ApiError(404, "not_found", "没有这个接口。");
    } catch (error) {
      response = errorResponse(error);
    }
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Vary", "Cookie");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  }
  return { handle, status };
}
