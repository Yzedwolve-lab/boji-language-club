export type BodyMeasurement = {
  id: string;
  date: string;
  weightKg: number | null;
  bodyFatPercent: number | null;
  waistCm: number | null;
  method: string;
};

export type MeasurementDraft = {
  date: string;
  weightKg: string;
  bodyFatPercent: string;
  waistCm: string;
  method: string;
};

type Metric = "weightKg" | "bodyFatPercent" | "waistCm";
export type MeasurementChange = {
  status: "comparable" | "insufficient" | "different_method" | "same_day";
  delta: number | null;
  latest: BodyMeasurement | null;
  previous: BodyMeasurement | null;
};

export function localMeasurementDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseBodyMeasurement(
  draft: MeasurementDraft,
  today = localMeasurementDate(),
): { value: Omit<BodyMeasurement, "id"> | null; errors: string[] } {
  const errors: string[] = [];
  const parsedDate = new Date(`${draft.date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ||
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== draft.date ||
    draft.date < "1900-01-01" ||
    draft.date > today
  )
    errors.push("请填写有效的测量日期，不能是未来日期。");

  function number(
    raw: string,
    label: string,
    max: number,
    exclusiveMax = false,
  ) {
    if (!raw.trim()) return null;
    const value = Number(raw);
    if (
      !/^\d+(?:\.\d+)?$/.test(raw.trim()) ||
      !Number.isFinite(value) ||
      value <= 0 ||
      (exclusiveMax ? value >= max : value > max)
    ) {
      errors.push(
        `${label}数值或单位需要核对，请填写大于 0、${exclusiveMax ? "小于" : "不超过"} ${max} 的数字。`,
      );
      return null;
    }
    return value;
  }
  const weightKg = number(draft.weightKg, "体重（kg）", 700);
  const bodyFatPercent = number(draft.bodyFatPercent, "体脂（%）", 100, true);
  const waistCm = number(draft.waistCm, "腰围（cm）", 400);
  const method = draft.method.trim();
  if (
    weightKg === null &&
    bodyFatPercent === null &&
    waistCm === null &&
    errors.length === 0
  )
    errors.push("至少填写一项实际测量值；不知道的项目留空就好。");
  if (bodyFatPercent !== null && !method)
    errors.push("记录体脂时，请注明测量方法与设备，方便之后比较。");
  if (method.length > 80) errors.push("测量方法请控制在 80 个字符以内。");
  return {
    value: errors.length
      ? null
      : { date: draft.date, weightKg, bodyFatPercent, waistCm, method },
    errors,
  };
}

export function measurementChanges(
  entries: BodyMeasurement[],
): Record<Metric, MeasurementChange> {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  function change(metric: Metric): MeasurementChange {
    const [latest = null, previous = null] = sorted.filter(
      (item) => item[metric] !== null && Number.isFinite(item[metric]),
    );
    const base = { latest, previous, delta: null };
    if (!latest || !previous) return { ...base, status: "insufficient" };
    if (
      metric === "bodyFatPercent" &&
      (!latest.method.trim() ||
        latest.method.trim().toLowerCase() !==
          previous.method.trim().toLowerCase())
    )
      return { ...base, status: "different_method" };
    if (latest.date === previous.date) return { ...base, status: "same_day" };
    return {
      latest,
      previous,
      status: "comparable",
      delta:
        Math.round(
          ((latest[metric] as number) - (previous[metric] as number)) * 100,
        ) / 100,
    };
  }
  return {
    weightKg: change("weightKg"),
    bodyFatPercent: change("bodyFatPercent"),
    waistCm: change("waistCm"),
  };
}
