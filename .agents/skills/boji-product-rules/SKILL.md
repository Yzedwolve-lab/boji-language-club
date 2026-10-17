---
name: boji-product-rules
description: Implement or review Boji club onboarding, score validation, planning, XP settlement and training-day transitions. Use for business rules, not visual styling alone.
---

# Boji product rules

Read the repository root PROJECT_SPEC.md sections 0, 4–7 and 10–12, plus QA_ACCEPTANCE.md.

1. List the relevant invariant before changing code. Treat the specification's defaults as explicit configuration, not discretionary AI choices.
2. Separate goalTitle, cardMaterial, clubDate, dayIndex and lifetimeCompletedDays.
3. Encode exam type and score scale in discriminated schemas. Test both ends, step sizes, absent scores and switching types.
4. Make forecasts versioned and uncertain when appropriate. Derive acceleration from an independent unaccelerated baseline; cap the request at 40% and check feasibility.
5. Build an explicit period state machine. Archive unclaimed periods; preserve attempts; hold a fair system-review period when provider delay crosses the date boundary.
6. Write the claim operation as one authenticated transaction with a unique source key. Client input never determines XP or eligibility.
7. Add race-condition, request-retry, local-date and daylight-saving tests before declaring the rule complete.

Outputs: changed code, rule/config version, relevant tests and a brief statement of any unresolved specification conflict. Do not silently replace the default missed-day interpretation.
