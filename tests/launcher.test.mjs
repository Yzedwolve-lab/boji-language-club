import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  mkdir,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { test } from "node:test";
import { prepareLaunch } from "../scripts/prepare-launch.mjs";

test("the launcher CLI loads the installed Next environment and emits only its private handoff JSON", async () => {
  await workspace(async (root) => {
    const result = spawnSync(process.execPath, ["scripts/prepare-launch.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_MODE: "demo",
        ENABLE_OPENAI_COMPATIBLE: "false",
        BOJI_PRIVATE_DIR: root,
      },
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0, "Launcher CLI must execute successfully.");
    const handoff = JSON.parse(result.stdout);
    assert.equal(handoff.needsSetup, true);
    assert.equal(new URL(handoff.url).origin, "http://127.0.0.1:3100");
    assert.equal(result.stderr, "");
    const saved = JSON.parse(
      await readFile(join(root, "setup-token.json"), "utf8"),
    );
    assert.match(saved.tokenHash, /^[a-f0-9]{64}$/);
    assert.equal(Object.keys(saved).length, 3);
  });
});

async function workspace(run) {
  const root = await mkdtemp(join(tmpdir(), "boji-launcher-"));
  try {
    await run(root);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    assert.ok(root.split(sep).at(-1).startsWith("boji-launcher-"));
    await rm(root, { recursive: true, force: true });
  }
}

test("first launch stores only a token digest and rotates old bootstrap URLs", async () => {
  await workspace(async (root) => {
    const first = await prepareLaunch({ root, env: {} });
    const token = new URLSearchParams(new URL(first.url).hash.slice(1)).get(
      "setup",
    );
    assert.equal(first.needsSetup, true);
    assert.equal(token.length, 43);
    const raw = await readFile(
      join(root, ".boji-private/setup-token.json"),
      "utf8",
    );
    assert.equal(raw.includes(token), false);
    assert.equal(
      JSON.parse(raw).tokenHash,
      createHash("sha256").update(token).digest("hex"),
    );
    const second = await prepareLaunch({ root, env: {} });
    assert.notEqual(second.url, first.url);
  });
});

test("saved configuration is preserved and never produces another first-setup token", async () => {
  await workspace(async (root) => {
    await mkdir(join(root, ".boji-private"));
    await writeFile(
      join(root, ".boji-private/ai-config.json"),
      "existing-private-config",
    );
    assert.deepEqual(await prepareLaunch({ root, env: {} }), {
      url: "http://127.0.0.1:3100",
      needsSetup: false,
    });
    assert.equal(
      await readFile(join(root, ".boji-private/ai-config.json"), "utf8"),
      "existing-private-config",
    );
    await assert.rejects(access(join(root, ".boji-private/setup-token.json")));
  });
});

test("production cannot be unlocked by the personal launcher", async () => {
  await workspace(async (root) => {
    assert.equal(
      (await prepareLaunch({ root, env: { APP_MODE: "production" } }))
        .needsSetup,
      false,
    );
    await assert.rejects(access(join(root, ".boji-private")));
  });
});

test("legacy environment settings defer configuration validity to the backend", async () => {
  await workspace(async (root) => {
    const env = {
      APP_MODE: "self_hosted",
      ENABLE_OPENAI_COMPATIBLE: "true",
      OPENAI_COMPAT_BASE_URL: "https://provider.example/v1",
      OPENAI_COMPAT_MODEL: "test",
      OPENAI_COMPAT_API_KEY: "fixture-only-key",
      BOJI_SELF_HOSTED_PASSWORD: "a-long-existing-password",
    };
    assert.equal((await prepareLaunch({ root, env })).needsSetup, true);
    assert.equal(env.OPENAI_COMPAT_API_KEY, "fixture-only-key");
    assert.equal(env.APP_MODE, "self_hosted");
  });
});

test("invalid legacy local settings cannot trap the page without setup authority", async () => {
  await workspace(async (root) => {
    const launch = await prepareLaunch({
      root,
      env: {
        APP_MODE: "self_hosted",
        ENABLE_OPENAI_COMPATIBLE: "true",
        OPENAI_COMPAT_BASE_URL: "https://provider.example/v1",
        OPENAI_COMPAT_MODEL: "test",
        OPENAI_COMPAT_ALLOW_LOCAL: "true",
        BOJI_SELF_HOSTED_PASSWORD: "a-long-existing-password",
      },
    });
    assert.equal(launch.needsSetup, true);
    assert.ok(
      new URLSearchParams(new URL(launch.url).hash.slice(1)).get("setup"),
    );
  });
});

test("public private-directory paths and non-HTTPS remote origins are rejected before writing", async () => {
  await workspace(async (root) => {
    await assert.rejects(
      prepareLaunch({ root, env: { BOJI_PRIVATE_DIR: "public/secrets" } }),
    );
    await assert.rejects(
      prepareLaunch({ root, env: {}, origin: "http://remote.example" }),
    );
    await assert.rejects(
      prepareLaunch({ root, env: {}, origin: "https://remote.example/path" }),
    );
    await assert.rejects(access(join(root, ".boji-private")));
    const result = await prepareLaunch({
      root,
      env: {},
      origin: "https://club.example",
    });
    assert.equal(new URL(result.url).origin, "https://club.example");
  });
});
