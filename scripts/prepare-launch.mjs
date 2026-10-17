// Only the launcher consumes the JSON output. Never print its URL in logs.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function exists(file) {
  try {
    await readFile(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function prepareLaunch({
  root,
  env = process.env,
  origin = "http://127.0.0.1:3100",
  now = new Date(),
}) {
  const url = new URL(origin);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    url.origin !== origin ||
    (url.protocol !== "https:" && !(local && url.protocol === "http:"))
  )
    throw new Error("Use an exact HTTPS origin, or a loopback HTTP origin.");
  const directory = resolve(root, env.BOJI_PRIVATE_DIR || ".boji-private");
  const publicRelative = relative(resolve(root, "public"), directory);
  if (
    publicRelative === "" ||
    (!publicRelative.startsWith("..") && !isAbsolute(publicRelative))
  ) {
    throw new Error("Private AI configuration cannot be stored under public/.");
  }
  // Only the running backend can validate legacy environment settings. A token
  // never bypasses an existing valid configuration's access password; generating
  // one here also lets incomplete legacy settings recover through the page.
  if (
    env.APP_MODE === "production" ||
    (await exists(resolve(directory, "ai-config.json")))
  )
    return { url: origin, needsSetup: false };

  await mkdir(directory, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("base64url");
  const record = {
    version: 1,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    createdAt: now.toISOString(),
  };
  const destination = resolve(directory, "setup-token.json");
  const temporary = resolve(directory, `.setup-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(record), {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, destination);
  return { url: `${origin}/#setup=${token}`, needsSetup: true };
}

export function loadLaunchEnvironment(root, development = false) {
  const require = createRequire(import.meta.url);
  const nextRequire = createRequire(require.resolve("next/package.json"));
  const { loadEnvConfig } = nextRequire("@next/env");
  loadEnvConfig(root, development, { info() {}, error() {} });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    loadLaunchEnvironment(root, process.argv.includes("--dev"));
    const originIndex = process.argv.indexOf("--origin");
    const origin = originIndex < 0 ? undefined : process.argv[originIndex + 1];
    if (originIndex >= 0 && !origin) throw new Error("Missing origin.");
    const result = await prepareLaunch({ root, origin });
    process.stdout.write(JSON.stringify(result));
  } catch {
    // Configuration and private paths may be sensitive; do not echo exceptions.
    process.stderr.write(
      "Unable to prepare the private setup page. Check the local runtime and private-directory permissions.\n",
    );
    process.exitCode = 1;
  }
}
