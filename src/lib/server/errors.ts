import "server-only";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: error.status },
    );
  }
  // Do not log request bodies, provider responses, tokens or health information.
  return Response.json(
    {
      error: "system_error",
      message:
        "The service could not complete this request. Your saved drafts are retained.",
    },
    { status: 503 },
  );
}

export async function jsonBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 64_000)
    throw new ApiError(413, "too_large", "Request must be under 64 KB.");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64_000) {
        await reader.cancel();
        throw new ApiError(413, "too_large", "Request must be under 64 KB.");
      }
      chunks.push(value);
    }
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(joined);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Send a JSON object.");
  }
}
