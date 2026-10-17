import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import {
  createOpenAICompatibleClient,
  type OpenAICompatibleConfig,
} from "./openai-compatible";
import {
  guardedProviderFetcher,
  publicIPAddress,
} from "./self-hosted-transport";

const config: OpenAICompatibleConfig = {
  baseUrl: "https://provider.example/v1",
  apiKey: "test-not-real",
  model: "test-model",
  allowLocal: false,
  timeoutMs: 1000,
  tokenParameter: "max_tokens",
};
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});
describe("request-configured provider network boundary", () => {
  it("immediately rejects an aborted hanging DNS lookup and removes its listener", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const transport = vi.fn(async () => Response.json({}));
    const resolveHost = vi.fn(
      () => new Promise<Array<{ address: string; family: number }>>(() => {}),
    );
    const pending = guardedProviderFetcher(config, { transport, resolveHost })(
      `${config.baseUrl}/chat/completions`,
      { method: "POST", signal: controller.signal },
    );
    const rejection = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await Promise.resolve();
    expect(resolveHost).toHaveBeenCalledTimes(1);
    controller.abort();
    await rejection;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.3.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::1",
  ])("rejects private, loopback or special-use address %s", (address) => {
    expect(publicIPAddress(address)).toBe(false);
  });
  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])(
    "allows public unicast address %s",
    (address) => {
      expect(publicIPAddress(address)).toBe(true);
    },
  );
  it("rejects every mixed public/private DNS answer before transport", async () => {
    const transport = vi.fn(async () => Response.json({}));
    const fetcher = guardedProviderFetcher(config, {
      transport,
      resolveHost: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.1.2.3", family: 4 },
      ],
    });
    await expect(
      fetcher(`${config.baseUrl}/chat/completions`, { method: "POST" }),
    ).rejects.toMatchObject({ code: "unsafe_provider_address" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("rechecks DNS on each request instead of reusing a previously public decision", async () => {
    const transport = vi.fn(async () => Response.json({}));
    const resolveHost = vi
      .fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const fetcher = guardedProviderFetcher(config, { transport, resolveHost });
    await fetcher(`${config.baseUrl}/chat/completions`, { method: "POST" });
    await expect(
      fetcher(`${config.baseUrl}/chat/completions`, { method: "POST" }),
    ).rejects.toMatchObject({ code: "unsafe_provider_address" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("does not start transport after a DNS resolution outlives the abort signal", async () => {
    const controller = new AbortController();
    const transport = vi.fn(async () => Response.json({}));
    const fetcher = guardedProviderFetcher(config, {
      transport,
      resolveHost: async () => {
        controller.abort();
        return [{ address: "93.184.216.34", family: 4 }];
      },
    });
    await expect(
      fetcher(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it("keeps localhost DNS restricted to loopback even in explicit local mode", async () => {
    const local = {
      ...config,
      baseUrl: "http://localhost:9000/v1",
      apiKey: "",
      allowLocal: true,
    };
    const fetcher = guardedProviderFetcher(local, {
      resolveHost: async () => [{ address: "192.168.1.1", family: 4 }],
    });
    await expect(
      fetcher(`${local.baseUrl}/chat/completions`, { method: "POST" }),
    ).rejects.toMatchObject({ code: "unsafe_provider_address" });
  });
  it("performs the real local keyless HTTP request and refuses redirects", async () => {
    let seenHost = "";
    let redirectTargetCalls = 0;
    const server = createServer((request, response) => {
      seenHost = request.headers.host ?? "";
      if (request.url === "/redirect/chat/completions") {
        response.writeHead(302, { location: "/target" }).end();
        return;
      }
      if (request.url === "/target") redirectTargetCalls++;
      request.resume();
      response.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: '{"connected":true}' },
            },
          ],
        }),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test server address");
    const local: OpenAICompatibleConfig = {
      ...config,
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      allowLocal: true,
      apiKey: "",
    };
    const client = createOpenAICompatibleClient(
      local,
      guardedProviderFetcher(local),
    );
    expect(
      await client.completeJson({
        system: "Return connected JSON.",
        user: {},
        schema: z.object({ connected: z.literal(true) }),
      }),
    ).toEqual({ connected: true });
    expect(seenHost).toBe(`127.0.0.1:${address.port}`);
    const redirect = {
      ...local,
      baseUrl: `http://127.0.0.1:${address.port}/redirect`,
    };
    await expect(
      createOpenAICompatibleClient(
        redirect,
        guardedProviderFetcher(redirect),
      ).completeJson({
        system: "Return JSON.",
        user: {},
        schema: z.object({}),
      }),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(redirectTargetCalls).toBe(0);
  });
  it("bounds a real oversized response before accepting provider JSON", async () => {
    const server = createServer((request, response) => {
      request.resume();
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end("x".repeat(100000));
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test server address");
    const local = {
      ...config,
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      allowLocal: true,
      apiKey: "",
    };
    await expect(
      createOpenAICompatibleClient(
        local,
        guardedProviderFetcher(local),
      ).completeJson({
        system: "Return JSON.",
        user: {},
        schema: z.object({}),
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
