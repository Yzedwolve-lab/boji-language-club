import "server-only";
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "./errors";
import {
  readOpenAICompatibleConfig,
  type OpenAICompatibleConfig,
} from "./openai-compatible";
import type { SelfHostedAIConfiguration } from "../ai-types";

export type Environment = Record<string, string | undefined>;
export const SETUP_TOKEN_TTL_MS = 30 * 60_000;
const digest = (text: string) => createHash("sha256").update(text).digest();
const storageError = () =>
  new ApiError(
    503,
    "private_configuration_unavailable",
    "私有 AI 配置暂不可读写，请检查本机存储权限。原配置不会自动重置。",
  );
const invalidConfig = () =>
  new ApiError(
    400,
    "invalid_configuration",
    "请核对接口地址、模型、口令和每日调用限额。",
  );
const unauthorized = () =>
  new ApiError(
    401,
    "setup_authorization_required",
    "设置授权无效或已过期，请用启动器重新打开设置页面。",
  );

const fileSchema = z
  .object({
    version: z.literal(1),
    baseUrl: z.string().max(2048),
    apiKey: z.string().max(4096),
    model: z.string().max(200),
    tokenParameter: z.enum(["max_tokens", "max_completion_tokens"]),
    allowLocal: z.boolean(),
    timeoutMs: z.number().int().min(1000).max(35000),
    origin: z.string().max(2048),
    dailyLimit: z.number().int().min(0).max(1000),
    passwordSalt: z.string().regex(/^[a-f0-9]{32}$/),
    passwordHash: z.string().regex(/^[a-f0-9]{64}$/),
    sessionSecret: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type ConfigurationFile = z.infer<typeof fileSchema>;
const tokenSchema = z
  .object({
    version: z.literal(1),
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.string().datetime(),
  })
  .strict();
export type SetupTokenRecord = z.infer<typeof tokenSchema>;
export interface Configuration {
  provider: OpenAICompatibleConfig;
  origin: string;
  privateDirectory: string;
  dailyLimit: number;
  signingKey: Buffer;
  via: "file" | "environment";
  file?: ConfigurationFile;
  environmentPassword?: string;
}
export interface ConfigurationState {
  config: Configuration | null;
  via: "file" | "environment" | "none";
}
export function privateConfigurationDirectory(env: Environment) {
  const directory = resolve(
    /* turbopackIgnore: true */ env.BOJI_PRIVATE_DIR || ".boji-private",
  );
  const fromPublic = relative(resolve("public"), directory);
  if (!isAbsolute(fromPublic) && !fromPublic.startsWith(".."))
    throw storageError();
  return directory;
}
function privatePath(directory: string, name: string) {
  return resolve(/* turbopackIgnore: true */ directory, name);
}
async function readPrivateJson(
  directory: string,
  name: string,
): Promise<unknown | null> {
  try {
    const contents = await readFile(
      /* turbopackIgnore: true */ privatePath(directory, name),
      "utf8",
    );
    if (contents.length > 20000) throw storageError();
    return JSON.parse(contents);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw storageError();
  }
}
function validOrigin(value: string) {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.origin !== value ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    )
      throw invalidConfig();
    return value;
  } catch {
    throw invalidConfig();
  }
}
export function setupRequestOrigin(request: Request) {
  const origin = validOrigin(request.headers.get("origin") ?? "");
  const expected = new URL(origin);
  // Next constructs Request.url from its internal fetchHostname/listen port.
  // It is not necessarily the browser-facing origin, especially behind a proxy.
  // Compare the browser Origin with the actual HTTP Host, never forwarded headers;
  // the one-time setup token (or authenticated password) is still required below.
  if (
    request.headers.get("host") !== expected.host ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ApiError(
      403,
      "origin_denied",
      "请从启动器打开的同源页面配置 AI。",
    );
  return origin;
}
function providerFromFile(file: ConfigurationFile) {
  return readOpenAICompatibleConfig({
    ENABLE_OPENAI_COMPATIBLE: "true",
    OPENAI_COMPAT_BASE_URL: file.baseUrl,
    OPENAI_COMPAT_API_KEY: file.apiKey,
    OPENAI_COMPAT_MODEL: file.model,
    OPENAI_COMPAT_ALLOW_LOCAL: String(file.allowLocal),
    OPENAI_COMPAT_TIMEOUT_MS: String(file.timeoutMs),
    OPENAI_COMPAT_TOKEN_PARAMETER: file.tokenParameter,
  })!;
}
export function configurationFromFile(
  file: ConfigurationFile,
  directory: string,
): Configuration {
  const parsed = fileSchema.parse(file);
  return {
    provider: providerFromFile(parsed),
    origin: validOrigin(parsed.origin),
    privateDirectory: directory,
    dailyLimit: parsed.dailyLimit,
    signingKey: digest(
      JSON.stringify([
        parsed.sessionSecret,
        parsed.baseUrl,
        parsed.apiKey,
        parsed.model,
        parsed.origin,
      ]),
    ),
    via: "file",
    file: parsed,
  };
}
export async function readSelfHostedConfiguration(
  env: Environment,
): Promise<ConfigurationState> {
  if (env.APP_MODE === "production") return { config: null, via: "none" };
  const directory = privateConfigurationDirectory(env);
  const raw = await readPrivateJson(directory, "ai-config.json");
  if (raw !== null) {
    try {
      return {
        config: configurationFromFile(fileSchema.parse(raw), directory),
        via: "file",
      };
    } catch {
      throw storageError();
    }
  }
  if (env.APP_MODE !== "self_hosted") return { config: null, via: "none" };
  try {
    const provider = readOpenAICompatibleConfig(env);
    const password = env.BOJI_SELF_HOSTED_PASSWORD ?? "";
    const origin = validOrigin(
      env.BOJI_SELF_HOSTED_ORIGIN ?? "http://127.0.0.1:3100",
    );
    const dailyLimit = Number(env.BOJI_DAILY_AI_CALL_LIMIT ?? 40);
    if (
      !provider ||
      password.length < 16 ||
      password.length > 1024 ||
      !password.trim() ||
      !Number.isInteger(dailyLimit) ||
      dailyLimit < 0 ||
      dailyLimit > 1000
    )
      return { config: null, via: "environment" };
    return {
      config: {
        provider,
        origin,
        privateDirectory: directory,
        dailyLimit,
        signingKey: digest(
          JSON.stringify([
            password,
            provider.baseUrl,
            provider.apiKey,
            provider.model,
            origin,
          ]),
        ),
        environmentPassword: password,
        via: "environment",
      },
      via: "environment",
    };
  } catch {
    return { config: null, via: "environment" };
  }
}
export function correctPassword(input: string, config: Configuration) {
  if (input.length > 1024) return false;
  if (config.file)
    return timingSafeEqual(
      scryptSync(input, config.file.passwordSalt, 32),
      Buffer.from(config.file.passwordHash, "hex"),
    );
  return timingSafeEqual(
    digest(input),
    digest(config.environmentPassword ?? ""),
  );
}
export function publicConfiguration(
  config: Configuration,
): SelfHostedAIConfiguration {
  return {
    baseUrl: config.provider.baseUrl,
    model: config.provider.model,
    dailyLimit: config.dailyLimit,
    tokenParameter: config.provider.tokenParameter,
    allowLocal: config.provider.allowLocal,
    hasApiKey: !!config.provider.apiKey,
  };
}
export async function readSetupToken(
  directory: string,
  now: number,
): Promise<SetupTokenRecord | null> {
  const raw = await readPrivateJson(directory, "setup-token.json");
  if (raw === null) return null;
  const parsed = tokenSchema.safeParse(raw);
  if (!parsed.success) throw storageError();
  const created = Date.parse(parsed.data.createdAt);
  return created <= now + 60_000 && created > now - SETUP_TOKEN_TTL_MS
    ? parsed.data
    : null;
}
export async function verifySetupToken(
  directory: string,
  input: string | undefined,
  now: number,
) {
  const record = await readSetupToken(directory, now);
  const validShape =
    typeof input === "string" && /^[A-Za-z0-9_-]{43}$/.test(input);
  if (
    !record ||
    !validShape ||
    !timingSafeEqual(digest(input), Buffer.from(record.tokenHash, "hex"))
  )
    throw unauthorized();
  return record;
}
export const configureInputSchema = z
  .object({
    setupToken: z.string().max(100).optional(),
    currentPassword: z.string().max(1024).optional(),
    baseUrl: z.string().trim().min(1).max(2048),
    apiKey: z.string().max(4096).optional(),
    model: z.string().trim().min(1).max(200),
    password: z.string().max(1024).optional(),
    dailyLimit: z.number().int().min(0).max(1000).optional(),
    tokenParameter: z.enum(["max_tokens", "max_completion_tokens"]).optional(),
    allowLocal: z.boolean().optional(),
  })
  .strict();
export function candidateConfiguration(
  input: z.infer<typeof configureInputSchema>,
  previous: Configuration | null,
  origin: string,
  directory: string,
  now: number,
) {
  let endpoint: string;
  try {
    endpoint = new URL(input.baseUrl).toString().replace(/\/+$/, "");
  } catch {
    throw invalidConfig();
  }
  const providedKey = input.apiKey?.trim();
  if (!providedKey && previous && endpoint !== previous.provider.baseUrl)
    throw new ApiError(
      400,
      "new_endpoint_requires_key",
      "更换接口地址时请重新输入 API Key，旧密钥不会发送到新地址。",
    );
  const newPassword = input.password || undefined;
  if (
    (!previous && !newPassword) ||
    (newPassword && (newPassword.length < 16 || !newPassword.trim()))
  )
    throw new ApiError(
      400,
      "invalid_password",
      "请设置至少 16 字符的独立访问口令。",
    );
  const passwordSalt =
    !newPassword && previous?.file
      ? previous.file.passwordSalt
      : randomBytes(16).toString("hex");
  const passwordHash =
    !newPassword && previous?.file
      ? previous.file.passwordHash
      : scryptSync(
          newPassword ?? previous!.environmentPassword!,
          passwordSalt,
          32,
        ).toString("hex");
  const file: ConfigurationFile = {
    version: 1,
    baseUrl: endpoint,
    apiKey: providedKey || previous?.provider.apiKey || "",
    model: input.model,
    tokenParameter:
      input.tokenParameter ?? previous?.provider.tokenParameter ?? "max_tokens",
    allowLocal: input.allowLocal ?? previous?.provider.allowLocal ?? false,
    timeoutMs: previous?.provider.timeoutMs ?? 20000,
    origin,
    dailyLimit: input.dailyLimit ?? previous?.dailyLimit ?? 40,
    passwordSalt,
    passwordHash,
    sessionSecret: randomBytes(32).toString("hex"),
    createdAt: previous?.file?.createdAt ?? new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
  try {
    return configurationFromFile(file, directory);
  } catch {
    throw invalidConfig();
  }
}
export async function commitConfiguration(
  config: Configuration,
  tokenRecord: SetupTokenRecord | null,
  now: number,
) {
  if (!config.file) throw storageError();
  if (tokenRecord) {
    const current = await readSetupToken(config.privateDirectory, now);
    if (!current || current.tokenHash !== tokenRecord.tokenHash)
      throw unauthorized();
  }
  const path = privatePath(config.privateDirectory, "ai-config.json");
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(config.privateDirectory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify(config.file), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
  } catch {
    await unlink(temporary).catch(() => {});
    throw storageError();
  }
  if (tokenRecord) {
    // A rotated token is not deleted accidentally. Existing configuration also
    // permanently disables token-only initialization, even if cleanup fails.
    try {
      const current = await readSetupToken(config.privateDirectory, now);
      if (current?.tokenHash === tokenRecord.tokenHash)
        await unlink(privatePath(config.privateDirectory, "setup-token.json"));
    } catch {
      /* The saved configuration is authoritative; token cannot override it. */
    }
  }
}
const activeMutations = new Set<string>();
export async function withConfigurationMutation<T>(
  directory: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (activeMutations.has(directory))
    throw new ApiError(
      409,
      "configuration_in_progress",
      "已有一次设置测试正在进行，请等待结果，不要重复提交。",
    );
  activeMutations.add(directory);
  try {
    return await operation();
  } finally {
    activeMutations.delete(directory);
  }
}
