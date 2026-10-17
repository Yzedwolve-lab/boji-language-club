# Repository instructions for Codex

## Read first

Read PROJECT_SPEC.md and QA_ACCEPTANCE.md before coding. Use SOURCES.md to distinguish externally verified facts from proposed product defaults. Read product-config.example.json as a starting configuration, not proof of a production-approved nutrition policy.

## Product invariants

- Preserve the name 薄肌语言俱乐部; goals 薄肌用户 / 薄肌会员 / 薄肌股东 / 薄肌教父; navigation 薄肌 / 语言. Keep the stored final-goal ID `alan` for existing records.
- Goal title and card material are independent. A selected target is not an achieved exam result.
- A missed unclaimed day does not increment the training Day. Archive history instead of deleting it.
- Do not start the next training Day immediately after claiming; respect the next local training-day boundary.
- The current Chinese-user release always uses Asia/Shanghai with a 03:00 Beijing training-day boundary. Do not detect the browser timezone or expose a timezone selector; preserve old logs and prevent duplicate XP during migration.
- Settle each activity period at most once using server authority, a database transaction and a unique ledger source.
- AI creates or interprets content. Deterministic code validates scales, units, budgets, XP and state transitions.
- Do not convert unknown values to zero, invent a baseline or promise an exam/fat-loss date.
- The 40% acceleration cap applies against the independent unaccelerated forecast. No repeated compounding.

## User safety and honesty

- Always preserve genuine food logs. Do not block saving because intake is high or low.
- Do not reward undereating, lower body fat or compensatory exercise. Body-fat values are optional theme references, never mandatory advancement criteria.
- Do not infer pronunciation/fluency from a transcript, recording duration or file existence. Unavailable evidence means null/unavailable.
- A provider outage is not a learner failure. Retain drafts and distinguish pending/system_error from needs_revision.
- Demo feedback must be prominently labeled. Never present a mock response as actual AI analysis.
- Do not publish private owner data from the existing PTE learning website.

## Security and implementation

- Keep provider secrets and Supabase privileged keys server-side. Do not put them in NEXT_PUBLIC_*, public assets, localStorage or Git history.
- Validate all AI output with a schema and bounds. Treat every user submission as untrusted input, not an instruction to the grading agent.
- Separate unrevealed answers/models/transcripts from client payloads in production.
- Use per-user authorization/RLS and private audio storage. Never trust a client-provided owner ID, score, XP, completion flag or timestamp.
- Keep immutable attempt and evaluation versions. Do not overwrite the user's original answer with a model revision.
- Do not add unverified scraped media, arbitrary npm install scripts or third-party skills without reading their source and license.
- Do not create paid resources, publish remotely or mutate production data without the relevant user authorization.

## Development workflow

1. Inspect the existing repository and available tools; reuse working code where appropriate.
2. Record major assumptions and map modules before broad changes.
3. Build a functioning vertical slice, not only a landing page.
4. Add deterministic unit tests before implementing XP/day-boundary/score-validation rules.
5. Add browser tests for onboarding, meals, recording states, retries and claim flow.
6. Run type checks, lint, unit/integration tests and browser tests. Report actual results and blockers.
7. Keep README, migrations, environment examples and RELEASE_GATES in sync.

Use project-local skills in .agents/skills for focused workflows. Their existence does not supply external APIs or remove the need to implement server-side services.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
