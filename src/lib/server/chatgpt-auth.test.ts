import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatGPTAuth } from "./chatgpt-auth";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const key = {
  ...publicKey.export({ format: "jwk" }),
  kid: "test-key",
  alg: "RS256",
  use: "sig",
};
const CALLBACK = "http://127.0.0.1:3100/api/self-hosted/chatgpt/callback";
const ISSUER = "https://auth.openai.com";
const SCOPE =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const directories: string[] = [];

function jwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: "test-key" },
) {
  const body = `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "boji-chatgpt-auth-test-"));
  directories.push(directory);
  let time = 1_800_000_000_000;
  let nonce = "";
  let selectedClient = "oaiapp_test";
  let claims: Record<string, unknown> = {};
  let scope = SCOPE;
  let tokenHandler:
    ((params: URLSearchParams) => Response | Promise<Response>) | undefined;
  let keyHandler: (() => Response) | undefined;
  let revokeHandler: (() => Response | Promise<Response>) | undefined;
  const calls: { url: string; params: URLSearchParams }[] = [];
  function tokens(overrides: Record<string, unknown> = {}) {
    return {
      access_token: "fixture-access-token",
      refresh_token: "fixture-refresh-token",
      token_type: "Bearer",
      expires_in: 3600,
      scope,
      id_token: jwt({
        iss: ISSUER,
        aud: selectedClient,
        sub: "subject-one",
        email: "user@example.test",
        name: "Test User",
        exp: Math.floor(time / 1000) + 3600,
        iat: Math.floor(time / 1000),
        nonce,
        ...claims,
      }),
      ...overrides,
    };
  }
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const params = new URLSearchParams(String(init?.body ?? ""));
      calls.push({ url, params });
      expect(init?.redirect).toBe("error");
      expect(init?.cache).toBe("no-store");
      if (url.endsWith("/.well-known/jwks.json"))
        return keyHandler ? keyHandler() : Response.json({ keys: [key] });
      if (url.endsWith("/.well-known/openid-configuration"))
        return Response.json({
          issuer: ISSUER,
          revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke`,
        });
      if (url.endsWith("/revoke"))
        return revokeHandler
          ? revokeHandler()
          : new Response(null, { status: 200 });
      if (url.endsWith("/oauth/token"))
        return tokenHandler ? tokenHandler(params) : Response.json(tokens());
      throw new Error("unexpected test URL");
    },
  ) as unknown as typeof fetch;
  const options = { directory, fetcher, now: () => time };
  const auth = createChatGPTAuth(options);
  async function start(newAccount = false, client = "oaiapp_test") {
    const attempt = await auth.start({ redirectUri: CALLBACK, newAccount });
    const query = new URL(attempt.authorizationUrl).searchParams;
    nonce = query.get("nonce")!;
    selectedClient = client;
    const url = new URL(CALLBACK);
    url.search = new URLSearchParams({
      state: query.get("state")!,
      code: "fixture-code",
      client_id: client,
    }).toString();
    return { ...attempt, query, url: url.href };
  }
  return {
    directory,
    auth,
    options,
    calls,
    tokens,
    start,
    setClaims: (value: Record<string, unknown>) => {
      claims = value;
    },
    setScope: (value: string) => {
      scope = value;
    },
    advance: (amount: number) => {
      time += amount;
    },
    setTokenHandler: (handler?: typeof tokenHandler) => {
      tokenHandler = handler;
    },
    setKeyHandler: (handler: () => Response) => {
      keyHandler = handler;
    },
    setRevokeHandler: (handler: NonNullable<typeof revokeHandler>) => {
      revokeHandler = handler;
    },
    state: async () =>
      JSON.parse(await readFile(join(directory, "chatgpt-auth.json"), "utf8")),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ChatGPT local public OAuth", () => {
  it("persists a stable host, generates independent state/nonce/PKCE, and exchanges the exact redirect", async () => {
    const f = await fixture();
    const a = await f.start();
    const b = await createChatGPTAuth(f.options).start({
      redirectUri: CALLBACK,
    });
    const bQuery = new URL(b.authorizationUrl).searchParams;
    expect(a.query.get("client_id")).toBe("dynamic_agent_client");
    expect(a.query.get("agent_name_hint")).toBe("薄肌语言俱乐部");
    expect(a.query.get("ext_agent_host_id")).toBe(
      bQuery.get("ext_agent_host_id"),
    );
    expect(a.query.get("ext_agent_host_id")).toMatch(/^urn:uuid:/);
    for (const name of ["state", "nonce", "code_challenge"])
      expect(a.query.get(name)).not.toBe(bQuery.get(name));
    expect(a.query.get("scope")).toBe(SCOPE);
    expect(a.query.has("id_token_hint")).toBe(false);
    expect(a.query.has("login_hint")).toBe(false);
    f.setTokenHandler(async (params) => {
      expect(params.get("client_id")).toBe("oaiapp_test");
      expect((await f.state()).candidateClientId).toBe("oaiapp_test");
      expect(params.get("redirect_uri")).toBe(CALLBACK);
      expect(params.get("resource")).toBe("https://api.openai.com/v1");
      expect(params.has("client_secret")).toBe(false);
      expect(
        createHash("sha256")
          .update(params.get("code_verifier")!)
          .digest("base64url"),
      ).toBe(a.query.get("code_challenge"));
      return Response.json(f.tokens());
    });
    expect(await f.auth.complete(a)).toEqual({
      signedIn: true,
      sharing: true,
      accountId: expect.stringMatching(/^[0-9a-f]{64}$/),
      email: "user@example.test",
      name: "Test User",
    });
    expect(await f.auth.getAccessToken()).toBe("fixture-access-token");
    expect(JSON.stringify(await f.auth.getSummary())).not.toMatch(
      /token|oaiapp|subject|nonce/i,
    );
  });

  it.each([
    "https://127.0.0.1:3100/api/self-hosted/chatgpt/callback",
    "http://localhost:3100/api/self-hosted/chatgpt/callback",
    "http://example.test/api/self-hosted/chatgpt/callback",
    `${CALLBACK}?x=1`,
    `${CALLBACK}#x`,
    "http://127.0.0.1:3100/other",
  ])("rejects unsupported callback %s", async (redirectUri) => {
    const f = await fixture();
    await expect(f.auth.start({ redirectUri })).rejects.toMatchObject({
      code: "chatgpt_login_expired",
    });
    expect(f.calls).toHaveLength(0);
  });

  it.each([
    "state",
    "expired",
    "wrong-origin",
    "wrong-path",
    "duplicate",
    "missing-code",
    "missing-client",
    "dynamic-client",
  ])("rejects and consumes bad callback: %s", async (kind) => {
    const f = await fixture();
    const a = await f.start();
    const url = new URL(a.url);
    if (kind === "state") url.searchParams.set("state", "wrong");
    if (kind === "expired") f.advance(600_001);
    if (kind === "wrong-origin") url.port = "3101";
    if (kind === "wrong-path") url.pathname = "/other";
    if (kind === "duplicate") url.searchParams.append("code", "another");
    if (kind === "missing-code") url.searchParams.delete("code");
    if (kind === "missing-client") url.searchParams.delete("client_id");
    if (kind === "dynamic-client")
      url.searchParams.set("client_id", "dynamic_agent_client");
    await expect(
      f.auth.complete({ ...a, url: url.href }),
    ).rejects.toMatchObject({ code: "chatgpt_login_expired" });
    await expect(f.auth.complete(a)).rejects.toMatchObject({
      code: "chatgpt_login_expired",
    });
    expect(f.calls).toHaveLength(0);
  });

  it("cancellation and denied consent never redeem a code", async () => {
    const f = await fixture();
    const a = await f.start();
    await f.auth.cancel(a.attemptId);
    await expect(f.auth.complete(a)).rejects.toMatchObject({
      code: "chatgpt_login_expired",
    });
    const b = await f.start();
    const url = new URL(b.url);
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", "UPSTREAM SECRET MUST NOT LEAK");
    await expect(
      f.auth.complete({ ...b, url: url.href }),
    ).rejects.toMatchObject({ code: "chatgpt_login_cancelled" });
    expect(f.calls).toHaveLength(0);
  });

  it("bounds pending attempts across factory instances and expires them", async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i++) await f.start();
    await expect(
      createChatGPTAuth(f.options).start({ redirectUri: CALLBACK }),
    ).rejects.toMatchObject({ code: "chatgpt_login_limit" });
    f.advance(600_001);
    await expect(f.start()).resolves.toHaveProperty("attemptId");
  });

  it("retains issued registration before failed code redemption and reuses it", async () => {
    const f = await fixture();
    const a = await f.start();
    f.setTokenHandler(() =>
      Response.json(
        { error: "invalid_grant", error_description: "SECRET" },
        { status: 400 },
      ),
    );
    await expect(f.auth.complete(a)).rejects.toMatchObject({
      code: "chatgpt_session_expired",
    });
    const b = await f.start();
    expect(b.query.get("client_id")).toBe("oaiapp_test");
    expect(b.query.has("agent_name_hint")).toBe(false);
    expect(b.query.get("ext_agent_host_id")).toBe(
      a.query.get("ext_agent_host_id"),
    );
  });

  it.each([
    { iss: "https://evil.test" },
    { aud: "oaiapp_other" },
    { exp: 1 },
    { nonce: "wrong" },
    { sub: "" },
    { iat: 9_999_999_999 },
    { nbf: 9_999_999_999 },
    { aud: ["oaiapp_test", "oaiapp_other"] },
    { azp: "oaiapp_other" },
  ])("rejects invalid signed identity claims %j", async (claims) => {
    const f = await fixture();
    f.setClaims(claims);
    const a = await f.start();
    await expect(f.auth.complete(a)).rejects.toMatchObject({
      code: "chatgpt_auth_invalid_response",
    });
    expect((await f.auth.getSummary()).signedIn).toBe(false);
  });

  it.each(["algorithm", "signature", "kid", "embedded-key"])(
    "rejects invalid JWT %s",
    async (kind) => {
      const f = await fixture();
      const a = await f.start();
      f.setTokenHandler(() => {
        const tokens = f.tokens();
        if (kind === "signature") {
          const parts = tokens.id_token.split(".");
          parts[2] = Buffer.alloc(256).toString("base64url");
          tokens.id_token = parts.join(".");
        } else {
          tokens.id_token = jwt(
            {},
            {
              alg: kind === "algorithm" ? "HS256" : "RS256",
              kid: kind === "kid" ? "missing" : "test-key",
              ...(kind === "embedded-key" ? { jwk: key } : {}),
            },
          );
        }
        return Response.json(tokens);
      });
      await expect(f.auth.complete(a)).rejects.toMatchObject({
        code: "chatgpt_auth_invalid_response",
      });
    },
  );

  it("checks both inference scopes and keeps an identity-only login without calling inference", async () => {
    const f = await fixture();
    f.setScope("openid profile email offline_access");
    const a = await f.start();
    expect(await f.auth.complete(a)).toMatchObject({
      signedIn: true,
      sharing: false,
    });
    await expect(f.auth.getAccessToken()).rejects.toMatchObject({
      code: "chatgpt_permission_required",
    });
    const reauthorize = await f.start();
    expect(reauthorize.query.get("prompt")).toBe("consent");
  });

  it("rejects a changed returning client or subject and preserves working credentials", async () => {
    const f = await fixture();
    await f.auth.complete(await f.start());
    const changedClient = await f.start(false, "oaiapp_other");
    await expect(f.auth.complete(changedClient)).rejects.toMatchObject({
      code: "chatgpt_login_expired",
    });
    f.setClaims({ sub: "another-subject" });
    await expect(f.auth.complete(await f.start())).rejects.toMatchObject({
      code: "chatgpt_auth_invalid_response",
    });
    expect(await f.auth.getAccessToken()).toBe("fixture-access-token");
  });

  it("accepts returning callback without client_id and prevents replay", async () => {
    const f = await fixture();
    await f.auth.complete(await f.start());
    const a = await f.start();
    expect(a.query.has("id_token_hint")).toBe(false);
    const url = new URL(a.url);
    url.searchParams.delete("client_id");
    expect(await f.auth.complete({ ...a, url: url.href })).toMatchObject({
      signedIn: true,
    });
    await expect(f.auth.complete(a)).rejects.toMatchObject({
      code: "chatgpt_login_expired",
    });
  });

  it("keeps the active account when changing accounts fails and retains candidate for retry", async () => {
    const f = await fixture();
    await f.auth.complete(await f.start());
    const next = await f.start(true, "oaiapp_new");
    expect(next.query.get("client_id")).toBe("dynamic_agent_client");
    f.setTokenHandler(() =>
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    await expect(f.auth.complete(next)).rejects.toMatchObject({
      code: "chatgpt_session_expired",
    });
    expect(await f.auth.getAccessToken()).toBe("fixture-access-token");
    expect((await f.start(true, "oaiapp_new")).query.get("client_id")).toBe(
      "oaiapp_new",
    );
  });

  it("binds summaries to verified account mappings and clears unused tokens only after successful replacement", async () => {
    const f = await fixture();
    const first = await f.auth.complete(await f.start());
    expect((await createChatGPTAuth(f.options).getSummary()).accountId).toBe(
      first.accountId,
    );
    f.setClaims({ sub: "second-subject", email: "other@example.test" });
    const next = await f.auth.complete(await f.start(true, "oaiapp_second"));
    expect(next.accountId).not.toBe(first.accountId);
    const stored = await f.state();
    expect(stored.registrations[0]).toMatchObject({
      clientId: "oaiapp_test",
      subject: "subject-one",
    });
    expect(stored.registrations[0].tokens).toBeUndefined();
    expect(stored.registrations[1].tokens).toBeDefined();
    await f.auth.signOut();
    expect(
      (await f.state()).registrations.every(
        (entry: { tokens?: unknown }) => entry.tokens === undefined,
      ),
    ).toBe(true);
    expect((await f.auth.getSummary()).accountId).toBe(next.accountId);
  });

  it("serializes refresh rotation across factory instances and atomically saves replacements", async () => {
    const f = await fixture();
    await f.auth.complete(await f.start());
    f.advance(3_550_000);
    let refreshes = 0;
    f.setTokenHandler((params) => {
      refreshes++;
      expect(params.get("grant_type")).toBe("refresh_token");
      expect(params.get("refresh_token")).toBe("fixture-refresh-token");
      expect(params.has("scope")).toBe(false);
      return Response.json(
        f.tokens({
          access_token: "fixture-access-rotated",
          refresh_token: "fixture-refresh-rotated",
        }),
      );
    });
    expect(
      await Promise.all([
        f.auth.getAccessToken(),
        createChatGPTAuth(f.options).getAccessToken(),
      ]),
    ).toEqual(["fixture-access-rotated", "fixture-access-rotated"]);
    expect(refreshes).toBe(1);
    expect((await f.state()).registrations[0].tokens).toMatchObject({
      accessToken: "fixture-access-rotated",
      refreshToken: "fixture-refresh-rotated",
    });
  });

  it("keeps credentials on temporary refresh failure and clears only unusable tokens", async () => {
    const f = await fixture();
    await f.auth.complete(await f.start());
    f.advance(3_550_000);
    f.setTokenHandler(() =>
      Response.json({ error: "temporary", message: "SECRET" }, { status: 503 }),
    );
    await expect(f.auth.getAccessToken()).rejects.toMatchObject({
      code: "chatgpt_auth_unavailable",
    });
    expect((await f.state()).registrations[0].tokens.accessToken).toBe(
      "fixture-access-token",
    );
    f.setTokenHandler(() =>
      Response.json({ error: "refresh_token_reused" }, { status: 400 }),
    );
    await expect(f.auth.getAccessToken()).rejects.toMatchObject({
      code: "chatgpt_session_expired",
    });
    expect((await f.state()).registrations[0].tokens).toBeUndefined();
    expect((await f.start()).query.get("client_id")).toBe("oaiapp_test");
  });

  it("rejects refresh identity changes without replacing a verified mapping", async () => {
    const f = await fixture();
    await f.auth.complete(await f.start());
    f.advance(3_550_000);
    f.setClaims({ sub: "another-subject" });
    await expect(f.auth.getAccessToken()).rejects.toMatchObject({
      code: "chatgpt_auth_invalid_response",
    });
    expect((await f.state()).registrations[0].subject).toBe("subject-one");
  });

  it("refreshes a previously unseen signing key once and rejects duplicate matching keys", async () => {
    const f = await fixture();
    let reads = 0;
    f.setKeyHandler(() => {
      reads++;
      return Response.json({
        keys: reads === 1 ? [{ ...key, kid: "old" }] : [key, key],
      });
    });
    await expect(f.auth.complete(await f.start())).rejects.toMatchObject({
      code: "chatgpt_auth_invalid_response",
    });
    expect(reads).toBe(2);
  });

  it("revokes on signout, removes all tokens, cancels attempts and retains registration", async () => {
    const f = await fixture();
    const first = await f.start();
    await f.auth.complete(first);
    const pending = await f.start();
    expect(await f.auth.signOut()).toEqual({ remoteRevocationConfirmed: true });
    const revocation = f.calls.find((call) => call.url.endsWith("/revoke"))!;
    expect(revocation.params.get("token")).toBe("fixture-refresh-token");
    expect(revocation.params.get("client_id")).toBe("oaiapp_test");
    expect(revocation.params.get("token_type_hint")).toBe("refresh_token");
    expect((await f.state()).registrations[0].tokens).toBeUndefined();
    expect(await f.auth.getSummary()).toMatchObject({
      signedIn: false,
      sharing: false,
    });
    await expect(f.auth.complete(pending)).rejects.toMatchObject({
      code: "chatgpt_login_expired",
    });
    const next = await f.start();
    expect(next.query.get("client_id")).toBe("oaiapp_test");
    expect(next.query.get("ext_agent_host_id")).toBe(
      first.query.get("ext_agent_host_id"),
    );
  });

  it("finishes local signout and reports unconfirmed remote revocation after bounded retries", async () => {
    const f = await fixture();
    await f.auth.complete(await f.start());
    let revocations = 0;
    f.setRevokeHandler(() => {
      revocations++;
      return new Response("SECRET", { status: 503 });
    });
    expect(await f.auth.signOut()).toEqual({
      remoteRevocationConfirmed: false,
    });
    expect(revocations).toBe(2);
    expect((await f.state()).registrations[0].tokens).toBeUndefined();
  });

  it("rejects a token response with oversized data without exposing its contents", async () => {
    const f = await fixture();
    f.setTokenHandler(() => new Response("SECRET".repeat(30_000)));
    await expect(f.auth.complete(await f.start())).rejects.toMatchObject({
      code: "chatgpt_auth_invalid_response",
    });
  });

  it("bounds stalled token response bodies without exposing credentials", async () => {
    const f = await fixture();
    const a = await f.start();
    let received!: () => void;
    const responseStarted = new Promise<void>((done) => {
      received = done;
    });
    f.setTokenHandler(() => {
      received();
      return new Response(
        new ReadableStream({
          start() {
            /* deliberately stalled */
          },
        }),
      );
    });
    vi.useFakeTimers();
    const checked = expect(f.auth.complete(a)).rejects.toMatchObject({
      code: "chatgpt_auth_unavailable",
    });
    await responseStarted;
    await vi.advanceTimersByTimeAsync(12_001);
    await checked;
  });

  it("saves reduced scopes on refresh and stops new inference", async () => {
    const f = await fixture();
    await f.auth.complete(await f.start());
    f.advance(3_550_000);
    f.setScope("openid profile email offline_access resource.invoke");
    await expect(f.auth.getAccessToken()).rejects.toMatchObject({
      code: "chatgpt_permission_required",
    });
    expect(await f.auth.getSummary()).toMatchObject({
      signedIn: true,
      sharing: false,
    });
  });

  it("returns a fixed error when the transport throws private upstream details", async () => {
    const f = await fixture();
    f.setTokenHandler(() => {
      throw new Error("SECRET fixture-refresh-token");
    });
    const error = await f.auth
      .complete(await f.start())
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "chatgpt_auth_unavailable" });
    expect(String(error)).not.toMatch(/SECRET|fixture-refresh-token/);
  });
});
