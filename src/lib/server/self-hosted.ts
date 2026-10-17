import "server-only";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { SelfHostedAIStatus } from "../ai-types";
import { ApiError, errorResponse, jsonBody } from "./errors";
import { createAIStarterPlan, parseAIPlanningInput } from "./ai-planning";
import {
  analyzeNutritionWithCompatibleAI,
  parseNutritionInput,
} from "./nutrition-adapter";
import { createOpenAICompatibleClient } from "./openai-compatible";
import { SelfHostedStore } from "./self-hosted-store";
import type { Fetcher } from "./supabase";
import {
  candidateConfiguration,
  commitConfiguration,
  configureInputSchema,
  correctPassword,
  privateConfigurationDirectory,
  publicConfiguration,
  readSelfHostedConfiguration,
  readSetupToken,
  setupRequestOrigin,
  verifySetupToken,
  withConfigurationMutation,
  type Configuration,
  type ConfigurationState,
  type Environment,
} from "./self-hosted-configuration";
import {
  guardedProviderFetcher,
  type ResolveHost,
} from "./self-hosted-transport";

const COOKIE = "boji_self_hosted";
const SESSION_MS = 12 * 60 * 60_000;
const digest = (text: string) => createHash("sha256").update(text).digest();
const sessionSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    expires: z.number().int().positive(),
  })
  .strict();

function tokenSignature(payload: string, config: Configuration) {
  return createHmac("sha256", config.signingKey)
    .update(payload)
    .digest("base64url");
}
function sessionToken(config: Configuration, now: number) {
  const session = {
    id: randomBytes(32).toString("hex"),
    expires: now + SESSION_MS,
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return { session, token: `${payload}.${tokenSignature(payload, config)}` };
}
function readSession(request: Request, config: Configuration, now: number) {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!token || token.length > 2000) return null;
  const [payload, signature, extra] = token.split(".");
  if (
    !payload ||
    !signature ||
    extra ||
    !timingSafeEqual(digest(signature), digest(tokenSignature(payload, config)))
  )
    return null;
  try {
    const session = sessionSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    return session.expires > now && session.expires <= now + SESSION_MS
      ? session
      : null;
  } catch {
    return null;
  }
}
function setCookie(token: string, config: Configuration, clear = false) {
  return `${COOKIE}=${token}; Path=/api/self-hosted; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_MS / 1000}${config.origin.startsWith("https:") ? "; Secure" : ""}`;
}
function checkOrigin(request: Request, config: Pick<Configuration, "origin">) {
  if (
    request.headers.get("origin") !== config.origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ApiError(403, "origin_denied", "请从你配置的网站地址发起请求。");
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new ApiError(415, "json_required", "请发送 JSON 请求。");
}

/** Single-owner mode. Inject transport/clock only in tests; callers cannot choose providers. */
export function createSelfHostedService(
  options: {
    env?: Environment;
    fetcher?: Fetcher;
    resolveHost?: ResolveHost;
    now?: () => number;
  } = {},
) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  async function status(
    request: Request,
    state?: ConfigurationState,
  ): Promise<SelfHostedAIStatus> {
    const resolved = state ?? (await readSelfHostedConfiguration(env));
    const config = resolved.config;
    const mode =
      config || env.APP_MODE === "self_hosted" ? "self_hosted" : "demo";
    const session = config ? readSession(request, config, now()) : null;
    const authenticated = !!(
      session &&
      config &&
      (await new SelfHostedStore(config.privateDirectory).hasSession(
        session.id,
        session.expires,
        now(),
      ))
    );
    return {
      mode,
      configured: !!config,
      authenticated,
      connected: authenticated,
      setup: {
        available:
          env.APP_MODE !== "production" &&
          !config &&
          !!(await readSetupToken(privateConfigurationDirectory(env), now())),
        configuredVia: resolved.via,
      },
    };
  }
  const providerFetcher = (config: Configuration) =>
    guardedProviderFetcher(config.provider, {
      transport: options.fetcher,
      resolveHost: options.resolveHost,
    });
  async function authenticatedSession(
    request: Request,
    config: Configuration,
    store: SelfHostedStore,
  ) {
    const session = readSession(request, config, now());
    if (
      !session ||
      !(await store.hasSession(session.id, session.expires, now()))
    )
      throw new ApiError(
        401,
        "authentication_required",
        "请先连接自己的 AI 服务。草稿已保留。",
      );
    return session;
  }
  async function testConnection(config: Configuration) {
    await createOpenAICompatibleClient(
      config.provider,
      providerFetcher(config),
    ).completeJson({
      system:
        'This is a connection check. Return exactly the JSON object {"connected":true}. No other text.',
      user: { action: "connection_test" },
      schema: z.object({ connected: z.literal(true) }).strict(),
    });
  }
  const connectedResponse = (config: Configuration, token: string) =>
    Response.json(
      {
        mode: "self_hosted",
        configured: true,
        authenticated: true,
        connected: true,
        setup: { available: false, configuredVia: config.via },
      } satisfies SelfHostedAIStatus,
      { headers: { "Set-Cookie": setCookie(token, config) } },
    );
  return {
    async handle(request: Request, path: string): Promise<Response> {
      let response: Response;
      try {
        const current = await readSelfHostedConfiguration(env);
        if (request.method === "GET" && path === "status") {
          response = Response.json(await status(request, current));
        } else if (request.method === "GET" && path === "configuration") {
          if (!current.config)
            throw new ApiError(
              401,
              "authentication_required",
              "请先连接自己的 AI 服务。",
            );
          await authenticatedSession(
            request,
            current.config,
            new SelfHostedStore(current.config.privateDirectory),
          );
          response = Response.json(publicConfiguration(current.config));
        } else if (request.method === "POST" && path === "configuration") {
          const config = current.config;
          if (!config)
            throw new ApiError(
              503,
              "self_hosted_unavailable",
              "尚无可读取的个人 AI 配置。",
            );
          checkOrigin(request, config);
          const store = new SelfHostedStore(config.privateDirectory);
          await store.consumeConnectionAttempt(now());
          const body = z
            .object({ password: z.string().min(1).max(1024) })
            .strict()
            .safeParse(await jsonBody(request));
          if (!body.success)
            throw new ApiError(
              400,
              "invalid_input",
              "请输入当前服务访问口令。",
            );
          if (!correctPassword(body.data.password, config))
            throw new ApiError(
              401,
              "unauthorized",
              "访问口令不正确，不能读取配置摘要。",
            );
          // Password recovery reads non-secret settings only. It never contacts
          // a provider or issues a connected/paid-call session.
          response = Response.json(publicConfiguration(config));
        } else if (request.method === "POST" && path === "configure") {
          if (env.APP_MODE === "production")
            throw new ApiError(
              503,
              "self_hosted_unavailable",
              "个人设置不能启用多用户生产模式。",
            );
          const origin = setupRequestOrigin(request);
          checkOrigin(request, { origin });
          const body = configureInputSchema.safeParse(await jsonBody(request));
          if (!body.success)
            throw new ApiError(
              400,
              "invalid_configuration",
              "请核对设置字段和输入长度。",
            );
          const directory = privateConfigurationDirectory(env);
          response = await withConfigurationMutation(directory, async () => {
            // Re-read inside the mutation boundary; a setup token cannot replace
            // a configuration installed by another request while this one waited.
            const previous = (await readSelfHostedConfiguration(env)).config;
            const store = new SelfHostedStore(directory);
            await store.consumeConnectionAttempt(now());
            let tokenRecord = null;
            if (previous) {
              checkOrigin(request, previous);
              // The owner must be able to repair an expired provider key even
              // when their AI-tested cookie has expired. The current password,
              // strict origin and persistent attempt limit authorize this edit.
              if (!correctPassword(body.data.currentPassword ?? "", previous))
                throw new ApiError(
                  401,
                  "unauthorized",
                  "请输入当前服务访问口令以修改设置。",
                );
            } else
              tokenRecord = await verifySetupToken(
                directory,
                body.data.setupToken,
                now(),
              );
            const candidate = candidateConfiguration(
              body.data,
              previous,
              origin,
              directory,
              now(),
            );
            await store.reserveCall(now(), candidate.dailyLimit);
            await testConnection(candidate);
            const { session, token } = sessionToken(candidate, now());
            // Persist the session before the atomic configuration commit. A disk
            // failure leaves the old configuration authoritative and no new cookie.
            await store.addSession(session.id, session.expires, now());
            await commitConfiguration(candidate, tokenRecord, now());
            return connectedResponse(candidate, token);
          });
        } else {
          if (
            request.method !== "POST" ||
            !["connect", "disconnect", "nutrition", "plan"].includes(path)
          )
            throw new ApiError(404, "not_found", "没有这个接口。");
          const config = current.config;
          if (!config)
            throw new ApiError(
              503,
              "self_hosted_unavailable",
              "AI 自托管尚未配置；演示模式不会调用收费 AI。",
            );
          checkOrigin(request, config);
          const store = new SelfHostedStore(config.privateDirectory);
          if (path === "connect") {
            await store.consumeConnectionAttempt(now());
            const body = z
              .object({ password: z.string().min(1).max(1024) })
              .strict()
              .safeParse(await jsonBody(request));
            if (!body.success)
              throw new ApiError(
                400,
                "invalid_input",
                "请输入服务端访问口令。",
              );
            if (!correctPassword(body.data.password, config))
              throw new ApiError(
                401,
                "unauthorized",
                "访问口令不正确，请核对自己的服务端配置。",
              );
            await store.reserveCall(now(), config.dailyLimit);
            await testConnection(config);
            const { session, token } = sessionToken(config, now());
            await store.addSession(session.id, session.expires, now());
            response = connectedResponse(config, token);
          } else {
            const session = await authenticatedSession(request, config, store);
            if (path === "disconnect") {
              await store.removeSession(session.id, now());
              response = Response.json(
                {
                  mode: "self_hosted",
                  configured: true,
                  authenticated: false,
                  connected: false,
                  setup: { available: false, configuredVia: config.via },
                } satisfies SelfHostedAIStatus,
                { headers: { "Set-Cookie": setCookie("", config, true) } },
              );
            } else if (path === "nutrition") {
              const input = parseNutritionInput(await jsonBody(request));
              await store.reserveCall(now(), config.dailyLimit);
              response = Response.json(
                await analyzeNutritionWithCompatibleAI(input, {
                  config: config.provider,
                  fetcher: providerFetcher(config),
                }),
              );
            } else {
              const input = parseAIPlanningInput(await jsonBody(request));
              await store.reserveCall(now(), config.dailyLimit);
              response = Response.json(
                await createAIStarterPlan(input, {
                  config: config.provider,
                  fetcher: providerFetcher(config),
                  now: new Date(now()),
                }),
              );
            }
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
