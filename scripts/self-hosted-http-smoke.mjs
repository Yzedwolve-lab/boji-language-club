// Real Next.js HTTP routes against a local fake provider. Never uses real keys.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const origin = "http://127.0.0.1:3112";
const fakeOrigin = "http://127.0.0.1:3113";
const password = "local-http-smoke-access-only";
const privateDir = await mkdtemp(join(tmpdir(), "boji-http-smoke-"));
const sample =
  "I study English every morning because I want to explain my ideas clearly. I enjoy cooking simple meals and sharing stories with my friends after work.";
const food = "one bowl of mapo tofu";
let providerCalls = 0;
const fakeProvider = createServer(async (request, response) => {
  let text = "";
  for await (const chunk of request) text += chunk;
  const body = JSON.parse(text);
  const user = JSON.parse(body.messages[1].content);
  providerCalls++;
  let content;
  if (user.action === "connection_test") content = { connected: true };
  else if (user.originalFood)
    content = {
      language: {
        status: "english",
        explanation: "This names a food and a portion.",
        suggestedEnglish: null,
        corrections: [],
      },
      items: [
        {
          sourceText: food,
          name: "mapo tofu",
          quantity: 250,
          unit: "g",
          quantityAssumed: true,
          assumption: "A bowl is assumed to contain 250 g; verify the portion.",
          preparation: "cooked",
          nutrition: {
            kcal: { min: 300, max: 420 },
            proteinG: { min: 15, max: 22 },
            carbsG: { min: 12, max: 20 },
            fatG: { min: 18, max: 28 },
          },
        },
      ],
      unresolvedFoods: [],
      uncertainties: ["Oil and serving size are not measured."],
    };
  else
    content = {
      nutrition: {
        summary: "一般均衡饮食参考，份量需要自己核对。",
        mealIdeas: [
          {
            meal: "breakfast",
            idea: "按饮食偏好搭配主食、蛋白质与水果。",
            note: "请核对食材和过敏原。",
          },
        ],
      },
      english: {
        summary: "The supplied writing describes a routine with clear reasons.",
        strengths: [
          {
            observation: "A reason is linked to an action.",
            evidence: "because I want to explain my ideas clearly",
          },
        ],
        focusAreas: [],
        tasks: [
          "vocabulary",
          "listening",
          "reading",
          "writing",
          "speaking",
        ].map((component) => ({
          component,
          instruction:
            "Practise describing a familiar daily routine within the allotted time.",
        })),
      },
    };
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify(content) },
        },
      ],
    }),
  );
});
await new Promise((ready, reject) => {
  fakeProvider.once("error", reject);
  fakeProvider.listen(3113, "127.0.0.1", ready);
});
const app = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3112",
  ],
  {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      APP_MODE: "self_hosted",
      ENABLE_OPENAI_COMPATIBLE: "true",
      OPENAI_COMPAT_BASE_URL: `${fakeOrigin}/v1`,
      OPENAI_COMPAT_API_KEY: "",
      OPENAI_COMPAT_MODEL: "local-test-fixture",
      OPENAI_COMPAT_ALLOW_LOCAL: "true",
      BOJI_SELF_HOSTED_PASSWORD: password,
      BOJI_SELF_HOSTED_ORIGIN: origin,
      BOJI_PRIVATE_DIR: privateDir,
      BOJI_DAILY_AI_CALL_LIMIT: "10",
    },
  },
);
let startupOutput = "";
app.stdout.on("data", (chunk) => {
  startupOutput = (startupOutput + chunk).slice(-4000);
});
app.stderr.on("data", (chunk) => {
  startupOutput = (startupOutput + chunk).slice(-4000);
});
const checks = [];
async function post(path, body, cookie = "", requestOrigin = origin) {
  return fetch(`${origin}/api/self-hosted/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
}
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (app.exitCode !== null)
      throw new Error(`Test app exited before readiness: ${startupOutput}`);
    try {
      ready = (await fetch(`${origin}/api/self-hosted/status`)).ok;
    } catch {
      /* wait for owned server */
    }
    if (ready) break;
    await new Promise((done) => setTimeout(done, 200));
  }
  assert.ok(ready, "Test app did not become ready");
  const status = await (await fetch(`${origin}/api/self-hosted/status`)).json();
  assert.deepEqual(status, {
    mode: "self_hosted",
    configured: true,
    authenticated: false,
    connected: false,
    provider: null,
    apiKey: { configured: true, connected: false },
    chatgpt: {
      available: true,
      signedIn: false,
      sharing: false,
      connected: false,
    },
    setup: { available: false, configuredVia: "environment" },
  });
  checks.push("configured is not connected");
  assert.equal(
    (await post("nutrition", { food, coverage: "partial" })).status,
    401,
  );
  assert.equal(
    (await post("connect", { password }, "", "http://untrusted.example"))
      .status,
    403,
  );
  assert.equal(providerCalls, 0);
  checks.push("unauthenticated and wrong-origin calls never reach provider");
  const connection = await post("connect", { password });
  assert.equal(connection.status, 200);
  assert.equal((await connection.json()).connected, true);
  const setCookie = connection.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(";")[0];
  checks.push("real HTTP connection handshake sets protected session");
  const nutritionResponse = await post(
    "nutrition",
    { food, coverage: "partial" },
    cookie,
  );
  assert.equal(nutritionResponse.status, 200);
  const nutrition = await nutritionResponse.json();
  assert.equal(nutrition.originalFood, food);
  assert.deepEqual(nutrition.knownSubtotal.kcal, { min: 300, max: 420 });
  assert.equal(nutrition.dailyTotals, null);
  assert.equal(nutrition.requiresReview, true);
  checks.push(
    "nutrition route returns local model ranges, preserves raw food and partial coverage",
  );
  const profile = {
    nickname: "HTTP QA",
    gender: "unspecified",
    age: 25,
    weightKg: 65,
    heightCm: 170,
    bodyFatPercent: null,
    activityLevel: "",
    timeBudget: 30,
    timeZone: "Australia/Brisbane",
    examType: "none",
    examScore: null,
    examDate: "",
    comparableToeflScore: null,
    cetStatus: "not_provided",
    goal: "member",
    healthConsent: true,
  };
  const planResponse = await post(
    "plan",
    {
      profile,
      preferences: {
        activityLevel: "moderate",
        dietaryPreferences: "home cooking",
        allergies: "none reported",
      },
      englishSample: sample,
    },
    cookie,
  );
  assert.equal(planResponse.status, 200);
  const plan = await planResponse.json();
  assert.equal(plan.english.basis, "written_sample");
  assert.equal(plan.nutrition.status, "general_guidance");
  assert.equal(plan.english.tasks.length, 5);
  checks.push(
    "plan route returns sample-based guidance with five fixed-budget tasks",
  );
  assert.equal((await post("disconnect", {}, cookie)).status, 200);
  assert.equal(
    (await post("nutrition", { food, coverage: "partial" }, cookie)).status,
    401,
  );
  assert.equal(providerCalls, 3);
  checks.push("disconnected session cannot replay billable calls");
  const report = {
    passed: checks.length,
    provider: "local fake provider only; no external AI calls",
    checks,
  };
  await mkdir("artifacts/logs", { recursive: true });
  await writeFile(
    "artifacts/logs/v3-self-hosted-http-smoke.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  app.kill();
  await new Promise((done) => {
    if (app.exitCode !== null) return done();
    app.once("exit", done);
  });
  await new Promise((done) => fakeProvider.close(done));
  const resolved = resolve(privateDir);
  assert.ok(
    resolved.startsWith(resolve(tmpdir()) + sep) &&
      resolved.split(sep).at(-1).startsWith("boji-http-smoke-"),
  );
  await rm(resolved, { recursive: true, force: true });
}
