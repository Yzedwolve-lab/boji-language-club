import { describe, expect, it } from "vitest";
import {
  estimateRecordedFood,
  calculateLabelNutrition,
  fitnessQuality,
  foodSpellingSuggestions,
} from "./fitness";
describe("honest nutrition records", () => {
  it("does not turn missing food into zero intake", () => {
    expect(estimateRecordedFood("").kcal).toBeNull();
  });
  it("keeps unknown amounts unknown", () => {
    expect(estimateRecordedFood("a bowl of rice").kcal).toBeNull();
  });
  it("retains invalid quantities as unknown without crashing a draft", () => {
    expect(estimateRecordedFood("0 g cooked rice").kcal).toBeNull();
    expect(
      estimateRecordedFood(
        "9999999999999999999999999999999999999999999 g raw rice",
      ).kcal,
    ).toBeNull();
  });
  it("distinguishes raw and cooked demo fixtures", () => {
    expect(estimateRecordedFood("100 g raw rice").kcal).not.toBe(
      estimateRecordedFood("100 g cooked rice").kcal,
    );
  });
  it("labels partial matching without claiming full-day coverage", () => {
    const result = estimateRecordedFood("100 g cooked rice and mystery sauce");
    expect(result.partial).toBe(true);
    expect(result.source).toBe("fictional_demo_fixture");
    expect(result.matchedItems).toHaveLength(1);
    expect(result.unestimatedText).toContain("mystery sauce");
  });
  it("updates known subtotals when the actual portion changes", () => {
    expect(estimateRecordedFood("100 g cooked rice").kcal).toBe(130);
    expect(estimateRecordedFood("200 g cooked rice").kcal).toBe(260);
    expect(estimateRecordedFood("a bowl of rice").matchedItems).toHaveLength(0);
  });
  it("does not misread negative or decimal quantities", () => {
    expect(estimateRecordedFood("-2 eggs").kcal).toBeNull();
    expect(estimateRecordedFood("-200 g cooked rice").kcal).toBeNull();
    expect(estimateRecordedFood("1.5 eggs").kcal).toBe(108);
  });
  it("suggests known food typos without rejecting brands or regional names", () => {
    expect(foodSpellingSuggestions("150 g chiken and 2 egss")).toEqual([
      { original: "chiken", suggestion: "chicken" },
      { original: "egss", suggestion: "eggs" },
    ]);
    expect(
      foodSpellingSuggestions("mapo tofu, café latte, yoghurt, Acme brand"),
    ).toEqual([]);
  });
  it("sums user package data without rounding each item", () => {
    expect(
      calculateLabelNutrition(125, {
        kcal: 101,
        carbs: 20,
        protein: 3,
        fat: 1,
      }),
    ).toEqual({ kcal: 126.25, carbs: 25, protein: 3.75, fat: 1.25 });
  });
  it("rejects nonfinite label/weight values", () => {
    expect(() =>
      calculateLabelNutrition(-10, {
        kcal: 100,
        carbs: 20,
        protein: 3,
        fat: 1,
      }),
    ).toThrow();
  });
  it("quality depends on logging/reflection, never calories or weight", () => {
    expect(
      fitnessQuality(true, true, true, "I will record my meals honestly."),
    ).toBe(100);
    expect(
      fitnessQuality(true, false, true, "I will record my meals honestly."),
    ).toBe(90);
  });
});
