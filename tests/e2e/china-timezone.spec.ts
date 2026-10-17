import { expect, test, type Page } from "@playwright/test";
import {
  defaultProfile,
  newDemo,
  type DemoState,
} from "../../src/lib/demo-store";

const STORAGE_KEY = "boji.club.demo.v1";
const DRAFT_KEY = "boji.onboarding.draft";

// The product's training day must not depend on the viewer's browser zone.
test.use({ timezoneId: "America/Los_Angeles" });

async function savedState(page: Page): Promise<DemoState> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    STORAGE_KEY,
  );
}

async function seedState(page: Page, fixture: DemoState) {
  await page.goto("/");
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: STORAGE_KEY, value: fixture },
  );
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "主要导航" }),
  ).toBeVisible();
}

async function finishRecordOnlyWizard(page: Page) {
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByLabel("当前训练参考").selectOption("none");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: /薄肌教父/ }).click();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  const request = page.waitForRequest(
    (req) => req.url().endsWith("/api/onboarding") && req.method() === "POST",
  );
  await page.getByRole("button", { name: "领取我的银色会员卡" }).click();
  expect((await request).postDataJSON().timeZone).toBe("Asia/Shanghai");
  await expect
    .poll(async () => (await savedState(page))?.profile.timeZone)
    .toBe("Asia/Shanghai");
}

test("new members use Beijing time without a time-zone field in a US browser", async ({
  page,
}) => {
  await page.goto("/");
  expect(
    await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
  ).toBe("America/Los_Angeles");
  await page.getByRole("button", { name: "先用记录模式，继续填写" }).click();
  await page.getByLabel("俱乐部昵称").fill("北京时间测试员");
  await page.getByLabel("年龄", { exact: true }).fill("25");
  await page
    .locator("summary")
    .filter({ hasText: /^身体资料/ })
    .click();
  await expect(page.getByLabel("训练时区")).toHaveCount(0);
  await expect(page.getByText("身体资料与时区", { exact: false })).toHaveCount(
    0,
  );
  await finishRecordOnlyWizard(page);
  await page
    .getByRole("navigation", { name: "成长与设置" })
    .getByRole("button", { name: /^设置与隐私/ })
    .click();
  const trainingDate = page
    .locator(".settings-section")
    .filter({
      has: page.getByRole("heading", { name: "训练日期", exact: true }),
    });
  await expect(trainingDate).toContainText("北京时间");
  await expect(trainingDate).toContainText("03:00");
  await expect(trainingDate).not.toContainText("Asia/Shanghai");
  await expect(trainingDate).not.toContainText("时区锁定");
  await expect(trainingDate.locator("input, select")).toHaveCount(0);
});

test("an old Brisbane onboarding draft retains entered details and submits Beijing time", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    {
      key: DRAFT_KEY,
      value: {
        ...defaultProfile(),
        nickname: "保留入会草稿",
        age: 28,
        heightCm: 178,
        weightKg: 76,
        timeZone: "Australia/Brisbane",
      },
    },
  );
  await page.reload();
  await page.getByRole("button", { name: "先用记录模式，继续填写" }).click();
  await expect(page.getByLabel("俱乐部昵称")).toHaveValue("保留入会草稿");
  await expect(page.getByLabel("年龄", { exact: true })).toHaveValue("28");
  await page
    .locator("summary")
    .filter({ hasText: /^身体资料/ })
    .click();
  await expect(page.getByLabel("身高 cm")).toHaveValue("178");
  await expect(page.getByLabel("体重 kg")).toHaveValue("76");
  await expect(page.getByLabel("训练时区")).toHaveCount(0);
  await finishRecordOnlyWizard(page);
  expect((await savedState(page)).profile).toMatchObject({
    nickname: "保留入会草稿",
    age: 28,
    heightCm: 178,
    weightKg: 76,
    timeZone: "Asia/Shanghai",
  });
});

test("existing non-China profiles migrate without losing drafts, history or experience", async ({
  page,
}) => {
  const now = new Date("2026-10-18T08:00:00Z");
  await page.clock.install({ time: now });
  const fixture = newDemo(
    {
      ...defaultProfile(),
      nickname: "旧档案迁移测试",
      timeZone: "Asia/Shanghai",
    },
    now,
  );
  fixture.profile.timeZone = "Australia/Brisbane";
  fixture.current.fitness.breakfast = "Two eggs and one bowl of cooked rice.";
  fixture.current.fitness.reflection = "I will describe my portions tomorrow.";
  fixture.current.learning.drafts = { writing: "My saved English draft." };
  fixture.current.dayIndex = 2;
  fixture.history = [
    {
      ...structuredClone(fixture.current),
      id: "synthetic-claimed-2026-10-17",
      date: "2026-10-17",
      dayIndex: 1,
      status: "claimed",
      awardedXP: 96,
      claimedAt: "2026-10-17T09:00:00Z",
    },
  ];
  fixture.xp = 96;
  fixture.completedDays = 1;
  fixture.ledger = [
    { source: fixture.history[0].id, xp: 96, date: "2026-10-17", dayIndex: 1 },
  ];
  await seedState(page, fixture);
  await expect
    .poll(async () => (await savedState(page)).profile.timeZone)
    .toBe("Asia/Shanghai");
  const migrated = await savedState(page);
  expect(migrated).toMatchObject({
    xp: 96,
    completedDays: 1,
    current: {
      id: fixture.current.id,
      date: "2026-10-18",
      dayIndex: 2,
      fitness: fixture.current.fitness,
      learning: { drafts: fixture.current.learning.drafts },
    },
  });
  expect(migrated.history).toEqual(fixture.history);
  expect(migrated.ledger).toEqual(fixture.ledger);
  await page.reload();
  await expect
    .poll(async () => (await savedState(page)).current.fitness.breakfast)
    .toBe(fixture.current.fitness.breakfast);
  expect((await savedState(page)).history).toEqual(fixture.history);
  expect((await savedState(page)).xp).toBe(96);
});

test("the training day rolls at Beijing 03:00 and archives unclaimed drafts in a US browser", async ({
  page,
}) => {
  // Load well before the boundary, then pause at an exact Beijing wall time.
  const now = new Date("2026-10-18T18:50:00Z");
  await page.clock.install({ time: now });
  const fixture = newDemo(
    {
      ...defaultProfile(),
      nickname: "凌晨边界测试",
      timeZone: "Asia/Shanghai",
    },
    now,
  );
  fixture.current.fitness.dinner = "A bowl of noodles and grilled tofu.";
  fixture.current.learning.drafts = {
    writing: "Keep this draft after rollover.",
  };
  await seedState(page, fixture);
  // Beijing is 02:59:40 on Oct 19; Los Angeles is still on Oct 18.
  await page.clock.pauseAt(new Date("2026-10-18T18:59:40Z"));
  expect((await savedState(page)).current.date).toBe("2026-10-18");
  await page.clock.fastForward(15_000);
  expect((await savedState(page)).current.date).toBe("2026-10-18");
  await page.clock.fastForward(31_000);
  await expect
    .poll(async () => (await savedState(page)).current.date)
    .toBe("2026-10-19");
  const rolled = await savedState(page);
  expect(rolled).toMatchObject({
    xp: 0,
    completedDays: 0,
    current: { dayIndex: 1, status: "active" },
  });
  expect(rolled.history).toHaveLength(1);
  expect(rolled.history[0]).toMatchObject({
    id: fixture.current.id,
    date: "2026-10-18",
    status: "archived_unclaimed",
    fitness: { dinner: fixture.current.fitness.dinner },
    learning: { drafts: fixture.current.learning.drafts },
  });
  expect(rolled.current.fitness.dinner).toBe("");
  expect(rolled.ledger).toHaveLength(0);
});
