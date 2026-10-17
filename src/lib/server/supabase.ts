import "server-only";
import { ApiError } from "./errors";

export type Fetcher = typeof fetch;
export interface ServerConfig {
  url: string;
  anonKey: string;
  serviceKey: string;
}
export interface Session {
  userId: string;
  token: string;
}

export function serverConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  if (env.APP_MODE !== "production")
    throw new ApiError(
      503,
      "production_unavailable",
      "This installation runs an explicitly local demo. Production accounts are not enabled.",
    );
  const {
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  } = env;
  if (!url || !anonKey || !serviceKey)
    throw new ApiError(
      503,
      "configuration_required",
      "Production account storage is not configured.",
    );
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !(
      env.NODE_ENV !== "production" &&
      ["127.0.0.1", "localhost"].includes(parsed.hostname)
    )
  ) {
    throw new ApiError(503, "invalid_configuration", "Storage requires HTTPS.");
  }
  return { url: url.replace(/\/$/, ""), anonKey, serviceKey };
}

export class SupabaseGateway {
  constructor(
    readonly config: ServerConfig,
    readonly fetcher: Fetcher = fetch,
  ) {}

  async authenticate(request: Request): Promise<Session> {
    const header = request.headers.get("authorization");
    if (!header || !/^Bearer [A-Za-z0-9._-]+$/.test(header))
      throw new ApiError(
        401,
        "authentication_required",
        "Sign in to continue.",
      );
    const token = header.slice(7);
    const response = await this.fetcher(`${this.config.url}/auth/v1/user`, {
      headers: {
        apikey: this.config.anonKey,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403)
      throw new ApiError(
        401,
        "invalid_session",
        "Your session has expired. Sign in again.",
      );
    if (!response.ok)
      throw new ApiError(
        503,
        "authentication_unavailable",
        "Sign-in verification is temporarily unavailable.",
      );
    const user: unknown = await response.json();
    if (
      !user ||
      typeof user !== "object" ||
      !("id" in user) ||
      typeof user.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(user.id)
    )
      throw new ApiError(401, "invalid_session", "Session validation failed.");
    return { userId: user.id, token };
  }

  async rest<T>(
    path: string,
    session: Session,
    init: RequestInit = {},
    privileged = false,
  ): Promise<T> {
    const key = privileged ? this.config.serviceKey : this.config.anonKey;
    const response = await this.fetcher(`${this.config.url}/rest/v1/${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${privileged ? key : session.token}`,
        Prefer: "return=representation",
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
      };
      // Only map our own non-sensitive business errors; do not echo PostgreSQL internals.
      const safe: Record<string, [number, string]> = {
        not_ready: [409, "Both modules must be complete before claiming."],
        period_closed: [409, "This training period is closed."],
        missing_profile: [409, "Complete onboarding first."],
        account_deleting: [409, "Account deletion is in progress."],
        not_found: [404, "This resource is unavailable."],
        quota_exceeded: [
          429,
          "The configured usage limit has been reached. Your draft is retained.",
        ],
        rate_limited: [429, "Too many requests. Please try again shortly."],
        timezone_locked: [
          409,
          "Timezone changes require a future-boundary migration.",
        ],
        request_key_conflict: [
          409,
          "This request key already belongs to different saved input. Use a new key for a new attempt.",
        ],
      };
      if (data.message && safe[data.message])
        throw new ApiError(
          safe[data.message][0],
          data.message,
          safe[data.message][1],
        );
      throw new ApiError(
        response.status === 401 ? 401 : 503,
        "storage_unavailable",
        "Storage could not complete this operation. Please retry.",
      );
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  rpc<T>(
    name: string,
    args: Record<string, unknown>,
    session: Session,
    privileged = false,
  ): Promise<T> {
    return this.rest<T>(
      `rpc/${name}`,
      session,
      { method: "POST", body: JSON.stringify(args) },
      privileged,
    );
  }

  async own<T extends { user_id: string }>(
    table: string,
    id: string,
    session: Session,
  ): Promise<T> {
    if (!/^[a-z_]+$/.test(table) || !/^[0-9a-f-]{36}$/i.test(id))
      throw new ApiError(404, "not_found", "This resource is unavailable.");
    const rows = await this.rest<T[]>(
      `${table}?id=eq.${id}&user_id=eq.${session.userId}&select=*&limit=1`,
      session,
    );
    if (!rows[0] || rows[0].user_id !== session.userId)
      throw new ApiError(404, "not_found", "This resource is unavailable.");
    return rows[0];
  }
}
