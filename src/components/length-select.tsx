import { lengthRules, TARGET_SECONDS } from "@/pipeline/script/schema";

/** 영상 길이(초) 고르기. 길이마다 장면 수가 정해진다. */
export function LengthSelect({
  name = "targetSeconds",
  label = "영상 길이",
  defaultValue,
  hint,
}: {
  name?: string;
  label?: string;
  defaultValue: number;
  hint: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select name={name} defaultValue={defaultValue}>
        {TARGET_SECONDS.map((seconds) => (
          <option key={seconds} value={seconds}>
            {seconds}초 · 장면 {lengthRules(seconds).scenes}개
          </option>
        ))}
      </select>
      <small className="muted">{hint}</small>
    </label>
  );
}
