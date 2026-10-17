import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type {
  AIStarterPlan,
  AINutritionResult,
  AIPlanningInput,
} from "../../src/lib/ai-types";
import type { DemoState } from "../../src/lib/demo-store";
import { planningInputKey } from "../../src/lib/plan-input";
import { calculateEnergyReference } from "../../src/lib/energy-plan";

// These routes simulate only our own server boundary. No provider is contacted.
const planFixture: AIStarterPlan = {
  basis: "model_guidance",
  createdAt: "2026-10-15T04:00:00.000Z",
  nutrition: {
    status: "general_guidance",
    summary: "模拟网络验收：根据填写的偏好整理一般饮食建议。",
    mealIdeas: [
      {
        meal: "breakfast",
        idea: "Oats, fruit and yoghurt",
        note: "模拟建议，需核对实际食材。",
      },
    ],
  },
  english: {
    basis: "written_sample",
    summary: "模拟网络验收：写作样本能描述日常生活，下一步练连接词。",
    strengths: ["能表达日常安排"],
    focusAreas: ["使用连接词组织段落"],
    tasks: [
      {
        component: "vocabulary",
        minutes: 4,
        instruction: "Review routine words.",
      },
      {
        component: "listening",
        minutes: 4,
        instruction: "Listen to a short routine.",
      },
      {
        component: "reading",
        minutes: 3,
        instruction: "Read a short passage.",
      },
      {
        component: "writing",
        minutes: 5,
        instruction: "Write about one habit.",
      },
      {
        component: "speaking",
        minutes: 5,
        instruction: "Describe your routine aloud.",
      },
    ],
  },
  limits: ["模拟网络数据，不是一次真实供应商评估。"],
};

function nutritionFixture(
  food: string,
  coverage: "partial" | "complete",
): AINutritionResult {
  const nutrients = {
    kcal: { min: 430, max: 510 },
    proteinG: { min: 10, max: 20 },
    carbsG: { min: 40, max: 60 },
    fatG: null,
  };
  return {
    originalFood: food,
    coverage,
    basis: "model_estimate",
    language: {
      status: "english",
      explanation: "模拟网络验收：原文可理解。",
      suggestedEnglish: null,
      corrections: [],
    },
    items: [
      {
        sourceText: food,
        name: "Mocked meal estimate",
        quantity: 100,
        unit: "g",
        quantityAssumed: false,
        assumption: null,
        preparation: "cooked",
        preparationAssumption: null,
        nutrition: nutrients,
      },
    ],
    unresolvedFoods: [],
    uncertainties: ["模拟模型数据：脂肪未知，不能当作 0。"],
    recordedTotals: nutrients,
    knownSubtotal: nutrients,
    dailyTotals: null,
    requiresReview: true,
    clarificationQuestions: [],
    clarificationAnswers: [],
    analysisState: "estimated",
    assessment: "not_evaluated",
    promptVersion: "nutrition-interpretation-v1",
  };
}

async function mockAI(page: Page) {
  const calls = {
    connected: false,
    failConnect: false,
    failPlan: false,
    failNutrition: false,
    connect: [] as unknown[],
    plans: [] as AIPlanningInput[],
    nutrition: [] as Array<{ food: string; coverage: "partial" | "complete" }>,
  };
  await page.route("**/api/self-hosted/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const status = () => ({
      mode: "self_hosted",
      configured: true,
      authenticated: calls.connected,
      connected: calls.connected,
    });
    if (path.endsWith("/status")) return route.fulfill({ json: status() });
    if (path.endsWith("/connect")) {
      calls.connect.push(route.request().postDataJSON());
      if (calls.failConnect)
        return route.fulfill({
          status: 503,
          json: { message: "模拟连接暂不可用，原输入保留。" },
        });
      calls.connected = true;
      return route.fulfill({ json: status() });
    }
    if (path.endsWith("/plan")) {
      const input = route.request().postDataJSON() as AIPlanningInput;
      calls.plans.push(input);
      return calls.failPlan
        ? route.fulfill({
            status: 503,
            json: { message: "模拟计划服务暂不可用。" },
          })
        : route.fulfill({
            json: {
              ...planFixture,
              inputKey: planningInputKey(input),
              nutrition: {
                ...planFixture.nutrition,
                energy: calculateEnergyReference(
                  input.profile,
                  input.preferences,
                ),
              },
            },
          });
    }
    if (path.endsWith("/nutrition")) {
      const input = route.request().postDataJSON();
      calls.nutrition.push(input);
      return calls.failNutrition
        ? route.fulfill({
            status: 503,
            json: { message: "模拟营养服务暂不可用，原文保留。" },
          })
        : route.fulfill({ json: nutritionFixture(input.food, input.coverage) });
    }
    return route.fulfill({
      status: 404,
      json: { message: "Unexpected mocked endpoint" },
    });
  });
  return calls;
}

const sample =
  "I usually study English after breakfast because a short routine fits my day. I want to explain my ideas clearly and learn useful words for daily conversations.";

async function fillConnectedWizard(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "使用 API Key", exact: true }).click();
  await page
    .getByLabel("服务访问口令", { exact: true })
    .fill("mock-access-password-2026");
  await page
    .getByRole("button", { name: "连接并测试 AI", exact: true })
    .click();
  await page.getByLabel("俱乐部昵称").fill("Mocked AI member");
  await page.getByLabel("年龄", { exact: true }).fill("26");
  await expect(page.getByLabel("体重 kg", { exact: true })).toBeVisible();
  await page.getByLabel("体重 kg", { exact: true }).fill("70");
  await page.getByLabel("身高 cm", { exact: true }).fill("175");
  await page
    .getByRole("checkbox", {
      name: "我愿意让 AI 结合我提供的资料给出一般饮食建议",
    })
    .check();
  await page.getByLabel("AI 计划活动参考").selectOption("moderate");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByLabel("给 AI 一段英文小样本", { exact: false }).fill(sample);
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: /薄肌会员/ }).click();
  await page.getByRole("button", { name: "继续", exact: true }).click();
}

async function persisted(page: Page): Promise<DemoState> {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("boji.club.demo.v1") ?? "null"),
  );
}

async function capturePage(page: Page, filename: string) {
  await expect(page.locator(".toast")).toBeHidden({ timeout: 8000 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: `artifacts/screenshots/${filename}`,
    fullPage: true,
    animations: "disabled",
  });
}

test.beforeAll(async () => {
  await mkdir("artifacts/screenshots", { recursive: true });
});

test("mocked AI configuration is not a connection and failed test keeps the access input", async ({
  page,
}) => {
  const calls = await mockAI(page);
  calls.failConnect = true;
  await page.goto("/");
  await page.getByRole("button", { name: "使用 API Key", exact: true }).click();
  await expect(
    page.getByText("配置已就绪 · 还需要连接测试", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("AI 已连接 · 队友就位 ✨", { exact: true }),
  ).toHaveCount(0);
  expect(calls.connect).toHaveLength(0);
  expect(calls.plans).toHaveLength(0);
  await expect(
    page.getByLabel("服务访问口令", { exact: true }),
  ).toHaveAttribute("type", "password");
  await page
    .getByLabel("服务访问口令", { exact: true })
    .fill("mock-access-password-2026");
  await page
    .getByRole("button", { name: "连接并测试 AI", exact: true })
    .click();
  await expect(page.locator(".error-box[role='alert']")).toContainText(
    "模拟连接暂不可用",
  );
  await expect(page.getByLabel("服务访问口令", { exact: true })).toHaveValue(
    "mock-access-password-2026",
  );
  expect(calls.connect).toEqual([{ password: "mock-access-password-2026" }]);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
  ).not.toContain("mock-access-password-2026");
});

test("mocked AI onboarding waits for consent, displays returned plans and nutrition, and preserves drafts on failure", async ({
  page,
}) => {
  const calls = await mockAI(page);
  await fillConnectedWizard(page);
  expect(calls.plans).toHaveLength(0);
  await page
    .getByRole("button", { name: "生成 AI 计划并加入", exact: true })
    .click();
  await expect(page.locator(".error-box[role='alert']")).toContainText(
    "先确认下面的资料发送说明",
  );
  expect(calls.plans).toHaveLength(0);
  await page.getByRole("checkbox", { name: /^我同意将填写的资料/ }).check();
  await page
    .getByRole("button", { name: "生成 AI 计划并加入", exact: true })
    .click();
  const plan = page.getByRole("region", { name: "AI 计划建议", exact: true });
  await expect(plan).toContainText(planFixture.english.summary);
  expect(calls.plans).toHaveLength(1);
  expect(calls.plans[0]).toMatchObject({
    profile: {
      heightCm: 175,
      weightKg: 70,
      bodyFatPercent: null,
      healthConsent: true,
    },
    englishSample: sample,
  });
  await expect(
    plan.getByText("依据本次英文写作样本", { exact: true }),
  ).toBeVisible();
  expect((await persisted(page)).xp).toBe(0);

  calls.failPlan = true;
  const updated = `${sample} My next draft will include clear examples.`;
  await page
    .getByRole("textbox", { name: "给 AI 的英文写作样本", exact: true })
    .fill(updated);
  const updateButton = page.getByRole("button", {
    name: "生成 / 更新 AI 计划",
    exact: true,
  });
  await expect(updateButton).toBeDisabled();
  expect(calls.plans).toHaveLength(1);
  await page.getByRole("checkbox", { name: /^同意将上述资料/ }).check();
  await updateButton.click();
  await expect(page.locator(".error-box[role='alert']")).toContainText(
    "模拟计划服务暂不可用",
  );
  await expect(plan).toContainText(planFixture.english.summary);
  await expect(
    page.getByRole("textbox", { name: "给 AI 的英文写作样本", exact: true }),
  ).toHaveValue(updated);
  await capturePage(page, "v3-mocked-ai-plan.png");

  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "薄肌", exact: true })
    .click();
  const breakfast = page.getByRole("textbox", {
    name: "Breakfast",
    exact: true,
  });
  await breakfast.fill("100 g cooked rice");
  expect(calls.nutrition).toHaveLength(0);
  await page
    .getByRole("button", { name: "AI 解读这份记录", exact: true })
    .click();
  await expect(page.getByTestId("nutrition-kcal")).toHaveText("约 430–510");
  await expect(page.getByTestId("nutrition-fatG")).toHaveText("未估算");
  expect(calls.nutrition).toEqual([
    {
      food: "100 g cooked rice",
      coverage: "partial",
      clarificationAnswers: [],
    },
  ]);
  expect((await persisted(page)).current.fitness.aiAnalysis?.basis).toBe(
    "model_estimate",
  );
  await expect(breakfast).toHaveValue("100 g cooked rice");
  await capturePage(page, "v3-mocked-ai-nutrition.png");

  calls.failNutrition = true;
  await breakfast.fill("200 g cooked rice");
  await expect(page.getByTestId("nutrition-kcal")).toHaveText("待分析");
  await page
    .getByRole("button", { name: "AI 解读这份记录", exact: true })
    .click();
  await expect(
    page.getByText("模拟营养服务暂不可用，原文保留。", { exact: true }),
  ).toBeVisible();
  await expect(breakfast).toHaveValue("200 g cooked rice");
  expect((await persisted(page)).current.fitness.breakfast).toBe(
    "200 g cooked rice",
  );
  expect((await persisted(page)).current.fitness.aiAnalysis).toBeUndefined();
  expect((await persisted(page)).xp).toBe(0);
});

test("mocked first plan failure keeps onboarding drafts and offers a record-only continuation", async ({
  page,
}) => {
  const calls = await mockAI(page);
  calls.failPlan = true;
  await fillConnectedWizard(page);
  await page.getByRole("checkbox", { name: /^我同意将填写的资料/ }).check();
  await page
    .getByRole("button", { name: "生成 AI 计划并加入", exact: true })
    .click();
  await expect(page.locator(".error-box[role='alert']")).toContainText(
    "模拟计划服务暂不可用",
  );
  await expect(
    page.getByRole("button", { name: "重试生成 AI 计划", exact: true }),
  ).toBeVisible();
  expect(await persisted(page)).toBeNull();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("boji.onboarding.ai-draft") ?? "{}")
          .englishSample,
    ),
  ).toBe(sample);
  await page
    .getByRole("button", { name: "保留资料，进入记录模式", exact: true })
    .click();
  await expect
    .poll(async () => (await persisted(page))?.profile.nickname)
    .toBe("Mocked AI member");
  expect((await persisted(page)).aiSetup?.mode).toBe("demo");
  expect(calls.plans).toHaveLength(1);
});

test("actual measurements compare same-method records, preserve unknowns, survive reload and fit mobile", async ({
  page,
}) => {
  const calls = await mockAI(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "先用虚构资料体验", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "成长与设置" })
    .getByRole("button", { name: "我的计划", exact: true })
    .click();
  const measurements = page.locator(".body-measurements");
  await measurements
    .getByRole("button", { name: "保存测量记录", exact: true })
    .click();
  await expect(measurements.getByRole("alert")).toContainText(
    "至少填写一项实际测量值",
  );
  async function add(
    date: string,
    weight: string,
    fat: string,
    waist: string,
    method: string,
  ) {
    await measurements.getByLabel("测量日期", { exact: true }).fill(date);
    await measurements
      .getByLabel("体重（kg，选填）", { exact: true })
      .fill(weight);
    await measurements.getByLabel("体脂（%，选填）", { exact: true }).fill(fat);
    await measurements
      .getByLabel("腰围（cm，选填）", { exact: true })
      .fill(waist);
    await measurements
      .getByLabel("体脂测量方法与设备（有体脂时必填）", { exact: true })
      .fill(method);
    await measurements
      .getByRole("button", { name: "保存测量记录", exact: true })
      .click();
  }
  await add("2026-10-01", "72", "23.1", "85", "Scale A");
  await add("2026-10-10", "71.2", "22.7", "84.5", "Scale A");
  await expect(measurements.locator(".measurement-changes")).toContainText(
    "-0.4 个百分点",
  );
  await expect(measurements.locator(".measurement-changes")).toContainText(
    "-0.8 kg",
  );
  await add("2026-10-11", "", "22", "", "Scale B");
  await expect(measurements.locator(".measurement-changes")).toContainText(
    "测量方法不同或缺失，不能直接比较",
  );
  expect((await persisted(page)).measurements?.[0]).toMatchObject({
    weightKg: null,
    waistCm: null,
  });
  await measurements
    .getByRole("button", { name: "删除 2026-10-11 的测量记录", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("navigation", { name: "成长与设置" })
    .getByRole("button", { name: "我的计划", exact: true })
    .click();
  await expect(measurements.locator(".measurement-changes")).toContainText(
    "-0.4 个百分点",
  );
  expect((await persisted(page)).measurements).toHaveLength(2);
  expect((await persisted(page)).xp).toBe(0);
  await measurements.screenshot({
    path: "artifacts/screenshots/v3-measurements-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await measurements
      .locator("input")
      .evaluateAll((inputs) =>
        inputs.every(
          (input) => parseFloat(getComputedStyle(input).fontSize) >= 16,
        ),
      ),
  ).toBe(true);
  await measurements.evaluate((section) =>
    section.scrollIntoView({ block: "start" }),
  );
  await page.screenshot({
    path: "artifacts/screenshots/v3-measurements-mobile.png",
  });
  await measurements
    .locator("form")
    .evaluate((form) => form.scrollIntoView({ block: "start" }));
  await page.screenshot({
    path: "artifacts/screenshots/v3-measurements-mobile-form.png",
  });
  expect(calls.plans).toHaveLength(0);
  expect(calls.nutrition).toHaveLength(0);
});

test("delayed mocked AI responses cannot overwrite newer food and English drafts from another tab", async ({
  page,
  context,
}) => {
  await mockAI(page);
  await fillConnectedWizard(page);
  await page.getByRole("checkbox", { name: /^我同意将填写的资料/ }).check();
  await page
    .getByRole("button", { name: "生成 AI 计划并加入", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "AI 计划建议", exact: true }),
  ).toContainText(planFixture.english.summary);

  // Both tabs use the real app and native shared localStorage/storage events.
  // Only the server response is delayed; no saved completion state is injected.
  const other = await context.newPage();
  const otherCalls = await mockAI(other);
  otherCalls.connected = true;
  await other.goto("/");
  for (const tab of [page, other]) {
    await tab
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name: "薄肌", exact: true })
      .click();
  }
  const breakfast = (tab: Page) =>
    tab.getByRole("textbox", { name: "Breakfast", exact: true });
  await breakfast(page).fill("100 g cooked rice");
  await expect(breakfast(other)).toHaveValue("100 g cooked rice");

  let releaseNutrition!: () => void;
  let nutritionInput: {
    food: string;
    coverage: "partial" | "complete";
  } | null = null;
  const nutritionGate = new Promise<void>((resolve) => {
    releaseNutrition = resolve;
  });
  await page.route("**/api/self-hosted/nutrition", async (route) => {
    nutritionInput = route.request().postDataJSON();
    await nutritionGate;
    await route.fulfill({
      json: nutritionFixture(nutritionInput!.food, nutritionInput!.coverage),
    });
  });
  try {
    await page
      .getByRole("button", { name: "AI 解读这份记录", exact: true })
      .click();
    await expect
      .poll(() => nutritionInput)
      .toEqual({
        food: "100 g cooked rice",
        coverage: "partial",
        clarificationAnswers: [],
      });
    await expect(
      page.getByRole("button", { name: "AI 正在解读…", exact: true }),
    ).toBeDisabled();
    await breakfast(other).fill("200 g cooked rice");
    await expect(breakfast(page)).toHaveValue("200 g cooked rice");
    const oldResponse = page.waitForResponse("**/api/self-hosted/nutrition");
    releaseNutrition();
    await (await oldResponse).finished();
    await expect(
      page.getByRole("button", { name: "AI 解读这份记录", exact: true }),
    ).toBeEnabled();
    for (const tab of [page, other]) {
      await expect(breakfast(tab)).toHaveValue("200 g cooked rice");
      await expect(tab.getByTestId("nutrition-kcal")).toHaveText("待分析");
      const saved = (await persisted(tab)).current.fitness;
      expect(saved.breakfast).toBe("200 g cooked rice");
      expect(saved.aiAnalysis).toBeUndefined();
      expect(saved.analyzed).toBe(false);
    }
  } finally {
    releaseNutrition();
  }

  for (const tab of [page, other]) {
    await tab
      .getByRole("navigation", { name: "成长与设置" })
      .getByRole("button", { name: "我的计划", exact: true })
      .click();
  }
  let releasePlan!: () => void;
  let planRequested = false;
  const planGate = new Promise<void>((resolve) => {
    releasePlan = resolve;
  });
  const stalePlan = {
    ...planFixture,
    createdAt: "2026-10-15T05:00:00.000Z",
    english: {
      ...planFixture.english,
      summary: "DELAYED STALE PLAN MUST NOT REPLACE THE SAVED PLAN",
    },
  };
  await page.route("**/api/self-hosted/plan", async (route) => {
    planRequested = true;
    await planGate;
    await route.fulfill({ json: stalePlan });
  });
  const updatedSample = `${sample} This newer sample was edited in my second tab.`;
  const writing = (tab: Page) =>
    tab.getByRole("textbox", { name: "给 AI 的英文写作样本", exact: true });
  try {
    await page.getByRole("checkbox", { name: /^同意将上述资料/ }).check();
    await page
      .getByRole("button", { name: "生成 / 更新 AI 计划", exact: true })
      .click();
    await expect.poll(() => planRequested).toBe(true);
    await writing(other).fill(updatedSample);
    await expect(writing(page)).toHaveValue(updatedSample);
    const oldResponse = page.waitForResponse("**/api/self-hosted/plan");
    releasePlan();
    await (await oldResponse).finished();
    await expect(
      page.getByRole("button", { name: "生成 / 更新 AI 计划", exact: true }),
    ).toBeEnabled();
    for (const tab of [page, other]) {
      await expect(writing(tab)).toHaveValue(updatedSample);
      await expect(
        tab.getByRole("region", { name: "AI 计划建议", exact: true }),
      ).toContainText(planFixture.english.summary);
      await expect(
        tab.getByText(stalePlan.english.summary, { exact: true }),
      ).toHaveCount(0);
      expect((await persisted(tab)).aiSetup?.englishSample).toBe(updatedSample);
      expect((await persisted(tab)).aiSetup?.plan?.createdAt).toBe(
        planFixture.createdAt,
      );
    }
  } finally {
    releasePlan();
    await other.close();
  }
});
