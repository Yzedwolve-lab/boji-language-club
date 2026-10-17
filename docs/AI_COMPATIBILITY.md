# 自带 AI：ChatGPT 套餐与 API Key

## V6 计划与营养协议

两种 provider 共用同一规划和营养 schema。个人模式的能量范围由 `energy-plan.ts` 生成，AI 只能据此建议三餐搭配与份量，不能输出自己的数字热量/宏量目标。每餐显示计划预算而非实测营养；任务分钟数由程序固定。全计划版本键标记过敏、偏好、英文样本等修改，能量版本键单独验证计算资料。详情见 [V6_DAILY_PLANS](V6_DAILY_PLANS.md)。

营养请求允许独立的 `clarificationAnswers`（累计最多三条），输出包含最多两条 `clarificationQuestions`、`analysisState` 及独立 `preparationAssumption`。已吃的常见食物默认熟食；必要歧义追问英文。输入及原文证据先验证，再预留调用额度；结果按原文、全天确认和回答快照绑定。未知热量或待追问不能通过数值计划审核，模型不能直接写完成标记。UI 向外取整显示粗略区间，内部原区间用于比较。

V6 改变的是个人模式的计划审核。浏览器进度不是公共可信账本，原多用户 `/api/v1` 仍为记录模式；真实记录的保存始终不因摄入高低被阻止。V6 测试使用模拟服务，未向真实服务发送个人资料。

V5 在启动页新增 **Continue with ChatGPT**，同时保留 V4 的兼容接口、模型、API Key 和访问口令配置。两种方式都由用户自己的服务端持有凭据，客户端只取得本应用会话和安全状态。步骤见 [SELF_HOSTED_AI.md](SELF_HOSTED_AI.md)。V5 初始验证使用模拟服务；V5.1 在用户自行授权后实测官方模型目录；V5.2 实测 GPT-6-Astra 最短连接请求通过。实际营养/英语计划质量与其他模型仍待验证。

没有配置时保持记录/演示模式。有效网页配置保存后会自动启用独立个人模式，无需手动设置环境变量；显式 `APP_MODE=production` 仍禁止个人配置。营养和计划请求需要通过会话、origin 与持久额度校验。原多用户 `/api/v1/fitness/analyze` 仍返回记录模式，现有写作 Responses 适配器保持独立。

## V5 ChatGPT 官方接入

- `chatgpt-auth.ts` 使用官方公开客户端动态登记、PKCE S256、一次性 state/nonce 和本机回调。先保存官方发回的 client ID，再兑换授权码；通过 OpenAI JWKS 验证签名、issuer、audience、有效期和身份后才替换当前账号。刷新串行执行并原子保存轮换令牌，失败的账号更换保留原连接。[官方登记流程](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- `chatgpt-service.ts` 和 `chatgpt-app-store.ts` 将已验证账号与本应用浏览器会话绑定，明确区分登录、套餐授权和连接测试。只允许本机 `127.0.0.1`，不读取 Codex 的私有登录文件，不要求用户输入 ChatGPT 密码或 API Key。
- `chatgpt-client.ts` 从 `GET https://api.openai.com/v1/models` 读取账号模型目录，保留官方顺序和 `visibility: "list"` 项；默认选择首个可用模型，可由页面选择其他项。目录允许最多 2 MiB，超过限制或结构不合法返回独立的目录错误；不持久保存目录中的额外元数据。模型列表不等于已测试模型能力。
- 推理固定请求 `POST https://api.openai.com/v1/responses`，带 `store:false`、`stream:true`，等到 `response.completed` 才接受完成结果。V5.2 兼容实测遇到的缺失 Content-Type 和完成事件中空 output：按有界 SSE 解析，从已完成的 `response.output_item.done` 重建正文并核对相应文本事件。显式非 SSE 类型、相互矛盾的事件、响应中断、incomplete、failed 或格式/范围校验失败仍保留原记录，不用模拟结果替代。没有使用 ChatGPT 私有 `backend-api`。[官方模型与推理说明](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- OAuth 令牌与刷新令牌保存在 `.boji-private/chatgpt/chatgpt-auth.json`；浏览器会话校验与模型状态在同目录 `browser.json`，调用计数在 `usage.json`。令牌不进入浏览器存储、业务导出、源码或日志；授权和回调链接也不得记录。没有增加依赖或复制第三方实现代码。

套餐调用要求 `resource.invoke` 与 `chatgpt.tokens.use.direct` 授权，身份登录本身不足以调用模型。用户回到页面后仍需明确点击短连接测试。符合条件的 Plus／Pro 用户使用既有 Codex／ChatGPT Work 额度，可在 [ChatGPT Usage](https://chatgpt.com/settings/usage) 管理；不是新的免费额度。API Key 路径仍按对应供应商的 API 规则计费。[官方套餐说明](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)

本版没有接入套餐音频、视频或任意工具调用，也没有实现远程 VM 授权转接。付费或远程托管应用需满足官方额外接入要求；当前实现不能被描述为公开多用户服务。[官方适用范围](https://developers.openai.com/siwc/token-sharing-open-source)、[当前能力限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

已测试且会话有效的连接可通过 `POST /api/self-hosted/select` 切换，不再次测试模型。当前选择的供应商出错时不会自动切换到另一种付费/额度来源。

## 保留的 API Key 兼容接口边界

- `src/lib/server/openai-compatible.ts`：固定的服务端配置、Chat Completions JSON 请求、单次调用、20 秒默认超时（可设 1–35 秒）、3,200 输出 token 上限、64 KB 响应字节上限、Zod 输出校验、关闭自动重定向、不暴露原始供应商错误。
- `src/lib/server/nutrition-adapter.ts`：把英文状态/建议改写与食物识别分开；保留 `originalFood`，每项保留原文证据、份量、单位、份量假设、生/熟状态与营养区间。无法确定的营养值为 `null`。
- 估算统一标记 `basis: "model_estimate"`，不能伪称食物数据库查询结果。未知食物进入 `unresolvedFoods`；`knownSubtotal` 只包含已知项，完整 `recordedTotals` 在相关项未知时保持 `null`；只有用户声明完整记录且营养项全部可估算时才给出 `dailyTotals`。这些仍是模型估算，不能据此颁发营养“优秀”、处方或 XP。
- 语言输出为 `english`、`needs_revision` 或 `uncertain`。可能的拼写错误以精确原文片段给出建议；原文不被改写。供应商异常为系统错误，不能计作英文错误。
- `openAICompatibleStatus()` 仅返回 `disabled` / `unavailable` / `configured` 和协议名称；没有网络请求，不代表连接测试成功，也不返回密钥、模型、端点。

## 高级环境变量配置

普通使用者通过启动页面配置。以下环境变量保留给高级部署，网页保存的有效配置文件优先；变量只置于服务端 `.env.local` 或 secret store，不得改成 `NEXT_PUBLIC_*`、放入浏览器存储或提交 Git。示例文件默认关闭。

```dotenv
ENABLE_OPENAI_COMPATIBLE=false
OPENAI_COMPAT_BASE_URL=https://provider.example/v1
OPENAI_COMPAT_API_KEY=
OPENAI_COMPAT_MODEL=
OPENAI_COMPAT_TIMEOUT_MS=20000
OPENAI_COMPAT_TOKEN_PARAMETER=max_tokens
OPENAI_COMPAT_ALLOW_LOCAL=false
```

Base URL 是 API 根路径，代码追加 `/chat/completions`，不要填完整 completion 端点。外部地址必须 HTTPS，不允许 URL 中的用户名、密码、查询串或 fragment。网页首次设置必须验证一次性配置码，修改已有设置必须验证当前访问口令；旧供应商失效时无需先建立旧连接。未授权请求不能发起模型测试。个人服务使用专用 transport，每次调用解析 DNS，拒绝私网/保留地址，将实际连接固定到验证过的 IP，并禁止重定向。更换端点必须重新填写 Key，不能把旧 Key 自动带到新地址。

只在明确的本地自托管测试中设置 `OPENAI_COMPAT_ALLOW_LOCAL=true`，允许 `localhost`、`127.0.0.1` 或 `[::1]` 的 HTTP / 无 key 接口；该开关不允许任意内网地址。共享云部署不要把此项当成允许用户访问内部服务的功能。

`OPENAI_COMPAT_MODEL` 由运营者选择，不设默认付费模型。兼容服务必须实测支持 `POST /chat/completions`、`messages`、`stream:false`、JSON object response format 及一个明确的输出 token 限制参数。默认发送 `max_tokens`；模型需要另一参数时设 `OPENAI_COMPAT_TOKEN_PARAMETER=max_completion_tokens`。不支持 JSON mode 或响应结构不同的服务会明确失败，不会悄悄用模拟结果替代。宣称“OpenAI 兼容”不等于所有模型均已通过本项目验证。

本适配器采用通用 JSON mode，再由应用执行严格 Zod 校验。OpenAI 官方说明 `json_object` 保证的 JSON 格式与 schema 一致性不是同一保证；支持时可以进一步采用 Structured Outputs，但本轮没有假定所有兼容供应商支持它。[官方 Chat Completions 文档](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)（2026-10-15 查阅）。

## 调用接口与下一步接线

```ts
import { analyzeNutritionWithCompatibleAI } from "@/lib/server/nutrition-adapter";

// 仅限服务端。调用前必须完成以下流程：
// 1. 已认证用户及日志所有权校验；保存不可变原始 food 记录。
// 2. 告知实际供应商和发送字段，记录用户对这次用途的同意。
// 3. 建立幂等 job，并在服务端预留实际供应商费用/配额。
const result = await analyzeNutritionWithCompatibleAI({
  food: savedOriginalFood,
  coverage: "partial",
});
// 将结果与原始日志/attempt 版本关联。失败保持原始日志与待审状态。
// 重试必须由 job/预算层控制；适配器不会自动重试或自动退款。
```

个人 UI 已要求用户核对份量和假设，并区分局部与全天记录。原多用户接口的后续接线仍需完成相同要求。总量由程序对各项区间相加，模型无权写入总热量、分数、XP 或通过标记。范围端点仅为模型估计区间，没有经过统计校准，不应标记成置信区间。

个人自托管方式已经选定并实现；托管公众密钥、多用户账户服务未在本轮开放。发布 GitHub 源码本身不会提供 AI 运行额度。用户可以自行完成 ChatGPT 套餐授权，也可以配置有权限的模型 API 账号；不得把一个开发者的凭据附在源码中供所有人使用。

公开接线还需要：用户级限额与全局硬预算、去重及幂等队列、保留/删除策略、真实供应商能力与故障测试、提示注入质量评估、模型营养估算与可靠营养数据库的后续对照。没有真实营养数据库时必须一直展示模型估算来源；不得伪造数据库 food ID 或假装营养目标已经过审核。

## 验证方式

执行：

```powershell
pnpm exec vitest run src/lib/server/openai-compatible.test.ts src/lib/server/nutrition-adapter.test.ts
pnpm exec vitest run src/lib/server/chatgpt-auth.test.ts src/lib/server/chatgpt-client.test.ts src/lib/server/ai-connection-service.test.ts
```

测试使用模拟 transport，覆盖默认关闭、配置校验、本地例外、密钥不外泄、超时与中断响应流、输入/响应大小边界、错误/拒绝/截断/坏 JSON/schema 拒绝、原文保留、拼写提示、未知营养不归零、份量假设、生熟信息及确定性求和。ChatGPT 测试另覆盖一次性登录事务、JWT 验证、刷新轮换、账号绑定、流式完成/失败、模型目录、切换与退出。实际执行结果统一见 [QA_MATRIX.md](QA_MATRIX.md) 和 [RELEASE_GATES.md](../RELEASE_GATES.md)；模拟验证不能代替实际账号授权、套餐资格或供应商能力验收。
