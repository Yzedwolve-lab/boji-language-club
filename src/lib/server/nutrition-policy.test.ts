import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  NutritionTargetEngine,
  type NutritionInput,
  type SignedNutritionPolicy,
} from "./nutrition-policy";

// Synthetic arithmetic fixtures only. These deliberately are NOT deployable
// clinical recommendations; no key or approved real-world policy is shipped.
const keys = generateKeyPairSync("ed25519");
const engine = new NutritionTargetEngine({
  test: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
});
const now = new Date("2026-10-15T00:00:00Z");
const profile: NutritionInput = {
  age: 30,
  weightKg: 60,
  heightCm: 170,
  activityLevel: "test_level",
  calculationParameter: "explicit_parameter",
  personalizationConsent: true,
  pregnancyOrLactation: false,
  professionallyManagedDiet: false,
};
const policy = {
  schemaVersion: 1,
  id: "SYNTHETIC-TEST-ONLY",
  version: "test-v1",
  review: {
    approved: true,
    reviewerId: "test-fixture-not-clinician",
    reviewedAt: "2026-10-01T00:00:00Z",
    expiresAt: "2026-11-01T00:00:00Z",
    evidence: ["https://example.invalid/synthetic-test"],
  },
  applicability: {
    age: { min: 18, max: 70 },
    weightKg: { min: 40, max: 150 },
    heightCm: { min: 140, max: 210 },
  },
  formula: {
    weightCoefficient: 20,
    heightCoefficient: 0,
    ageCoefficient: 0,
    offsetByParameter: { explicit_parameter: 0 },
  },
  activityMultipliers: { test_level: 1.5 },
  energyTargetMultiplier: { min: 1, max: 1 },
  allowedReferenceKcal: { min: 1000, max: 5000 },
  macroEnergyShares: {
    carbohydrate: { min: 0.4, max: 0.6 },
    protein: { min: 0.1, max: 0.3 },
    fat: { min: 0.2, max: 0.4 },
  },
};
function signed(value: unknown = policy): SignedNutritionPolicy {
  const payload = JSON.stringify(value);
  return {
    payload,
    signatureBase64: sign(null, Buffer.from(payload), keys.privateKey).toString(
      "base64",
    ),
    keyId: "test",
  };
}

describe("NutritionTargetEngine policy gates", () => {
  it("defaults to tracking with unknown numeric outputs even with complete metrics", () => {
    expect(engine.evaluate(profile)).toMatchObject({
      mode: "tracking_only",
      referenceKcal: null,
      macroGrams: null,
    });
  });
  it("rejects unknown signer and any modified policy payload", () => {
    expect(
      new NutritionTargetEngine().evaluate(profile, signed(), now).mode,
    ).toBe("tracking_only");
    const envelope = signed();
    envelope.payload = envelope.payload.replace("test-v1", "test-v2");
    expect(engine.evaluate(profile, envelope, now).mode).toBe("tracking_only");
  });
  it("requires explicit consent and adult/special-population screening", () => {
    for (const delta of [
      { personalizationConsent: false },
      { age: 17 },
      { pregnancyOrLactation: true },
      { pregnancyOrLactation: null },
      { professionallyManagedDiet: true },
    ])
      expect(
        engine.evaluate({ ...profile, ...delta }, signed(), now).mode,
      ).toBe("tracking_only");
  });
  it("never fills missing weight, height or a separate formula parameter", () => {
    for (const delta of [
      { weightKg: null },
      { heightCm: null },
      { calculationParameter: null },
      { activityLevel: null },
      { weightKg: NaN },
      { weightKg: 1000 },
    ])
      expect(
        engine.evaluate({ ...profile, ...delta }, signed(), now),
      ).toMatchObject({ mode: "tracking_only", referenceKcal: null });
  });
  it("rejects expired or incomplete reviews and malformed macro allocations", () => {
    expect(
      engine.evaluate(profile, signed(), new Date("2026-12-01")).mode,
    ).toBe("tracking_only");
    expect(
      engine.evaluate(
        profile,
        signed({ ...policy, review: { ...policy.review, approved: false } }),
        now,
      ).mode,
    ).toBe("tracking_only");
    expect(
      engine.evaluate(
        profile,
        signed({
          ...policy,
          macroEnergyShares: {
            carbohydrate: { min: 0.8, max: 0.9 },
            protein: { min: 0.8, max: 0.9 },
            fat: { min: 0.8, max: 0.9 },
          },
        }),
        now,
      ).mode,
    ).toBe("tracking_only");
  });
  it("calculates only authenticated in-scope policy arithmetic without exercise subtraction", () => {
    expect(engine.evaluate(profile, signed(), now)).toMatchObject({
      mode: "reviewed_policy",
      policyVersion: "test-v1",
      restingEnergyKcal: 1200,
      referenceKcal: { min: 1800, max: 1800 },
      activityAlreadyIncluded: true,
      macroGrams: {
        carbohydrate: { min: 180, max: 270 },
        protein: { min: 45, max: 135 },
        fat: { min: 40, max: 80 },
      },
    });
  });
  it("returns tracking when calculated energy violates signed safeguards", () => {
    expect(
      engine.evaluate(
        profile,
        signed({ ...policy, allowedReferenceKcal: { min: 2000, max: 5000 } }),
        now,
      ).mode,
    ).toBe("tracking_only");
  });
});
