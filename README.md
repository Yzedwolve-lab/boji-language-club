# 薄肌语言俱乐部 · Boji Language Club

把饮食记录变成英语练习，把每日坚持变成会员卡经验。一个中文为主、带一点英文梗和 emoji 的个人训练应用。

你可以用自己的 **ChatGPT 账号或 API Key** 生成饮食参考计划与英语任务，也可以先用虚构资料体验。每个人在自己的电脑运行、连接自己的 AI；本仓库不提供共享账号或免费模型额度。

[GitHub 仓库](https://github.com/Yzedwolve-lab/boji-language-club) · [直接下载 ZIP](https://github.com/Yzedwolve-lab/boji-language-club/archive/refs/heads/main.zip) · [从这里开始](START_HERE.md)

## 能做什么

- **薄肌**：英文记录饮食，AI 给出粗略热量区间、熟食等假设与必要追问；按全天总量核对个人参考范围。一日只吃一餐也能记录，不要求填满三餐。
- **语言**：根据英文样本和每天可用时间生成任务，配合词汇、听力、阅读、写作、口语练习与复盘。
- **俱乐部**：薄肌用户 → 薄肌会员 → 薄肌股东 → **薄肌教父**；目标称号与卡片材质独立，完成双模块后领取经验。
- **自己的记录**：保留草稿与历史、体重等实际测量、个人分享卡和数据导出；服务失败不会把演示回应冒充真实 AI。

## 本机启动

### Windows：第一次安装

1. 点击 [下载 ZIP](https://github.com/Yzedwolve-lab/boji-language-club/archive/refs/heads/main.zip)，或在仓库页面选择 **Code → Download ZIP**，下载后**完整解压**。不要在 ZIP 内直接启动。
2. 安装 [Node.js LTS](https://nodejs.org/en/download)（版本 **22 或更高**）。安装完成后重新打开终端。
3. 进入解压后的文件夹，在资源管理器地址栏输入 `powershell` 并回车，依次运行：

   ```powershell
   npm.cmd install --global pnpm@11.25.0
   pnpm.cmd install --frozen-lockfile --ignore-scripts
   ```

4. 双击文件夹里的 **启动薄肌俱乐部.cmd**。首次启动会构建应用，完成后自动打开 [本机页面](http://127.0.0.1:3100)。

以后直接双击启动文件即可，**不需要编辑 `.env`**。服务运行时保持启动窗口打开；按 **Ctrl+C** 停止。首次安装需要联网下载依赖，启动器本身不会安装依赖。

### macOS / Linux，或使用命令行

安装 Node.js 22+ 后，在项目目录执行：

```sh
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm start
```

保持该终端运行，另开一个终端，在同一目录执行：

```sh
pnpm ai:setup
```

它会通过系统默认浏览器打开本机配置页。开发时可用 `pnpm dev` 代替构建与启动。本项目验证以 Windows 为主，尚未对 macOS / Linux 各发行版完成安装验收。

## 连接自己的 AI

| 方式             | 页面上怎么做                                                                                     | 用量与条件                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **ChatGPT 账号** | 点 **Continue with ChatGPT** → 在官方页面授权 → 回来点 **连接并测试**                            | 使用账号获准的套餐额度；资格、模型和可用额度以官方返回为准。本版仅支持本机 `127.0.0.1` 登录。 |
| **API Key**      | 切换到 API Key → 填供应商的 Base URL、模型名称、Key → 设置自己的服务访问口令 → **保存并测试 AI** | 支持兼容 OpenAI Chat Completions 且支持 JSON 输出的接口；费用按供应商规则计算。               |

连接测试只发送一段短文本。生成计划、分析饮食等请求会使用相应额度；切换连接不会自动换一种计费方式重试。ChatGPT 账号登录不等于获得 API Key 额度。

API Key 的一次性配置码由启动器自动准备，不用自己编。如果页面要求配置码，再次双击启动器；命令行用户保持服务运行并重新执行 `pnpm ai:setup`。

详细说明：[个人自托管 AI](docs/SELF_HOSTED_AI.md) · [接口兼容说明](docs/AI_COMPATIBILITY.md)

## 连接后，开始第一天

1. 完成入会，在 **我的计划** 填写身高、体重、活动程度等适用资料，并提交至少 20 个英文单词的真实样本。
2. 核对将发送的资料，点击 **生成 / 更新 AI 计划**。程序计算能量参考范围；AI 建议食物组合、份量与英语任务。连接成功后不会自动生成计划。
3. 在 **薄肌** 用英文记录真实食物、饮料和零食；重要信息不清楚时回答英文追问。今天只吃一餐就填一餐，其余留空。
4. 记录完整后，勾选 **今天吃的都记完了（一餐也可以）**，明确点击 AI 解读，核对结果并填写英文复盘。数值计划要求全天估算区间落入参考范围；不满足时仍保存记录，并说明原因。
5. 在 **语言** 完成当天任务，双模块完成后领取经验。

训练日期统一按**北京时间每天凌晨 3 点**刷新，无需选择时区；电脑在境外也沿用同一规则。旧版本的档案会自动适配，保留历史记录与已获得的经验。

不想提供身体资料时，可以选择仅记录模式。数值计划当天启用后，断开 AI 或切换模式不会跳过审核；资料和饮食修改后需要重新核对。更多规则见 [每日计划说明](docs/V6_DAILY_PLANS.md)。

## 当前边界与数据

这是 **个人本机 / 自托管版本**，需要单个 Node.js 进程和可持久写入的私有磁盘。公众多用户账户、完整音频自动评分和动态课程服务尚未完成。现有固定英语练习明确标为演示，活动完成分不代表真实考试成绩；缺少音频证据时不会推断发音或流利度。

饮食范围属于产品规划估算，AI 热量也只是估算，不能证明营养达标、体脂下降或保证减脂日期。真实记录无论高低都会保留；低摄入、低体脂或补偿运动不获得额外经验。公式依据及产品默认见 [SOURCES.md](SOURCES.md)。

学习记录保存在当前浏览器，录音保存在本机浏览器存储；清除浏览器数据可能丢失记录。AI 凭据由自己的服务端保存到 `.boji-private/`，其中的 Key 和授权令牌不是加密保险箱。**不要上传该目录、真实 `.env`、个人导出记录或登录链接**。提交给 AI 的内容会发送给你选定的服务商，发送前请核对页面提示。详见 [数据与凭据说明](docs/SELF_HOSTED_AI.md#保存在哪里)。

## GitHub 与部署

**下载源码后在自己的电脑运行，是本版推荐的使用方式。GitHub Pages 无法运行这个完整应用。** 本项目需要服务端 API；上传仓库不会自动得到在线服务，也不会把项目作者的 AI 分享给访客。

远程个人服务器目前使用 API Key 路径，需要 HTTPS、准确的 origin、访问控制和持久磁盘；不能直接套用多实例或无持久磁盘的 serverless 部署。公开提供多人在线服务前，还需完成 [发布门槛](RELEASE_GATES.md)。

[下载、更新与分享指南](docs/GITHUB_GUIDE.md) · [服务器配置](docs/SELF_HOSTED_AI.md) · [后端说明](docs/BACKEND.md)

## 开发与验证

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm test
node --test tests/launcher.test.mjs
pnpm exec playwright install chromium
pnpm test:e2e
```

本项目使用 Next.js、React、TypeScript、Vitest 和 Playwright。源代码位于 `src/`，数据库草案位于 `supabase/`，浏览器测试位于 `tests/e2e/`。

实际验证记录与未完成项：[QA 矩阵](docs/QA_MATRIX.md) · [发布门槛](RELEASE_GATES.md) · [实现说明](IMPLEMENTATION_PLAN.md)。历史原始日志和截图仅在维护者本机留存，不随源码发布。模拟 AI 测试不等于对真实营养质量或全部服务商完成验收。原始需求和验收要求保留在 [项目规格](PROJECT_SPEC.md) 与 [验收清单](QA_ACCEPTANCE.md)，它们不是已全部实现的功能承诺。

## 许可证

原创代码与内容采用 [MIT License](LICENSE)，版权主体为 Boji Language Club contributors。第三方依赖遵循各自许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。练习材料为原创演示内容，本项目与所提及的考试机构及 AI 服务商无官方隶属关系。
