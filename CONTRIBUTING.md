# 参与薄肌语言俱乐部

欢迎提交问题、改善新手安装体验，或通过 Pull Request 贡献代码。

## 本地开发

先按 [README](README.md) 安装 Node.js 和 pnpm，运行 `pnpm install --frozen-lockfile --ignore-scripts`，再执行 `pnpm dev`。开发约定见 [AGENTS.md](AGENTS.md)。

提交前运行：

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm test
node --test tests/launcher.test.mjs
```

修改交互时，另运行 `pnpm exec playwright install chromium` 和 `pnpm test:e2e`。测试使用虚构资料和模拟 AI，不需要提供真实密钥。

## 提交问题或修改

- Bug 报告请说明操作系统、Node 版本、复现步骤、预期和实际结果。
- 截图前隐藏姓名、身体资料、英文原文、API Key、授权码及一次性配置码。
- 不提交 `.boji-private/`、真实 `.env`、个人导出文件、录音、运行日志或本机测试截图；`artifacts/` 仅用于本地验证。
- 请保留原始饮食和英语草稿；估算必须标明来源、范围和未知项。
- AI 服务故障不能当作用户答错。不要用演示结果冒充真实 AI 分析。
- 贡献内容须有权按本仓库 MIT 许可分发；第三方内容请注明来源并保留其许可。

项目目前供个人本机运行。公开多用户托管、音频能力评分等尚未完成的能力见 [RELEASE_GATES.md](RELEASE_GATES.md)。
