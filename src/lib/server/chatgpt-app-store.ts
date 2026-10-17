import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "./errors";

const schema = z
  .object({
    version: z.literal(1),
    model: z.string().min(1).max(200).nullable(),
    models: z
      .array(
        z
          .object({
            slug: z.string().min(1).max(200),
            displayName: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(500),
    sessions: z.record(
      z.string().regex(/^[a-f0-9]{64}$/),
      z
        .object({
          expires: z.number().int().positive(),
          origin: z.string().max(200),
          accountId: z.string().min(1).max(200),
          connected: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
export type ChatGPTAppState = z.infer<typeof schema>;
const unavailable = () =>
  new ApiError(
    503,
    "chatgpt_storage_unavailable",
    "ChatGPT 本机连接记录暂不可读写，请检查存储权限。原始资料已保留。",
  );

/** Non-provider browser credentials and model preference; OAuth tokens live separately. */
export class ChatGPTAppStore {
  constructor(readonly directory: string) {}
  private path() {
    return resolve(/* turbopackIgnore: true */ this.directory, "browser.json");
  }
  async read(now: number): Promise<ChatGPTAppState> {
    try {
      const raw = await readFile(
        /* turbopackIgnore: true */ this.path(),
        "utf8",
      );
      if (raw.length > 150_000) throw unavailable();
      const state = schema.parse(JSON.parse(raw));
      state.sessions = Object.fromEntries(
        Object.entries(state.sessions).filter(
          ([, session]) => session.expires > now,
        ),
      );
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 1, model: null, models: [], sessions: {} };
      throw unavailable();
    }
  }
  /** Caller serializes mutations with the ChatGPT service operation lock. */
  async write(state: ChatGPTAppState) {
    try {
      const serialized = JSON.stringify(schema.parse(state));
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.path()}.${randomUUID()}.tmp`;
      await writeFile(/* turbopackIgnore: true */ temporary, serialized, {
        flag: "wx",
        mode: 0o600,
      });
      await rename(/* turbopackIgnore: true */ temporary, this.path());
    } catch {
      throw unavailable();
    }
  }
}
