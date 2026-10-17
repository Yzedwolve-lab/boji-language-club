import "server-only";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { ApiError } from "./errors";
import type { OpenAICompatibleConfig } from "./openai-compatible";
import type { Fetcher } from "./supabase";

export type ResolveHost = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;
const denied = () =>
  new ApiError(
    400,
    "unsafe_provider_address",
    "接口地址必须是公开 HTTPS 服务；本地模型仅支持明确启用的 loopback 地址。",
  );
function normalizedAddress(address: string) {
  if (isIP(address) === 6)
    return new URL(`http://[${address}]`).hostname.slice(1, -1);
  return address;
}
export function publicIPAddress(raw: string) {
  const address = normalizedAddress(raw).toLowerCase();
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 ||
          (b === 0 && (c === 0 || c === 2)) ||
          (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family === 6) {
    // Only global unicast; exclude documentation, transition and special-use ranges.
    return (
      /^[23][0-9a-f]{3}:/.test(address) &&
      !/^(?:2001:(?:db8:|2:|10:|20:|:)|2002:)/.test(address)
    );
  }
  return false;
}
function loopbackAddress(address: string) {
  const normalized = normalizedAddress(address);
  return (
    (/^127\./.test(normalized) && isIP(normalized) === 4) ||
    normalized === "::1"
  );
}
async function resolveWithSignal(
  hostname: string,
  resolver: ResolveHost,
  signal?: AbortSignal | null,
) {
  signal?.throwIfAborted();
  if (!signal) return resolver(hostname);
  return new Promise<Awaited<ReturnType<ResolveHost>>>(
    (resolveResult, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", aborted);
        action();
      };
      const aborted = () =>
        finish(() =>
          reject(signal.reason ?? new DOMException("Aborted", "AbortError")),
        );
      signal.addEventListener("abort", aborted, { once: true });
      // Native DNS may not be cancelable, but its result is detached immediately
      // on abort and can never initiate a later socket or retain our listener.
      Promise.resolve()
        .then(() => {
          signal.throwIfAborted();
          return resolver(hostname);
        })
        .then(
          (addresses) => finish(() => resolveResult(addresses)),
          (error) => finish(() => reject(error)),
        );
    },
  );
}

/** Resolve before each call, reject every nonpublic answer, then pin the socket.
 * A second DNS lookup by global fetch would leave a DNS-rebinding gap. */
export function guardedProviderFetcher(
  config: OpenAICompatibleConfig,
  options: { resolveHost?: ResolveHost; transport?: Fetcher } = {},
): Fetcher {
  return async (input, init) => {
    const url = new URL(String(input));
    if (
      url.toString() !== `${config.baseUrl}/chat/completions` ||
      init?.method !== "POST"
    )
      throw denied();
    const hostname = url.hostname
      .replace(/^\[|\]$/g, "")
      .toLowerCase()
      .replace(/\.$/, "");
    const local = ["127.0.0.1", "localhost", "::1"].includes(hostname);
    if (
      url.protocol !== "https:" &&
      !(local && config.allowLocal && url.protocol === "http:")
    )
      throw denied();
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await resolveWithSignal(
          hostname,
          options.resolveHost ??
            ((host) => lookup(host, { all: true, verbatim: true })),
          init?.signal,
        );
    if (
      !addresses.length ||
      addresses.some(
        (item) =>
          !isIP(item.address) ||
          (local && config.allowLocal
            ? !loopbackAddress(item.address)
            : !publicIPAddress(item.address)),
      )
    )
      throw denied();
    init?.signal?.throwIfAborted();
    // Only test code injects a transport. Runtime traffic always uses the pinned socket below.
    if (options.transport) return options.transport(input, init);
    const pinned = addresses[0];
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    headers.host = url.host;
    return new Promise<Response>((resolveResponse, reject) => {
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const outgoing = send(
        {
          protocol: url.protocol,
          hostname: pinned.address,
          family: pinned.family,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: "POST",
          headers,
          ...(url.protocol === "https:" && !isIP(hostname)
            ? { servername: hostname }
            : {}),
          signal: init?.signal ?? undefined,
          // TLS verification remains enabled, and redirects are never followed.
        },
        (incoming) => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value))
              value.forEach((item) => responseHeaders.append(name, item));
            else if (value !== undefined) responseHeaders.set(name, value);
          }
          let finished = false;
          let bytes = 0;
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              incoming.on("data", (chunk: Buffer) => {
                if (finished) return;
                bytes += chunk.byteLength;
                if (bytes > 64000) {
                  finished = true;
                  controller.error(
                    new Error("Provider response exceeds the allowed size."),
                  );
                  incoming.destroy();
                  return;
                }
                controller.enqueue(new Uint8Array(chunk));
              });
              incoming.on("end", () => {
                if (!finished) {
                  finished = true;
                  controller.close();
                }
              });
              incoming.on("error", (error) => {
                if (!finished) {
                  finished = true;
                  controller.error(error);
                }
              });
            },
            cancel() {
              finished = true;
              incoming.destroy();
            },
          });
          const status = incoming.statusCode ?? 502;
          resolveResponse(
            new Response([204, 205, 304].includes(status) ? null : body, {
              status,
              headers: responseHeaders,
            }),
          );
        },
      );
      outgoing.once("error", reject);
      outgoing.end(typeof init?.body === "string" ? init.body : undefined);
    });
  };
}
