// Open the trusted local setup URL without displaying its one-time token.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLaunchEnvironment, prepareLaunch } from "./prepare-launch.mjs";

try {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  loadLaunchEnvironment(root, process.argv.includes("--dev"));
  const status = await fetch("http://127.0.0.1:3100/api/self-hosted/status", {
    signal: AbortSignal.timeout(3000),
  });
  const data = await status.json();
  if (!status.ok || typeof data.configured !== "boolean") throw new Error();
  const launch = await prepareLaunch({ root });
  if (!launch.needsSetup) launch.url += "/#ai-settings";
  const env = { ...process.env, BOJI_SETUP_LAUNCH_URL: launch.url };
  const command =
    process.platform === "win32"
      ? "powershell.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    process.platform === "win32"
      ? [
          "-NoProfile",
          "-Command",
          "Start-Process -FilePath $env:BOJI_SETUP_LAUNCH_URL",
        ]
      : [launch.url];
  const child = spawn(command, args, {
    env,
    windowsHide: true,
    stdio: "ignore",
  });
  await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? done() : reject(new Error())));
  });
  console.log("AI setup page opened. Keep your local service running.");
} catch {
  console.error(
    "Could not open AI setup. Start Boji Club first, then run pnpm ai:setup again.",
  );
  process.exitCode = 1;
}
