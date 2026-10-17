# 第三方来源与权利说明

本项目没有复制私人 PTE 网站的数据、账号、录音或题库。产品图形为 CSS/HTML/SVG，题目文章和听力脚本为本次实现的原创演示材料。没有下载第三方图片或考试音频。

主要依赖（精确版本以 pnpm-lock.yaml 为准）：

| 软件 | 来源 | 许可证 / 用途 |
|---|---|---|
| Next.js | https://github.com/vercel/next.js | MIT；服务端 React 应用 |
| React / React DOM | https://github.com/facebook/react | MIT；界面 |
| Lucide React | https://github.com/lucide-icons/lucide | ISC；图标 |
| Zod | https://github.com/colinhacks/zod | MIT；结构化输入校验 |
| TypeScript | https://github.com/microsoft/TypeScript | Apache-2.0；类型检查 |
| ESLint 与 Next 配置 | https://github.com/eslint/eslint | MIT；静态检查（插件各保留原许可） |
| Vitest | https://github.com/vitest-dev/vitest | MIT；单元与集成测试 |
| Prettier | https://github.com/prettier/prettier | MIT；源码格式化 |
| Playwright | https://github.com/microsoft/playwright | Apache-2.0；真实浏览器测试 |
| PGlite / PostgreSQL | https://github.com/electric-sql/pglite | Apache-2.0 / PostgreSQL License；隔离 SQL 测试 |
| DM Sans | https://fonts.google.com/specimen/DM+Sans | SIL Open Font License；界面英文字体 |
| Noto Sans SC | https://fonts.google.com/noto/specimen/Noto+Sans+SC | SIL Open Font License；界面中文字体 |

字体由 Google Fonts CSS 加载，字体服务不可用时降级为系统字体，不影响任务逻辑。字体网络请求仍可能向字体服务暴露常规网络元数据（如 IP）；若面向真实用户部署，应根据地区政策自托管经许可的字体或完全使用系统字体。

浏览器 SpeechSynthesis 是本机/浏览器提供的合成朗读，不是官方考试音频；声音的许可与网络行为取决于系统提供者，生产运营需另行确认。本演示明确提供文字替代，合成语音不可用不算学习失败。

营养 fixture 仅用于示例计算，不声称来自 USDA 或已核实数据；生产营养来源与策略尚未接入。考试规则来源见原始 SOURCES.md 与 docs/SOURCE_VERIFICATION.md。

依赖完整许可证清单可用 `pnpm licenses list --json` 生成。开发期间的机器可读清单保存在本机 `artifacts/dependency-licenses.json`，该目录不包含在公开源码中。通过包管理器安装的依赖保留各自许可证；分发依赖或二进制时须一并保留相应版权和许可文本。
