import { AutoRefresh } from "@/components/auto-refresh";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { dispatchAvailability } from "@/lib/github";
import { isProbeBusy, latestProbe, latestSuccessfulProbe, type ProbeState } from "@/pipeline/probe";
import { DEFAULT_SCRIPT_MODEL } from "@/pipeline/script/model";
import { getSettings } from "@/pipeline/settings";
import { ProbeButton } from "./probe-button";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

const PROBE_STATE_LABELS: Record<ProbeState, string> = {
  pending: "실행 대기",
  running: "조회 중",
  done: "완료",
  failed: "실패",
};

export default async function SettingsPage() {
  await requireSession();
  const [settings, probe, catalog] = await Promise.all([getSettings(), latestProbe(), latestSuccessfulProbe()]);
  const busy = isProbeBusy(probe);
  const availability = dispatchAvailability();
  const items = catalog?.models ?? [];
  const tools = catalog?.tools ?? [];

  return (
    <>
      <AutoRefresh active={busy} />
      <h1>설정</h1>

      <section>
        <h2>ManyMotions 모델 조회</h2>
        <p className="muted small">
          사용할 수 있는 모델·목소리와 크레딧을 ManyMotions 에서 직접 가져옵니다. 크레딧은 쓰지 않습니다.
        </p>
        {probe ? (
          <p>
            마지막 조회: <strong>{PROBE_STATE_LABELS[probe.state]}</strong> · {formatDateTime(probe.updatedAt)}
            {probe.runUrl ? (
              <>
                {" · "}
                <a href={probe.runUrl} target="_blank" rel="noreferrer">
                  실행 기록
                </a>
              </>
            ) : null}
          </p>
        ) : (
          <p className="muted">아직 조회하지 않았습니다.</p>
        )}
        {probe?.state === "failed" && probe.error ? <p className="error prewrap">{probe.error}</p> : null}
        {/* 프리뷰·로컬에서도 버튼은 보이게 두고 누를 수 없게만 한다(실행 요청은 프로덕션에서만). */}
        <ProbeButton disabled={busy || !availability.ok} label={busy ? "조회 중…" : "모델 조회"} />
        {availability.ok ? null : <p className="warn small">{availability.reason}</p>}
      </section>

      <section>
        <h2>생성 설정</h2>
        <SettingsForm
          options={items.map((item) => ({ id: item.id, label: item.label }))}
          monthlyCreditLimit={settings.monthlyCreditLimit}
          fields={[
            { name: "scriptModel", label: "대본 모델 (Claude)", hint: `비우면 ${DEFAULT_SCRIPT_MODEL}`, value: settings.scriptModel ?? "", fromCatalog: false },
            { name: "videoModel", label: "영상 모델 (5초 장면 2개)", hint: "예정: Kling 3.0 Standard", value: settings.videoModel ?? "", fromCatalog: true },
            { name: "imageModel", label: "이미지 모델 (장면 2개)", hint: "예정: Seedream 4.5", value: settings.imageModel ?? "", fromCatalog: true },
            { name: "voiceModel", label: "음성 모델", hint: "예정: ElevenLabs v3", value: settings.voiceModel ?? "", fromCatalog: true },
            { name: "voice", label: "목소리 (채널 전체 고정)", hint: "조회 결과의 목소리 ID", value: settings.voice ?? "", fromCatalog: true },
          ]}
        />
      </section>

      {catalog ? (
        <section>
          <h2>조회 결과 ({formatDateTime(catalog.updatedAt)})</h2>
          {items.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>이름</th>
                    <th>종류</th>
                    <th>크레딧</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <code>{item.id}</code>
                      </td>
                      <td>{item.label}</td>
                      <td>{item.kind ?? ""}</td>
                      <td>{item.credits ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="warn">응답에서 모델 목록을 찾지 못했습니다. 아래 원문을 확인하세요.</p>
          )}
          <details>
            <summary>도구 {tools.length}개 (이름·필수 입력)</summary>
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
          <details>
            <summary>응답 원문</summary>
            <pre className="raw">{JSON.stringify(catalog.listings, null, 2)}</pre>
          </details>
        </section>
      ) : null}
    </>
  );
}
