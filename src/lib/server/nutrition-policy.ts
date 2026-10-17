import "server-only";
import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";

const range = z
  .object({ min: z.number().finite(), max: z.number().finite() })
  .strict()
  .refine((value) => value.min <= value.max);
const positiveRange = range.refine((value) => value.min > 0);
const shareRange = range.refine((value) => value.min >= 0 && value.max <= 1);
export const nutritionPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1).max(100),
    version: z.string().min(1).max(100),
    review: z
      .object({
        approved: z.literal(true),
        reviewerId: z.string().min(1),
        reviewedAt: z.string().datetime({ offset: true }),
        expiresAt: z.string().datetime({ offset: true }),
        evidence: z.array(z.string().url()).min(1),
      })
      .strict(),
    applicability: z
      .object({
        age: positiveRange.refine((value) => value.min >= 18),
        weightKg: positiveRange,
        heightCm: positiveRange,
      })
      .strict(),
    // Coefficients, activity factors and safe bounds must all come from a reviewed
    // signed policy. There is intentionally no bundled clinical/default policy.
    formula: z
      .object({
        weightCoefficient: z.number().finite(),
        heightCoefficient: z.number().finite(),
        ageCoefficient: z.number().finite(),
        offsetByParameter: z.record(z.string(), z.number().finite()),
      })
      .strict(),
    activityMultipliers: z.record(z.string(), z.number().finite().positive()),
    energyTargetMultiplier: positiveRange,
    allowedReferenceKcal: positiveRange,
    macroEnergyShares: z
      .object({
        carbohydrate: shareRange,
        protein: shareRange,
        fat: shareRange,
      })
      .strict(),
  })
  .strict()
  .refine((policy) => {
    const shares = Object.values(policy.macroEnergyShares);
    return (
      shares.reduce((sum, value) => sum + value.min, 0) <= 1 &&
      shares.reduce((sum, value) => sum + value.max, 0) >= 1
    );
  }, "Macro ranges must permit a complete energy allocation.");

export interface SignedNutritionPolicy {
  payload: string;
  signatureBase64: string;
  keyId: string;
}
export interface NutritionInput {
  age: number;
  weightKg: number | null;
  heightCm: number | null;
  activityLevel: string | null;
  /** Explicit formula parameter, independently consented; never inferred from gender. */
  calculationParameter: string | null;
  personalizationConsent: boolean;
  pregnancyOrLactation: boolean | null;
  professionallyManagedDiet: boolean | null;
}
type TrackingResult = {
  mode: "tracking_only";
  reason: string;
  referenceKcal: null;
  macroGrams: null;
  policyVersion: null;
};
type ReviewedResult = {
  mode: "reviewed_policy";
  reason: string;
  referenceKcal: { min: number; max: number };
  macroGrams: Record<
    "carbohydrate" | "protein" | "fat",
    { min: number; max: number }
  >;
  policyVersion: string;
  policyId: string;
  evidence: string[];
  restingEnergyKcal: number;
  activityAlreadyIncluded: true;
};
const tracking = (reason: string): TrackingResult => ({
  mode: "tracking_only",
  reason,
  referenceKcal: null,
  macroGrams: null,
  policyVersion: null,
});
const within = (value: number, bounds: { min: number; max: number }) =>
  Number.isFinite(value) && value >= bounds.min && value <= bounds.max;

/**
 * Deterministic arithmetic/gating only. A signature authenticates configuration;
 * it does not certify clinical suitability. Trusted keys must be operator-owned
 * server configuration and must never be taken from a user's request.
 */
export class NutritionTargetEngine {
  constructor(
    private readonly trustedPublicKeys: Readonly<Record<string, string>> = {},
  ) {}
  evaluate(
    input: NutritionInput,
    signed: SignedNutritionPolicy | null = null,
    now: Date = new Date(),
  ): TrackingResult | ReviewedResult {
    if (!signed) return tracking("No reviewed nutrition policy is installed.");
    if (!input.personalizationConsent)
      return tracking("Personalized estimates were not requested.");
    if (!Number.isInteger(input.age) || input.age < 18)
      return tracking(
        "Automatic body recommendations are not enabled for this age.",
      );
    if (
      input.pregnancyOrLactation !== false ||
      input.professionallyManagedDiet !== false
    )
      return tracking(
        "Applicability screening is incomplete or requires individual professional guidance.",
      );
    if (
      input.weightKg === null ||
      input.heightCm === null ||
      !input.activityLevel ||
      !input.calculationParameter
    )
      return tracking(
        "Required calculation inputs are missing; unknown values remain unknown.",
      );
    if (signed.payload.length > 32000 || !this.trustedPublicKeys[signed.keyId])
      return tracking("The policy is not from a trusted reviewer key.");
    let policy: z.infer<typeof nutritionPolicySchema>;
    try {
      const key = createPublicKey(this.trustedPublicKeys[signed.keyId]);
      if (
        key.asymmetricKeyType !== "ed25519" ||
        !verify(
          null,
          Buffer.from(signed.payload, "utf8"),
          key,
          Buffer.from(signed.signatureBase64, "base64"),
        )
      )
        return tracking("Policy integrity verification failed.");
      const parsed = nutritionPolicySchema.safeParse(
        JSON.parse(signed.payload),
      );
      if (!parsed.success)
        return tracking("The signed policy is incomplete or invalid.");
      policy = parsed.data;
    } catch {
      return tracking("The signed policy could not be verified.");
    }
    if (
      !Number.isFinite(now.getTime()) ||
      Date.parse(policy.review.reviewedAt) > now.getTime() ||
      Date.parse(policy.review.expiresAt) <= now.getTime()
    )
      return tracking("The policy review is not currently valid.");
    if (
      !within(input.age, policy.applicability.age) ||
      !within(input.weightKg, policy.applicability.weightKg) ||
      !within(input.heightCm, policy.applicability.heightCm)
    )
      return tracking("These inputs fall outside the reviewed policy scope.");
    const multiplier = policy.activityMultipliers[input.activityLevel];
    const offset = policy.formula.offsetByParameter[input.calculationParameter];
    if (!Number.isFinite(multiplier) || !Number.isFinite(offset))
      return tracking(
        "The reviewed policy does not cover these calculation parameters.",
      );
    const resting =
      policy.formula.weightCoefficient * input.weightKg +
      policy.formula.heightCoefficient * input.heightCm +
      policy.formula.ageCoefficient * input.age +
      offset;
    const daily = resting * multiplier;
    const reference = {
      min: Math.round(daily * policy.energyTargetMultiplier.min),
      max: Math.round(daily * policy.energyTargetMultiplier.max),
    };
    if (
      resting <= 0 ||
      !within(reference.min, policy.allowedReferenceKcal) ||
      !within(reference.max, policy.allowedReferenceKcal)
    )
      return tracking(
        "The calculated range falls outside the reviewed policy safeguards.",
      );
    const grams = (
      name: "carbohydrate" | "protein" | "fat",
      energyPerGram: number,
    ) => ({
      min: Math.round(
        (reference.min * policy.macroEnergyShares[name].min) / energyPerGram,
      ),
      max: Math.round(
        (reference.max * policy.macroEnergyShares[name].max) / energyPerGram,
      ),
    });
    return {
      mode: "reviewed_policy",
      reason:
        "Estimate from a signed, versioned policy within its declared scope; not a diagnosis or promised outcome.",
      referenceKcal: reference,
      macroGrams: {
        carbohydrate: grams("carbohydrate", 4),
        protein: grams("protein", 4),
        fat: grams("fat", 9),
      },
      policyVersion: policy.version,
      policyId: policy.id,
      evidence: policy.review.evidence,
      restingEnergyKcal: Math.round(resting),
      activityAlreadyIncluded: true,
    };
  }
}
