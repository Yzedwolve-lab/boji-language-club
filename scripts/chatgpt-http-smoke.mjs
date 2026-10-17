// Real Next HTTP and cookie/callback behavior. Cancels OAuth locally before any
// external token exchange; never opens an account or makes an inference request.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const origin = "http://127.0.0.1:3116";
const directory = await mkdtemp(join(tmpdir(), "boji-chatgpt-http-"));
const checks = [];
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3116",
  ],
  {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      APP_MODE: "demo",
      ENABLE_OPENAI_COMPATIBLE: "false",
      OPENAI_COMPAT_API_KEY: "",
      BOJI_PRIVATE_DIR: directory,
    },
  },
);
async function call(path, body, cookie = "", headers = {}) {
  return fetch(`${origin}/api/self-hosted/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (app.exitCode !== null) throw new Error("Isolated test server exited");
    try {
      ready = (await call("status")).ok;
    } catch {
      /* startup */
    }
    if (ready) break;
    await new Promise((done) => setTimeout(done, 200));
  }
  assert.ok(ready);
  const initial = await (await call("status")).json();
  assert.equal(initial.chatgpt.available, true);
  assert.equal(initial.chatgpt.signedIn, false);
  assert.equal(initial.apiKey.configured, false);
  checks.push("local choices available without API config");

  const start = await call("chatgpt/start", {});
  assert.equal(start.status, 200);
  const url = new URL((await start.json()).authorizationUrl);
  assert.equal(url.origin, "https://auth.openai.com");
  assert.equal(url.pathname, "/api/accounts/authorize");
  assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    `${origin}/api/self-hosted/chatgpt/callback`,
  );
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(
    url.searchParams.get("scope").includes("chatgpt.tokens.use.direct"),
  );
  assert.equal(url.searchParams.has("id_token_hint"), false);
  const cookieHeader = start.headers.getSetCookie()[0];
  assert.ok(cookieHeader.includes("HttpOnly; SameSite=Lax"));
  const cookie = cookieHeader.split(";")[0];
  checks.push(
    "official dynamic OAuth URL, PKCE and browser-bound callback cookie",
  );

  const callbackPath = `chatgpt/callback?error=access_denied&state=${encodeURIComponent(url.searchParams.get("state"))}`;
  const cancelled = await call(callbackPath, undefined, cookie);
  assert.equal(cancelled.status, 303);
  assert.equal(
    cancelled.headers.get("location"),
    `${origin}/#chatgpt=error&reason=chatgpt_login_cancelled`,
  );
  assert.equal(cancelled.headers.get("referrer-policy"), "no-referrer");
  assert.ok(cancelled.headers.getSetCookie()[0].includes("Max-Age=0"));
  checks.push("cancelled consent returns safely and clears attempt cookie");

  const replay = await call(callbackPath, undefined, cookie);
  assert.ok(
    replay.headers.get("location").includes("reason=chatgpt_login_expired"),
  );
  checks.push(
    "callback replay rejected across recreated route service instances",
  );

  const missing = await call(callbackPath);
  assert.ok(
    missing.headers.get("location").includes("reason=chatgpt_state_invalid"),
  );
  checks.push("callback without browser attempt rejected");

  const cross = await call("chatgpt/start", {}, "", {
    Origin: "https://untrusted.invalid",
  });
  assert.equal(cross.status, 403);
  assert.equal(
    (
      await call("select", { provider: "chatgpt" }, "", {
        Origin: "https://untrusted.invalid",
      })
    ).status,
    403,
  );
  checks.push("cross-origin login and provider selection rejected");

  const food = await call(
    "nutrition",
    { food: "2 eggs", coverage: "partial" },
    "boji_ai_provider=chatgpt",
  );
  assert.equal(food.status, 401);
  checks.push("unauthorized inference rejected without provider fallback");

  const final = await (await call("status")).json();
  assert.equal(final.connected, false);
  assert.equal(final.chatgpt.signedIn, false);
  assert.equal(final.provider, null);
  checks.push(
    "cancellation leaves application disconnected and records usable",
  );
  const report = {
    scope: "real local Next HTTP; no real OpenAI authorization or inference",
    passed: checks.length,
    checks,
  };
  await mkdir("artifacts/logs", { recursive: true });
  await writeFile(
    "artifacts/logs/v5-chatgpt-http-smoke.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (app.exitCode === null) {
    const stopped = new Promise((done) => app.once("exit", done));
    app.kill();
    await stopped;
  }
  const target = resolve(directory);
  if (!target.startsWith(`${resolve(tmpdir())}${sep}boji-chatgpt-http-`))
    throw new Error("Unsafe cleanup path");
  await rm(target, { recursive: true, force: true });
}
