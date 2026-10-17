import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type {
  ChatGPTConnectionStatus,
  SelfHostedAIStatus,
} from "../../src/lib/ai-types";

// Browser boundary mocks only: no real login, token, or inference is used.
async function mockChatGPT(
  page: Page,
  initial: Partial<ChatGPTConnectionStatus> = {},
) {
  const state = {
    chatgpt: {
      available: true,
      signedIn: false,
      sharing: false,
      connected: false,
      ...initial,
    } as ChatGPTConnectionStatus,
    authorizationUrl:
      "https://auth.openai.com/oauth/authorize?client_id=mock-client&state=mock-state",
    calls: [] as Array<{ path: string; input: unknown }>,
    failTest: false,
    failModels: false,
    apiConnected: false,
    selectedProvider: undefined as "chatgpt" | "api_key" | undefined,
  };
  function summary(): SelfHostedAIStatus {
    return {
      mode: state.chatgpt.signedIn ? "self_hosted" : "demo",
      configured: state.chatgpt.signedIn,
      authenticated: state.chatgpt.signedIn,
      connected: state.chatgpt.connected || state.apiConnected,
      provider:
        state.selectedProvider ??
        (state.chatgpt.connected
          ? "chatgpt"
          : state.apiConnected
            ? "api_key"
            : null),
      apiKey: { configured: state.apiConnected, connected: state.apiConnected },
      chatgpt: { ...state.chatgpt },
      setup: { available: true, configuredVia: "none" },
    };
  }
  await page.route("**/api/self-hosted/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/self-hosted/status")
      return route.fulfill({ json: summary() });
    const input = route.request().postDataJSON();
    state.calls.push({ path, input });
    if (path === "/api/self-hosted/select") {
      state.selectedProvider = input.provider;
      return route.fulfill({ json: summary() });
    }
    if (path.endsWith("/chatgpt/start"))
      return route.fulfill({
        json: { authorizationUrl: state.authorizationUrl },
      });
    if (path.endsWith("/chatgpt/models")) {
      if (state.failModels)
        return route.fulfill({
          status: 503,
          json: {
            error: "chatgpt_models_invalid_response",
            message:
              "ChatGPT 模型列表暂时读取失败，请重试刷新模型。登录状态已保留。",
          },
        });
      return route.fulfill({
        json: {
          models: [
            { slug: "mock-model", displayName: "Mock model" },
            { slug: "mock-model-two", displayName: "Mock model two" },
          ],
        },
      });
    }
    if (path.endsWith("/chatgpt/connect")) {
      if (state.failTest)
        return route.fulfill({
          status: 429,
          json: {
            error: "chatgpt_usage_limit",
            message: "套餐或本应用的使用额度已达到上限，请管理用量后重试。",
          },
        });
      state.chatgpt.connected = true;
      state.chatgpt.model = input.model || "mock-model";
      return route.fulfill({ json: summary() });
    }
    if (path.endsWith("/chatgpt/disconnect")) {
      state.chatgpt = {
        available: true,
        signedIn: false,
        sharing: false,
        connected: false,
      };
      return route.fulfill({ json: summary() });
    }
    return route.fulfill({
      status: 503,
      json: { error: "unexpected_mock_call", message: "未预期的模拟请求。" },
    });
  });
  return state;
}

const apiOption = (page: Page) =>
  page.getByRole("button", { name: "使用 API Key", exact: true });
const chatgptOption = (page: Page) =>
  page.getByRole("button", { name: "使用 ChatGPT 登录", exact: true });
const testConnection = (page: Page) =>
  page.getByRole("button", {
    name: "连接并测试（使用少量套餐额度）",
    exact: true,
  });

test("mobile choice is keyboard accessible and preserves API inputs without browser secret storage", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await mockChatGPT(page);
  const bootstrap = "mock-bootstrap-code";
  await page.goto(`/#setup=${bootstrap}`);
  await expect(chatgptOption(page)).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Continue with ChatGPT", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("API Key", { exact: true })).not.toBeVisible();
  await apiOption(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/已读取首次配置码/)).toBeVisible();
  await page
    .getByLabel("Base URL", { exact: true })
    .fill("https://provider.example/v1");
  await page
    .getByLabel("API Key", { exact: true })
    .fill("mock-api-secret-never-store");
  await chatgptOption(page).click();
  await apiOption(page).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue(
    "mock-api-secret-never-store",
  );
  await expect(page.getByLabel("Base URL", { exact: true })).toHaveValue(
    "https://provider.example/v1",
  );
  const stored = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(stored).not.toContain("mock-api-secret-never-store");
  expect(stored).not.toContain(bootstrap);
  expect(page.url()).not.toContain(bootstrap);
  await chatgptOption(page).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(state.calls).toEqual([]);
  await mkdir("artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: "artifacts/screenshots/v5-chatgpt-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1460, height: 1000 });
  await page.screenshot({
    path: "artifacts/screenshots/v5-chatgpt-desktop.png",
    fullPage: true,
  });
});

test("official login starts only on click and rejects nonofficial redirect destinations", async ({
  page,
}) => {
  const state = await mockChatGPT(page);
  state.authorizationUrl =
    "https://auth.openai.com.evil.example/oauth/authorize";
  await page.goto("/");
  const signIn = page.getByRole("button", {
    name: "Continue with ChatGPT",
    exact: true,
  });
  await expect(signIn).toBeEnabled();
  expect(state.calls).toEqual([]);
  await signIn.click();
  await expect(
    page.locator(".chatgpt-connection").getByRole("alert"),
  ).toContainText("暂时打不开官方登录页");
  await expect(page).toHaveURL("http://127.0.0.1:3100/");
  expect(state.calls).toEqual([
    { path: "/api/self-hosted/chatgpt/start", input: { newAccount: false } },
  ]);
  state.authorizationUrl =
    "https://auth.openai.com/oauth/authorize?client_id=mock-client&state=mock-state";
  await page.route("https://auth.openai.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<p>Simulated official authorization destination</p>",
    }),
  );
  await signIn.click();
  await expect(page).toHaveURL(state.authorizationUrl);
  await expect(
    page.getByText("Simulated official authorization destination"),
  ).toBeVisible();
  expect(state.calls.every((call) => call.path.endsWith("/start"))).toBe(true);
});

test("cancelled callback has a useful message, removes callback fields, and does not test AI", async ({
  page,
}) => {
  const state = await mockChatGPT(page);
  await page.goto("/#chatgpt=error&reason=chatgpt_access_denied&section=ai");
  await expect(
    page.locator(".chatgpt-connection").getByRole("alert"),
  ).toContainText("你取消了登录或套餐授权");
  await expect(page).toHaveURL(/#section=ai$/);
  await expect(chatgptOption(page)).toHaveAttribute("aria-pressed", "true");
  expect(state.calls).toEqual([]);
});

test("signed-in users acknowledge plan use once and explicitly test, with quota recovery and model choice retained", async ({
  page,
}) => {
  const state = await mockChatGPT(page, {
    signedIn: true,
    sharing: true,
    email: "mock-user@example.test",
  });
  await page.goto("/#chatgpt=connected");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(
    "You're using your ChatGPT plan",
  );
  expect(state.calls).toEqual([]);
  await page
    .getByRole("button", { name: "Got it · 知道啦", exact: true })
    .click();
  await expect(
    page.getByText("ChatGPT 已登录 · 再测试一下就好", { exact: true }),
  ).toBeVisible();
  await expect(testConnection(page)).toBeVisible();
  expect(state.calls).toEqual([]);
  await page.getByText("模型设置 · 可选", { exact: true }).click();
  await page.getByRole("button", { name: "刷新可用模型", exact: true }).click();
  await page
    .getByLabel("ChatGPT 模型", { exact: true })
    .selectOption("mock-model-two");
  state.failTest = true;
  await testConnection(page).click();
  await expect(
    page.locator(".chatgpt-connection").getByRole("alert"),
  ).toContainText("使用额度已达到上限");
  await expect(
    page.locator(".chatgpt-usage-note a.button.primary"),
  ).toHaveAttribute("href", "https://chatgpt.com/settings/usage");
  await expect(page.getByLabel("ChatGPT 模型", { exact: true })).toHaveValue(
    "mock-model-two",
  );
  state.failTest = false;
  await testConnection(page).click();
  await expect(page.getByLabel("俱乐部昵称")).toBeVisible();
  const tests = state.calls.filter((call) => call.path.endsWith("/connect"));
  expect(tests).toEqual([
    {
      path: "/api/self-hosted/chatgpt/connect",
      input: { model: "mock-model-two" },
    },
    {
      path: "/api/self-hosted/chatgpt/connect",
      input: { model: "mock-model-two" },
    },
  ]);
  await page.getByRole("button", { name: "上一步", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByText("ChatGPT 已连接 · 队友就位 ✨", { exact: true }),
  ).toBeVisible();
  const stored = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(stored).not.toContain("mock-user@example.test");
});

test("identity without plan consent cannot run inference and can disconnect", async ({
  page,
}) => {
  const state = await mockChatGPT(page, {
    signedIn: true,
    sharing: false,
    email: "mock-user@example.test",
  });
  await page.goto("/");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByText(/还未授权使用套餐额度/)).toBeVisible();
  await expect(testConnection(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Continue with ChatGPT", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "断开 ChatGPT", exact: true }).click();
  await expect(
    page.getByText("mock-user@example.test", { exact: true }),
  ).toHaveCount(0);
  expect(state.calls).toEqual([
    { path: "/api/self-hosted/chatgpt/disconnect", input: {} },
  ]);
});

test("connected ChatGPT is independent of API configuration and account switch requests fresh official sign in", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("boji.chatgpt.plan-welcome.v1", "seen"),
  );
  const state = await mockChatGPT(page, {
    signedIn: true,
    sharing: true,
    connected: true,
    email: "mock-user@example.test",
  });
  await page.goto("/");
  await expect(
    page.getByText("ChatGPT 已连接 · 队友就位 ✨", { exact: true }),
  ).toBeVisible();
  await apiOption(page).click();
  await expect(page.getByLabel("Base URL", { exact: true })).toBeVisible();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("服务访问口令", { exact: true })).toHaveCount(0);
  await chatgptOption(page).click();
  await page.route("https://auth.openai.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<p>Simulated account selection</p>",
    }),
  );
  await page
    .getByRole("button", { name: "更换 ChatGPT 账号", exact: true })
    .click();
  await expect(page).toHaveURL(state.authorizationUrl);
  expect(state.calls).toEqual([
    { path: "/api/self-hosted/chatgpt/start", input: { newAccount: true } },
  ]);
});

test("unavailable remote sign in keeps API choice and record mode usable", async ({
  page,
}) => {
  const state = await mockChatGPT(page, {
    available: false,
    message: "请使用本机启动器打开 127.0.0.1 页面。",
  });
  await page.goto("/");
  await expect(
    page.getByText("请使用本机启动器打开 127.0.0.1 页面。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with ChatGPT", exact: true }),
  ).toBeDisabled();
  await apiOption(page).click();
  await expect(page.getByLabel("Base URL", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "先用记录模式，继续填写", exact: true })
    .click();
  await expect(page.getByLabel("俱乐部昵称")).toBeVisible();
  expect(state.calls).toEqual([]);
});

test("returning from cancelled official login preserves the onboarding profile draft", async ({
  page,
}) => {
  const state = await mockChatGPT(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "先用记录模式，继续填写", exact: true })
    .click();
  await page.getByLabel("俱乐部昵称").fill("Mocked retained draft");
  await page.getByLabel("年龄", { exact: true }).fill("28");
  await page.getByRole("button", { name: "上一步", exact: true }).click();
  // Simulate a full browser return, not a hash-only in-document navigation.
  await page.goto("about:blank");
  await page.goto("/#chatgpt=error&reason=chatgpt_access_denied");
  await expect(
    page.locator(".chatgpt-connection").getByRole("alert"),
  ).toContainText("你取消了登录或套餐授权");
  await page
    .getByRole("button", { name: "先用记录模式，继续填写", exact: true })
    .click();
  await expect(page.getByLabel("俱乐部昵称")).toHaveValue(
    "Mocked retained draft",
  );
  await expect(page.getByLabel("年龄", { exact: true })).toHaveValue("28");
  expect(state.calls).toEqual([]);
});

test("switching between two tested providers selects the chosen connection without new inference", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("boji.chatgpt.plan-welcome.v1", "seen"),
  );
  const state = await mockChatGPT(page, {
    signedIn: true,
    sharing: true,
    connected: true,
  });
  state.apiConnected = true;
  state.selectedProvider = "api_key";
  await page.goto("/");
  await expect(
    page.getByText("ChatGPT 已就绪 · 可以切换 ✨", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "已连接，继续填写资料", exact: true })
    .click();
  await expect(page.getByLabel("俱乐部昵称")).toBeVisible();
  expect(state.selectedProvider).toBe("chatgpt");
  await page.getByRole("button", { name: "上一步", exact: true }).click();
  await apiOption(page).click();
  await page
    .getByRole("button", { name: "已连接，继续填写资料", exact: true })
    .click();
  await expect(page.getByLabel("俱乐部昵称")).toBeVisible();
  expect(state.selectedProvider).toBe("api_key");
  expect(state.calls).toEqual([
    { path: "/api/self-hosted/select", input: { provider: "chatgpt" } },
    { path: "/api/self-hosted/select", input: { provider: "api_key" } },
  ]);
});

test("model catalogue failure preserves sign in, reports the model error, and only tests after explicit connect", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("boji.chatgpt.plan-welcome.v1", "seen"),
  );
  const state = await mockChatGPT(page, {
    signedIn: true,
    sharing: true,
    email: "mock-catalogue-user@example.test",
  });
  state.failModels = true;
  await page.goto("/");
  const panel = page.locator(".chatgpt-connection");
  const refresh = page.getByRole("button", {
    name: "刷新可用模型",
    exact: true,
  });
  await page.getByText("模型设置 · 可选", { exact: true }).click();
  expect(state.calls).toEqual([]);
  await refresh.click();
  await expect(panel.getByRole("alert")).toContainText(
    "ChatGPT 模型列表暂时读取失败",
  );
  await expect(panel.getByRole("alert")).not.toContainText(
    /额度|充值|invalid_provider_output/,
  );
  await expect(
    panel.getByText("ChatGPT 已登录 · 再测试一下就好", { exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByText("mock-catalogue-user@example.test", { exact: true }),
  ).toBeVisible();
  await expect(panel.locator(".chatgpt-usage-note.limit-reached")).toHaveCount(
    0,
  );
  await expect(refresh).toBeEnabled();
  await expect(testConnection(page)).toBeEnabled();
  expect(state.chatgpt.signedIn).toBe(true);
  expect(state.chatgpt.connected).toBe(false);
  expect(state.calls).toEqual([
    { path: "/api/self-hosted/chatgpt/models", input: {} },
  ]);

  state.failModels = false;
  await refresh.click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await page
    .getByLabel("ChatGPT 模型", { exact: true })
    .selectOption("mock-model-two");
  await expect(page.getByLabel("ChatGPT 模型", { exact: true })).toHaveValue(
    "mock-model-two",
  );
  expect(state.calls).toEqual([
    { path: "/api/self-hosted/chatgpt/models", input: {} },
    { path: "/api/self-hosted/chatgpt/models", input: {} },
  ]);
  await testConnection(page).click();
  await expect(page.getByLabel("俱乐部昵称")).toBeVisible();
  expect(state.calls).toEqual([
    { path: "/api/self-hosted/chatgpt/models", input: {} },
    { path: "/api/self-hosted/chatgpt/models", input: {} },
    {
      path: "/api/self-hosted/chatgpt/connect",
      input: { model: "mock-model-two" },
    },
  ]);
});
