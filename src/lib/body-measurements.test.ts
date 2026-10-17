import { describe, expect, it } from "vitest";
import {
  parseBodyMeasurement,
  measurementChanges,
  type BodyMeasurement,
} from "./body-measurements";

const draft = {
  date: "2026-10-15",
  weightKg: "",
  bodyFatPercent: "",
  waistCm: "",
  method: "",
};
const entry = (
  date: string,
  values: Partial<BodyMeasurement>,
): BodyMeasurement => ({
  id: date,
  date,
  weightKg: null,
  bodyFatPercent: null,
  waistCm: null,
  method: "Scale A",
  ...values,
});

describe("actual body measurements", () => {
  it("keeps missing metrics null and never derives body fat from weight", () => {
    const result = parseBodyMeasurement(
      { ...draft, weightKg: "70.2" },
      "2026-10-15",
    );
    expect(result.errors).toEqual([]);
    expect(result.value).toMatchObject({
      weightKg: 70.2,
      bodyFatPercent: null,
      waistCm: null,
    });
  });

  it("requires an actual metric and a method for body fat", () => {
    expect(parseBodyMeasurement(draft, "2026-10-15").value).toBeNull();
    expect(
      parseBodyMeasurement(
        { ...draft, bodyFatPercent: "22" },
        "2026-10-15",
      ).errors.join(),
    ).toContain("测量方法");
    expect(
      parseBodyMeasurement(
        { ...draft, bodyFatPercent: "22", method: "Scale A" },
        "2026-10-15",
      ).value?.bodyFatPercent,
    ).toBe(22);
  });

  it.each(["Infinity", "NaN", "-1", "0", "701", "1e3"])(
    "rejects invalid weight %s",
    (weightKg) => {
      expect(
        parseBodyMeasurement({ ...draft, weightKg }, "2026-10-15").value,
      ).toBeNull();
    },
  );

  it.each(["2026-02-30", "2026-10-16", "2026-2-01", "1899-01-01"])(
    "rejects invalid or future date %s",
    (date) => {
      expect(
        parseBodyMeasurement({ ...draft, date, weightKg: "70" }, "2026-10-15")
          .value,
      ).toBeNull();
    },
  );

  it("accepts leap day and rejects out-of-range percentages and waist values", () => {
    expect(
      parseBodyMeasurement(
        { ...draft, date: "2024-02-29", waistCm: "82.3" },
        "2026-10-15",
      ).value?.waistCm,
    ).toBe(82.3);
    expect(
      parseBodyMeasurement(
        { ...draft, bodyFatPercent: "100", method: "Scale A" },
        "2026-10-15",
      ).value,
    ).toBeNull();
    expect(
      parseBodyMeasurement({ ...draft, waistCm: "401" }, "2026-10-15").value,
    ).toBeNull();
  });

  it("sorts by date and uses two observed values independently for each metric", () => {
    const result = measurementChanges([
      entry("2026-10-01", { weightKg: 72, bodyFatPercent: 23.1, waistCm: 85 }),
      entry("2026-10-15", { weightKg: 71.2, bodyFatPercent: 22.7 }),
      entry("2026-10-10", { waistCm: 84.5 }),
    ]);
    expect(result.weightKg.delta).toBe(-0.8);
    expect(result.bodyFatPercent.delta).toBe(-0.4);
    expect(result.waistCm.delta).toBe(-0.5);
    expect(result.bodyFatPercent.previous?.date).toBe("2026-10-01");
  });

  it("does not compare body-fat methods or skip a newer method to imply a trend", () => {
    const result = measurementChanges([
      entry("2026-10-15", { bodyFatPercent: 22, method: "Scale B" }),
      entry("2026-10-10", { bodyFatPercent: 23 }),
      entry("2026-10-01", { bodyFatPercent: 24 }),
    ]);
    expect(result.bodyFatPercent.status).toBe("different_method");
    expect(result.bodyFatPercent.delta).toBeNull();
  });

  it("requires two dates and never treats null as zero", () => {
    expect(measurementChanges([]).bodyFatPercent.status).toBe("insufficient");
    expect(
      measurementChanges([entry("2026-10-15", { weightKg: 70 })]).bodyFatPercent
        .delta,
    ).toBeNull();
    expect(
      measurementChanges([
        entry("2026-10-15", { weightKg: 70 }),
        entry("2026-10-15", { weightKg: 71 }),
      ]).weightKg.status,
    ).toBe("same_day");
  });
});
