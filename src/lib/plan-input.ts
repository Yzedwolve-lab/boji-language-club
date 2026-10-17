import type { AIPlanningInput, AIStarterPlan } from "./ai-types";

const VERSION = "planning-input-v1";
function ordered(value: object) {
  const entries = Object.entries(value);
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.fromEntries(entries);
}

/** Local freshness checksum, not authentication, encryption or a security hash.
 * Keep it with the private plan; do not send it to the model or logs. A date
 * change alone does not invalidate a reusable plan with unchanged inputs. */
export function planningInputKey(input: AIPlanningInput): string {
  const profile = Object.fromEntries(
    Object.entries(input.profile).filter(
      ([key]) => key !== "nickname" && key !== "gender",
    ),
  );
  const preferences = {
    ...input.preferences,
    // Match server parsing defaults for older, still-supported preferences.
    energyGoal: input.preferences.energyGoal ?? "gentle_loss",
    calculationSex: input.preferences.calculationSex ?? "unspecified",
    nutritionEligibility:
      input.preferences.nutritionEligibility ?? "unspecified",
  };
  const text = JSON.stringify({
    version: VERSION,
    profile: ordered(profile),
    preferences: ordered(preferences),
    englishSample: input.englishSample.trim(),
  });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `${VERSION}:${(hash >>> 0).toString(16)}:${text.length}`;
}

export function isAIPlanCurrent(
  plan: AIStarterPlan | null | undefined,
  input: AIPlanningInput,
): boolean {
  return !!plan?.inputKey && plan.inputKey === planningInputKey(input);
}
