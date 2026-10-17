import "server-only";
import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "./errors";

const ISSUER = "https://auth.openai.com";
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const JWKS = `${ISSUER}/.well-known/jwks.json`;
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const RESOURCE = "https://api.openai.com/v1";
const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const CALLBACK_PATH = "/api/self-hosted/chatgpt/callback";
const ATTEMPT_LIFETIME = 10 * 60_000;
const secret = z.string().min(1).max(32_768);
const clientIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/)
  .refine((value) => value !== "dynamic_agent_client");
const tokensSchema = z
  .object({
    accessToken: secret,
    refreshToken: secret.optional(),
    idToken: secret,
    scopes: z.array(z.string().min(1).max(256)).max(100),
    expiresAt: z.number().finite(),
  })
  .strict();
const registrationSchema = z
  .object({
    clientId: clientIdSchema,
    subject: z.string().min(1).max(512).optional(),
    email: z.string().max(320).optional(),
    name: z.string().max(200).optional(),
    callbackPath: z.literal(CALLBACK_PATH),
    tokens: tokensSchema.optional(),
  })
  .strict();
const stateSchema = z
  .object({
    version: z.literal(1),
    hostId: z.string().regex(/^urn:uuid:[0-9a-f-]{36}$/),
    registrations: z.array(registrationSchema).max(8),
    activeClientId: clientIdSchema.optional(),
    candidateClientId: clientIdSchema.optional(),
  })
  .strict()
  .superRefine((state, context) => {
    const ids = new Set(state.registrations.map((entry) => entry.clientId));
    if (
      ids.size !== state.registrations.length ||
      (state.activeClientId && !ids.has(state.activeClientId)) ||
      (state.candidateClientId && !ids.has(state.candidateClientId))
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid registration mapping",
      });
    }
  });
type State = z.infer<typeof stateSchema>;
type Tokens = z.infer<typeof tokensSchema>;
type Pending = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  clientId?: string;
  expiresAt: number;
};
type Runtime = {
  queue: Promise<void>;
  pending: Map<string, Pending>;
  jwks?: { at: number; keys: Record<string, unknown>[] };
};
// Route bundles and recreated service factories share locks in the one supported Node process.
const runtimeKey = Symbol.for("boji.chatgpt-auth.runtime.v1");
const globals = globalThis as typeof globalThis & {
  [runtimeKey]?: Map<string, Runtime>;
};
const runtimes = (globals[runtimeKey] ??= new Map());

export type ChatGPTAuthSummary = {
  signedIn: boolean;
  sharing: boolean;
  /** Server-only binding for first-party sessions; do not include in public status payloads. */
  accountId?: string;
  email?: string;
  name?: string;
};

const unavailable = () =>
  new ApiError(
    503,
    "chatgpt_auth_unavailable",
    "暂时无法连接 ChatGPT 登录服务，请稍后重试。你的原有连接和草稿会保留。",
  );
const invalidResponse = () =>
  new ApiError(
    502,
    "chatgpt_auth_invalid_response",
    "未能验证 ChatGPT 返回的登录信息，请重新登录。",
  );
const storageError = () =>
  new ApiError(
    503,
    "chatgpt_storage_unavailable",
    "ChatGPT 私有凭据暂时无法保存或读取，请检查本机服务端存储。",
  );
const invalidAttempt = () =>
  new ApiError(
    400,
    "chatgpt_login_expired",
    "这次登录已过期或无法验证，请返回页面重新点击 Continue with ChatGPT。",
  );
const sessionExpired = () =>
  new ApiError(
    401,
    "chatgpt_session_expired",
    "ChatGPT 授权已失效，请重新登录；不需要填写 API Key。",
  );
const hasSharing = (tokens?: Tokens) =>
  !!tokens?.scopes.includes("resource.invoke") &&
  tokens.scopes.includes("chatgpt.tokens.use.direct");
const random = () => randomBytes(32).toString("base64url");
const equal = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Public-client OAuth for a personal local installation, not a hosted multi-user service. */
export function createChatGPTAuth(options: {
  directory: string;
  fetcher?: typeof fetch;
  now?: () => number;
}) {
  const path = resolve(
    /* turbopackIgnore: true */ options.directory,
    "chatgpt-auth.json",
  );
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let runtime = runtimes.get(path);
  if (!runtime) {
    runtime = { queue: Promise.resolve(), pending: new Map() };
    runtimes.set(path, runtime);
  }
  const shared = runtime;

  async function locked<T>(operation: () => Promise<T>): Promise<T> {
    const previous = shared.queue;
    let release!: () => void;
    shared.queue = new Promise<void>((done) => {
      release = done;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async function readState(): Promise<State> {
    try {
      const contents = await readFile(/* turbopackIgnore: true */ path, "utf8");
      if (contents.length > 1_000_000) throw storageError();
      return stateSchema.parse(JSON.parse(contents));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          version: 1,
          hostId: `urn:uuid:${randomUUID()}`,
          registrations: [],
        };
      }
      throw storageError();
    }
  }

  async function saveState(state: State) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      stateSchema.parse(state);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(
        /* turbopackIgnore: true */ temporary,
        JSON.stringify(state),
        { mode: 0o600, flag: "wx" },
      );
      await rename(/* turbopackIgnore: true */ temporary, path);
    } catch {
      await unlink(/* turbopackIgnore: true */ temporary).catch(
        () => undefined,
      );
      throw storageError();
    }
  }

  async function request(
    url: string,
    init: RequestInit = {},
    timeout = 12_000,
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetcher(url, {
        ...init,
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  async function readJson(
    response: Response,
    maximum = 130_000,
  ): Promise<Record<string, unknown>> {
    if (Number(response.headers.get("content-length") ?? 0) > maximum)
      throw invalidResponse();
    const reader = response.body?.getReader();
    if (!reader) throw invalidResponse();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(unavailable());
        void reader.cancel().catch(() => undefined);
      }, 12_000);
    });
    try {
      return await Promise.race([
        deadline,
        (async () => {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maximum) {
              void reader.cancel().catch(() => undefined);
              throw invalidResponse();
            }
            chunks.push(value);
          }
          const parsed: unknown = JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          );
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw invalidResponse();
          return parsed as Record<string, unknown>;
        })(),
      ]);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "chatgpt_auth_unavailable"
      )
        throw error;
      throw invalidResponse();
    } finally {
      if (timer) clearTimeout(timer);
      reader.releaseLock();
    }
  }

  async function loadKeys(force = false): Promise<Record<string, unknown>[]> {
    if (!force && shared.jwks && shared.jwks.at + 10 * 60_000 > now())
      return shared.jwks.keys;
    const response = await request(JWKS);
    if (!response.ok) throw unavailable();
    const body = await readJson(response);
    if (
      !Array.isArray(body.keys) ||
      body.keys.length > 50 ||
      body.keys.length === 0 ||
      body.keys.some(
        (key) => !key || typeof key !== "object" || Array.isArray(key),
      )
    )
      throw invalidResponse();
    const keys = body.keys as Record<string, unknown>[];
    shared.jwks = { at: now(), keys };
    return keys;
  }

  async function identity(idToken: string, clientId: string, nonce?: string) {
    const parts = idToken.split(".");
    if (
      parts.length !== 3 ||
      parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
    )
      throw invalidResponse();
    let header: Record<string, unknown>;
    let payload: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
      payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
      throw invalidResponse();
    }
    if (
      !header ||
      !payload ||
      Array.isArray(header) ||
      Array.isArray(payload) ||
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      header.kid.length > 200 ||
      !header.kid ||
      header.crit !== undefined ||
      header.jku !== undefined ||
      header.jwk !== undefined
    )
      throw invalidResponse();
    let keys = await loadKeys();
    let matching = keys.filter((key) => key.kid === header.kid);
    if (matching.length === 0) {
      keys = await loadKeys(true);
      matching = keys.filter((key) => key.kid === header.kid);
    }
    if (matching.length !== 1) throw invalidResponse();
    const key = matching[0];
    if (
      key.kty !== "RSA" ||
      (key.alg !== undefined && key.alg !== "RS256") ||
      (key.use !== undefined && key.use !== "sig") ||
      (key.key_ops !== undefined &&
        (!Array.isArray(key.key_ops) || !key.key_ops.includes("verify")))
    )
      throw invalidResponse();
    try {
      const publicKey = createPublicKey({ key, format: "jwk" });
      if (
        publicKey.asymmetricKeyDetails?.modulusLength &&
        publicKey.asymmetricKeyDetails.modulusLength < 2048
      )
        throw invalidResponse();
      if (
        !verify(
          "RSA-SHA256",
          Buffer.from(`${parts[0]}.${parts[1]}`),
          publicKey,
          Buffer.from(parts[2], "base64url"),
        )
      )
        throw invalidResponse();
    } catch {
      throw invalidResponse();
    }
    const seconds = now() / 1000;
    const audiences =
      typeof payload.aud === "string" ? [payload.aud] : payload.aud;
    if (
      payload.iss !== ISSUER ||
      !Array.isArray(audiences) ||
      !audiences.includes(clientId) ||
      audiences.some((audience) => typeof audience !== "string") ||
      (audiences.length > 1 && payload.azp !== clientId) ||
      (payload.azp !== undefined && payload.azp !== clientId) ||
      !Number.isInteger(payload.exp) ||
      (payload.exp as number) <= seconds - 5 ||
      !Number.isInteger(payload.iat) ||
      (payload.iat as number) > seconds + 5 ||
      (payload.nbf !== undefined &&
        (!Number.isInteger(payload.nbf) ||
          (payload.nbf as number) > seconds + 5)) ||
      typeof payload.sub !== "string" ||
      !payload.sub ||
      payload.sub.length > 512 ||
      (nonce !== undefined &&
        (typeof payload.nonce !== "string" || !equal(payload.nonce, nonce)))
    )
      throw invalidResponse();
    return {
      subject: payload.sub,
      ...(typeof payload.email === "string" && payload.email.length <= 320
        ? { email: payload.email }
        : {}),
      ...(typeof payload.name === "string" && payload.name.length <= 200
        ? { name: payload.name }
        : {}),
    };
  }

  async function exchange(
    body: URLSearchParams,
  ): Promise<Record<string, unknown>> {
    const response = await request(TOKEN, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!response.ok) {
      const payload = await readJson(response, 8192).catch(
        () => ({}) as Record<string, unknown>,
      );
      const code =
        typeof payload.error === "string" ? payload.error : undefined;
      const expired = new Set([
        "invalid_grant",
        "invalid_refresh_token",
        "token_expired",
        "refresh_token_expired",
        "refresh_token_invalidated",
        "refresh_token_reused",
      ]);
      if (code && expired.has(code)) throw sessionExpired();
      if (code === "invalid_client")
        throw new ApiError(
          400,
          "chatgpt_client_invalid",
          "ChatGPT 应用登记暂不可用，请重新连接或使用 API Key。",
        );
      throw unavailable();
    }
    return readJson(response);
  }

  function parseTokens(
    payload: Record<string, unknown>,
    previousIdToken?: string,
  ): Tokens {
    const idToken = payload.id_token ?? previousIdToken;
    if (
      payload.token_type !== "Bearer" ||
      !Number.isInteger(payload.expires_in) ||
      (payload.expires_in as number) < 1 ||
      (payload.expires_in as number) > 86_400 ||
      typeof payload.scope !== "string" ||
      payload.scope.length > 4096
    )
      throw invalidResponse();
    const parsed = tokensSchema.safeParse({
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      idToken,
      scopes: payload.scope.split(/\s+/).filter(Boolean),
      expiresAt: now() + (payload.expires_in as number) * 1000,
    });
    if (
      !parsed.success ||
      (parsed.data.scopes.includes("offline_access") &&
        !parsed.data.refreshToken)
    )
      throw invalidResponse();
    return parsed.data;
  }

  function summary(state: State): ChatGPTAuthSummary {
    const active = state.registrations.find(
      (entry) => entry.clientId === state.activeClientId,
    );
    const signedIn =
      !!active?.subject &&
      !!active.tokens &&
      (active.tokens.expiresAt > now() || !!active.tokens.refreshToken);
    return {
      signedIn,
      sharing: signedIn && hasSharing(active?.tokens),
      ...(active?.subject
        ? {
            accountId: createHash("sha256")
              .update(JSON.stringify([ISSUER, active.clientId, active.subject]))
              .digest("hex"),
          }
        : {}),
      ...(active?.email ? { email: active.email } : {}),
      ...(active?.name ? { name: active.name } : {}),
    };
  }

  return {
    async start({
      redirectUri,
      newAccount = false,
    }: {
      redirectUri: string;
      newAccount?: boolean;
    }) {
      return locked(async () => {
        let callback: URL;
        try {
          callback = new URL(redirectUri);
        } catch {
          throw invalidAttempt();
        }
        if (
          callback.protocol !== "http:" ||
          callback.hostname !== "127.0.0.1" ||
          callback.pathname !== CALLBACK_PATH ||
          callback.search ||
          callback.hash ||
          callback.username ||
          callback.password ||
          callback.href !== redirectUri
        )
          throw invalidAttempt();
        for (const [key, attempt] of shared.pending)
          if (attempt.expiresAt <= now()) shared.pending.delete(key);
        if (shared.pending.size >= 5)
          throw new ApiError(
            429,
            "chatgpt_login_limit",
            "同时打开的登录窗口太多，请完成现有登录或稍后重试。",
          );
        const state = await readState();
        const selected = newAccount
          ? state.candidateClientId
          : (state.activeClientId ?? state.candidateClientId);
        const registration = state.registrations.find(
          (entry) => entry.clientId === selected,
        );
        const attemptId = random();
        const pending: Pending = {
          state: random(),
          nonce: random(),
          verifier: random(),
          redirectUri,
          ...(registration ? { clientId: registration.clientId } : {}),
          expiresAt: now() + ATTEMPT_LIFETIME,
        };
        await saveState(state); // Persist the stable host before the browser opens.
        shared.pending.set(attemptId, pending);
        const authorizationUrl = new URL(AUTHORIZE);
        authorizationUrl.search = new URLSearchParams({
          client_id: registration?.clientId ?? "dynamic_agent_client",
          ...(!registration ? { agent_name_hint: "薄肌语言俱乐部" } : {}),
          ext_agent_host_id: state.hostId,
          response_type: "code",
          redirect_uri: redirectUri,
          scope: SCOPES,
          resource: RESOURCE,
          state: pending.state,
          nonce: pending.nonce,
          code_challenge_method: "S256",
          code_challenge: createHash("sha256")
            .update(pending.verifier)
            .digest("base64url"),
          ...(registration?.tokens && !hasSharing(registration.tokens)
            ? { prompt: "consent" }
            : {}),
        }).toString();
        return { authorizationUrl: authorizationUrl.toString(), attemptId };
      });
    },

    async complete({ url, attemptId }: { url: string; attemptId: string }) {
      return locked(async () => {
        const pending = shared.pending.get(attemptId);
        shared.pending.delete(attemptId);
        if (!pending || pending.expiresAt <= now()) throw invalidAttempt();
        let callback: URL;
        try {
          callback = new URL(url);
        } catch {
          throw invalidAttempt();
        }
        const expected = new URL(pending.redirectUri);
        if (
          callback.origin !== expected.origin ||
          callback.pathname !== expected.pathname ||
          callback.hash ||
          callback.username ||
          callback.password ||
          ["state", "code", "client_id", "error"].some(
            (key) => callback.searchParams.getAll(key).length > 1,
          ) ||
          !equal(callback.searchParams.get("state") ?? "", pending.state)
        )
          throw invalidAttempt();
        if (callback.searchParams.has("error"))
          throw new ApiError(
            400,
            "chatgpt_login_cancelled",
            "ChatGPT 登录或套餐授权没有完成。可以重试，也可以选择 API Key。",
          );
        const code = callback.searchParams.get("code");
        const returnedId = callback.searchParams.get("client_id");
        if (
          !code ||
          code.length > 8192 ||
          (pending.clientId && returnedId && returnedId !== pending.clientId)
        )
          throw invalidAttempt();
        const clientId = pending.clientId ?? returnedId;
        if (!clientId || !clientIdSchema.safeParse(clientId).success)
          throw invalidAttempt();
        const state = await readState();
        let registration = state.registrations.find(
          (entry) => entry.clientId === clientId,
        );
        if (!pending.clientId) {
          // Keep the issued ID even if redemption fails; never register again solely to retry a code.
          if (!registration) {
            if (state.registrations.length >= 8) {
              const unused = state.registrations.findIndex(
                (entry) =>
                  entry.clientId !== state.activeClientId && !entry.tokens,
              );
              if (unused < 0)
                throw new ApiError(
                  409,
                  "chatgpt_account_limit",
                  "本机保存的 ChatGPT 登记已达上限，请先退出不用的账户。",
                );
              state.registrations.splice(unused, 1);
            }
            registration = { clientId, callbackPath: CALLBACK_PATH };
            state.registrations.push(registration);
          }
          state.candidateClientId = clientId;
          await saveState(state);
        }
        if (!registration) throw invalidAttempt();
        const payload = await exchange(
          new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            code,
            code_verifier: pending.verifier,
            redirect_uri: pending.redirectUri,
            resource: RESOURCE,
          }),
        );
        const tokens = parseTokens(payload);
        const account = await identity(tokens.idToken, clientId, pending.nonce);
        if (registration.subject && registration.subject !== account.subject)
          throw invalidResponse();
        Object.assign(registration, account, { tokens });
        // This personal installation keeps one renewable session. Retain other
        // registration mappings for retry without retaining unused credentials.
        for (const entry of state.registrations) {
          if (entry.clientId !== clientId) delete entry.tokens;
        }
        state.activeClientId = clientId;
        if (state.candidateClientId === clientId)
          delete state.candidateClientId;
        await saveState(state);
        return summary(state);
      });
    },

    async getSummary() {
      return locked(async () => summary(await readState()));
    },

    async getAccessToken() {
      return locked(async () => {
        const state = await readState();
        const active = state.registrations.find(
          (entry) => entry.clientId === state.activeClientId,
        );
        if (!active?.tokens || !active.subject)
          throw new ApiError(
            401,
            "chatgpt_not_signed_in",
            "请先点击 Continue with ChatGPT 登录并授权。",
          );
        if (!hasSharing(active.tokens))
          throw new ApiError(
            403,
            "chatgpt_permission_required",
            "已登录，但尚未授权使用 ChatGPT 套餐。请重新连接并允许使用套餐，或选择 API Key。",
          );
        if (active.tokens.expiresAt > now() + 60_000)
          return active.tokens.accessToken;
        if (!active.tokens.refreshToken) throw sessionExpired();
        let payload: Record<string, unknown>;
        try {
          payload = await exchange(
            new URLSearchParams({
              grant_type: "refresh_token",
              client_id: active.clientId,
              refresh_token: active.tokens.refreshToken,
              resource: RESOURCE,
            }),
          );
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.code === "chatgpt_session_expired"
          ) {
            delete active.tokens;
            await saveState(state);
          }
          throw error;
        }
        const tokens = parseTokens(payload, active.tokens.idToken);
        if (!tokens.refreshToken) throw invalidResponse();
        if (payload.id_token !== undefined) {
          const account = await identity(tokens.idToken, active.clientId);
          if (account.subject !== active.subject) throw invalidResponse();
          Object.assign(active, account);
        }
        active.tokens = tokens;
        await saveState(state);
        if (!hasSharing(tokens))
          throw new ApiError(
            403,
            "chatgpt_permission_required",
            "ChatGPT 套餐授权已关闭，请重新连接授权或选择 API Key。",
          );
        return tokens.accessToken;
      });
    },

    async signOut() {
      return locked(async () => {
        shared.pending.clear();
        const state = await readState();
        const active = state.registrations.find(
          (entry) => entry.clientId === state.activeClientId,
        );
        let remoteRevocationConfirmed = !active?.tokens;
        if (active?.tokens?.refreshToken) {
          try {
            const response = await request(DISCOVERY, {}, 5000);
            if (!response.ok) throw unavailable();
            const discovery = await readJson(response, 32_768);
            const endpoint = new URL(String(discovery.revocation_endpoint));
            if (
              discovery.issuer !== ISSUER ||
              endpoint.origin !== ISSUER ||
              endpoint.username ||
              endpoint.password ||
              endpoint.hash ||
              endpoint.search
            )
              throw invalidResponse();
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                const revoked = await request(
                  endpoint.href,
                  {
                    method: "POST",
                    headers: {
                      "content-type": "application/x-www-form-urlencoded",
                    },
                    body: new URLSearchParams({
                      token: active.tokens.refreshToken,
                      token_type_hint: "refresh_token",
                      client_id: active.clientId,
                    }),
                  },
                  5000,
                );
                if (revoked.status === 200) {
                  remoteRevocationConfirmed = true;
                  break;
                }
                if (revoked.status < 500) break;
              } catch {
                /* Retry once; local sign-out must still finish. */
              }
              if (attempt === 0)
                await new Promise((done) => setTimeout(done, 150));
            }
          } catch {
            /* Never expose discovery, token or upstream error text. */
          }
        }
        if (active) delete active.tokens;
        await saveState(state);
        return { remoteRevocationConfirmed };
      });
    },

    async cancel(attemptId: string) {
      await locked(async () => {
        shared.pending.delete(attemptId);
      });
    },
  };
}
