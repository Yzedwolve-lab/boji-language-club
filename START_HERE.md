# 从这里开始

欢迎来到 **薄肌语言俱乐部**。这是可以在自己电脑运行的应用源码；每个人使用自己的 ChatGPT 账号或 API Key。

## 我想直接使用

Windows 首次安装：

1. 在 GitHub 点击 **Code → Download ZIP**，下载后完整解压。
2. 安装 [Node.js LTS](https://nodejs.org/en/download)，选择 22 或更高版本。
3. 在解压目录的资源管理器地址栏输入 `powershell`，回车后执行：

   ```powershell
   npm.cmd install --global pnpm@11.25.0
   pnpm.cmd install --frozen-lockfile --ignore-scripts
   ```

4. 双击 **启动薄肌俱乐部.cmd**，等待首次构建完成、浏览器自动打开。
5. 在网页选择 **ChatGPT 账号** 或 **API Key**，按提示连接并测试；也可先用虚构资料体验。

以后双击启动文件即可。保持启动窗口运行，不需要编辑 `.env`。如果双击后只看到代码，确认打开的是 `.cmd` 文件，并使用“打开”而非编辑器；也可在该目录的 PowerShell 输入 `cmd /c .\启动薄肌俱乐部.cmd`。

完整步骤、其他系统和第一天的用法见 [README](README.md)。下载、更新和常见问题见 [GitHub 使用指南](docs/GITHUB_GUIDE.md)。

## 我想了解或修改代码

- [PROJECT_SPEC.md](PROJECT_SPEC.md)：原始产品规格，部分功能仍是规划。
- [AGENTS.md](AGENTS.md)：仓库开发约束与数据边界。
- [QA_ACCEPTANCE.md](QA_ACCEPTANCE.md)：验收要求，不是测试通过报告。
- [docs/QA_MATRIX.md](docs/QA_MATRIX.md) 与 [RELEASE_GATES.md](RELEASE_GATES.md)：实际验证证据与未完成项。
- [SOURCES.md](SOURCES.md)：外部依据与产品默认的区分。
- [.agents/skills/](.agents/skills/)：本项目的开发工作流程，不是远程 AI 服务。

最初的 `PACKAGE_MANIFEST.json` 仅描述原始交接规格包，不代表当前全部源码。当前版本以仓库源码和 README 为准。

**不要将 `.boji-private/`、真实 `.env`、个人健康/学习记录、录音或授权链接上传到公开仓库。** 本版推荐个人使用；GitHub Pages 不能运行完整的 AI 服务。
