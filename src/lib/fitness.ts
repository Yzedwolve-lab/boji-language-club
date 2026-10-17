export type Nutrients = {
  kcal: number;
  carbs: number;
  protein: number;
  fat: number;
};
export type FoodEstimate = {
  kcal: number | null;
  carbs: number | null;
  protein: number | null;
  fat: number | null;
  partial: boolean;
  source: "fictional_demo_fixture";
  assumptions: string[];
  matchedItems: Array<{ description: string; nutrients: Nutrients }>;
  unestimatedText: string;
};
// Deliberately fictional, limited fixtures for demonstrating quantity arithmetic.
// These are NOT database matches and must never be used by a production nutrition provider.
const fixtures: Array<{ pattern: RegExp; per100: Nutrients; name: string }> = [
  {
    pattern:
      /(?<![\d.\-−])(\d+(?:\.\d+)?)\s*(?:g|grams?)\s+(?:of\s+)?cooked rice\b/gi,
    per100: { kcal: 130, carbs: 28, protein: 2.5, fat: 0.3 },
    name: "cooked rice",
  },
  {
    pattern:
      /(?<![\d.\-−])(\d+(?:\.\d+)?)\s*(?:g|grams?)\s+(?:of\s+)?raw rice\b/gi,
    per100: { kcal: 360, carbs: 79, protein: 7, fat: 0.7 },
    name: "raw rice",
  },
  {
    pattern:
      /(?<![\d.\-−])(\d+(?:\.\d+)?)\s*(?:g|grams?)\s+(?:of\s+)?(?:grilled |cooked )?chicken\b/gi,
    per100: { kcal: 165, carbs: 0, protein: 31, fat: 3.6 },
    name: "chicken (skinless cooked assumption)",
  },
  {
    pattern: /(?<![\d.\-−])(\d+(?:\.\d+)?)\s*(?:g|grams?)\s+(?:of\s+)?oats\b/gi,
    per100: { kcal: 380, carbs: 67, protein: 13, fat: 7 },
    name: "dry oats",
  },
];
export function calculateLabelNutrition(
  grams: number,
  per100: Nutrients,
): Nutrients {
  if (
    !Number.isFinite(grams) ||
    grams <= 0 ||
    Object.values(per100).some((v) => !Number.isFinite(v) || v < 0)
  )
    throw new Error("Invalid quantity or nutrition label");
  return {
    kcal: (per100.kcal * grams) / 100,
    carbs: (per100.carbs * grams) / 100,
    protein: (per100.protein * grams) / 100,
    fat: (per100.fat * grams) / 100,
  };
}
export function estimateRecordedFood(text: string): FoodEstimate {
  const total: Nutrients = { kcal: 0, carbs: 0, protein: 0, fat: 0 };
  const assumptions: string[] = [];
  const matchedItems: FoodEstimate["matchedItems"] = [];
  let matched = 0;
  let remaining = text;
  for (const item of fixtures) {
    for (const match of text.matchAll(item.pattern)) {
      const grams = Number(match[1]);
      if (!Number.isFinite(grams) || grams <= 0 || grams > 100000) continue;
      const n = calculateLabelNutrition(grams, item.per100);
      for (const key of Object.keys(total) as Array<keyof Nutrients>)
        total[key] += n[key];
      matched++;
      matchedItems.push({ description: match[0], nutrients: n });
      remaining = remaining.replace(match[0], "");
      assumptions.push(`${match[1]} g ${item.name} · fictional demo fixture`);
    }
  }
  for (const match of text.matchAll(
    /(?<![\d.\-−])(\d+(?:\.\d+)?)\s+(?:boiled |fried )?eggs?\b/gi,
  )) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) continue;
    total.kcal += amount * 72;
    total.protein += amount * 6;
    total.carbs += amount * 0.4;
    total.fat += amount * 5;
    matchedItems.push({
      description: match[0],
      nutrients: {
        kcal: amount * 72,
        protein: amount * 6,
        carbs: amount * 0.4,
        fat: amount * 5,
      },
    });
    matched++;
    remaining = remaining.replace(match[0], "");
    assumptions.push(`${amount} eggs · assumes 50 g each; oil excluded · demo`);
  }
  const partial =
    remaining.replace(
      /\b(and|i|had|ate|for|breakfast|lunch|dinner)\b|[\s,.;]/gi,
      "",
    ).length > 0;
  const unestimatedText = remaining
    .replace(/\b(and|i|had|ate|for|breakfast|lunch|dinner)\b/gi, " ")
    .replace(/^[\s,.;]+|[\s,.;]+$/g, "")
    .replace(/\s+/g, " ");
  if (!matched)
    return {
      kcal: null,
      carbs: null,
      protein: null,
      fat: null,
      partial: !!text.trim(),
      source: "fictional_demo_fixture",
      matchedItems,
      unestimatedText,
      assumptions: [
        "No supported quantity: clarify portions or retain as an unestimated record.",
      ],
    };
  return {
    ...total,
    partial,
    source: "fictional_demo_fixture",
    assumptions,
    matchedItems,
    unestimatedText,
  };
}
/** A small, explicit typo list, not an AI spell checker. Unfamiliar names are not errors. */
export function foodSpellingSuggestions(
  text: string,
): Array<{ original: string; suggestion: string }> {
  const corrections: Record<string, string> = {
    chiken: "chicken",
    chickne: "chicken",
    chikcen: "chicken",
    chickn: "chicken",
    egss: "eggs",
    egs: "eggs",
    rcie: "rice",
    ricce: "rice",
    bananna: "banana",
    bannana: "banana",
    yougurt: "yogurt",
    yoghourt: "yoghurt",
    brocoli: "broccoli",
    avacado: "avocado",
  };
  const seen = new Set<string>();
  return [...text.matchAll(/\b[a-z]+\b/gi)].flatMap(([original]) => {
    const word = original.toLowerCase();
    if (!corrections[word] || seen.has(word)) return [];
    seen.add(word);
    return [{ original, suggestion: corrections[word] }];
  });
}
export function validReflection(text: string) {
  return (
    text.trim().length >= 12 &&
    /[a-z]{2}/i.test(text) &&
    text.trim().split(/\s+/).length >= 4 &&
    !/[\u4e00-\u9fff]/.test(text)
  );
}
export function fitnessQuality(
  valid: boolean,
  confirmed: boolean,
  reviewed: boolean,
  reflection: string,
) {
  return (
    (valid ? 30 : 0) +
    (confirmed ? 10 : 0) +
    (reviewed ? 30 : 0) +
    (validReflection(reflection) ? 30 : 0)
  );
}
