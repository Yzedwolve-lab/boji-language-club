import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { DemoState } from "../../src/lib/demo-store";

const screenshots = "artifacts/screenshots";
const STORAGE_KEY = "boji.club.demo.v1";

async function capture(page: Page, filename: string) {
  await expect(page.locator(".toast")).toBeHidden({ timeout: 8000 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({
    path: `${screenshots}/${filename}`,
    fullPage: true,
    animations: "disabled",
  });
}

function silentWav(): Buffer {
  const samples = 8000;
  const audio = Buffer.alloc(44 + samples * 2);
  audio.write("RIFF", 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVE", 8);
  audio.write("fmt ", 12);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(samples * 2, 40);
  return audio;
}

async function state(page: Page): Promise<DemoState> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    STORAGE_KEY,
  );
}

async function enterDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "先用虚构资料体验" }).click();
  await expect(
    page
      .getByRole("navigation", { name: "主要导航" })
      .getByRole("button", { name: /训练总览/ }),
  ).toBeVisible();
  await expect
    .poll(async () => (await state(page))?.profile.nickname)
    .toBe("薄肌练习生");
}

async function navigate(page: Page, name: string) {
  const section = ["训练总览", "薄肌", "语言"].includes(name)
    ? "主要导航"
    : "成长与设置";
  await page
    .getByRole("navigation", { name: section })
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .click();
}

async function completeFitness(page: Page) {
  await navigate(page, "薄肌");
  await page
    .getByRole("textbox", { name: "Breakfast", exact: true })
    .fill("2 boiled eggs and 40 g oats");
  await page.getByRole("button", { name: "查看记录反馈" }).click();
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
    .fill("I will note the portion size next time.");
  await page.getByRole("button", { name: "完成记录与复盘" }).click();
  await expect(
    page.getByRole("button", { name: "薄肌活动已完成 · 40 XP 待领取" }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  await mkdir(screenshots, { recursive: true });
});

test("wizard validates IELTS, clears old scale values and creates a silver card without body metrics", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "先用记录模式，继续填写" }).click();
  await page.getByLabel("俱乐部昵称").fill("验收练习生");
  await page.getByLabel("年龄", { exact: true }).fill("25");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByLabel("当前训练参考").selectOption("ielts");
  await page.getByRole("spinbutton", { name: "总分" }).fill("6.3");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await expect(
    page.getByText("IELTS: enter 0–9, in 0.5 increments.").first(),
  ).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "总分" })).toHaveValue(
    "6.3",
  );
  await page.getByRole("spinbutton", { name: "总分" }).fill("8");
  await page.getByLabel("当前训练参考").selectOption("pte_academic");
  await expect(page.getByRole("spinbutton", { name: "总分" })).toHaveValue("");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await expect(
    page.getByText("PTE Academic: enter 10–90, in whole numbers.").first(),
  ).toBeVisible();
  await page.getByLabel("当前训练参考").selectOption("none");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: /薄肌教父/ }).click();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await expect(page.getByText("待诊断", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "领取我的银色会员卡" }).click();
  await expect.poll(async () => (await state(page))?.profile.goal).toBe("alan");
  expect(await state(page)).toMatchObject({
    xp: 0,
    profile: { weightKg: null, bodyFatPercent: null, examScore: null },
    current: { dayIndex: 1 },
  });
  await capture(page, "desktop-dashboard.png");
});

test("390px mobile wizard with reduced motion remains keyboard usable and keeps drafts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "先用记录模式，继续填写" }).click();
  await page.getByLabel("俱乐部昵称").focus();
  await page.keyboard.type("Mobile tester");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("年龄", { exact: true })).toBeFocused();
  await page.keyboard.type("24");
  await page.reload();
  await page.getByRole("button", { name: "先用记录模式，继续填写" }).click();
  await expect(page.getByLabel("俱乐部昵称")).toHaveValue("Mobile tester");
  await expect(page.getByLabel("年龄", { exact: true })).toHaveValue("24");
  expect(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await capture(page, "mobile-onboarding.png");
  await page.getByRole("button", { name: "当前为记录模式 · 连接 AI" }).click();
  await page.getByRole("button", { name: "先用虚构资料体验" }).click();
  await expect
    .poll(async () => (await state(page))?.profile.nickname)
    .toBe("薄肌练习生");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await capture(page, "mobile-dashboard.png");
});

test("raw food drafts survive invalid English, refresh and feedback; only one module cannot claim", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await enterDemo(page);
  await navigate(page, "薄肌");
  await page.getByRole("button", { name: "查看记录反馈" }).click();
  await expect(
    page.getByText("Log at least one meal or activity before submitting."),
  ).toBeVisible();
  await page.getByRole("button", { name: "OK bestie，我改 ✍️" }).click();
  await page
    .getByRole("textbox", { name: "Breakfast", exact: true })
    .fill("今天吃了两碗米饭");
  await page.getByRole("button", { name: "保存原始记录" }).click();
  await page.getByRole("button", { name: "查看记录反馈" }).click();
  await expect(
    page.getByText("Please describe your meal or exercise in English."),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Breakfast", exact: true }),
  ).toHaveValue("今天吃了两碗米饭");
  await page.getByRole("button", { name: "OK bestie，我改 ✍️" }).click();
  await page.reload();
  await navigate(page, "薄肌");
  await expect(
    page.getByRole("textbox", { name: "Breakfast", exact: true }),
  ).toHaveValue("今天吃了两碗米饭");
  await page
    .getByRole("textbox", { name: "Breakfast", exact: true })
    .fill("0 g cooked rice");
  await expect(
    page.getByRole("textbox", { name: "Breakfast", exact: true }),
  ).toHaveValue("0 g cooked rice");
  await page.getByLabel("Duration · minutes").fill("-30");
  await page.getByLabel("MET assumption").fill("4");
  await page.getByRole("button", { name: "查看记录反馈" }).click();
  await expect(
    page.getByText("Activity duration must be between 0 and 1,440 minutes."),
  ).toBeVisible();
  await page.getByLabel("Duration · minutes").fill("");
  await page.getByLabel("MET assumption").fill("");
  await completeFitness(page);
  expect((await state(page)).current.fitness.quality).toBe(100);
  expect((await state(page)).xp).toBe(0);
  await expect(
    page.getByRole("button", { name: "提交当日俱乐部活动经验" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  await capture(page, "desktop-fitness.png");
});

test("activity-only records preserve unknown food intake and missing personal energy", async ({
  page,
}) => {
  await enterDemo(page);
  await navigate(page, "薄肌");
  await page.getByLabel("Cardio / Activity").fill("Brisk walking");
  await page.getByLabel("Duration · minutes").fill("30");
  await page.getByLabel("MET assumption").fill("4");
  await page.getByRole("button", { name: "查看记录反馈" }).click();
  await expect(
    page.getByText("未提供饮食，无法评价全天摄入。活动记录仍可用于完成复盘。"),
  ).toBeVisible();
  await expect(
    page.getByText(/未提供体重：无法个性化估算运动消耗/),
  ).toBeVisible();
  expect((await state(page)).current.fitness.analyzed).toBe(true);
});

test("onboarding service failure retains user input and offers retry", async ({
  page,
}) => {
  await page.route("**/api/onboarding", (route) => route.abort("failed"));
  await page.goto("/");
  await page.getByRole("button", { name: "先用记录模式，继续填写" }).click();
  await page.getByLabel("俱乐部昵称").fill("Draft stays here");
  await page.getByLabel("年龄", { exact: true }).fill("28");
  await page.getByRole("button", { name: "当前为记录模式 · 连接 AI" }).click();
  await page.getByRole("button", { name: "先用虚构资料体验" }).click();
  await expect(
    page.getByText("服务连接失败，草稿已保留，请重试。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "先用记录模式，继续填写" }).click();
  await expect(page.getByLabel("俱乐部昵称")).toHaveValue("Draft stays here");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("boji.onboarding.draft") ?? "{}")
          .nickname,
    ),
  ).toBe("Draft stays here");
  expect(await state(page)).toBeNull();
});

test("all five practices, a local retry, alternatives, idempotent claim and both rollover paths", async ({
  page,
}) => {
  await enterDemo(page);
  await completeFitness(page);
  await navigate(page, "语言");
  await expect(
    page.getByRole("button", { name: "查看复盘", exact: true }),
  ).toBeDisabled();
  await page.locator("#habit-v1").fill("wrong");
  await page.locator("#habit-v2").fill("wrong");
  await page.locator("#habit-v3").fill("organise");
  await page.getByRole("button", { name: "检查我的答案" }).click();
  await expect(
    page.getByText("再 remix 一次，看看下面的提示", { exact: false }),
  ).toBeVisible();
  await page.locator("#habit-v1").fill("consistent");
  await page.locator("#habit-v2").fill("routine");
  await page.getByRole("button", { name: "重做这一项" }).click();
  await page.getByRole("button", { name: "继续：听力" }).click();
  await page.getByRole("button", { name: "无法播放？使用文字替代" }).click();
  await expect(
    page.getByText("无障碍文字阅读替代 · 不评估听辨能力"),
  ).toBeVisible();
  await page
    .getByRole("radio", { name: "After breakfast", exact: true })
    .check();
  await page
    .getByRole("radio", { name: "Review three words", exact: true })
    .check();
  await page.getByRole("button", { name: "检查我的答案" }).click();
  await page.getByRole("button", { name: "继续：阅读" }).click();
  await page.getByText("加入生词（也支持键盘输入）", { exact: true }).click();
  await page.getByLabel("Word", { exact: true }).fill("approach");
  await page.getByLabel("目标词义", { exact: true }).fill("方法");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  if (!(await page.getByLabel("Word", { exact: true }).isVisible())) {
    await page.getByText("加入生词（也支持键盘输入）", { exact: true }).click();
  }
  await page.getByLabel("Word", { exact: true }).fill("approach");
  await page.getByLabel("目标词义", { exact: true }).fill("方法");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const savedWords =
    (await state(page)).current.learning.words?.filter(
      (word) => word.lemma === "approach",
    ) ?? [];
  expect(savedWords).toHaveLength(1);
  expect(savedWords[0].firstStudiedAt).toBeNull();
  expect(savedWords[0].sources[0]).toContain("原创阅读");
  for (const answer of [
    "Small, repeated practice can be useful",
    "Revisits older words",
    "They connect words with his life",
  ]) {
    await page.getByRole("radio", { name: answer, exact: true }).check();
  }
  await page.getByRole("button", { name: "检查我的答案" }).click();
  await page.getByRole("button", { name: "继续：写作" }).click();
  await page.locator("#writing-draft").fill("A short draft.");
  await expect(
    page.getByRole("button", { name: "完成自评替代练习" }),
  ).toBeDisabled();
  expect((await state(page)).current.learning).toMatchObject({
    vocabulary: 100,
    listening: 100,
    reading: 100,
    writing: null,
  });
  await page
    .locator("#writing-draft")
    .fill(
      "One small habit I want to build is reading English after breakfast. I will review three words and write one sentence about my own life. When my schedule changes, I can practise in the evening and keep my plan simple.",
    );
  for (const prefix of ["内容：", "组织：", "语法：", "词汇："]) {
    await page
      .getByRole("checkbox", { name: new RegExp(`^${prefix}`) })
      .check();
  }
  await page.getByRole("button", { name: "完成自评替代练习" }).click();
  await page.getByRole("button", { name: "继续：口语" }).click();
  await page
    .locator("#speaking-outline")
    .fill(
      "I practise English after breakfast. I review a few useful words and describe my daily plans because small habits fit my schedule.",
    );
  await page.getByRole("checkbox", { name: /^我检查了提纲/ }).check();
  await page.getByRole("checkbox", { name: /^我已用适合/ }).check();
  await page.getByRole("button", { name: "完成表达准备替代活动" }).click();
  await page.getByRole("button", { name: "查看复盘", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "今日完整复盘", exact: true }),
  ).toBeVisible();
  const completed = await state(page);
  expect(completed.current.learning).toMatchObject({
    vocabulary: 100,
    listening: 100,
    reading: 100,
    writing: 80,
    speaking: 80,
    pronunciation: null,
    fluency: null,
    answersRevealed: true,
  });
  expect(completed.current.learning.attempts).toHaveLength(6);
  expect(completed.xp).toBe(0);
  await capture(page, "desktop-learning.png");
  const claim = page.getByRole("button", { name: "提交当日俱乐部活动经验" });
  // Dispatch a rapid double click to exercise the actual handler's locking path.
  await claim.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect
    .poll(async () => (await state(page)).current.status)
    .toBe("claimed");
  expect(await state(page)).toMatchObject({
    xp: 96,
    completedDays: 1,
    current: { dayIndex: 1, awardedXP: 96 },
  });
  expect((await state(page)).ledger).toHaveLength(1);
  await page.reload();
  expect((await state(page)).current.dayIndex).toBe(1);
  await expect(
    page.getByRole("button", { name: "提交当日俱乐部活动经验" }),
  ).toHaveCount(0);
  await navigate(page, "设置与隐私");
  await page.getByRole("button", { name: "模拟进入下一训练日" }).click();
  await expect.poll(async () => (await state(page)).current.dayIndex).toBe(2);
  expect(
    (await state(page)).current.learning.words?.some(
      (word) => word.lemma === "approach",
    ),
  ).toBe(true);
  expect((await state(page)).history[0]).toMatchObject({
    status: "claimed",
    awardedXP: 96,
  });
  expect((await state(page)).xp).toBe(96);
  await page.getByRole("button", { name: "模拟进入下一训练日" }).click();
  expect((await state(page)).current.dayIndex).toBe(2);
  expect((await state(page)).history).toHaveLength(2);
  expect((await state(page)).history[1].status).toBe("archived_unclaimed");
  expect((await state(page)).completedDays).toBe(1);
  await navigate(page, "成长记录");
  await expect(page.getByText("未领取 · 原始内容已归档")).toBeVisible();
  await capture(page, "desktop-history.png");
});

test("unavailable microphone and undecodable audio never invent pronunciation or a passing score", async ({
  page,
}) => {
  await enterDemo(page);
  await navigate(page, "语言");
  await page.getByRole("tab", { name: /口语/ }).click();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(
    page.getByText(/麦克风权限被拒绝|无法连接麦克风|当前浏览器不支持录音/),
  ).toBeVisible();
  await page.getByLabel("Upload your own audio").setInputFiles({
    name: "invalid-recording.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("This fixture is deliberately not an audio stream."),
  });
  await expect(
    page.getByText(
      "音频无法解码，未保存且不计为学习失败。请换用有效音频或完成替代活动。",
    ),
  ).toBeVisible();
  expect((await state(page)).current.learning).toMatchObject({
    speaking: null,
    pronunciation: null,
    fluency: null,
  });
  expect((await state(page)).current.learning.recordings).toHaveLength(0);
  expect((await state(page)).current.learning.attempts).toHaveLength(0);
  await capture(page, "recording-unavailable.png");
});

test("forecast remains uncertain and repeated 40% previews use the same fictional baseline", async ({
  page,
}) => {
  await enterDemo(page);
  await navigate(page, "我的计划");
  await page.getByRole("button", { name: "40%", exact: true }).click();
  await page.getByRole("button", { name: "预览计划调整" }).click();
  await expect(page.getByText("暂不能生成加速计划")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认演示调整" })).toHaveCount(
    0,
  );
  await page
    .getByRole("checkbox", {
      name: "使用虚构的 100 天基线演示约束计算（不是真实预测）",
    })
    .check();
  await page.getByRole("button", { name: "预览计划调整" }).click();
  await expect(page.getByText("演示请求：100 天 → 60 天")).toBeVisible();
  await page.getByRole("button", { name: "确认演示调整" }).click();
  await page.getByRole("button", { name: "预览计划调整" }).click();
  await expect(page.getByText("演示请求：100 天 → 60 天")).toBeVisible();
  expect((await state(page)).xp).toBe(0);
  expect((await state(page)).plan).toMatchObject({
    compression: 0.4,
    baselineId: "fictional-independent-100-days-v1",
  });
});

test("privacy export downloads a local file and confirmed deletion removes all saved progress", async ({
  page,
}) => {
  await enterDemo(page);
  await navigate(page, "语言");
  await page.getByRole("tab", { name: /口语/ }).click();
  await page.getByLabel("Upload your own audio").setInputFiles({
    name: "private-demo.wav",
    mimeType: "audio/wav",
    buffer: silentWav(),
  });
  await expect
    .poll(async () => (await state(page)).current.learning.recordings?.length)
    .toBe(1);
  await navigate(page, "设置与隐私");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出数据", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "boji-demo-export.json",
  );
  await page.getByRole("button", { name: "删除数据", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除本机演示数据" });
  await expect(
    dialog.getByRole("button", { name: "确认删除全部本机数据" }),
  ).toBeDisabled();
  await dialog.getByLabel("输入“删除”以确认").fill("删除");
  await dialog.getByRole("button", { name: "确认删除全部本机数据" }).click();
  await expect(
    page.getByRole("button", { name: "先用虚构资料体验" }),
  ).toBeVisible();
  expect(await state(page)).toBeNull();
  expect(
    await page.evaluate(() => localStorage.getItem("boji.onboarding.draft")),
  ).toBeNull();
  const audioCount = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("boji-private-demo-audio");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const count = db
            .transaction("recordings")
            .objectStore("recordings")
            .count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => {
            db.close();
            reject(count.error);
          };
        };
      }),
  );
  expect(audioCount).toBe(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "先用虚构资料体验" }),
  ).toBeVisible();
});

test("repeated mistakes switch to scaffold questions and language tabs support arrow/Home/End keys", async ({
  page,
}) => {
  await enterDemo(page);
  await navigate(page, "语言");
  await page.locator("#tab-vocabulary").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#tab-listening")).toBeFocused();
  await expect(page.locator("#tab-listening")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("End");
  await expect(page.locator("#tab-speaking")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#tab-writing")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.locator("#tab-vocabulary")).toBeFocused();
  for (const id of ["habit-v1", "habit-v2", "habit-v3"])
    await page.locator(`#${id}`).fill("incorrect");
  await page.getByRole("button", { name: "检查我的答案" }).click();
  await page.getByRole("button", { name: "重做这一项" }).click();
  await expect(
    page.getByText("New strategy just dropped. 🧩", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#habit-v1")).toHaveCount(0);
  await page.locator("#habit-vr1").fill("consistent");
  await page.locator("#habit-vr2").fill("routine");
  await page.locator("#habit-vr3").fill("organise");
  await page.getByRole("button", { name: "重做这一项" }).click();
  expect((await state(page)).current.learning).toMatchObject({
    vocabulary: 100,
    listening: null,
    reading: null,
    writing: null,
    speaking: null,
  });
  expect((await state(page)).current.learning.attempts).toHaveLength(3);
  await page.getByRole("button", { name: "继续：听力" }).click();
  await expect(page.locator("#tab-listening")).toBeFocused();
});
