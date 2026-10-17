# 服务端交付与明确边界

本次交付包含可执行的 Next.js API、数据库迁移、原创 seed、mocked transport 测试和实际 PostgreSQL WASM 数据库测试。**这不是已完成生产验收的多用户服务**：没有创建远程 Supabase、没有连接私人 PTE 数据库、没有调用收费模型、没有部署。migration 与 seed 已在一次性 PGlite 内存 PostgreSQL 中执行，但未在真实 Supabase 环境执行。

## 运行模式

`APP_MODE=demo` 是默认值。`POST /api/onboarding` 重复完整资料校验并返回 `{profile}` 或 `{errors}`，不创建账户。其他 `/api/v1/*` 接口返回明确的 production unavailable。浏览器演示状态不构成真实 XP 钱包或账号权限。

2026-10-18 起，个人版入会资料与 AI 计划统一使用 `Asia/Shanghai`（北京时间），训练日仍以北京时间 03:00 为界。服务端忽略旧客户端提交的时区字段，先规范化再校验；AI 计划的 `forDate` 也由程序按该固定边界计算，不依赖浏览器或宿主机时区。页面不再提供时区选择。

`APP_MODE=production` 要求 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`；缺一则拒绝提供生产服务。服务端文件导入 `server-only`。秘密不得使用 `NEXT_PUBLIC_*`。前端生产登录、会话恢复和完整 API 接线仍是上线门槛，页面在该模式下显示服务尚未开放。

每次请求要求 `Authorization: Bearer <access_token>`，调用 Supabase Auth `/auth/v1/user` 验证会话；不信任客户端解码的 JWT、owner ID、分数或时间。用户读取使用原用户 JWT，并加 `user_id` 条件；数据库 RLS 再限制所有者。答案与 provider secrets 不进入公开课程响应。特权写入由服务端绑定已验证 UID，浏览器不能直接写评估或钱包。

## API 清单

所有以下路径均以 `/api/v1` 开头。JSON 的未知字段会被可变输入 schema 拒绝。

| Method / path | 已实现行为 | 当前限制 |
|---|---|---|
| POST `/onboarding` | 重复 Profile 校验、成人门槛、幂等创建 profile/自报成绩/目标/同意记录；新档案固定北京时间 | 不含注册或登录 UI；历史生产档案不由重复入会改写 |
| GET `/me/dashboard`、`/activity/current` | 服务端跨日，返回本人公开题干、原稿、评估 | 固定原创 seed；未实现动态课程生成 |
| POST `/activity/:id/claim`，body `{}` | 用户 JWT 调用事务结算；不接受 xp/passed/owner/time | 必须先真实完成全部项目；当前音频门槛阻止完整生产领取 |
| GET `/history` | 最近 100 个训练期/结算/账本，显式给出导出入口 | 尚无 UI 分页 |
| POST `/language/tasks/:id/submit` 或 `/retry` | 保存不可变尝试，客观题在服务端判分；写作可调用真实适配器 | `answer`、UUID `requestKey`，写作还需 `providerConsent:true`；重试使用新 requestKey |
| GET `/jobs/:id` | 仅本人 job 状态 | 无已部署后台 worker |
| POST `/fitness/analyze` | 保存真实 `food`/`exercise` 原文及覆盖范围，返回 tracking_only | USDA/语义解析未配置，营养及消耗 null |
| POST `/fitness/complete` | 简单英文日志识别、确认反馈与假设、英文反思，记录习惯质量 | 词典识别范围有限；未知词保留原文并待复核；不按摄入或体脂发奖 |
| GET `/feedback/:period` | 只在不可变成功结算证据存在时解锁完整答案，并记录已揭示 | 解锁时点比规格的“语言通过后”更保守：目前需先结算 |
| POST `/plans/preview` | 服务端拒绝 >40%；缺基线返回 calibrating，日期 null | 真实预测/原子确认未实现；`/plans/confirm` 返回 unavailable |
| POST `/recordings/upload-intent` | 明确 unavailable | 扫描、真实格式/时长验证、解码、评分及保留期 worker 完成前禁止上传 |
| POST `/me/export` | 分页读取本人数据；超大数据不伪称完整导出 | 包含音频元数据，不包含音频二进制；非跨表一致性快照，生产需背景导出 |
| DELETE `/me` | body `{"confirmation":"DELETE MY ACCOUNT"}`；标记删除、取消 jobs、清私有对象、删除 Auth 用户级联数据 | 真实 Auth/Storage 失败恢复与备份/第三方保留政策未验收 |

原始 food/activity 记录不因热量高低、缺体重或 AI 失败被抹掉。当前 UI/API 只提供记录模式；没有审核过的 NutritionPolicy，不能打开真实自动减脂处方。

独立 `NutritionTargetEngine` 已实现 `tracking_only` 与 `reviewed_policy` 两种路径。默认不含任何真实建议策略或信任密钥；只有运营者服务器信任的 Ed25519 密钥签名、有效审核版本/日期、完整公式系数/适用范围/活动参数/能量与宏量边界配置，且用户明确同意、成年、适用性筛查与所需参数齐全，才进行确定性计算。公式参数独立于展示性别；缺值、越范围、过期、篡改均回退为 null/记录模式；不再扣减已包含于活动系数的运动消耗。签名只证明配置来源，并不替代专业审核。七项单元测试使用清楚标注的合成数学 fixture，不能当作真实临床策略；该引擎尚未接入公开个性化功能。

## 数据库权威

`supabase/migrations/202610150001_club.sql` 定义规格中的核心实体、逐用户 RLS、无客户端 DML 授权、私有答案表、私有 audio bucket 和以下 RPC：

增量迁移 `202610180001_beijing_time.sql` 将新 profiles 的默认值、INSERT 与入会 RPC 统一为 `Asia/Shanghai`，包括忽略旧客户端提交的其他时区。请按文件名顺序应用全部迁移；旧迁移没有改写。本次仅在可销毁 PGlite 测试库执行，未操作远程数据库。已有多用户数据库中的 profiles、activity_periods、checkins 与 XP 账本保持原样；旧账号重复入会也保留原锁定时区，不自动重算历史。未来若要将这类已部署旧账号迁至北京时间，需要单独设计生效边界；这不影响当前个人版固定北京时间的行为。

- `current_activity()` 用真实数据库时间及已锁定 profile 时区的 03:00 边界，新账号固定北京时间。未领归档并保持 Day；已领须等合法下一日期；漏多日只创建本次期，不补造完成。
- `claim_activity(period)` 先锁 profile、再锁 period；读取每次 attempt 最新不可变 evaluation，为每个项目保留最佳通过尝试。五项最低 60、平均至少 70，fitness 有有效通过证据后才计算最多 100 XP。同事务创建唯一 check-in/ledger、更新累计数与已领状态。重试返回原结算，不重算快照。
- `record_attempt` / `finish_assessment` 只授予 service_role；原稿与 evaluation 都只能追加。评分 version 单调递增。所有用户表的 INSERT 还锁 profile 并检查 deleting，避免删除竞争中重建数据。
- 对所有六类材料已在服务端截止前提交的期，provider 延迟会保留同一期。无论用户是否已经刷新，截止后最后一次审核完成都会创建固定 24 小时窗口。此竞态已在实际内存 PostgreSQL 中回归；真实服务多会话验证仍待执行。
- `reserve_usage` 用 profile 锁和全局预算行锁串行检查用户/全局 UTC 日额度，再记录 reservation；数据库默认额度为 0。`check_rate_limit` 为已入会用户施加 60 次/分钟上限。

同一 `requestKey` 不会重复创建尝试或重复调用模型。失败/超时可能已经产生费用，因此 reservation 不自动退款，避免猜测供应商账单；重新提交新尝试会再次计入额度。**后台重试、费用对账、同输入跨 requestKey 缓存、按 IP 限流尚未实现**。这些是生产阻断项，不以当前行锁代表全部费用保护完成。单位预算必须先与所选模型最大输入/输出成本核对，当前代码未宣称美元级真实费用已校准。

## Provider

写作适配器只访问固定 `https://api.openai.com/v1/responses`，不接收外部 URL，不向模型提供工具、身体资料或账户秘密。调用明确发送 `store:false`，启用 JSON Schema structured output，并再次用 Zod 校验 0–5 范围与每维原文引句。四维教学分由程序转换为站内百分制；不是 IELTS/PTE 认证。拒答、未完成、无效 JSON、越界或找不到原文依据均不算学习失败。

真实调用需要显式配置 `ENABLE_PAID_WRITING=true`、key、支持 Structured Outputs 的模型、经过评审的 reservation units 和数据库额度。默认关闭，代码未实际调用。模型质量校准、提示注入评测、完整隐私同意文案与账单上限仍需验收。

没有真实可验证音频处理时，`pronunciation`、`fluency`、`practiceScore` 都保持 null/unavailable；不依据转写、录音长度或文件存在给数字。SQL 也禁止非 `verified_audio` 的发音/流利度数字。生产听力 seed 明确 unavailable；口语请求仅保存尝试并保持 pending。完整无障碍替代生产链路尚未接好。

## 实际验证与本地数据库测试

2026-10-18 固定北京时间更新后，已执行 `pnpm exec vitest run src/lib/server`，**13 个文件、398 项通过**。新增覆盖旧/缺失/无效客户端时区规范化、AI 计划的北京时间 02:59:59/03:00 边界、数据库会话时区独立性、新 profile/RPC 固定时区、以及增量迁移保留旧档案/已结算期/XP。均使用合成数据和 mock provider，没有发送真实 AI 请求。

以下为初始服务端交付的 45 项验证范围；后续扩展后的完整结果以上述当前执行结果及项目测试报告为准：

- 24 项 transport mock 测试：Auth 验证调用路径、A/B API 所有权拒绝、用户令牌读取、伪造 XP 拒绝、未解锁答案拒绝、缺音频不记错误、压缩上限、未知预测、上传 fail closed、删除中拒绝、删除失败恢复顺序、真实高摄入日志保存和 provider 输出校验。
- 14 项 **实际 PostgreSQL 18.6 / PGlite 0.5.10** 测试：执行 migration 与 seed；验证真实 SQL 权限/RLS、A/B 隔离、钱包/答案/特权 RPC 拒绝、音频 owner 与过期策略、NULL 分数与无音频评分约束、03:00/Sydney DST、缺模块拒绝、不可变记录、结算与 requestKey 幂等、漏日归档/保持 Day、领取后合法跨日才加 Day、provider 截止后完成且用户未刷新、默认预算拒绝/只预留一次、删除防重建/级联。
- 7 项签名营养策略测试：默认关闭、签名/篡改、审核有效期、独立参数/缺值/适用范围、同意与特殊情形、配置安全边界、确定性数学。

PGlite 测试只在进程内新建可销毁内存库，没有生产连接。仅为 Supabase 提供小型 auth.users/auth.uid、role 与 storage schema shim。生产 SQL 只省略 `CREATE EXTENSION pgcrypto` 一行，因为此引擎没有默认打包它；已验证 migration 实际使用的 core `gen_random_uuid` 和 `sha256`。其余表、RLS、约束、触发器、RPC 与 seed 原样执行。PGlite 是**单连接**引擎，测试不证明真实 Supabase Auth/REST/Storage 行为、备份删除、HTTP 隔离或多会话并发，也未调用真实模型。

当前环境找不到 `psql`、`docker`、`supabase` 命令，因此未执行以下**真实 Supabase/多会话**测试。提供的 `supabase/tests/run-local-tests.ps1` 仅接受 loopback URL 和显式可销毁数据库确认，没有生产 URL 回退，也不会自行迁移。先由操作者准备独立、一次性的本地 Supabase，审核并应用 migration 与 seed，然后：

```powershell
$env:BOJI_TEST_DATABASE_URL='postgresql://postgres:LOCAL_TEST_PASSWORD@127.0.0.1:54322/postgres'
./supabase/tests/run-local-tests.ps1 -DedicatedDatabaseAcknowledgement I_ACKNOWLEDGE_DEDICATED_LOCAL_SUPABASE
```

脚本在事务回滚内验证所有者隔离、客户端 XP/答案权限拒绝、边界、不可变记录、重复领取和删除防重建；另建立专属虚构 fixture，启动 8 个并行 psql 会话领取，断言唯一账本/100 XP 后清理该 fixture。还需要扩展并执行完整的待审跨日、夏令时两方向、服务中断、录音授权与全表 A/B CRUD 矩阵。

## 上线前仍需完成

1. 真实 Supabase migration / RLS / 并发 / 时间与删除恢复测试；已完成的 PGlite SQL 验证不替代部署环境验收。
2. 真实登录 UI、生产 API 前端接线、后台队列重试与取消/对账；服务端课程生成与间隔复习。
3. 独立存储、音频签名读取、内容扫描/格式/时长验证、真实解码评分与 30 天清理 worker；原创听力音频授权。
4. 真实营养数据库适配和审核策略；缺项继续 tracking_only，不伪造目标。
5. 校准 provider 成本、全局费用止损、IP 限流、重复输入缓存及监控；实际 provider schema/质量测试。
6. 预测基线/计划确认与历史目标更改、已有多用户档案迁入北京时间的未来生效策略（如需）、稳定导出快照、法域/数据处理/备份保留审核。

官方技术依据（2026-10-15 读取）：[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Next.js Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)、[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)、[PGlite 文档](https://pglite.dev/docs/)。PGlite 为仅测试的精确 devDependency，使用 [Apache-2.0 / PostgreSQL 双许可](https://github.com/electric-sql/pglite)，安装使用 `--ignore-scripts`。本仓库没有声称官方文档本身替代实际隔离与费用测试。
