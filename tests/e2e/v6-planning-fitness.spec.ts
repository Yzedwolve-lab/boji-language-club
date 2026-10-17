import { expect, test, type Page } from "@playwright/test";
import { access, mkdir } from "node:fs/promises";
import {
  defaultProfile,
  newDemo,
  STORAGE_KEY,
  type DemoState,
} from "../../src/lib/demo-store";
import { calculateEnergyReference } from "../../src/lib/energy-plan";
import { planningInputKey } from "../../src/lib/plan-input";
import type {
  AIPlanningInput,
  AIStarterPlan,
  AINutritionResult,
} from "../../src/lib/ai-types";
import { TASKS } from "../../src/lib/lessons";

const englishSample =
  "I study English every morning and practise useful phrases for cooking because a regular routine helps me remember new words.";
const preferences: AIPlanningInput["preferences"] = {
  activityLevel: "light",
  dietaryPreferences: "",
  allergies: "",
  energyGoal: "gentle_loss",
  calculationSex: "male",
  nutritionEligibility: "standard_adult",
};
test.beforeAll(async () => {
  await mkdir("artifacts/screenshots", { recursive: true });
});
function starter(
  profile = defaultProfile(),
  prefs = preferences,
  sample = englishSample,
): AIStarterPlan {
  const energy = calculateEnergyReference(profile, prefs);
  return {
    basis: "model_guidance",
    createdAt: new Date().toISOString(),
    forDate: newDemo(profile).current.date,
    inputKey: planningInputKey({
      profile,
      preferences: prefs,
      englishSample: sample,
    }),
    nutrition: {
      status: "general_guidance",
      summary: "模拟：按你的资料规划每日饮食。",
      energy,
      mealIdeas: (["breakfast", "lunch", "dinner"] as const).map(
        (meal, index) => ({
          meal,
          idea: [
            "60 g oats, 200 g yoghurt and one banana",
            "150 g cooked chicken, 200 g cooked rice and 200 g vegetables",
            "200 g tofu, 250 g potato and 200 g vegetables",
          ][index],
          note: "模拟搭配；预算不是菜谱实测热量。",
          budgetKcal: energy.mealBudgets.find((budget) => budget.meal === meal)
            ?.kcal,
        }),
      ),
    },
    english: {
      basis: "written_sample",
      summary: "模拟个人英语计划。",
      strengths: [],
      focusAreas: [],
      tasks: TASKS.map((component, index) => ({
        component,
        minutes: index === 0 ? 7 : 2,
        instruction: `Personal task: practise ${component} with daily food examples.`,
      })),
    },
    limits: ["模拟数据，仅用于浏览器验收。"],
  };
}
function seed(withPlan = true) {
  const profile = {
    ...defaultProfile(),
    nickname: "Synthetic V6 member",
    age: 30,
    heightCm: 180,
    weightKg: 80,
    healthConsent: true,
  };
  const state = newDemo(profile);
  state.aiSetup = {
    mode: "self_hosted",
    preferences: { ...preferences },
    englishSample,
    ...(withPlan ? { plan: starter(profile) } : {}),
  };
  return state;
}
type NutritionInput = {
  food: string;
  coverage: "partial" | "complete";
  clarificationAnswers: Array<{
    sourceText: string;
    question: string;
    answer: string;
  }>;
};
function nutrition(
  input: NutritionInput,
  kcal: { min: number; max: number },
  clarify = false,
): AINutritionResult {
  const nutrients = {
    kcal,
    proteinG: { min: 80, max: 100 },
    carbsG: { min: 200, max: 220 },
    fatG: { min: 60, max: 70 },
  };
  return {
    originalFood: input.food,
    coverage: input.coverage,
    basis: "model_estimate",
    language: {
      status: "english",
      explanation: "The food description is understandable.",
      suggestedEnglish: null,
      corrections: [],
    },
    items: [
      {
        sourceText: input.food,
        name: "Mock meal",
        quantity: 150,
        unit: "g",
        quantityAssumed: clarify,
        assumption: clarify ? "Portion still needs confirmation." : null,
        preparation: "cooked",
        preparationAssumption: null,
        nutrition: nutrients,
      },
    ],
    unresolvedFoods: [],
    uncertainties: [],
    recordedTotals: nutrients,
    knownSubtotal: nutrients,
    dailyTotals: clarify ? null : nutrients,
    requiresReview: true,
    assessment: "not_evaluated",
    promptVersion: "nutrition-interpretation-v2",
    clarificationAnswers: input.clarificationAnswers,
    clarificationQuestions: clarify
      ? [
          {
            sourceText: input.food,
            question: "How much cooked rice did you have?",
          },
        ]
      : [],
    analysisState: clarify ? "needs_clarification" : "estimated",
  };
}
async function setup(page: Page, initial: DemoState) {
  await page.addInitScript(
    ({ key, state }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(state));
    },
    { key: STORAGE_KEY, state: initial },
  );
  const control = {
    requests: [] as NutritionInput[],
    plans: [] as AIPlanningInput[],
    kcal: { min: 164, max: 176 },
    clarify: false,
    failNext: false,
  };
  await page.route("**/api/self-hosted/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/status"))
      return route.fulfill({
        json: {
          mode: "self_hosted",
          configured: true,
          authenticated: true,
          connected: true,
          provider: "api_key",
          apiKey: { configured: true, connected: true },
        },
      });
    if (path.endsWith("/nutrition")) {
      const input = route.request().postDataJSON() as NutritionInput;
      control.requests.push(input);
      if (control.failNext) {
        control.failNext = false;
        return route.fulfill({
          status: 503,
          json: { message: "模拟分析暂不可用，回答已保留。" },
        });
      }
      return route.fulfill({
        json: nutrition(
          input,
          control.kcal,
          control.clarify && !input.clarificationAnswers.length,
        ),
      });
    }
    if (path.endsWith("/plan")) {
      const input = route.request().postDataJSON() as AIPlanningInput;
      control.plans.push(input);
      return route.fulfill({
        json: starter(input.profile, input.preferences, input.englishSample),
      });
    }
    return route.fulfill({
      status: 503,
      json: { message: "Unexpected synthetic request" },
    });
  });
  await page.goto("/");
  return control;
}
async function fitness(page: Page) {
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "薄肌", exact: true })
    .click();
}
async function saved(page: Page): Promise<DemoState> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    STORAGE_KEY,
  );
}
async function preserveScreenshot(page: Page, path: string) {
  try {
    await access(path);
  } catch {
    await page.screenshot({ path, fullPage: true });
  }
}
async function reflect(page: Page) {
  await page
    .getByRole("checkbox", { name: "我已核对原文与假设，理解未知项未被估算" })
    .check();
  await page
    .getByRole("checkbox", {
      name: "我已读完反馈，知道任务依据真实记录与复盘完成",
    })
    .check();
  await page
    .getByLabel("One small step for tomorrow")
    .fill("I will record the portion clearly tomorrow.");
}

test("missing plan opens editable personal setup and actual English task minutes follow the generated plan", async ({
  page,
}) => {
  const state = seed(false);
  state.profile.heightCm = null;
  state.profile.weightKg = null;
  state.aiSetup!.preferences.calculationSex = "unspecified";
  state.aiSetup!.preferences.nutritionEligibility = "unspecified";
  const control = await setup(page, state);
  await fitness(page);
  await expect(page.getByTestId("fitness-daily-review")).toContainText(
    "先到“我的计划”",
  );
  await page
    .getByRole("button", { name: "填写资料并生成每日计划", exact: true })
    .click();
  await expect(page.getByLabel("饮食目标", { exact: true })).toHaveValue(
    "gentle_loss",
  );
  await page.getByLabel("计划参考身高（cm）", { exact: true }).fill("180");
  await page.getByLabel("计划参考体重（kg）", { exact: true }).fill("80");
  await page
    .getByLabel("能量公式计算参数", { exact: true })
    .selectOption("male");
  await page
    .getByLabel("饮食规划适用情况", { exact: true })
    .selectOption("standard_adult");
  await page.getByRole("checkbox", { name: /^同意将上述资料/ }).check();
  await page
    .getByRole("button", { name: "生成 / 更新 AI 计划", exact: true })
    .click();
  await expect(page.locator(".ai-energy-target")).toContainText("kcal");
  await preserveScreenshot(
    page,
    "artifacts/screenshots/v6-personal-plan-desktop.png",
  );
  expect(control.plans[0].profile).toMatchObject({
    heightCm: 180,
    weightKg: 80,
  });
  expect(control.plans[0].preferences).toMatchObject({
    energyGoal: "gentle_loss",
    calculationSex: "male",
    nutritionEligibility: "standard_adult",
  });
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "语言", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: /词汇/ })).toContainText("7 MIN");
  await expect(page.locator(".ai-daily-instruction")).toContainText(
    "Personal task: practise vocabulary",
  );
  await expect(page.locator(".ai-daily-instruction")).toContainText(
    "固定原创演示练习",
  );
  await page
    .getByRole("navigation", { name: "成长与设置" })
    .getByRole("button", { name: "我的计划", exact: true })
    .click();
  await page.getByLabel("计划参考体重（kg）", { exact: true }).fill("81");
  await expect(
    page.getByText(/^资料或规划条件已变化，请重新生成计划。/),
  ).toBeVisible();
  expect(control.plans).toHaveLength(1);
  await fitness(page);
  await expect(page.getByTestId("fitness-daily-review")).toHaveClass(
    /review-plan_required/,
  );
  await expect(page.getByTestId("fitness-daily-review")).toContainText(
    "尚无适用范围",
  );
  await expect(
    page.getByRole("button", { name: "填写资料并生成每日计划", exact: true }),
  ).toBeVisible();
  expect(control.requests).toEqual([]);
});

test("170 kcal declared as a full day is saved but cannot complete daily fitness", async ({
  page,
}) => {
  const control = await setup(page, seed());
  await fitness(page);
  await page
    .getByRole("textbox", { name: "Breakfast", exact: true })
    .fill("2 boiled eggs");
  await page
    .getByRole("checkbox", {
      name: "今天吃的都记完了（一餐也可以）",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "AI 解读这份记录", exact: true })
    .click();
  await expect(page.getByTestId("nutrition-kcal")).toHaveText("约 160–180");
  await expect(page.getByTestId("fitness-daily-review")).toContainText(
    "低于计划参考范围",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await preserveScreenshot(
    page,
    "artifacts/screenshots/v6-low-intake-mobile.png",
  );
  await reflect(page);
  const complete = page.getByRole("button", {
    name: "完成记录与复盘",
    exact: true,
  });
  await expect(complete).toBeEnabled();
  await complete.click();
  const guidance = page.getByTestId("fitness-completion-guidance");
  await expect(guidance).toHaveAttribute("role", "alert");
  await expect(guidance).toContainText("低于计划参考范围");
  await expect(guidance).toBeFocused();
  await expect(
    page.getByRole("button", { name: "查看食物记录", exact: true }),
  ).toBeVisible();
  await guidance.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/screenshots/v6.1-completion-feedback-mobile.png",
  });
  expect((await saved(page)).current.fitness).toMatchObject({
    breakfast: "2 boiled eggs",
    completed: false,
    coverage: true,
  });
  expect((await saved(page)).xp).toBe(0);
  expect(control.requests).toHaveLength(1);
});

test("changing allergies expires saved meals and English instructions without generating a new plan", async ({
  page,
}) => {
  const control = await setup(page, seed());
  await page
    .getByRole("navigation", { name: "成长与设置" })
    .getByRole("button", { name: "我的计划", exact: true })
    .click();
  await page
    .getByLabel("食物过敏 / 需要避开的食物", { exact: true })
    .fill("Peanut allergy");
  await expect(
    page.getByText(/^资料或规划条件已变化，请重新生成计划。/),
  ).toBeVisible();
  expect((await saved(page)).aiSetup?.preferences.allergies).toBe(
    "Peanut allergy",
  );
  await page
    .getByRole("navigation", { name: "主要导航" })
    .getByRole("button", { name: "语言", exact: true })
    .click();
  await expect(page.locator(".ai-daily-instruction")).toHaveCount(0);
  await expect(page.getByText(/Personal task:/)).toHaveCount(0);
  expect(control.plans).toEqual([]);
  expect(control.requests).toEqual([]);
});

test("AI reflection is writable before analysis and survives food edits, missing-plan guidance and an AI failure", async ({
  page,
}) => {
  const control = await setup(page, seed(false));
  await fitness(page);
  const reflection = page.getByLabel("One small step for tomorrow");
  const draft = "I will write the food details clearly tomorrow.";
  await expect(reflection).toBeVisible();
  await expect(reflection).toBeEnabled();
  await reflection.fill(draft);
  const complete = page.getByRole("button", {
    name: "完成记录与复盘",
    exact: true,
  });
  await expect(complete).toBeEnabled();
  await complete.click();
  const guidance = page.getByTestId("fitness-completion-guidance");
  await expect(guidance).toHaveAttribute("role", "alert");
  await expect(guidance).toContainText("计划");
  await expect(guidance).toBeFocused();
  await page
    .getByRole("button", { name: "去生成 / 更新计划", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "生成 / 更新 AI 计划", exact: true }),
  ).toBeVisible();
  expect(control.plans).toEqual([]);
  expect(control.requests).toEqual([]);

  await fitness(page);
  await expect(reflection).toHaveValue(draft);
  const lunch = page.getByRole("textbox", { name: "Lunch", exact: true });
  await lunch.fill("150 g cooked rice");
  await expect(reflection).toHaveValue(draft);
  await lunch.fill("200 g cooked rice");
  await expect(reflection).toBeVisible();
  await expect(reflection).toHaveValue(draft);
  control.failNext = true;
  await page
    .getByRole("button", { name: "AI 解读这份记录", exact: true })
    .click();
  await expect(page.locator(".error-box[role='alert']")).toContainText(
    "模拟分析暂不可用",
  );
  await expect(reflection).toBeVisible();
  await expect(reflection).toBeEnabled();
  await expect(reflection).toHaveValue(draft);
  await expect(complete).toBeEnabled();
  expect((await saved(page)).current.fitness).toMatchObject({
    lunch: "200 g cooked rice",
    reflection: draft,
    analyzed: false,
    completed: false,
  });
  await page.reload();
  await fitness(page);
  await expect(reflection).toHaveValue(draft);
  await expect(lunch).toHaveValue("200 g cooked rice");
  expect(control.requests).toHaveLength(1);
  expect(control.plans).toEqual([]);
  expect((await saved(page)).xp).toBe(0);
});

test("one Lunch entry can complete the day after explicit coverage confirmation and analysis", async ({
  page,
}) => {
  const state = seed();
  const control = await setup(page, state);
  const target = state.aiSetup!.plan!.nutrition.energy!.targetKcal!;
  control.kcal = {
    min: Math.ceil(target.min + 20),
    max: Math.floor(target.max - 20),
  };
  await fitness(page);
  const food =
    "A large chicken rice bowl with vegetables, avocado and olive oil";
  await page.getByRole("textbox", { name: "Lunch", exact: true }).fill(food);
  const coverage = page.getByRole("checkbox", {
    name: "今天吃的都记完了（一餐也可以）",
    exact: true,
  });
  await expect(coverage).toHaveCount(1);
  await expect(coverage).toHaveAttribute("id", "fitness-day-complete");
  await expect(coverage).not.toBeChecked();
  await page
    .getByRole("button", { name: "AI 解读这份记录", exact: true })
    .click();
  await expect(page.getByTestId("fitness-daily-review")).toHaveClass(
    /review-partial/,
  );
  const complete = page.getByRole("button", {
    name: "完成记录与复盘",
    exact: true,
  });
  await complete.click();
  await expect(page.getByTestId("fitness-completion-guidance")).toHaveAttribute(
    "role",
    "alert",
  );
  await page.getByRole("button", { name: "确认全天记录", exact: true }).click();
  await expect(coverage).toBeFocused();
  await expect(coverage).not.toBeChecked();
  expect(control.requests).toHaveLength(1);

  await coverage.check();
  await expect(page.getByTestId("nutrition-kcal")).toHaveText("待分析");
  expect((await saved(page)).current.fitness.analyzed).toBe(false);
  expect(control.requests).toHaveLength(1);
  await complete.click();
  await expect(page.getByTestId("fitness-completion-guidance")).toHaveAttribute(
    "role",
    "alert",
  );
  await page
    .getByRole("button", { name: "去分析当前记录", exact: true })
    .click();
  const analyze = page.getByRole("button", {
    name: "AI 解读这份记录",
    exact: true,
  });
  await expect(analyze).toBeFocused();
  expect(control.requests).toHaveLength(1);
  await analyze.click();
  await expect(page.getByTestId("fitness-daily-review")).toHaveClass(
    /review-within_range/,
  );
  await reflect(page);
  await complete.click();
  await expect(
    page.getByRole("button", {
      name: "薄肌活动已完成 · 40 XP 待领取",
      exact: true,
    }),
  ).toBeVisible();
  expect((await saved(page)).current.fitness).toMatchObject({
    breakfast: "",
    lunch: food,
    dinner: "",
    snacks: "",
    drinks: "",
    coverage: true,
    analyzed: true,
    completed: true,
  });
  expect(control.requests.map(({ coverage }) => coverage)).toEqual([
    "partial",
    "complete",
  ]);
  expect(control.plans).toEqual([]);
});

test("English followup keeps original food and answers through failure, then permits reviewed in-range completion", async ({
  page,
}) => {
  const state = seed();
  const control = await setup(page, state);
  control.clarify = true;
  const target = state.aiSetup!.plan!.nutrition.energy!.targetKcal!;
  control.kcal = {
    min: Math.ceil(target.min + 20),
    max: Math.floor(target.max - 20),
  };
  await fitness(page);
  await page
    .getByRole("textbox", { name: "Breakfast", exact: true })
    .fill("a bowl of rice");
  await page
    .getByRole("checkbox", {
      name: "今天吃的都记完了（一餐也可以）",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "AI 解读这份记录", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("How much cooked rice did you have?");
  await expect(page.getByTestId("fitness-daily-review")).toContainText(
    "记录待澄清",
  );
  await expect(page.getByTestId("fitness-daily-review")).toContainText(
    "待核对当前记录",
  );
  await expect(page.getByTestId("fitness-daily-review")).not.toContainText(
    "全天记录",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await preserveScreenshot(
    page,
    "artifacts/screenshots/v6-clarification-mobile.png",
  );
  await page.getByLabel("English answer 1", { exact: true }).fill("一碗");
  await page
    .getByRole("button", { name: "Send answers · 补充后重新分析", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("请用英文");
  expect(control.requests).toHaveLength(1);
  await page
    .getByLabel("English answer 1", { exact: true })
    .fill("About 150 g cooked rice.");
  control.failNext = true;
  await page
    .getByRole("button", { name: "Send answers · 补充后重新分析", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("模拟分析暂不可用");
  await expect(
    page.getByLabel("English answer 1", { exact: true }),
  ).toHaveValue("About 150 g cooked rice.");
  expect((await saved(page)).current.fitness).toMatchObject({
    breakfast: "a bowl of rice",
    analyzed: false,
    completed: false,
  });
  expect(
    (await saved(page)).current.fitness.aiAnalysisHistory?.length,
  ).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Send answers · 补充后重新分析", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("fitness-daily-review")).toContainText(
    "位于计划参考范围内",
  );
  expect(control.requests[2]).toMatchObject({
    food: "a bowl of rice",
    clarificationAnswers: [
      {
        sourceText: "a bowl of rice",
        question: "How much cooked rice did you have?",
        answer: "About 150 g cooked rice.",
      },
    ],
  });
  await reflect(page);
  await page
    .getByRole("button", { name: "完成记录与复盘", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "薄肌活动已完成 · 40 XP 待领取",
      exact: true,
    }),
  ).toBeVisible();
  expect((await saved(page)).current.fitness.reviewVersion).toBe(
    "fitness-review-v2",
  );
  expect((await saved(page)).current.fitness.reviewKey).toContain(
    "fitness-review-v2:",
  );
  expect((await saved(page)).current.fitness.breakfast).toBe("a bowl of rice");
});

test("legacy unclaimed completion is reopened without deleting logs, reflection or historical XP", async ({
  page,
}) => {
  const state = seed();
  state.xp = 50;
  state.current.fitness = {
    ...state.current.fitness,
    breakfast: "2 boiled eggs",
    analyzed: true,
    completed: true,
    quality: 100,
    confirmed: true,
    reviewed: true,
    reflection: "I kept an accurate food record today.",
  };
  await setup(page, state);
  await fitness(page);
  await expect
    .poll(async () => (await saved(page)).current.fitness.completed)
    .toBe(false);
  expect((await saved(page)).current.fitness.breakfast).toBe("2 boiled eggs");
  expect((await saved(page)).current.fitness.reflection).toBe(
    "I kept an accurate food record today.",
  );
  expect((await saved(page)).xp).toBe(50);
  await expect(
    page.getByRole("button", {
      name: "薄肌活动已完成 · 40 XP 待领取",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("too many clarification answers offer explicit original-record recovery without sending or silently dropping answers", async ({
  page,
}) => {
  const state = seed();
  const food = "a bowl of rice";
  const previous = [
    { sourceText: food, question: "Was it cooked?", answer: "Cooked." },
    { sourceText: food, question: "Which rice?", answer: "White rice." },
    { sourceText: food, question: "Any oil?", answer: "No oil." },
  ];
  state.current.fitness = {
    ...state.current.fitness,
    breakfast: food,
    coverage: true,
    analyzed: true,
    clarificationAnswers: previous,
    aiAnalysis: nutrition(
      { food, coverage: "complete", clarificationAnswers: previous },
      { min: 100, max: 500 },
      true,
    ),
  };
  const control = await setup(page, state);
  await fitness(page);
  await page
    .getByRole("button", {
      name: "补充食物细节 · Continue the chat",
      exact: true,
    })
    .click();
  await page
    .getByLabel("English answer 1", { exact: true })
    .fill("About 150 g cooked rice.");
  await page
    .getByRole("button", { name: "Send answers · 补充后重新分析", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "返回上方食物记录",
  );
  expect(control.requests).toEqual([]);
  expect((await saved(page)).current.fitness.clarificationAnswers).toHaveLength(
    4,
  );
  await page
    .getByRole("button", { name: "返回食物记录，补充完整描述", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Breakfast", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: "Breakfast", exact: true })
    .fill("150 g cooked white rice without oil");
  const recovered = (await saved(page)).current.fitness;
  expect(recovered.clarificationAnswers).toEqual([]);
  expect(recovered.clarificationDraftHistory?.at(-1)).toMatchObject({
    food,
    answers: [
      ...previous,
      {
        sourceText: food,
        question: "How much cooked rice did you have?",
        answer: "About 150 g cooked rice.",
      },
    ],
  });
  expect(recovered.breakfast).toBe("150 g cooked white rice without oil");
  expect(control.requests).toEqual([]);
});
