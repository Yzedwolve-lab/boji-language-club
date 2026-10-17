---
name: boji-release-audit
description: Audit the Boji club before release for truthful nutrition behavior, privacy, AI key safety, user isolation, media rights, cost limits and verified deployment.
---

# Boji release audit

Read PROJECT_SPEC.md sections 8 and 11–15, SOURCES.md and QA_ACCEPTANCE.md. This is an engineering checklist, not medical or legal certification.

1. Confirm that real food logs can always be saved and that low intake, lower body fat and compensatory exercise never earn extra XP.
2. Check that missing body data means tracking mode, not invented calorie targets; automatic recommendations need an applicable versioned policy and declared release review.
3. Inspect built browser assets, server/client imports, environment examples and Git history for provider secrets. Do not expose Supabase service-role privileges.
4. Test user A/user B isolation at both API and database levels, private recordings, expiry and answer-release authorization.
5. Test idempotent settlement, AI budget limits, failed uploads, deletion with pending jobs and preserved drafts during outages.
6. Audit content provenance. No private PTE owner records, copyrighted unlicensed media or anonymous copied question banks in public seed data.
7. Verify that the target host actually supports the selected server features. GitHub source publication, Pages demo and production app are separate releases.
8. Run real test/build commands. Record what ran, what failed and which external-service tests remain unexecuted.
9. Create or update RELEASE_GATES with ready / blocked / not applicable statuses and specific evidence. Do not call the site production-ready with missing authorization or privacy tests.

Outputs: findings ordered by severity, reproducible evidence, fixes/tests and a release-gate report. Do not deploy or create paid resources without authorization.
