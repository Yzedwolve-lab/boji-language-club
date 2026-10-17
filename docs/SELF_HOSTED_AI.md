# 个人自托管 AI

V5 启动页提供 **ChatGPT 账号** 和 **API Key** 两种方式，普通本机用户都不需要编辑 `.env`。ChatGPT 方式通过 OpenAI 官方页面登录并授权，API Key 方式保留兼容 OpenAI Chat Completions 的网页配置。凭据由用户自己的服务端私有保存。

适用范围是一个人、一个 Node.js 进程、有持久磁盘的实例。原有练习题与 XP 仍为浏览器中的本地训练状态；V6 支持个人能量参考范围、三餐建议、英文样本反馈、按时长安排任务和食物英文追问。启动连接成功后请到“我的计划”补全资料并明确生成，流程与限制见 [V6_DAILY_PLANS.md](V6_DAILY_PLANS.md)。这不是公开的多用户账户服务，也不代表听说读写全项自动评分。

## 使用自己的 ChatGPT 账号

1. 双击 **启动薄肌俱乐部.cmd**，使用它打开的 `http://127.0.0.1:3100` 页面。启动页默认选择 ChatGPT。
2. 点击 **Continue with ChatGPT**，在 `auth.openai.com` 官方页面登录，核对并允许使用 ChatGPT 套餐。ChatGPT 密码只输入官方页面；本应用不读取你已安装的 Codex 登录文件。
3. 授权完成后返回本机页面。页面明确区分“已登录”和“连接已测试”，不会在回跳时自动发出模型测试。
4. 点击 **连接并测试（使用少量套餐额度）**。应用读取该账号的可用模型，默认采用列表中的第一个可用项；也可展开“模型设置”选择。测试只发送短文本，不发送身体资料或英语样本。
5. 测试通过后继续四步入会。之后仍由你确认是否发送资料、生成计划或分析食物；普通刷新不会重发模型测试。

这条路径不需要 API Key、服务访问口令、一次性配置码或环境变量。符合条件的 Plus／Pro 用户可授权使用套餐中的 Codex／ChatGPT Work 额度；连接应用不会增加一份独立额度。资格及可用模型以官方返回为准。[官方用户说明](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)

页面的 **Manage usage · 管理套餐用量** 打开 [ChatGPT 设置 → Usage](https://chatgpt.com/settings/usage)。达到套餐或应用限额时保留草稿并停止调用；不会自动切换到 API Key。两种连接都已测试且会话有效时，可直接切换当前使用方式，切换本身不调用模型。重新测试或更换模型会明确提示使用套餐额度。

“换一个账号”会重新打开官方授权页，验证完成后才更换活动账号。“断开 ChatGPT”会清除本地令牌并尝试撤销远端可续期会话；远端撤销未确认时页面会提示到 ChatGPT 设置处理。完整撤销入口为 **Settings → Security and login → Sign in with ChatGPT → Disconnect**。[官方会话说明](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)

本版仅在本机 `127.0.0.1` 使用 ChatGPT 登录。请勿改成 `localhost`、远程域名或将此入口暴露给公众。远程 VM 授权转接尚未实现；远程个人部署可继续采用下文的 API Key 路径。付费或远程托管应用需满足官方另行规定的接入要求。[官方适用范围](https://developers.openai.com/siwc/token-sharing-open-source)

## 使用自己的 API Key：双击启动，在网页配置

1. 按 [README](../README.md#本机启动) 安装 Node 与项目依赖，在源码目录双击 **启动薄肌俱乐部.cmd**。启动器会准备本机服务并打开网页；已有正常运行的本机服务会直接复用。
2. 首次启动器生成一次性配置码，通过 URL 的 `#setup=…` 交给页面。页面读取后立即从地址栏移除。不要分享启动链接或配置码。
3. 填写供应商的 **Base URL、模型名称和 API Key**。Base URL 使用供应商文档中的接口根地址，通常以 `/v1` 结尾；应用会追加 `/chat/completions`，模型需要支持 JSON object 输出。
4. 设置一个独立且至少 16 字符的**服务访问口令**，以后用于登录自己的实例。不要把 API Key 当作访问口令。
5. 核对页面显示的目标服务，勾选确认，再点击 **保存并测试 AI**。这会发送一次短请求，可能计费；连接测试不发送身体资料或英语样本。
6. 测试并保存成功后，敏感输入清空，页面继续四步入会。失败会保留当前页输入供重试，不覆盖已保存配置，也不会显示“已连接”。

高级设置可修改每日请求上限和 `max_tokens` / `max_completion_tokens` 参数，请以所选供应商文档为准。HTTP 或无需 Key 的本地模型仅允许显式开启回环接口后的 `localhost`、`127.0.0.1` 或 `::1`；远程接口仍要求 HTTPS 与 Key。修改已保存的接口地址时仍需重新填写 Key。

也可以跳过，选择记录模式或虚构资料体验；跳过不会调用付费 AI。之后仍可从“我的计划”连接自己的 AI。

## API Key 的配置码、登录与修改

首次配置码由本机启动器生成，30 分钟有效。服务器只保存配置码的哈希和创建时间；成功验证供应商并原子保存配置后，配置码被消费。失败可在有效期内重试，但受连接尝试次数和调用额度限制。未获得有效配置码的访问者不能抢先配置实例。

配置码过期、丢失或页面误关时，**再次双击启动器即可重新打开**；服务已运行时无需先关闭。未配置实例会生成新码，之前的码失效。使用 `pnpm dev` 的开发者也可在服务运行后执行：

```powershell
pnpm ai:setup
```

这会自动打开本机配置页，不把配置码打印到终端。页面也提供“输入一次性配置码”或“更换一次性配置码”入口，供手动输入自己启动器提供的码。已有 `ai-config.json` 时不再生成首次配置码。只有旧环境变量、尚无配置文件时，启动器也会准备码，再由服务端判断旧配置是否有效：有效配置仍必须验证当前服务访问口令，配置码不能覆盖它；无效环境配置可以用新码修复。

之后输入服务访问口令并连接。已连接时点击 **修改 AI 配置**，网页只读取地址、模型、额度等概要，API Key 输入框保持空白。保存修改还需要**当前服务访问口令**；同一接口地址下留空 Key 或新口令会保留原值，换 Base URL 必须重新填写 Key。新配置先测试，成功后即时生效，无需重启；旧配置对应的会话失效。

如果旧 Key 已过期、模型不可用或登录会话失效，在连接页输入**当前服务访问口令**，点击 **用口令修改配置**，即可读取概要并填写新 Key；不需要先成功连接旧模型。保存时再次填写当前口令、勾选目标服务确认，再点 **保存修改并测试 AI**。读取概要不调用供应商，也不建立“已连接”会话；只有新配置测试成功并保存后才建立有效连接。忘记服务访问口令不能用供应商 Key 或首次配置码代替。

## 保存在哪里

默认服务器私有目录为项目根目录下的 `.boji-private/`，可用高级环境变量 `BOJI_PRIVATE_DIR` 指定其他私有位置。

| 文件                        | 内容                                                           |
| --------------------------- | -------------------------------------------------------------- |
| `ai-config.json`            | 接口配置、供应商 API Key、加盐 scrypt 哈希形式的服务访问口令   |
| `setup-token.json`          | 一次性配置码的哈希与创建时间                                   |
| `usage.json`                | 每日调用次数、连接尝试时间、会话随机标识与过期时间             |
| `chatgpt/chatgpt-auth.json` | ChatGPT 本机标识、已验证的账号登记、访问/刷新/身份令牌及有效期 |
| `chatgpt/browser.json`      | ChatGPT 浏览器会话的校验信息、选中模型及账号绑定               |
| `chatgpt/usage.json`        | ChatGPT 路径的调用计数和连接尝试限制                           |

**供应商 API Key 和 ChatGPT OAuth 令牌在服务端私有文件中是明文，不是加密保险箱。** POSIX 文件权限设为仅所有者可访问；Windows 依赖操作系统 ACL，应只允许运行服务的账户访问。不要将私有目录放在 `public/`、提交到 GitHub 或打包进源码 ZIP，也不要公开备份。授权链接、回调链接、授权码与配置码也不能写入日志或提交到仓库。

填写期间 Key、口令和配置码临时存在当前页面中，用于同源提交；成功或离开表单后清空敏感输入。它们不写入浏览器 `localStorage`、`sessionStorage`、业务记录或导出文件。配置读取接口不会返回已保存的 Key 或口令哈希，错误不回传原始供应商响应。`.gitignore` 已排除私有目录，但不能清除已提交的秘密。

## 接口与资料发送

所有接口位于 `/api/self-hosted/`。修改请求要求 JSON 和准确的 Origin。API Key 使用 HttpOnly、SameSite=Strict 的 12 小时 cookie，HTTPS 下添加 Secure；其配置恢复可单独验证服务访问口令。ChatGPT 本机会话同样为 HttpOnly，OAuth 临时 cookie 使用 SameSite=Lax 以接收官方回跳；授权码经 PKCE、state、nonce 和身份令牌校验后才能建立本机登录会话。

ChatGPT 端点为 `POST chatgpt/start`、`GET chatgpt/callback`、`POST chatgpt/models`、`POST chatgpt/connect` 与 `POST chatgpt/disconnect`。模型目录来自官方账号接口；只有显式连接测试通过后才标记 connected。`POST select {provider}` 仅选择已有的有效连接，不发出额外测试。营养和计划端点根据当前明确选定的方式调用；失败不会切换到另一种方式。下列原 API Key 端点继续保留：

- `GET status` 不访问供应商。`configured` 只表示配置完整；`connected` 表示当前有效会话曾通过连接测试，不是供应商持续可用的保证。`setup.available` 只说明存在可用的首次配置码，`setup.configuredVia` 为 `file`、`environment` 或 `none`。
- `POST configure` 首次使用 `setupToken`，修改时验证 `currentPassword`，不要求旧供应商仍能连接或旧 cookie 仍有效。接收 `baseUrl`、`model`、`apiKey`、`password` 及可选高级设置；成功测试和保存后返回连接状态并设置会话。失败返回 `{error,message}`。不接受通过空 Key 将旧密钥带到新接口。
- `GET configuration` 需有效会话，只返回 `baseUrl`、`model`、`dailyLimit`、`tokenParameter`、`allowLocal` 和 `hasApiKey`。
- `POST configuration {password}` 使用当前服务访问口令获取同一份安全概要，用于没有有效会话时修复配置；不返回 Key，不调用模型，不签发已连接会话，计入连接尝试限流。
- `POST connect {password}` 发送短 JSON 测试请求，成功后签发会话。`POST disconnect {}` 撤销当前服务端会话并清 cookie；退出后不自动再次请求 AI。
- `POST plan {profile,preferences,englishSample}` 返回带服务端训练日的计划。新增偏好 `energyGoal`、`calculationSex`、`nutritionEligibility`，活动选项增加 `sedentary`。程序返回 `nutrition.energy` 状态、依据、参考区间、三餐预算和资料版本标记；AI 不能改写预算。英文样本不足 20 个词时能力状态为 unavailable；无健康同意不发身体资料。练习分钟数由既有程序预算确定，模型不能改变 XP、分数或完成状态。
- `POST nutrition {food,coverage,clarificationAnswers?}` 返回估算范围、独立熟食假设、英文建议、未识别食物及最多两条澄清问题。补充回答含 `sourceText/question/answer`，累计最多三条，在扣调用额度前验证。未知值保持 null，待回答时无完整每日总量。原文先在浏览器保存；模型估算均要求用户核对，不能当作营养数据库验证或体脂变化证明。

英文正文、所选偏好及经同意的成年健康资料会发送到自己选择的模型服务。没有健康同意时，计划调用不向模型服务商发送身高、体重、年龄、过敏信息和饮食偏好。完整测量历史留在本机；最新体重仅在明确确认生成计划且允许健康建议后作为参考发送，体脂和腰围的测量记录不会发送给模型服务商。服务端不在文件中保存食物原文、英语样本或计划；浏览器保存用户草稿与选择。供应商的数据政策由使用者选择和核对。

## 额度、故障与高级部署

V5.2 修复“列表已有模型，但连接测试仍提示格式错误”的流式回复兼容问题：实测官方服务未返回 Content-Type，最终完成事件的 output 为空，但此前的消息完成事件已携带完整正文。新版读取完整事件流、核对消息身份及文本，仍必须收到最终完成事件并通过 JSON/业务校验。未完成回复、不是 JSON 和业务格式错误现在分别提示；不能只收到部分文字就标记连接成功。

V5.1 修复了“刷新可用模型”或“连接并测试”显示“ChatGPT 返回的结果不完整或格式不正确”的已知问题：官方模型目录含额外元数据，实测约 569 KB，超过旧版误设的 128 KB 限制。现在目录独立限制为 2 MiB，解析失败明确提示“模型列表”错误。此问题发生在读取列表阶段，不能据此判断套餐额度不足；更新并重启服务后刷新页面即可重试，无需重新登录。目录读取成功仍不等于模型连接测试成功。

连接失败时，页面会区分服务商认证、访问权限、模型或接口、参数、额度、限流、网络和超时错误，只显示固定说明，不回显供应商的原始错误或密钥。HTTP 429 仅根据明确的服务商错误代码区分额度与限流；无法识别的代码不能证明余额充足或不足。模型名称请从供应商文档复制，保持大小写；OpenAI 新模型可在高级设置选择 `max_completion_tokens`。本应用的 API Key 调用按供应商 API 计费，具体余额和权限应在供应商控制台核对。

如果刷新页面后再次出现“输入一次性配置码”，无需自行设置这个码，也不要填 API Key。重新双击桌面或项目里的启动器，在它新打开的页面继续。启动器会自动传入新码，旧码随之失效。

两种路径各自持久保存调用计数，默认每天最多 40 次请求，按 UTC 日计算；每 15 分钟最多 6 次连接尝试。每次模型请求在发出前占用本机额度，即使供应商超时、报错或输出未通过校验也不退还。API Key 默认每次最多 3,200 输出 token、20 秒超时；ChatGPT 使用独立的流式请求及超时/响应大小限制。次数限制不是金额或套餐余额保证：API Key 预算在供应商控制台设置，ChatGPT 用量在官方 Usage 页面管理。

私有文件采用原子替换，同一 Node 进程内串行预留额度；重启保留计数和会话撤销状态。文件无法读写或损坏时停止调用，不自动恢复成无限额度。不要删除计数文件来重置额度；系统时钟倒退不会重置当日计数。

高级环境变量仍兼容：复制 `.env.example` 为 `.env.local`，设置 `APP_MODE=self_hosted`、`ENABLE_OPENAI_COMPATIBLE=true`、`OPENAI_COMPAT_BASE_URL`、`OPENAI_COMPAT_API_KEY`、`OPENAI_COMPAT_MODEL` 和 `BOJI_SELF_HOSTED_PASSWORD`。有效网页配置文件优先于环境变量；无配置时默认记录/演示模式。`APP_MODE=production` 会拒绝个人配置，不能绕过公众服务门槛。环境变量修改需重启；网页保存成功则即时生效。

本机默认 origin 为 `http://127.0.0.1:3100`。以下远程说明仅适用于 **API Key**。远程服务器需 HTTPS、访问控制和私有持久磁盘。网页首次配置会验证并保存当前网站 origin，**无需设置 `BOJI_SELF_HOSTED_ORIGIN`**；只有使用高级环境变量兼容方式时才设置该变量。`localhost` 与 `127.0.0.1` 是不同 origin，不可混用。首次远程设置由运营者在受信任服务器执行以下命令，取得仅供自己打开的一次性 URL；输出含敏感配置码，不要放进公共日志：

```sh
node scripts/prepare-launch.mjs --origin https://自己的域名
```

此文件方案不支持多实例、多个 Node worker 或无持久磁盘的 serverless 环境。那些部署需要共享数据库中的会话和原子额度，以及多用户认证授权。GitHub Pages 无法运行本项目的 Node API。公众多用户服务另见 [RELEASE_GATES.md](../RELEASE_GATES.md)。

浏览器网络模拟和本地假供应商测试不能代替真实模型验证。V5.1 实测官方模型目录读取，V5.2 在同一已授权账号上完成 GPT-6-Astra 的真实最短连接测试；没有发送真实营养/英语计划请求，也没有调用 API Key 模型。用户仍需在自己的页面点击连接测试，以建立当前浏览器连接状态。API Key 路径不限定供应商必须是 OpenAI，只要求兼容已实现的接口合同；ChatGPT 套餐路径固定使用官方 OAuth 与 Responses 接口。[API 说明](https://developers.openai.com/api/reference/overview)、[ChatGPT 模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
