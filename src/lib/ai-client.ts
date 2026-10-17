/** Same-origin calls only. Provider credentials never enter browser code. */
export async function selfHostedRequest<T>(
  path: "plan" | "nutrition" | "disconnect",
  body: unknown = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/self-hosted/${path}`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null)
    throw new Error(
      typeof data?.message === "string"
        ? data.message.slice(0, 500)
        : "AI 请求未完成，原始记录已保留。请检查连接后重试。",
    );
  return data as T;
}
