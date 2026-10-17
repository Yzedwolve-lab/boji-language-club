---
name: boji-ui-design
description: Design and implement the purple Boji club onboarding, animated membership cards, fitness and English dashboards with responsive accessible interaction.
---

# Boji UI design

Read PROJECT_SPEC.md sections 3–8 and inspect the current app before choosing components.

1. Establish a small purple design-token system. Keep text readable and verify contrast; do not substitute excessive glow for visual hierarchy.
2. Preserve the four Chinese goal names and distinguish goal cards from XP material cards.
3. Implement the complete onboarding wizard, including back navigation, drafts, inline validation and legal skip paths.
4. Render membership card content as real accessible text, not a generated flat image. Provide a deliberate share-card preview with private details hidden by default.
5. Implement desktop left navigation and mobile single-column interaction. Ensure all forms work without hover and all buttons have focus states.
6. Use brief transitions and reduced-motion alternatives. Loading indicators must reflect real requests; errors must retain user input.
7. Display demo, unavailable, pending, partial data and true failure states visibly; do not design only the ideal happy path.
8. Use actual browser screenshots at mobile and desktop sizes. Test keyboard access, long Chinese usernames and overflowing feedback.

Outputs: reusable components, tokens, state coverage, screenshots and test evidence. Do not publish the site or install an unreviewed design plugin as a side effect.
