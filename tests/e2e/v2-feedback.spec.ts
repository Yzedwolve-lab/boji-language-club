import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const screenshots = "artifacts/screenshots";
const STORAGE_KEY = "boji.club.demo.v1";

async function enterDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "先用虚构资料体验" }).click();
  await expect(page.locator(".training-grid")).toBeVisible();
  await expect(page.locator(".toast")).toBeHidden({ timeout: 8000 });
}

async function navigate(page: Page, name: "薄肌" | "语言" | "训练总览") {
  const mobile = (page.viewportSize()?.width ?? 1440) <= 760;
  await page
    .getByRole("navigation", { name: mobile ? "移动端导航" : "主要导航" })
    .getByRole("button", { name, exact: true })
    .click();
}

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

async function expectReadableText(scope: Locator, minimum = 13) {
  const tooSmall = await scope.evaluate(
    (root, min) =>
      [...root.querySelectorAll<HTMLElement>("*")]
        .filter(
          (element) =>
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== "hidden" &&
            [...element.childNodes].some(
              (node) =>
                node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
            ) &&
            parseFloat(getComputedStyle(element).fontSize) < min,
        )
        .map((element) => ({
          text: element.textContent?.trim().slice(0, 70),
          className: element.className,
          size: getComputedStyle(element).fontSize,
        })),
    minimum,
  );
  expect(tooSmall).toEqual([]);
}

async function capture(page: Page, filename: string, fullPage = false) {
  await expect(page.locator(".toast")).toBeHidden({ timeout: 8000 });
  await page.screenshot({
    path: `${screenshots}/${filename}`,
    fullPage,
    animations: "disabled",
  });
}

test.beforeAll(async () => {
  await mkdir(screenshots, { recursive: true });
});

test("Chinese meal dialogue keeps the raw draft, traps focus, and closes with Escape on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterDemo(page);
  await navigate(page, "薄肌");
  const breakfast = page.getByRole("textbox", {
    name: "Breakfast",
    exact: true,
  });
  const submit = page.getByRole("button", { name: "查看记录反馈" });
  await breakfast.fill("今天吃了两个鸡蛋和米饭");
  await submit.click();
  const dialog = page.getByRole("dialog", {
    name: "如果你没说对，那我不要和你说话 🙈",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("English mode, bestie");
  await expect(dialog).toContainText("草稿我已经替你留好了");
  await expect(dialog.getByRole("button", { name: "关闭提醒" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "OK bestie，我改 ✍️" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "关闭提醒" })).toBeFocused();
  await expectReadableText(dialog);
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.height).toBeLessThanOrEqual(844);
  await expectNoOverflow(page);
  await capture(page, "v2-food-english-dialog-mobile.png");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(submit).toBeFocused();
  await expect(breakfast).toHaveValue("今天吃了两个鸡蛋和米饭");
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).current.fitness.breakfast,
      STORAGE_KEY,
    ),
  ).toBe("今天吃了两个鸡蛋和米饭");
  await page.reload();
  await navigate(page, "薄肌");
  await expect(breakfast).toHaveValue("今天吃了两个鸡蛋和米饭");
});

test("common food typos suggest corrections and continuing keeps the exact original", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterDemo(page);
  await navigate(page, "薄肌");
  const breakfast = page.getByRole("textbox", {
    name: "Breakfast",
    exact: true,
  });
  const original = "100 g chiken and 2 egss";
  await breakfast.fill(original);
  await page.getByRole("button", { name: "查看记录反馈" }).click();
  const dialog = page.getByRole("dialog", {
    name: "你的键盘是不是有自己的想法？🤨",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".food-corrections")).toContainText("chiken");
  await expect(dialog.locator(".food-corrections")).toContainText("chicken");
  await expect(dialog.locator(".food-corrections")).toContainText("egss");
  await expect(dialog.locator(".food-corrections")).toContainText("eggs");
  await expectReadableText(dialog);
  await capture(page, "v2-food-spelling-dialog-desktop.png");
  await dialog
    .getByRole("button", { name: "按原文保留并继续，不自动改字" })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(breakfast).toHaveValue(original);
  await expect(page.getByTestId("nutrition-kcal")).toHaveText("未估算");
  const fitness = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).current.fitness,
    STORAGE_KEY,
  );
  expect(fitness.breakfast).toBe(original);
  expect(fitness.analyzed).toBe(true);
});

test("food quantities recalculate after analysis and unsupported portions remain unknown", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await enterDemo(page);
  await navigate(page, "薄肌");
  const breakfast = page.getByRole("textbox", {
    name: "Breakfast",
    exact: true,
  });
  const analyze = page.getByRole("button", { name: "查看记录反馈" });
  const kcal = page.getByTestId("nutrition-kcal");
  await breakfast.fill("100 g cooked rice");
  await expect(kcal).toHaveText("待分析");
  await analyze.click();
  await expect(kcal).toHaveText("130");
  await breakfast.fill("200 g cooked rice");
  await expect(kcal).toHaveText("待分析");
  await expect(page.locator(".reflection-panel")).toHaveCount(0);
  await analyze.click();
  await expect(kcal).toHaveText("260");
  await expect(kcal.locator("xpath=../..")).toHaveAttribute(
    "data-estimate-state",
    "estimated",
  );
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await capture(page, "v2-fitness-quantity-desktop.png");
  await breakfast.fill("a bowl of mapo tofu");
  await analyze.click();
  await expect(kcal).toHaveText("未估算");
  await expect(kcal.locator("xpath=../..")).toHaveAttribute(
    "data-estimate-state",
    "unestimated",
  );
  await expect(page.locator(".unknown-food")).toContainText(
    "a bowl of mapo tofu",
  );
  await breakfast.fill("100 g cooked rice and mystery sauce");
  await analyze.click();
  await expect(kcal).toHaveText("130");
  await expect(kcal.locator("xpath=../..")).toHaveAttribute(
    "data-estimate-state",
    "partial",
  );
  await expect(page.locator(".unknown-food")).toContainText("mystery sauce");
  await expect(page.locator(".food-buddy")).toContainText("还有内容未估算");
  await expect(
    page.getByRole("button", { name: "保存原始记录" }),
  ).toBeEnabled();
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`${viewport.name} prioritizes both entrances and keeps feedback and form text readable`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await enterDemo(page);
    const cards = page.locator(".training-grid");
    for (const name of ["薄肌", "语言"]) {
      const card = cards
        .getByRole("button")
        .filter({ has: page.getByRole("heading", { name, exact: true }) });
      await expect(card).toBeVisible();
      expect(
        await card
          .getByRole("heading")
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(28);
      const box = await card.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(280);
    }
    await expectReadableText(cards);
    const nav = page.getByRole("navigation", {
      name: viewport.name === "mobile" ? "移动端导航" : "主要导航",
    });
    for (const name of ["薄肌", "语言"]) {
      const button = nav.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(
        await button
          .locator(":scope > span")
          .first()
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(viewport.name === "mobile" ? 16 : 22);
    }
    await cards.scrollIntoViewIfNeeded();
    await expectNoOverflow(page);
    await capture(page, `v2-dashboard-${viewport.name}.png`);
    await navigate(page, "薄肌");
    const breakfast = page.getByRole("textbox", {
      name: "Breakfast",
      exact: true,
    });
    expect(
      await breakfast.evaluate((el) =>
        parseFloat(getComputedStyle(el).fontSize),
      ),
    ).toBeGreaterThanOrEqual(16);
    await expectReadableText(page.locator(".fitness-panel"));
    await expectNoOverflow(page);
    await navigate(page, "语言");
    await expectReadableText(page.locator(".learning"));
    for (const task of [
      "vocabulary",
      "listening",
      "reading",
      "writing",
      "speaking",
    ]) {
      await page.locator(`#tab-${task}`).click();
      await expectNoOverflow(page);
    }
    await page.locator("#tab-vocabulary").click();
    for (const id of ["habit-v1", "habit-v2", "habit-v3"])
      await page.locator(`#${id}`).fill("wrong");
    await page.getByRole("button", { name: "检查我的答案" }).click();
    await expect(page.locator(".learning-buddy")).toContainText(
      "Plot twist: this one needs a remix",
    );
    await page.locator("#habit-v1").fill("consistent");
    await page.locator("#habit-v2").fill("routine");
    await page.locator("#habit-v3").fill("organise");
    await page.getByRole("button", { name: "重做这一项" }).click();
    await expect(page.locator(".learning-buddy")).toContainText(
      "You ate that. No crumbs. ✨",
    );
    await expect(page.locator(".learning-feedback")).toContainText("100 / 100");
    await page.locator(".learning-buddy").scrollIntoViewIfNeeded();
    await capture(page, `v2-language-win-${viewport.name}.png`);
  });
}
