import { AutoRefresh } from "@/components/auto-refresh";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { dispatchAvailability } from "@/lib/github";
import type { ModelOption } from "@/pipeline/catalog";
import { isProbeBusy, latestProbe, latestSuccessfulProbe, needsRefresh, type ProbeState } from "@/pipeline/probe";
import { DEFAULT_SCRIPT_MODEL } from "@/pipeline/script/model";
import { getSettings } from "@/pipeline/settings";
import { AutoProbe, ProbeButton } from "./probe-button";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

const PROBE_STATE_LABELS: Record<ProbeState, string> = {
  pending: "갱신 대기",
  running: "갱신 중",
  done: "완료",
  failed: "실패",
};

export default async function SettingsPage() {
  await requireSession();
  const [settings, probe, lastSuccess] = await Promise.all([getSettings(), latestProbe(), latestSuccessfulProbe()]);
  const busy = isProbeBusy(probe);
  const availability = dispatchAvailability();
  // 목록이 없거나 하루 넘게 지났으면 화면을 여는 순간 자동으로 다시 가져온다(프로덕션에서만).
  const autoRefresh = availability.ok && needsRefresh(probe, lastSuccess);
  const catalog = lastSuccess?.catalog ?? { video: [], image: [], audio: [], other: {} };
  const claude = lastSuccess?.claudeModels;
  const claudeOptions: ModelOption[] = Array.isArray(claude)
    ? claude.map((model) => ({ id: model.id, label: model.label, vertical: null, fiveSeconds: null, detail: "" }))
    : [];
  const tools = lastSuccess?.tools ?? [];

  return (
    <>
      <AutoProbe enabled={autoRefresh} />
      <AutoRefresh active={busy || autoRefresh} />
      <h1>설정</h1>

      <section>
        <h2>생성 설정</h2>
        <p className="muted small">
          {lastSuccess
            ? `모델 목록: ${formatDateTime(lastSuccess.updatedAt)} 기준 (매일 자동 갱신)`
            : busy || autoRefresh
              ? "모델 목록을 처음 가져오는 중입니다. 1~2분 뒤 자동으로 표시됩니다."
              : "모델 목록이 아직 없습니다."}
        </p>
        <SettingsForm
          monthlyCreditLimit={settings.monthlyCreditLimit}
          voice={settings.voice ?? ""}
          fields={[
            {
              name: "scriptModel",
              label: "대본 모델 (Claude)",
              value: settings.scriptModel ?? "",
              options: claudeOptions,
              emptyLabel: `기본값 (${DEFAULT_SCRIPT_MODEL})`,
            },
            {
              name: "videoModel",
              label: "영상 모델 (텍스트→영상, 5초 장면 2개)",
              value: settings.videoModel ?? "",
              options: catalog.video,
              emptyLabel: "선택 안 함",
            },
            {
              name: "imageModel",
              label: "이미지 모델 (텍스트→이미지, 장면 2개)",
              value: settings.imageModel ?? "",
              options: catalog.image,
              emptyLabel: "선택 안 함",
            },
            {
              name: "voiceModel",
              label: "음성 모델 (내레이션)",
              value: settings.voiceModel ?? "",
              options: catalog.audio,
              emptyLabel: "선택 안 함",
            },
          ]}
        />
        {!Array.isArray(claude) && claude?.error ? (
          <p className="warn small">Claude 모델 목록을 가져오지 못했습니다: {claude.error}</p>
        ) : null}
      </section>

      <section>
        <h2>모델 목록 갱신</h2>
        {probe ? (
          <p className="small">
            마지막 갱신: <strong>{PROBE_STATE_LABELS[probe.state]}</strong> · {formatDateTime(probe.updatedAt)}
            {probe.runUrl ? (
              <>
                {" · "}
                <a href={probe.runUrl} target="_blank" rel="noreferrer">
                  실행 기록
                </a>
              </>
            ) : null}
          </p>
        ) : null}
        {probe?.state === "failed" && probe.error ? <p className="error prewrap small">{probe.error}</p> : null}
        <ProbeButton disabled={busy || !availability.ok} label={busy ? "갱신 중…" : "지금 새로 가져오기"} />
        {availability.ok ? null : <p className="warn small">{availability.reason}</p>}
      </section>

      {lastSuccess ? (
        <section>
          <details>
            <summary>ManyMotions 도구 {tools.length}개 (이름·필수 입력)</summary>
            <ul className="small">
              {tools.map((tool) => (
                <li key={tool.name}>
                  <code>{tool.name}</code>
                  {tool.inputSchema?.required?.length ? ` — 필수: ${tool.inputSchema.required.join(", ")}` : ""}
                  {tool.description ? <div className="muted">{tool.description.split("\n")[0]}</div> : null}
                </li>
              ))}
            </ul>
          </details>
          {Object.keys(catalog.other).length ? (
            <details>
              <summary>기타 목록 ({Object.keys(catalog.other).join(", ")})</summary>
              <ul className="small">
                {Object.entries(catalog.other).flatMap(([key, options]) =>
                  options.map((option) => (
                    <li key={`${key}-${option.id}`}>
                      <code>{option.id}</code> {option.label}
                    </li>
                  )),
                )}
              </ul>
            </details>
          ) : null}
          <details>
            <summary>응답 원문</summary>
            <pre className="raw">{JSON.stringify(lastSuccess.listings, null, 2)}</pre>
          </details>
        </section>
      ) : null}
    </>
  );
}
