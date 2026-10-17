import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "./errors";

const stateSchema = z
  .object({
    version: z.literal(1),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    calls: z.number().int().nonnegative(),
    connectAttempts: z.array(z.number().finite()).max(100),
    sessions: z.record(z.string(), z.number().finite()),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
const locks = new Map<string, Promise<void>>();
const unavailable = () =>
  new ApiError(
    503,
    "private_storage_unavailable",
    "私有用量文件暂不可用，请检查服务端存储。已保存的草稿不受影响。",
  );

/** Durable limits for ONE Node process on a persistent disk; not a multi-instance store. */
export class SelfHostedStore {
  readonly path: string;
  constructor(directory: string) {
    this.path = resolve(/* turbopackIgnore: true */ directory, "usage.json");
  }

  private async transaction<T>(
    now: number,
    change: (state: State) => T,
  ): Promise<T> {
    const previous = locks.get(this.path) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    locks.set(this.path, current);
    await previous;
    try {
      const day = new Date(now).toISOString().slice(0, 10);
      let state: State;
      try {
        const contents = await readFile(
          /* turbopackIgnore: true */ this.path,
          "utf8",
        );
        if (contents.length > 100_000) throw unavailable();
        state = stateSchema.parse(JSON.parse(contents));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw unavailable();
        state = {
          version: 1,
          day,
          calls: 0,
          connectAttempts: [],
          sessions: {},
        };
      }
      if (day > state.day) {
        state.day = day;
        state.calls = 0;
      }
      // A backward wall-clock change must not reset the daily count.
      state.connectAttempts = state.connectAttempts.filter(
        (at) => at > now - 15 * 60_000,
      );
      state.sessions = Object.fromEntries(
        Object.entries(state.sessions).filter(([, expires]) => expires > now),
      );
      const result = change(state);
      try {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const temporary = `${this.path}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(state), {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporary, this.path);
      } catch {
        throw unavailable();
      }
      return result;
    } finally {
      release();
      if (locks.get(this.path) === current) locks.delete(this.path);
    }
  }

  async consumeConnectionAttempt(now: number) {
    return this.transaction(now, (state) => {
      if (state.connectAttempts.length >= 6)
        throw new ApiError(
          429,
          "connection_rate_limit",
          "连接尝试过于频繁，请 15 分钟后重试。",
        );
      state.connectAttempts.push(now);
    });
  }
  async reserveCall(now: number, maximum: number) {
    return this.transaction(now, (state) => {
      if (state.calls >= maximum)
        throw new ApiError(
          429,
          "daily_call_limit",
          "今天的 AI 调用额度已用完，草稿已保留。额度按 UTC 日期重置。",
        );
      state.calls += 1;
    });
  }
  async addSession(id: string, expires: number, now: number) {
    return this.transaction(now, (state) => {
      if (Object.keys(state.sessions).length >= 100)
        throw new ApiError(
          429,
          "session_limit",
          "会话数量已达上限，请等待旧会话过期。",
        );
      state.sessions[id] = expires;
    });
  }
  async hasSession(id: string, expires: number, now: number) {
    return this.transaction(now, (state) => state.sessions[id] === expires);
  }
  async removeSession(id: string, now: number) {
    return this.transaction(now, (state) => {
      delete state.sessions[id];
    });
  }
}
