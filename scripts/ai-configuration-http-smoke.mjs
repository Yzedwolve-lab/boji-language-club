// Exercises saved page configuration through real Next HTTP, with a local fake model only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { prepareLaunch } from "./prepare-launch.mjs";

const origin = "http://127.0.0.1:3114";
const baseUrl = "http://127.0.0.1:3115/v1";
let privateDir = await mkdtemp(join(tmpdir(), "boji-config-http-"));
const privateDirectories = [privateDir];
const password = "local-configuration-test-passphrase";
const fakeKey = "local-fixture-key-never-real";
let calls = 0;
let lastAuthorization = "";
const unavailableModels = new Set(["fixture-failure"]);
const fakeProvider = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const input = JSON.parse(body);
  calls++;
  lastAuthorization = request.headers.authorization ?? "";
  if (unavailableModels.has(input.model)) {
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        message: `Provider debug must never escape: ${fakeKey}`,
      }),
    );
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      choices: [
        { finish_reason: "stop", message: { content: '{"connected":true}' } },
      ],
    }),
  );
});
await new Promise((done, reject) => {
  fakeProvider.once("error", reject);
  fakeProvider.listen(3115, "127.0.0.1", done);
});
let app;
async function stopApp() {
  if (!app || app.exitCode !== null) return;
  const exited = new Promise((done) => app.once("exit", done));
  app.kill();
  await exited;
}
async function startApp() {
  app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3114",
    ],
    {
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        APP_MODE: "demo",
        ENABLE_OPENAI_COMPATIBLE: "false",
        OPENAI_COMPAT_API_KEY: "",
        BOJI_SELF_HOSTED_PASSWORD: "",
        BOJI_PRIVATE_DIR: privateDir,
      },
    },
  );
  for (let attempt = 0; attempt < 60; attempt++) {
    if (app.exitCode !== null)
      throw new Error("Owned test server exited early.");
    try {
      if ((await fetch(`${origin}/api/self-hosted/status`)).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error("Owned test server did not become ready.");
}
async function get(path, cookie = "") {
  return fetch(`${origin}/api/self-hosted/${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    signal: AbortSignal.timeout(15000),
  });
}
async function configure(body, cookie = "", from = origin) {
  return fetch(`${origin}/api/self-hosted/configure`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: from,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
}
function cookieFrom(response) {
  const header = response.headers.get("set-cookie");
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  return header.split(";")[0];
}
const checks = [];
try {
  const launch = await prepareLaunch({
    root: process.cwd(),
    env: { BOJI_PRIVATE_DIR: privateDir },
    origin,
  });
  const setupToken = new URLSearchParams(new URL(launch.url).hash.slice(1)).get(
    "setup",
  );
  await startApp();
  const status = await (await get("status")).json();
  assert.equal(status.configured, false);
  assert.deepEqual(status.setup, { available: true, configuredVia: "none" });
  const candidate = {
    setupToken,
    baseUrl,
    apiKey: fakeKey,
    model: "fixture-first",
    password,
    dailyLimit: 10,
    tokenParameter: "max_tokens",
    allowLocal: true,
  };
  assert.ok(!(await configure({ ...candidate, setupToken: "wrong-token" })).ok);
  assert.equal(
    (await configure(candidate, "", "https://other.example")).status,
    403,
  );
  assert.equal(calls, 0);
  checks.push(
    "first configuration requires bootstrap authority and same origin before any model request",
  );
  const saved = await configure(candidate);
  assert.equal(saved.status, 200);
  const result = await saved.text();
  assert.equal(JSON.parse(result).connected, true);
  for (const secret of [fakeKey, password, setupToken])
    assert.equal(result.includes(secret), false);
  let cookie = cookieFrom(saved);
  assert.equal(lastAuthorization, `Bearer ${fakeKey}`);
  const file = join(privateDir, "ai-config.json");
  const original = await readFile(file, "utf8");
  assert.equal(original.includes(password), false);
  checks.push(
    "page configuration tests the model, saves only on success, hashes access password and returns no secrets",
  );
  assert.equal((await get("configuration")).status, 401);
  const metadataText = await (await get("configuration", cookie)).text();
  const metadata = JSON.parse(metadataText);
  assert.equal(metadata.hasApiKey, true);
  assert.equal(metadata.baseUrl, baseUrl);
  assert.equal(metadataText.includes(fakeKey), false);
  assert.equal(metadataText.includes(password), false);
  assert.ok(!(await configure(candidate)).ok);
  assert.equal(calls, 1);
  checks.push(
    "configuration reads require authentication and never reveal the key; bootstrap cannot replace saved settings",
  );
  await stopApp();
  await startApp();
  const restarted = await (await get("status", cookie)).json();
  assert.equal(restarted.connected, true);
  assert.equal(restarted.setup.configuredVia, "file");
  checks.push(
    "saved web configuration and authenticated session survive a real server restart without environment keys",
  );
  const update = {
    baseUrl,
    model: "fixture-failure",
    currentPassword: password,
    dailyLimit: 10,
    tokenParameter: "max_tokens",
    allowLocal: true,
  };
  const failed = await configure(update, cookie);
  assert.equal(failed.status, 503);
  const failureText = await failed.text();
  assert.equal(failureText.includes(fakeKey), false);
  assert.equal(await readFile(file, "utf8"), original);
  assert.ok(
    !(
      await configure(
        {
          ...update,
          model: "fixture-next",
          baseUrl: "http://127.0.0.1:3115/v2",
        },
        cookie,
      )
    ).ok,
  );
  assert.equal(calls, 2);
  checks.push(
    "failed test preserves prior settings; endpoint changes without a fresh key cannot call the model",
  );
  const changed = await configure({ ...update, model: "fixture-next" }, cookie);
  assert.equal(changed.status, 200);
  const oldCookie = cookie;
  cookie = cookieFrom(changed);
  assert.equal((await (await get("status", cookie)).json()).connected, true);
  assert.equal(
    (await (await get("status", oldCookie)).json()).connected,
    false,
  );
  assert.equal(
    (await (await get("configuration", cookie)).json()).model,
    "fixture-next",
  );
  assert.equal(lastAuthorization, `Bearer ${fakeKey}`);
  assert.equal(calls, 3);
  checks.push(
    "authenticated same-endpoint update retains hidden key, activates immediately and replaces the old session",
  );
  // A separate owner fixture keeps recovery below the real attempt limit without
  // modifying the ledger, clock, authentication state or rate-limit implementation.
  await stopApp();
  privateDir = await mkdtemp(join(tmpdir(), "boji-config-http-"));
  privateDirectories.push(privateDir);
  const recoveryLaunch = await prepareLaunch({
    root: process.cwd(),
    env: { BOJI_PRIVATE_DIR: privateDir },
    origin,
  });
  await startApp();
  const recoverySetup = await configure({
    ...candidate,
    setupToken: new URLSearchParams(
      new URL(recoveryLaunch.url).hash.slice(1),
    ).get("setup"),
  });
  assert.equal(recoverySetup.status, 200);
  // Deliberately discard the valid cookie, as with a new browser or expired login.
  unavailableModels.add("fixture-first");
  const recoveryPost = (path, body) =>
    fetch(`${origin}/api/self-hosted/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  assert.equal((await recoveryPost("connect", { password })).status, 503);
  const callsBeforeRecovery = calls;
  assert.equal(
    (await recoveryPost("configuration", { password: "wrong-password" }))
      .status,
    401,
  );
  const unlocked = await recoveryPost("configuration", { password });
  assert.equal(unlocked.status, 200);
  assert.equal(unlocked.headers.get("set-cookie"), null);
  const unlockedText = await unlocked.text();
  assert.equal(JSON.parse(unlockedText).model, "fixture-first");
  assert.equal(unlockedText.includes(fakeKey), false);
  assert.equal(calls, callsBeforeRecovery);
  assert.equal((await (await get("status")).json()).connected, false);
  checks.push(
    "correct access password can unlock safe settings with an unavailable old provider and no session; this never calls AI or claims a connection",
  );
  const recovered = await configure({
    ...update,
    model: "fixture-recovered",
    apiKey: "replacement-fixture-key-never-real",
  });
  assert.equal(recovered.status, 200);
  assert.equal(
    (await (await get("status", cookieFrom(recovered))).json()).connected,
    true,
  );
  assert.equal(calls, callsBeforeRecovery + 1);
  assert.equal(lastAuthorization, "Bearer replacement-fixture-key-never-real");
  checks.push(
    "password-authorized replacement repairs a failed old key without its cookie; only the successful new provider test issues a connected session",
  );
  const report = {
    passed: checks.length,
    provider: "local fake provider only; no external AI calls",
    checks,
  };
  await mkdir("artifacts/logs", { recursive: true });
  await writeFile(
    "artifacts/logs/v4-configuration-http-smoke.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await stopApp();
  await new Promise((done) => fakeProvider.close(done));
  for (const directory of privateDirectories) {
    const target = resolve(directory);
    assert.ok(
      target.startsWith(resolve(tmpdir()) + sep) &&
        target.split(sep).at(-1).startsWith("boji-config-http-"),
    );
    await rm(target, { recursive: true, force: true });
  }
}
