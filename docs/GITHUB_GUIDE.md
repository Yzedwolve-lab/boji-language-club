# GitHub 下载、更新与分享指南

薄肌语言俱乐部采用 [MIT License](../LICENSE)。你可以下载、使用和修改源码；每个人独立运行、连接自己的 AI。GitHub 不提供本项目的运行后端或免费模型额度。

## 第一次下载

不需要先学习 Git：点击 [直接下载 ZIP](https://github.com/Yzedwolve-lab/boji-language-club/archive/refs/heads/main.zip)，或在 [仓库首页](https://github.com/Yzedwolve-lab/boji-language-club) 点击 **Code → Download ZIP**，把压缩包完整解压到自己容易找到的文件夹。

Windows 安装 [Node.js LTS](https://nodejs.org/en/download)（22 或更高版本），在解压目录的资源管理器地址栏输入 `powershell` 并回车，执行：

```powershell
npm.cmd install --global pnpm@11.25.0
pnpm.cmd install --frozen-lockfile --ignore-scripts
```

然后双击 **启动薄肌俱乐部.cmd**。首次会构建应用，成功后自动打开 [本机页面](http://127.0.0.1:3100)。启动窗口需要保持运行；按 Ctrl+C 停止。后续无需重复安装依赖，直接双击启动即可。

熟悉 Git 的用户可以克隆：

```sh
git clone https://github.com/Yzedwolve-lab/boji-language-club.git
cd boji-language-club
```

然后安装依赖并启动。macOS / Linux 和完整命令行启动步骤见 [README](../README.md#本机启动)。这些系统的启动命令已提供，但尚未完成各平台安装验收。

## 选择自己的 AI

- **ChatGPT 账号**：点 **Continue with ChatGPT**，仅在 OpenAI 官方登录页输入账号信息。授权返回后点 **连接并测试**，测试通过再继续入会。模型与额度按官方实际授权结果使用。本版仅允许 `127.0.0.1` 本机登录。
- **API Key**：填供应商文档中的 Base URL、模型名称和自己的 API Key，再设置独立的服务访问口令（至少 16 个字符）。核对目标服务，点击 **保存并测试 AI**。需要兼容 Chat Completions 和 JSON 输出的模型。
- **先体验**：选择虚构资料体验或记录模式，跳过连接不会调用 AI。

测试和后续 AI 请求会使用相应套餐额度或按供应商 API 规则计费。ChatGPT 账号与 API Key 是两种接入方式，不会因为其中一种失败而自动改用另一种。项目作者不会提供或承担访客的模型额度。

首次 API Key 配置码由本机启动器生成，**不是 API Key，也不用自己设置**。要求重新输入配置码时，再次双击启动器，或保持命令行服务运行并执行 `pnpm ai:setup`。

连接成功后，到 **我的计划** 补全适用资料与英文样本，确认发送内容，点击 **生成 / 更新 AI 计划**。具体步骤见 [README](../README.md#连接后开始第一天)；配置字段、失败重试和私有保存方式见 [SELF_HOSTED_AI.md](SELF_HOSTED_AI.md)。

## 更新版本

先在应用内导出需要保留的记录，再停止本机服务。浏览器记录与服务端配置分开保存：前者属于当前浏览器与站点地址，后者在自己的私有目录内。不要将包含私人文件的整个目录重新打包分享。

使用 Git 克隆且没有本地修改时，在项目目录执行：

```sh
git pull --ff-only
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
```

再按原来的方式启动。自己修改过源码时，先保存修改，再处理合并，避免覆盖自己的工作。

ZIP 用户可以下载新版并解压到新目录，按首次安装流程启动；新目录中的 AI 需要重新连接。继续使用原来的浏览器和 `http://127.0.0.1:3100`，不要清除浏览器存储。保留原目录，确认记录与新版正常后再自行整理。

## 常见问题

| 情况                            | 怎么处理                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 双击后只有几行代码              | 确认运行的是 **启动薄肌俱乐部.cmd**，不是 `.ps1`、`.mjs` 或源码文件。也可在项目目录的 PowerShell 执行 `cmd /c .\启动薄肌俱乐部.cmd`。 |
| 提示 `Dependencies are missing` | 先在项目目录运行 `pnpm.cmd install --frozen-lockfile --ignore-scripts`，完成后再双击。                                                |
| 找不到 Node / npm / pnpm        | 安装 Node.js 22+ 后重新打开终端；按首次安装步骤安装 pnpm。                                                                            |
| 页面仍是旧版本                  | 停止旧启动窗口，重新启动后按 Ctrl+F5。启动器会复用正在运行的服务，所以更新时要先停止旧服务。                                          |
| 显示已登录，仍不能生成计划      | 登录和模型连接测试是两步；先完成 **连接并测试**，再在 **我的计划** 明确生成。                                                         |
| 一天只吃了一餐，显示部分记录    | 其他餐可留空；确认全部记录后勾选 **今天吃的都记完了（一餐也可以）**，再点击 AI 解读。                                                 |
| AI 连接失败                     | 依据页面提示检查账号授权、接口地址、可用模型、余额/额度与网络。不要把错误一律当成余额不足；保留输入后重试。                           |

## 分享视频时，观众怎么使用

把 [仓库首页链接](https://github.com/Yzedwolve-lab/boji-language-club) 放到视频简介，指引观众依次完成“下载 ZIP → 安装依赖 → 双击启动 → 连接自己的 AI”。推荐同时链接 [从这里开始](../START_HERE.md)。

可使用这段简短说明：

> 薄肌语言俱乐部：在自己的电脑记录饮食、练英语、升级俱乐部卡。源码公开，可用自己的 ChatGPT 账号或 API Key；模型额度由各自账号提供。到仓库看 README，下载后按步骤启动。

录屏时避免展示 API Key、服务访问口令、一次性配置码、授权/回调链接和个人资料。反馈问题时可在仓库的 Issues 描述复现步骤、系统与错误提示，先删除截图和日志里的私人内容。

## 源码公开与网站部署

源码可公开，不代表此版本已是多人在线服务。**GitHub Pages 只能托管静态内容，无法运行本应用的 AI 服务端、认证和私有存储。**

当前个人版需要单个 Node.js 进程与持久私有磁盘。远程个人运行使用 API Key，并按 [自托管说明](SELF_HOSTED_AI.md) 配置 HTTPS、准确 origin 与访问控制；ChatGPT 远程授权转接尚未实现。多实例、无持久磁盘的 serverless 环境及公众多人服务需要继续改造和验收，见 [RELEASE_GATES.md](../RELEASE_GATES.md)。

向自己的 Fork 提交修改前，检查文件列表：包含源码与 `.env.example`，不含 `.boji-private/`、真实 `.env`、个人导出记录、录音、依赖和构建文件。`.gitignore` 不能清除已经进入提交历史的秘密；若曾泄露，先撤销对应授权或密钥，再处理历史。
