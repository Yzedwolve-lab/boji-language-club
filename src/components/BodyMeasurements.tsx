"use client";

import { useId, useState, type FormEvent } from "react";
import {
  localMeasurementDate,
  measurementChanges,
  parseBodyMeasurement,
  type BodyMeasurement,
  type MeasurementChange,
  type MeasurementDraft,
} from "@/lib/body-measurements";
import "./body-measurements.css";

const metrics = [
  { key: "bodyFatPercent", label: "体脂记录变化", unit: "个百分点" },
  { key: "weightKg", label: "体重记录变化", unit: "kg" },
  { key: "waistCm", label: "腰围记录变化", unit: "cm" },
] as const;

function changeText(change: MeasurementChange, unit: string) {
  if (change.status !== "comparable" || change.delta === null) return "待比较";
  return `${change.delta > 0 ? "+" : ""}${change.delta} ${unit}`;
}

function changeHelp(change: MeasurementChange) {
  if (change.status === "different_method")
    return "测量方法不同或缺失，不能直接比较。";
  if (change.status === "same_day") return "同一天的记录，暂不作跨日比较。";
  if (change.status === "insufficient") return "需要两个日期的实际测量值。";
  return `${change.previous?.date.replaceAll("-", "‑")} → ${change.latest?.date.replaceAll("-", "‑")}`;
}

export default function BodyMeasurements({
  value,
  onChange,
}: {
  value: BodyMeasurement[];
  onChange: (entries: BodyMeasurement[]) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<MeasurementDraft>(() => ({
    date: localMeasurementDate(),
    weightKg: "",
    bodyFatPercent: "",
    waistCm: "",
    method: "",
  }));
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const changes = measurementChanges(value);
  const recent = [...value]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);

  function update(field: keyof MeasurementDraft, text: string) {
    setDraft((previous) => ({ ...previous, [field]: text }));
    setErrors([]);
    setNotice("");
  }

  function save(event: FormEvent) {
    event.preventDefault();
    const result = parseBodyMeasurement(draft);
    setErrors(result.errors);
    if (!result.value) return;
    onChange([{ id: crypto.randomUUID(), ...result.value }, ...value]);
    setDraft((previous) => ({
      ...previous,
      weightKg: "",
      bodyFatPercent: "",
      waistCm: "",
    }));
    setNotice("Receipt saved. 📏 实际测量已记录，未知项保持空白。");
  }

  return (
    <section
      className="body-measurements panel"
      aria-labelledby={`${id}-title`}
    >
      <div className="measurement-heading">
        <span aria-hidden="true">📏</span>
        <div>
          <h2 id={`${id}-title`}>
            Body check-in <span>· 实测记录</span>
          </h2>
          <p>体重、体脂、腰围，按真实测量填写。没有测过的项目留空就好。</p>
        </div>
      </div>
      <p className="measurement-privacy">
        完整测量历史留在本机；最新体重仅在你确认生成 AI
        计划并允许健康建议后作为参考发送。体脂和腰围的测量记录不会发送给模型服务商。
      </p>
      <div className="measurement-changes">
        {metrics.map(({ key, label, unit }) => (
          <div className="measurement-change" key={key}>
            <span>{label}</span>
            <strong>{changeText(changes[key], unit)}</strong>
            <small>{changeHelp(changes[key])}</small>
          </div>
        ))}
      </div>
      <p className="measurement-note">
        体脂只比较最新两条有值、同测量方法的记录。体重与腰围独立比较；变化不自动归因于脂肪，也不预测达标日期或因为下降奖励
        XP。
      </p>
      <form onSubmit={save} noValidate className="measurement-form">
        <label>
          测量日期
          <input
            type="date"
            min="1900-01-01"
            max={localMeasurementDate()}
            value={draft.date}
            onChange={(event) => update("date", event.target.value)}
          />
        </label>
        <label>
          体重（kg，选填）
          <input
            inputMode="decimal"
            value={draft.weightKg}
            onChange={(event) => update("weightKg", event.target.value)}
            placeholder="实际称重，例如 70.2"
          />
        </label>
        <label>
          体脂（%，选填）
          <input
            inputMode="decimal"
            value={draft.bodyFatPercent}
            onChange={(event) => update("bodyFatPercent", event.target.value)}
            placeholder="实际测量，例如 22.5"
          />
        </label>
        <label>
          腰围（cm，选填）
          <input
            inputMode="decimal"
            value={draft.waistCm}
            onChange={(event) => update("waistCm", event.target.value)}
            placeholder="实际测量，例如 82.3"
          />
        </label>
        <label className="measurement-method">
          体脂测量方法与设备（有体脂时必填）
          <input
            maxLength={80}
            value={draft.method}
            onChange={(event) => update("method", event.target.value)}
            placeholder="例如：家中体脂秤 A；同一设备保持同一名称"
          />
        </label>
        {errors.length > 0 && (
          <div className="measurement-errors" role="alert">
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        )}
        <div className="measurement-actions">
          <button type="submit" className="button primary">
            保存测量记录
          </button>
          <p role="status">{notice}</p>
        </div>
      </form>
      <div className="measurement-history">
        <h3>
          最近的真实记录 <span>({value.length})</span>
        </h3>
        {recent.length === 0 ? (
          <p>这里还空着。下一次测量后，带着数据回来 📋</p>
        ) : (
          <ul>
            {recent.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{entry.date}</strong>
                  <p>
                    体重{" "}
                    {entry.weightKg === null ? "未测" : `${entry.weightKg} kg`}{" "}
                    · 体脂{" "}
                    {entry.bodyFatPercent === null
                      ? "未测"
                      : `${entry.bodyFatPercent}%`}{" "}
                    · 腰围{" "}
                    {entry.waistCm === null ? "未测" : `${entry.waistCm} cm`}
                  </p>
                  {entry.bodyFatPercent !== null && (
                    <small>体脂方法：{entry.method || "未注明"}</small>
                  )}
                </div>
                <button
                  type="button"
                  className="text-button"
                  aria-label={`删除 ${entry.date} 的测量记录`}
                  onClick={() => {
                    onChange(value.filter((item) => item.id !== entry.id));
                    setNotice("这条测量记录已删除。");
                  }}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
        {value.length > 8 && (
          <p className="measurement-note">
            展示最近 8 条，其余记录仍保留在本机数据中。
          </p>
        )}
      </div>
    </section>
  );
}
