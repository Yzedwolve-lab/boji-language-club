---
name: boji-learning-engine
description: Build daily English lessons, vocabulary reviews, evidence-based writing and speaking feedback, answer-release controls and targeted retries for the Boji club.
---

# Boji learning engine

Read PROJECT_SPEC.md section 9 and the task/evaluation models before editing lesson generation or grading.

1. Allocate all required activities inside the user's time cap, including review and retry allowance. New words consume the same quota as user-highlighted unfamiliar words.
2. Preserve the distinction between assigned, actually studied, independently retrieved and mastered. Use genuine attempts to schedule spaced review.
3. Generate original or properly licensed material with stable item IDs, source metadata, private answers and supported explanations.
4. Keep current-test answers, models and transcripts out of unrevealed production payloads. Learning examples may be shown separately and must not masquerade as learner work.
5. Grade objective responses deterministically when possible; allow valid language variants and use bounded semantic review for ambiguous free answers.
6. Grade writing against the declared rubric with evidence from the actual draft. Preserve every version and the distinction between first and revised attempts.
7. Grade pronunciation and fluency only from audio the selected service can actually process. If only a transcript is available, leave those scores null; label accessible alternatives honestly.
8. Treat provider errors separately from learner failure. Retry only failed tasks, retain passes and use scaffolded parallel exercises after repeated errors.
9. Validate structured model output and never let user text redefine scoring instructions or invoke privileged actions.

Outputs: lesson/evaluation schemas, provider interfaces, fixtures, retry logic and tests. Never claim official IELTS, TOEFL or PTE scoring.
