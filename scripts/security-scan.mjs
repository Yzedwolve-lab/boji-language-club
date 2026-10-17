import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
async function files(dir) {
  const result = [];
  for (const entry of await fs
    .readdir(dir, { withFileTypes: true })
    .catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await files(full)));
    else result.push(full);
  }
  return result;
}
const source = (
  await Promise.all(
    ["src", "supabase", "tests"].map((dir) => files(path.join(root, dir))),
  )
)
  .flat()
  .filter((file) => /\.(ts|tsx|sql|ps1|css)$/.test(file));
const browser = (await files(path.join(root, ".next", "static"))).filter(
  (file) => /\.(js|json|html)$/.test(file),
);
const patterns = [
  ["credential-shaped token", /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/],
  ["embedded private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
const browserOnly = [
  [
    "privileged key variable in browser",
    /SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|OPENAI_COMPAT_API_KEY|BOJI_SELF_HOSTED_PASSWORD/,
  ],
  ["AI endpoint in browser", /api\.openai\.com\/v1/],
];
const findings = [];
for (const file of [...source, ...browser]) {
  const content = await fs.readFile(file, "utf8");
  for (const [name, pattern] of [
    ...patterns,
    ...(browser.includes(file) ? browserOnly : []),
  ])
    if (pattern.test(content))
      findings.push({ file: path.relative(root, file), rule: name });
}
const report = {
  sourceFiles: source.length,
  browserAssets: browser.length,
  findings,
  scope:
    "Pattern scan of selected source and browser build files only; does not scan Git history or prove absence of every possible secret.",
};
await fs.mkdir(path.join(root, "artifacts", "logs"), { recursive: true });
await fs.writeFile(
  path.join(root, "artifacts", "logs", "security-scan.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (findings.length) process.exitCode = 1;
