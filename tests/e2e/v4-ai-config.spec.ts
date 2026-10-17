import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type {
  SelfHostedAIConfiguration,
  SelfHostedAIConfigureInput,
  SelfHostedAIStatus,
} from "../../src/lib/ai-types";

// These browser tests simulate our server boundary, never a real AI provider.
// Backend tests separately verify authorization, private files and response secrecy.
const setupToken = "s".repeat(43);
const replacementToken = "r".repeat(43);
const apiKey = "mock-only-provider-key-do-not-use";
const password = "mock-only-service-password";
const configuration: SelfHostedAIConfiguration = {
  baseUrl: "https://provider.example/v1",
  model: "mock-compatible-model",
  dailyLimit: 40,
  tokenParameter: "max_tokens",
  allowLocal: false,
  hasApiKey: true,
};

async function mockConfiguration(page: Page, configured = false) {
  const state = {
    configured,
    connected: configured,
    failNext: false,
    configure: [] as SelfHostedAIConfigureInput[],
    summaries: 0,
    summaryMethods: [] as string[],
    connectionCalls: 0,
    disconnectCalls: 0,
    providerUnavailable: false,
    otherPaidCalls: [] as string[],
    summary: { ...configuration },
  };
  const status = (): SelfHostedAIStatus => ({
    mode: state.configured ? "self_hosted" : "demo",
    configured: state.configured,
    authenticated: state.connected,
    connected: state.connected,
    setup: {
      available: !state.configured,
      configuredVia: state.configured ? "file" : "none",
    },
  });
  await page.route("**/api/self-hosted/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/status")) return route.fulfill({ json: status() });
    if (path.endsWith("/configuration")) {
      const request = route.request();
      state.summaryMethods.push(request.method());
      if (
        (request.method() === "POST" &&
          request.postDataJSON().password !== password) ||
        (request.method() === "GET" && !state.connected)
      ) {
        return route.fulfill({
          status: 401,
          json: { error: "unauthorized", message: "模拟口令不正确。" },
        });
      }
      state.summaries++;
      return route.fulfill({ json: state.summary });
    }
    if (path.endsWith("/connect")) {
      state.connectionCalls++;
      if (state.providerUnavailable)
        return route.fulfill({
          status: 503,
          json: {
            error: "provider_unavailable",
            message: "模拟旧接口不可用，请修改配置。",
          },
        });
      state.connected = true;
      return route.fulfill({ json: status() });
    }
    if (path.endsWith("/disconnect")) {
      state.disconnectCalls++;
      state.connected = false;
      return route.fulfill({ json: status() });
    }
    if (path.endsWith("/configure")) {
      const input = route
        .request()
        .postDataJSON() as SelfHostedAIConfigureInput;
      state.configure.push(input);
      if (state.failNext) {
        state.failNext = false;
        return route.fulfill({
          status: 503,
          json: {
            error: "mock_provider_unavailable",
            message: "模拟接口暂不可用，当前输入保留，请重试。",
          },
        });
      }
      state.configured = true;
      state.connected = true;
      state.summary = {
        baseUrl: input.baseUrl,
        model: input.model,
        dailyLimit: input.dailyLimit ?? state.summary.dailyLimit,
        tokenParameter: input.tokenParameter ?? state.summary.tokenParameter,
        allowLocal: input.allowLocal ?? state.summary.allowLocal,
        hasApiKey: Boolean(input.apiKey) || state.summary.hasApiKey,
      };
      return route.fulfill({ json: status() });
    }
    state.otherPaidCalls.push(path);
    return route.fulfill({
      status: 503,
      json: { error: "unexpected_mock_call", message: "未预期的模拟请求" },
    });
  });
  return state;
}

const keyField = (page: Page) => page.getByLabel(/^API Key/);
const targetConsent = (page: Page) =>
  page.getByRole("checkbox", { name: /^我已核对目标服务/ });
const saveButton = (page: Page) =>
  page.getByRole("button", { name: "保存并测试 AI", exact: true });

async function fillInitialConfiguration(page: Page) {
  await page.getByLabel(/^Base URL/).fill(configuration.baseUrl);
  await page.getByLabel("模型名称", { exact: true }).fill(configuration.model);
  await keyField(page).fill(apiKey);
  await page.getByLabel(/^设置服务访问口令/).fill(password);
}

async function expectNoBrowserSecrets(page: Page, values: string[]) {
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  for (const value of values) {
    expect(storage).not.toContain(value);
    expect(page.url()).not.toContain(value);
  }
}

test("mocked first configuration requires target confirmation, preserves failed inputs and clears successful secrets", async ({
  page,
}) => {
  const calls = await mockConfiguration(page);
  const requestedUrls: string[] = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  await page.goto(`/#setup=${setupToken}&section=ai`);
  await page.getByRole("button", { name: "使用 API Key", exact: true }).click();
  await expect(page.getByText(/已读取首次配置码/)).toBeVisible();
  await expect(page).toHaveURL(/#section=ai$/);
  await fillInitialConfiguration(page);
  await expect(page.getByTestId("ai-config-host")).toHaveText(
    "https://provider.example",
  );
  await saveButton(page).click();
  await expect(page.locator(".ai-config-form .error-box")).toContainText(
    "先核对下方显示的目标服务",
  );
  expect(calls.configure).toHaveLength(0);
  await targetConsent(page).check();
  calls.failNext = true;
  await saveButton(page).click();
  await expect(page.locator(".ai-config-form .error-box")).toContainText(
    "模拟接口暂不可用",
  );
  await expect(keyField(page)).toHaveValue(apiKey);
  await expect(page.getByLabel(/^设置服务访问口令/)).toHaveValue(password);
  await expect(page.getByLabel(/^Base URL/)).toHaveValue(configuration.baseUrl);
  await expectNoBrowserSecrets(page, [setupToken, apiKey, password]);
  expect(calls.configure[0]).toMatchObject({
    setupToken,
    baseUrl: configuration.baseUrl,
    model: configuration.model,
    apiKey,
    password,
  });

  // Keep references to the actual fields to verify cleanup even after unmount.
  const keyInput = await keyField(page).elementHandle();
  const passwordInput = await page
    .getByLabel(/^设置服务访问口令/)
    .elementHandle();
  await saveButton(page).click();
  await expect(page.getByLabel("俱乐部昵称")).toBeVisible();
  expect(
    await keyInput!.evaluate((input) => (input as HTMLInputElement).value),
  ).toBe("");
  expect(
    await passwordInput!.evaluate((input) => (input as HTMLInputElement).value),
  ).toBe("");
  await expectNoBrowserSecrets(page, [setupToken, apiKey, password]);
  expect(calls.configure).toHaveLength(2);
  expect(calls.otherPaidCalls).toEqual([]);
  for (const value of [setupToken, apiKey, password])
    expect(requestedUrls.join("\n")).not.toContain(value);

  await page.getByRole("button", { name: "上一步", exact: true }).click();
  await page.getByRole("button", { name: "使用 API Key", exact: true }).click();
  await expect(page.getByText("AI 已连接 · 队友就位 ✨")).toBeVisible();
  await page.getByRole("button", { name: "修改 AI 配置", exact: true }).click();
  await expect(keyField(page)).toHaveValue("");
  await expect(page.getByLabel(/^当前服务访问口令/)).toHaveValue("");
});

test("mocked authenticated editing reads only the safe summary and can retain the same endpoint key", async ({
  page,
}) => {
  const calls = await mockConfiguration(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "使用 API Key", exact: true }).click();
  const summaryResponse = page.waitForResponse(
    "**/api/self-hosted/configuration",
  );
  await page.getByRole("button", { name: "修改 AI 配置", exact: true }).click();
  expect(Object.keys(await (await summaryResponse).json()).sort()).toEqual(
    Object.keys(configuration).sort(),
  );
  await expect(keyField(page)).toHaveValue("");
  await expect(page.getByLabel(/^Base URL/)).toHaveValue(configuration.baseUrl);
  await page.getByLabel("模型名称", { exact: true }).fill("mock-updated-model");
  await targetConsent(page).check();
  const submit = page.getByRole("button", {
    name: "保存修改并测试 AI",
    exact: true,
  });
  await submit.click();
  await expect(page.locator(".ai-config-form .error-box")).toContainText(
    "修改配置需要当前服务访问口令",
  );
  expect(calls.configure).toHaveLength(0);
  await page.getByLabel(/^当前服务访问口令/).fill(password);
  await submit.click();
  await expect(page.getByLabel("俱乐部昵称")).toBeVisible();
  expect(calls.configure).toHaveLength(1);
  expect(calls.configure[0]).toMatchObject({
    currentPassword: password,
    baseUrl: configuration.baseUrl,
    model: "mock-updated-model",
  });
  expect(calls.configure[0]).not.toHaveProperty("apiKey");
  expect(calls.configure[0]).not.toHaveProperty("password");
  expect(calls.configure[0]).not.toHaveProperty("setupToken");
  expect(calls.summaries).toBe(1);
  await expectNoBrowserSecrets(page, [apiKey, password]);
});

test("mocked endpoint changes require a new key and renewed destination confirmation", async ({
  page,
}) => {
  const calls = await mockConfiguration(page, true);
  await page.goto("/");
  await page.getByRole("button", { name: "使用 API Key", exact: true }).click();
  await page.getByRole("button", { name: "修改 AI 配置", exact: true }).click();
  await targetConsent(page).check();
  await page.getByLabel(/^Base URL/).fill("https://new-provider.example/v1");
  await expect(targetConsent(page)).not.toBeChecked();
  await expect(page.getByTestId("ai-config-host")).toHaveText(
    "https://new-provider.example",
  );
  await page.getByLabel(/^当前服务访问口令/).fill(password);
  await targetConsent(page).check();
  const submit = page.getByRole("button", {
    name: "保存修改并测试 AI",
    exact: true,
  });
  await submit.click();
  await expect(page.locator(".ai-config-form .error-box")).toContainText(
    "接口地址已改变，请重新填写 API Key；旧密钥不会发送到新地址。",
  );
  expect(calls.configure).toHaveLength(0);
  const newKey = "mock-new-endpoint-key";
  await keyField(page).fill(newKey);
  await submit.click();
  await expect(page.getByLabel("俱乐部昵称")).toBeVisible();
  expect(calls.configure).toHaveLength(1);
  expect(calls.configure[0]).toMatchObject({
    baseUrl: "https://new-provider.example/v1",
    apiKey: newKey,
    currentPassword: password,
  });
  await expectNoBrowserSecrets(page, [apiKey, newKey, password]);
});

test("mobile mocked setup accepts a manual replacement code and exposes readable advanced controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await mockConfiguration(page);
  await page.goto("/");
  await page.getByRole("button", { name: "使用 API Key", exact: true }).click();
  await fillInitialConfiguration(page);
  await targetConsent(page).check();
  await saveButton(page).click();
  await expect(page.locator(".ai-config-form .error-box")).toContainText(
    "一次性配置码",
  );
  expect(calls.configure).toHaveLength(0);
  await page.getByText("输入一次性配置码", { exact: true }).click();
  await page.getByLabel("一次性配置码", { exact: true }).fill(replacementToken);
  await page.getByText("高级设置", { exact: true }).click();
  await page.getByLabel(/^每日 AI 请求上限/).fill("12");
  await page
    .getByLabel("Token 参数", { exact: true })
    .selectOption("max_completion_tokens");
  await expect(
    page.getByRole("checkbox", { name: /^允许本机回环接口/ }),
  ).not.toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(
        '.ai-config-form input:not([type="checkbox"]), .ai-config-form select',
      )
      .evaluateAll((inputs) =>
        inputs.every(
          (input) => parseFloat(getComputedStyle(input).fontSize) >= 16,
        ),
      ),
  ).toBe(true);
  await mkdir("artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: "artifacts/screenshots/v4-ai-config-mobile.png",
    fullPage: true,
  });
  await saveButton(page).click();
  await expect(page.getByLabel("俱乐部昵称")).toBeVisible();
  expect(calls.configure[0]).toMatchObject({
    setupToken: replacementToken,
    dailyLimit: 12,
    tokenParameter: "max_completion_tokens",
    allowLocal: false,
  });
  await expectNoBrowserSecrets(page, [replacementToken, apiKey, password]);
});

test("saved demo users can reopen mocked first setup directly without losing their record", async ({
  page,
}) => {
  const calls = await mockConfiguration(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "先用虚构资料体验", exact: true })
    .click();
  await expect(page.locator(".training-grid")).toBeVisible();
  const savedProfile = await page.evaluate(
    () => JSON.parse(localStorage.getItem("boji.club.demo.v1")!).profile,
  );
  expect(calls.configure).toHaveLength(0);
  expect(calls.otherPaidCalls).toEqual([]);
  // The launcher opens a document; a hash-only navigation would not remount it.
  await page.goto("about:blank");
  await page.goto(`/#setup=${setupToken}`);
  await page.getByRole("button", { name: "使用 API Key", exact: true }).click();
  await expect(page.locator(".settings-page .ai-config-form")).toBeVisible();
  await expect(page.getByText(/已读取首次配置码/)).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await fillInitialConfiguration(page);
  await targetConsent(page).check();
  await saveButton(page).click();
  await expect(page.locator(".ai-config-form")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("boji.club.demo.v1")!).profile,
    ),
  ).toEqual(savedProfile);
  await expectNoBrowserSecrets(page, [setupToken, apiKey, password]);
  expect(calls.configure).toHaveLength(1);
  expect(calls.otherPaidCalls).toEqual([]);
});

test("mocked unavailable old provider can be repaired with the service password without an AI session", async ({
  page,
}) => {
  const calls = await mockConfiguration(page, true);
  calls.connected = false;
  calls.providerUnavailable = true;
  await page.goto("/");
  await page.getByRole("button", { name: "使用 API Key", exact: true }).click();
  const loginPassword = page.getByLabel("服务访问口令", { exact: true });
  await loginPassword.fill(password);
  await page
    .getByRole("button", { name: "连接并测试 AI", exact: true })
    .click();
  await expect(
    page.getByText("模拟旧接口不可用，请修改配置。", { exact: true }),
  ).toBeVisible();
  expect(calls.connectionCalls).toBe(1);
  expect(calls.connected).toBe(false);

  const oldInput = await loginPassword.elementHandle();
  await page
    .getByRole("button", { name: "用口令修改配置", exact: true })
    .click();
  await expect(page.locator(".ai-config-form")).toBeVisible();
  await expect(keyField(page)).toHaveValue("");
  await expect(
    page.getByLabel("当前服务访问口令", { exact: true }),
  ).toHaveValue("");
  expect(
    await oldInput!.evaluate((input) => (input as HTMLInputElement).value),
  ).toBe("");
  expect(calls.summaryMethods).toEqual(["POST"]);
  expect(calls.connectionCalls).toBe(1);
  expect(calls.connected).toBe(false);
  await expect(
    page.getByText("AI 已连接 · 队友就位 ✨", { exact: true }),
  ).toHaveCount(0);
  await expectNoBrowserSecrets(page, [password, apiKey]);

  const repairedKey = "mock-repaired-provider-key";
  await keyField(page).fill(repairedKey);
  await page.getByLabel("当前服务访问口令", { exact: true }).fill(password);
  await targetConsent(page).check();
  await page
    .getByRole("button", { name: "保存修改并测试 AI", exact: true })
    .click();
  await expect(page.getByLabel("俱乐部昵称")).toBeVisible();
  expect(calls.configure).toHaveLength(1);
  expect(calls.configure[0]).toMatchObject({
    apiKey: repairedKey,
    currentPassword: password,
  });
  expect(calls.configure[0]).not.toHaveProperty("setupToken");
  expect(calls.connected).toBe(true);
  expect(calls.otherPaidCalls).toEqual([]);
  await expectNoBrowserSecrets(page, [password, repairedKey]);
});

test("mocked disconnect immediately replaces the connected UI with the password login", async ({
  page,
}) => {
  const calls = await mockConfiguration(page, true);
  await page.goto("/");
  await page
    .getByRole("button", { name: "先用虚构资料体验", exact: true })
    .click();
  const settings = () =>
    page
      .getByRole("navigation", { name: "成长与设置" })
      .getByRole("button", { name: /^设置/ });
  await settings().click();
  await page.getByRole("button", { name: "使用 API Key", exact: true }).click();
  await page
    .getByRole("button", { name: "使用此连接，查看我的计划", exact: true })
    .click();
  await settings().click();
  await page.getByRole("button", { name: "使用 API Key", exact: true }).click();
  await expect(
    page.getByText("AI 已连接 · 队友就位 ✨", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "断开 AI，回到记录模式", exact: true })
    .click();
  await page.getByRole("button", { name: "使用 API Key", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "连接并测试 AI", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("AI 已连接 · 队友就位 ✨", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "使用此连接，查看我的计划", exact: true }),
  ).toHaveCount(0);
  expect(calls.disconnectCalls).toBe(1);
  expect(calls.connected).toBe(false);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("boji.club.demo.v1")!).aiSetup.mode,
    ),
  ).toBe("demo");
});
