import { describe, expect, it, vi } from "vitest";
import type { AIPlanningInput } from "../ai-types";
import { TIME_TEMPLATES } from "../domain";
import { TASKS } from "../lessons";
import { createAIStarterPlan, parseAIPlanningInput } from "./ai-planning";
import { readOpenAICompatibleConfig } from "./openai-compatible";
import { calculateEnergyReference } from "../energy-plan";
import { planningInputKey } from "../plan-input";

const config = readOpenAICompatibleConfig({
  ENABLE_OPENAI_COMPATIBLE: "true",
  OPENAI_COMPAT_BASE_URL: "https://provider.example/v1",
  OPENAI_COMPAT_API_KEY: "test-not-real",
  OPENAI_COMPAT_MODEL: "test-model",
})!;
const input = (): AIPlanningInput => ({
  profile: {
    nickname: "Test",
    gender: "unspecified",
    age: 28,
    weightKg: 65,
    heightCm: 170,
    bodyFatPercent: null,
    activityLevel: "light",
    timeBudget: 30,
    timeZone: "Asia/Shanghai",
    examType: "none",
    examScore: null,
    examDate: "",
    comparableToeflScore: null,
    cetStatus: "not_provided",
    goal: "user",
    healthConsent: true,
  },
  preferences: {
    activityLevel: "light",
    dietaryPreferences: "vegetarian",
    allergies: "peanuts",
  },
  englishSample:
    "I enjoy learning English because it helps me communicate with people from different countries. Every day I read a short story and write about my experiences.",
});
const output = () => ({
  nutrition: {
    summary: "将主食、蛋白质来源和蔬菜搭配起来。",
    mealIdeas: [
      {
        meal: "breakfast",
        idea: "燕麦、水果和酸奶。",
        note: "根据偏好调整，并自行核对过敏原。",
      },
    ],
  },
  english: {
    summary: "这份写作样本能清楚说明学习习惯。",
    strengths: [
      {
        observation: "能给出原因。",
        evidence: "because it helps me communicate",
      },
    ],
    focusAreas: [
      {
        observation: "可以增加具体例子。",
        evidence: "write about my experiences",
      },
    ],
    tasks: TASKS.map((component) => ({
      component,
      instruction: `Practice ${component} with a short everyday example.`,
    })),
  },
});
const transport = (value: unknown) =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return Response.json({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(value) } },
      ],
    });
  });

describe("AI starter plan boundaries", () => {
  it.each([
    ["2026-10-14T18:59:59Z", "2026-10-14"],
    ["2026-10-14T19:00:00Z", "2026-10-15"],
  ])(
    "uses the Beijing 03:00 boundary at %s even for a legacy client zone",
    async (now, expectedDate) => {
      const raw = input();
      raw.profile.timeZone = "America/Los_Angeles";
      expect(parseAIPlanningInput(raw).profile.timeZone).toBe("Asia/Shanghai");
      const fetcher = transport(output());
      const plan = await createAIStarterPlan(raw, {
        config,
        fetcher,
        now: new Date(now),
      });
      expect(plan.forDate).toBe(expectedDate);
      const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
      expect(JSON.parse(sent.messages[1].content).forDate).toBe(expectedDate);
    },
  );
  it("accepts legacy preferences without guessing eligibility or calculation sex", () => {
    const parsed = parseAIPlanningInput(input());
    expect(parsed.preferences).toMatchObject({
      energyGoal: "gentle_loss",
      calculationSex: "unspecified",
      nutritionEligibility: "unspecified",
    });
  });
  it("binds a server-calculated daily range and three meal budgets without treating meal text as measured calories", async () => {
    const raw = input();
    Object.assign(raw.preferences, {
      calculationSex: "female",
      nutritionEligibility: "standard_adult",
      energyGoal: "gentle_loss",
    });
    const generated = output();
    generated.nutrition.mealIdeas = [
      {
        meal: "breakfast",
        idea: "燕麦 50 克、酸奶 1 杯和香蕉 1 根。",
        note: "核对食材。",
      },
      {
        meal: "lunch",
        idea: "熟米饭 1 碗、豆腐 150 克与蔬菜。",
        note: "份量为搭配参考。",
      },
      {
        meal: "dinner",
        idea: "鸡蛋 2 个、土豆 1 个与蔬菜。",
        note: "根据偏好替换。",
      },
    ];
    const fetcher = transport(generated);
    const plan = await createAIStarterPlan(raw, {
      config,
      fetcher,
      now: new Date("2026-10-15T15:30:00Z"),
    });
    const energy = calculateEnergyReference(raw.profile, raw.preferences);
    // At 23:30 Beijing time this remains the October 15 training day.
    expect(plan.forDate).toBe("2026-10-15");
    expect(plan.inputKey).toBe(planningInputKey(raw));
    expect(plan.nutrition.energy).toEqual(energy);
    expect(plan.nutrition.mealIdeas.map((meal) => meal.budgetKcal)).toEqual(
      energy.mealBudgets.map((meal) => meal.kcal),
    );
    const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    const context = JSON.parse(sent.messages[1].content);
    expect(context.nutritionContext.energyPlan.targetKcal).toEqual(
      energy.targetKcal,
    );
    expect(context.nutritionContext.energyPlan).not.toHaveProperty("inputKey");
    expect(sent.messages[1].content).not.toContain("inputKey");
    expect(sent.messages[1].content).not.toContain(plan.inputKey!);
    expect(context.forDate).toBe("2026-10-15");
    expect(plan.limits.join(" ")).toContain("产品");
  });
  it.each([30, 60, 120, 240] as const)(
    "makes %s-minute daily tasks explicit and retains the full app budget",
    async (timeBudget) => {
      const raw = input();
      raw.profile.timeBudget = timeBudget;
      const plan = await createAIStarterPlan(raw, {
        config,
        fetcher: transport(output()),
      });
      for (const task of plan.english.tasks)
        expect(task.instruction).toContain(`${task.minutes} minutes`);
      expect(
        Object.values(TIME_TEMPLATES[timeBudget]).reduce(
          (sum, value) => sum + value,
          0,
        ),
      ).toBe(timeBudget);
    },
  );
  it("rejects model-authored duration expansions and calorie targets even for an eligible plan", async () => {
    const raw = input();
    Object.assign(raw.preferences, {
      calculationSex: "female",
      nutritionEligibility: "standard_adult",
    });
    const generated = output();
    generated.english.tasks[0].instruction = "Spend 90 minutes on vocabulary.";
    await expect(
      createAIStarterPlan(raw, { config, fetcher: transport(generated) }),
    ).rejects.toMatchObject({ code: "invalid_provider_output" });
    generated.english.tasks[0].instruction = "Learn five useful words.";
    generated.nutrition.summary = "Your target is 1200 kcal.";
    await expect(
      createAIStarterPlan(raw, { config, fetcher: transport(generated) }),
    ).rejects.toMatchObject({ code: "invalid_provider_output" });
  });
  it("does not send health details or calculated energy to AI without health consent", async () => {
    const raw = input();
    raw.profile.healthConsent = false;
    Object.assign(raw.preferences, {
      calculationSex: "female",
      nutritionEligibility: "standard_adult",
    });
    const fetcher = transport(output());
    const plan = await createAIStarterPlan(raw, { config, fetcher });
    const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(JSON.parse(sent.messages[1].content).nutritionContext).toBeNull();
    expect(sent.messages[1].content).not.toContain("female");
    expect(plan.nutrition.energy).toMatchObject({
      status: "tracking_only",
      targetKcal: null,
    });
  });
  it("uses actual writing evidence and deterministic task budgets without granting XP or scores", async () => {
    const result = await createAIStarterPlan(input(), {
      config,
      fetcher: transport(output()),
      now: new Date("2026-10-15T00:00:00Z"),
    });
    expect(result.basis).toBe("model_guidance");
    expect(result.createdAt).toBe("2026-10-15T00:00:00.000Z");
    expect(result.english.basis).toBe("written_sample");
    expect(result.english.tasks.map((task) => task.minutes)).toEqual(
      TASKS.map((key) => TIME_TEMPLATES[30][key]),
    );
    expect(result.english.strengths[0]).toContain(
      "because it helps me communicate",
    );
    expect(result).not.toHaveProperty("xp");
    expect(result).not.toHaveProperty("score");
  });
  it.each(["", "I like tea."])(
    "does not invent a baseline from a missing or short sample",
    async (sample) => {
      const raw = input();
      raw.englishSample = sample;
      const result = await createAIStarterPlan(raw, {
        config,
        fetcher: transport(output()),
      });
      expect(result.english.basis).toBe("unavailable");
      expect(result.english.strengths).toEqual([]);
      expect(result.english.focusAreas).toEqual([]);
      expect(result.english.summary).toContain("20");
    },
  );
  it.each(["minor", "no-consent"])(
    "keeps %s in tracking mode and excludes health information from the provider request",
    async (reason) => {
      const raw = input();
      if (reason === "minor") raw.profile.age = 17;
      else raw.profile.healthConsent = false;
      const fetcher = transport(output());
      const result = await createAIStarterPlan(raw, { config, fetcher });
      expect(result.nutrition.status).toBe("tracking_only");
      expect(result.nutrition.mealIdeas).toEqual([]);
      const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
      const userData = JSON.parse(sent.messages[1].content);
      expect(userData.nutritionContext).toBeNull();
      expect(sent.messages[1].content).not.toContain("peanuts");
    },
  );
  it("leaves missing height and weight unknown in general guidance", async () => {
    const raw = input();
    raw.profile.heightCm = null;
    raw.profile.weightKg = null;
    const fetcher = transport(output());
    const result = await createAIStarterPlan(raw, { config, fetcher });
    expect(result.nutrition.status).toBe("general_guidance");
    const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(JSON.parse(sent.messages[1].content).nutritionContext).toMatchObject(
      { heightCm: null, weightKg: null },
    );
  });
  it("rejects unsupported evidence rather than accepting fabricated diagnostics", async () => {
    const generated = output();
    generated.english.strengths[0].evidence = "A sentence the user never wrote";
    await expect(
      createAIStarterPlan(input(), { config, fetcher: transport(generated) }),
    ).rejects.toMatchObject({ code: "invalid_provider_output" });
  });
  it.each(["minutes", "score", "duplicate-task"])(
    "rejects model-controlled %s",
    async (kind) => {
      const generated = output();
      if (kind === "duplicate-task")
        generated.english.tasks[4].component = "writing";
      else Object.assign(generated.english.tasks[0], { [kind]: 999 });
      await expect(
        createAIStarterPlan(input(), { config, fetcher: transport(generated) }),
      ).rejects.toMatchObject({ code: "invalid_provider_output" });
    },
  );
  it("rejects numerical diet prescriptions and invented exam bands", async () => {
    const diet = output();
    diet.nutrition.summary = "Eat 1200 kcal every day.";
    await expect(
      createAIStarterPlan(input(), { config, fetcher: transport(diet) }),
    ).rejects.toMatchObject({ code: "invalid_provider_output" });
    const exam = output();
    exam.english.summary = "You are IELTS 8.";
    await expect(
      createAIStarterPlan(input(), { config, fetcher: transport(exam) }),
    ).rejects.toMatchObject({ code: "invalid_provider_output" });
  });
  it.each([
    ["summary", "Calories: 1200"],
    ["summary", "Daily calorie target: 1,200"],
    ["summary", "Energy budget is about 1200"],
    ["summary", "Calories:\n1200"],
    ["idea", "Protein target: 120 g"],
    ["idea", "Carbs per day: 200 g"],
    ["note", "Fat intake should be 50 g"],
    ["note", "能量目标约为 1200"],
    ["note", "蛋白质每日目标：120 克"],
  ] as const)(
    "rejects numeric nutrition claims after their label in %s: %s",
    async (field, text) => {
      const generated = output();
      if (field === "summary") generated.nutrition.summary = text;
      else generated.nutrition.mealIdeas[0][field] = text;
      await expect(
        createAIStarterPlan(input(), { config, fetcher: transport(generated) }),
      ).rejects.toMatchObject({ code: "invalid_provider_output" });
    },
  );
  it("retains ordinary food portions and English practice counts", async () => {
    const generated = output();
    generated.nutrition.summary = "Choose an ordinary source of protein";
    generated.nutrition.mealIdeas[0].idea =
      "50 g oats, 150 ml milk and 2 eggs; protein source: 150 g tofu as an alternative.";
    generated.nutrition.mealIdeas[0].note =
      "Choose low-fat yogurt, 100 g with fruit. 核对食材和份量。";
    generated.english.tasks[0].instruction =
      "Learn 5 useful words and write 2 short example sentences.";
    const plan = await createAIStarterPlan(input(), {
      config,
      fetcher: transport(generated),
    });
    expect(plan.nutrition.mealIdeas[0].idea).toBe(
      generated.nutrition.mealIdeas[0].idea,
    );
    expect(plan.english.tasks[0].instruction).toContain("Learn 5 useful words");
  });
  it("validates profile and bounds before model invocation", async () => {
    const raw = input();
    raw.englishSample = "x".repeat(6001);
    expect(() => parseAIPlanningInput(raw)).toThrow();
    const bad = input();
    bad.profile.timeBudget = 45 as 30;
    const fetcher = transport(output());
    await expect(
      createAIStarterPlan(bad, { config, fetcher }),
    ).rejects.toMatchObject({ code: "invalid_plan_input" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
