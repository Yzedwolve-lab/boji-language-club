# 核查来源与适用范围

核查日期：2026-10-15。以下是本需求包使用的外部依据；实现前应再次检查易变接口、考试规则和部署条款。

本文仅摘要必要规则，不包含第三方文章、题库或音频的完整副本。网址是供实施时核查，不表示相关机构为本项目背书。

## V5 · ChatGPT 登录与套餐授权（2026-10-15 核查）

### R20 · Sign in with ChatGPT：用户授权及用量

[官方用户说明](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)

用途：身份登录与使用套餐是两项权限；符合条件的 Plus／Pro 用户可以授权应用使用既有 Codex／ChatGPT Work 额度。应用不因此获得一份额外额度，也不会仅凭该权限取得用户的 ChatGPT 对话或记忆。使用量和应用上限在 [ChatGPT Usage](https://chatgpt.com/settings/usage) 管理。

### R21 · 开源与本地应用接入范围

[官方接入范围](https://developers.openai.com/siwc/token-sharing-open-source)

用途：本地/开源直接接入与付费、远程托管应用的接入条件不同。当前实现仅开放本机 `127.0.0.1`，未实现远程 VM 流程。MIT 源码发布不代表公共托管服务已开放或取得官方背书。

### R22 · 公开客户端登记与身份验证

[Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

[On your website：身份令牌验证参考](https://developers.openai.com/siwc/website)

用途：稳定的本机标识、动态登记后保留 client ID、PKCE、state、nonce、精确回调地址与已验证身份绑定。网站文档仅用于核查 issuer/JWKS 和令牌验证要求，不表示本项目获得商业网站 OAuth 资格。

### R23 · 会话、刷新与退出

[Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)

[Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)

用途：凭据仅在私有服务端保存，刷新令牌轮换需要串行和原子持久化；退出尝试撤销可续期会话，无法确认远端撤销时仍清除本地凭据并明确告知。保留登记映射供后续登录，不读取或复用已安装 Codex 的登录文件。

### R24 · 模型目录、流式推理与失败恢复

[Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)

[Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)

用途：从账号模型目录保留可展示项和顺序；套餐推理使用公开 Responses 端点以及 `store:false`、`stream:true`。只有终止事件确认完成才接受结果；额度、权限和中断错误需要区分，不自动切换另一种计费方式。

### R25 · 当前能力边界

[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

用途：核对套餐接口支持的请求能力。本版仅使用文本请求，不因 ChatGPT 登录可用就宣称音频评分、视频、任意工具或全部模型都已支持。本轮只有模拟服务测试，没有真实用户授权或模型推理验收。

## 考试

### R01 · IELTS / British Council

`https://takeielts.britishcouncil.org/results/how-is-ielts-assessed`

`https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail`

用途：IELTS 0–9，整数/半分；整体分数有规定的计算方法。本站不把内部教学分包装成官方 IELTS 分。

### R02 · Pearson PTE Academic

`https://www.pearsonpte.com/pte-academic/scoring/`

用途：PTE Academic 总分及技能分范围为 10–90。不得把该量表直接线性换成 IELTS。

### R03 · ETS TOEFL iBT

`https://www.ets.org/toefl/test-takers/ibt/scores/understand-scores.html`

`https://www.ets.org/toefl/institutions/ibt/score-scale-update.html`

用途：2026-01-21 起的新 1–6 量表、0.5 步长，以及报告中的可比 0–120 总分。表单须记录量表类型，不把新版 5.5 错当旧制低分。

### R04 · 中国教育考试网 CET 分数解释

`https://cet.neea.edu.cn/xhtml1/folder/19081/5124-1.htm`

用途：四六级报道总分 710，官方不设及格线。界面采用“达到425分”等状态是对用户常用说法的明确化，不称为官方“通过认证”，不据此虚构雅思等值。

## 健康背景与数据

### R05 · TomTom 官方手册中的 ACE 体脂分类表

`https://download.tomtom.com/open/manuals/band/html/en-us/ACEBodyCompositionPercentageChart-Ibiza.htm`

该表注明源自 ACE；例如男性 fitness 为 14–17%、athletes 为 6–13%，女性分别为 21–24%、14–20%。这是制造商官方手册对分类的收录，不是为本产品四个称号制定的临床标准。

本规格的 18/15/12/10 与 28/25/22/20 是产品主题参考点，并非该来源直接给出的四级方案。不得据此宣称同档男女健康程度等价或所有人都应减至这些数字。

### R06 · NIDDK 个人能量需求及体重规划适用范围

`https://www.niddk.nih.gov/health-information/weight-management/just-enough-food-portions`

`https://www.niddk.nih.gov/health-information/weight-management/body-weight-planner`

用途：能量需求与年龄、体重、身高、性别及活动量有关；相应规划工具用于成年人，不适用于未成年人和孕期/哺乳期。引用适用边界不等于复制其算法或取得品牌授权。

### R07 · Australian Institute of Sport / Australian Sports Commission

`https://www.ausport.gov.au/ais/disorderedeating/resources/ais-resources/body-composition-assessment`

`https://www.ausport.gov.au/ais/disorderedeating`

用途：身体成分评估与操控可能产生风险，需有适当流程。本产品据此采用记录中立、不给极端低摄入/低体脂发奖励的设计，而不是把游戏等级当健康诊断。

### R08 · USDA FoodData Central API

`https://fdc.nal.usda.gov/api-guide/`

用途：食物条目检索与营养数据来源。它不保证自动识别中餐份量、油量或复合菜配方；应用需保存匹配依据与不确定性。

### R15 · Compendium of Physical Activities

`https://pacompendium.com/`

用途：MET、活动代码和运动消耗粗估。官方说明允许商业使用并要求引用；不要篡改 MET 数值或将不同强度直接混并。

### R16 · Mifflin 等人的原始研究

`https://pubmed.ncbi.nlm.nih.gov/2305711/?dopt=Abstract`

论文：A new predictive equation for resting energy expenditure in healthy individuals，1990，DOI `10.1093/ajcn/51.2.241`。

用途：V6 个人模式静息能量估算（REE，非全天维持消耗）的公式依据。2026-10-15 重新核对：研究包含 498 位 19–78 岁健康成人，含正常体重与肥胖成人；常用简化式为男参数 `10W + 6.25H - 5A + 5`、女参数 `10W + 6.25H - 5A - 161`。这不代表已审核本产品的活动系数、减脂缺口、规划下限或适用人群。

### R26 · NHLBI 成人 BMI 分类

[官方说明](https://www.nhlbi.nih.gov/health/overweight-and-obesity/symptoms)

2026-10-15 核对。成人 BMI <18.5 分类仅用于筛查，不能推算体脂或给个体下健康诊断。本项目额外对 BMI <20 暂停自动减脂目标，是独立的保守产品限制，并非该机构标准。R06 的成人规划工具不用于孕哺期，本项目没有复制该工具的模型。

### R27 · National Academies, Dietary Reference Intakes for Energy (2023)

[应用章节](https://www.nationalacademies.org/read/26818/chapter/9)

2026-10-15 核对。应用能量估算时需考虑个体需求及活动分类的不确定性；短期自报摄入与估算需求的比较不能单独判断营养充分。因此本产品的范围审核仅称“计划匹配”，不称健康认证。

### V6 产品默认与事实的边界

活动系数 1.2/1.375/1.55/1.725、10% 缺口且最多 250 kcal、中心 ±10% 浮动带、男参数 1800／女参数 1500 且不低于 REE 的规划下限、三餐 30/40/30、BMI 20 门槛及 120–230 cm／35–250 kg 支持范围，均为**产品默认，未经个体临床验证**。上下区间不是统计置信区间，也不是个人最低安全摄入量。AI 菜谱份量未与独立营养数据库交叉核验。精确代码与使用说明见 [V6_DAILY_PLANS](docs/V6_DAILY_PLANS.md)。

## 部署、密钥、授权

### R09 · GitHub Pages 的定位

`https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages`

用途：Pages 是 HTML/CSS/JavaScript 静态站点托管；公开仓库与可访问网页是不同交付物。

### R10 · GitHub Pages 使用限制

`https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits`

用途：流量和构建等限制；不能默认用 Pages 承载商业 SaaS 或敏感交易。生产部署前核查最新条款。

### R11 · Next.js 静态导出

`https://nextjs.org/docs/app/guides/static-exports`

用途：静态导出不支持依赖服务器的全部功能，不能将完整后端误当作可随 Pages 一并运行。

### R12 · Next.js 与 Git 部署

`https://nextjs.org/docs/app/getting-started/deploying`

`https://vercel.com/docs/git`

用途：完整服务可选择支持 Next.js 服务端的托管；可从 Git 仓库部署。本文不承诺免费额度、价格或商业条款。

### R13 · Supabase Row Level Security

`https://supabase.com/docs/guides/database/postgres/row-level-security`

用途：逐用户数据隔离、客户端公开配置与服务端特权的边界。RLS 需要正确编写和测试，不是启用开关就自动安全。

### R14 · OpenAI API 密钥安全

`https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety`

用途：不要把密钥部署在浏览器/移动客户端；通过后端调用，禁止公开到仓库。本站运行时 AI 与 Codex 写代码是不同能力层。

### R17 · GitHub 仓库许可

`https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository`

用途：公开仓库不自动授予完整开源使用权；需要明确许可。第三方素材的权利不能被自己的 LICENSE 自动覆盖。

## Codex 工作流

### R18 · OpenAI 本地技能与 AGENTS.md 文档

`https://developers.openai.com/codex/skills/`

`https://developers.openai.com/codex/guides/agents-md/`

核查时分别转到 ChatGPT Learn 的 Build skills 与 AGENTS.md 说明。Codex 可从仓库 `.agents/skills` 发现本地技能；每个技能以带 name/description 的 SKILL.md 表达工作流。

本包的四个技能是为此项目新编写的本地说明，没有调用外部服务的内置权限，不是已经替用户安装的第三方插件。

### R19 · 历史技能目录的现状

`https://github.com/openai/skills`

`https://github.com/openai/plugins`

核查时 openai/skills 仓库已标注 deprecated，并指向 OpenAI Plugins 示例。不要只凭旧教程假定某个旧技能路径仍可安装；本包优先使用已核实的本地技能目录格式。
