import { AutoRefresh } from "@/components/auto-refresh";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { dispatchAvailability } from "@/lib/github";
import type { ModelOption } from "@/pipeline/catalog";
import { isProbeBusy, latestProbe, latestSuccessfulProbe, needsRefresh, type ProbeState } from "@/pipeline/probe";
import { DEFAULT_SCRIPT_MODEL } from "@/pipeline/script/model";
import { recommendedOption } from "@/pipeline/recommended";
import { getManyMotionsAccount } from "@/pipeline/accounts";
import { getCostStatus, monthlyActualCost, recentCosts, utcMonthStart } from "@/pipeline/costs";
import { formatUsd } from "@/pipeline/script/pricing";
import { scriptCostSince } from "@/pipeline/scripts";
import { getSettings } from "@/pipeline/settings";
import { DEFAULT_VOICE_ID, DEFAULT_VOICE_MODEL, VOICE_MODELS, VOICES, voiceLabel } from "@/pipeline/voices";
import { AutoProbe, ProbeButton } from "./probe-button";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

const PROBE_STATE_LABELS: Record<ProbeState, string> = {
  pending: "갱신 대기",
  running: "갱신 중",
  done: "완료",
  failed: "실패",
};

const COST_TYPE_LABELS: Record<string, string> = {
  tokens: "토큰",
  web_search: "웹 검색",
  code_execution: "코드 실행",
  session_usage: "세션",
};

export default async function SettingsPage() {
  await requireSession();
  const [settings, probe, lastSuccess, costStatus, costDays, actual, calculated, account] = await Promise.all([
    getSettings(),
    latestProbe(),
    latestSuccessfulProbe(),
    getCostStatus(),
    recentCosts(7),
    monthlyActualCost(),
    scriptCostSince(utcMonthStart()),
    getManyMotionsAccount(),
  ]);
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
  // 비워 두면(자동) 추천 모델을 쓴다. 어떤 모델인지 드롭다운 첫 줄에 보여 준다.
  const auto = (option: ModelOption | null) => (option ? `자동 · 추천: ${option.label}` : "선택 안 함");
  const scriptRecommended =
    claudeOptions.find((option) => option.id === DEFAULT_SCRIPT_MODEL) ??
    ({ id: DEFAULT_SCRIPT_MODEL, label: DEFAULT_SCRIPT_MODEL, vertical: null, fiveSeconds: null, detail: "" } as ModelOption);
  const video = recommendedOption("video", catalog.video);
  const image = recommendedOption("image", catalog.image);
  // 내레이션은 ManyMotions 영상 편집 에이전트의 ElevenLabs 목소리를 쓴다(모델 목록에는 음성이 없다).
  const option = (id: string, label: string): ModelOption => ({ id, label, vertical: null, fiveSeconds: null, detail: "" });
  const voiceOptions = VOICES.map((voice) => option(voice.id, voiceLabel(voice)));
  const voiceModelOptions = VOICE_MODELS.map((model) => option(model.id, model.label));
  const defaultVoice = voiceOptions.find((voice) => voice.id === DEFAULT_VOICE_ID) ?? null;
  const defaultVoiceModel = voiceModelOptions.find((model) => model.id === DEFAULT_VOICE_MODEL) ?? null;

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
          fields={[
            {
              name: "scriptModel",
              label: "대본 모델 (Claude)",
              value: settings.scriptModel ?? "",
              options: claudeOptions,
              recommended: scriptRecommended.id,
              emptyLabel: auto(scriptRecommended),
            },
            {
              name: "videoModel",
              label: "영상 모델 (텍스트→영상, 5초 장면 2개)",
              value: settings.videoModel ?? "",
              options: catalog.video,
              recommended: video?.id ?? null,
              emptyLabel: auto(video),
            },
            {
              name: "imageModel",
              label: "이미지 모델 (텍스트→이미지, 장면 2개)",
              value: settings.imageModel ?? "",
              options: catalog.image,
              recommended: image?.id ?? null,
              emptyLabel: auto(image),
            },
            {
              name: "voice",
              label: "기본 목소리 (내레이션, 쇼츠마다 바꿀 수 있음)",
              value: settings.voice ?? "",
              options: voiceOptions,
              recommended: DEFAULT_VOICE_ID,
              emptyLabel: auto(defaultVoice),
            },
            {
              name: "voiceModel",
              label: "음성 모델 (내레이션)",
              value: settings.voiceModel ?? "",
              options: voiceModelOptions,
              recommended: DEFAULT_VOICE_MODEL,
              emptyLabel: auto(defaultVoiceModel),
            },
          ]}
        />
        <p className="muted small">
          ★ 는 가성비 추천 모델입니다. &quot;자동&quot; 으로 두면 목록이 바뀌어도 추천 모델을 따라갑니다.
        </p>
        {!Array.isArray(claude) && claude?.error ? (
          <p className="warn small">Claude 모델 목록을 가져오지 못했습니다: {claude.error}</p>
        ) : null}
      </section>

      <section id="manymotions-credits">
        <h2>ManyMotions 크레딧</h2>
        {account?.credits != null ? (
          <p>
            잔여 <strong>{account.credits.toLocaleString("ko-KR")}</strong> 크레딧
            {"credits_used_this_period" in account.fields && "credits_total_this_period" in account.fields
              ? ` · 이번 결제 기간 사용 ${account.fields.credits_used_this_period.toLocaleString("ko-KR")} / ${account.fields.credits_total_this_period.toLocaleString("ko-KR")}`
              : ""}
            <br />
            <span className="muted small">
              {account.fetchedAt ? `${formatDateTime(account.fetchedAt)} 조회` : ""} · 응답의 <code>{account.creditsField}</code> 값 ·
              모델 목록과 함께 매일 갱신. 아래 &quot;이번 달 사용&quot; 은 이 파이프라인이 쓴 크레딧만 센 값입니다.
            </span>
          </p>
        ) : (
          <p className="muted small">
            {account ? "잔여 크레딧을 아직 알아내지 못했습니다." : "아직 조회한 적이 없습니다. 아래 \"지금 새로 가져오기\" 를 누르세요."}
          </p>
        )}
        {account?.message ? (
          <p className={`${account.state === "failed" ? "error" : "warn"} small prewrap`}>
            {account.state === "failed" ? `마지막 조회 실패(${formatDateTime(account.checkedAt)}): ` : ""}
            {account.message}
          </p>
        ) : null}
        {account && Object.keys(account.fields).length ? (
          <details>
            <summary className="small">응답의 숫자 필드</summary>
            <ul className="small">
              {Object.entries(account.fields).map(([path, value]) => (
                <li key={path}>
                  <code>{path}</code>: {value.toLocaleString("ko-KR")}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section id="costs">
        <h2>Claude 실제 비용</h2>
        {actual ? (
          <p>
            이번 달(UTC) 실제 <strong>{formatUsd(actual.usd)}</strong> · 대본 계산값 {formatUsd(calculated.total)} (
            {calculated.runs}회)
            <br />
            <span className="muted small">
              {formatDateTime(actual.fetchedAt)} 조회 · 요청 후 보통 5분 안에 반영되고, 모델 목록과 함께 매일 갱신됩니다.
            </span>
          </p>
        ) : (
          <p className="muted small">아직 실제 비용을 가져온 적이 없습니다.</p>
        )}
        {costStatus?.state === "failed" ? (
          <p className="error small prewrap">
            마지막 조회 실패({formatDateTime(costStatus.updatedAt)}): {costStatus.message}
          </p>
        ) : null}
        {!costStatus || costStatus.state !== "ok" ? (
          <div className="callout small">
            <strong>연결 방법</strong>
            <ol>
              <li>Claude Console 이 조직 계정이어야 합니다(Settings → Organization). 개인 계정은 Admin 키를 만들 수 없습니다.</li>
              <li>
                조직의 admin 역할로{" "}
                <a href="https://platform.claude.com/settings/admin-keys" target="_blank" rel="noreferrer">
                  Claude Console &gt; Settings &gt; Admin keys
                </a>
                에서 Admin 키(sk-ant-admin01-…)를 만듭니다. 일반 API 키(sk-ant-api03-…)로는 조회할 수 없습니다(403).
              </li>
              <li>
                GitHub 저장소 → Settings → Secrets and variables → Actions 에 <code>ANTHROPIC_ADMIN_KEY</code> 로
                등록합니다(채팅에 붙이지 마세요).
              </li>
              <li>
                선택: 이 프로젝트 키를 별도 워크스페이스에 두었다면 Variables 에 <code>ANTHROPIC_COST_WORKSPACE_ID</code>
                (wrkspc_…)를 넣으면 그 워크스페이스 비용만 셉니다.
              </li>
              <li>아래 &quot;지금 새로 가져오기&quot; 를 누르면 1~2분 뒤 표시됩니다.</li>
            </ol>
          </div>
        ) : null}
        {costDays.length ? (
          <details>
            <summary className="small">최근 {costDays.length}일 (UTC 날짜)</summary>
            <ul className="small">
              {costDays.map((day) => (
                <li key={day.day}>
                  {day.day}: <strong>{formatUsd(day.usd)}</strong>
                  {day.breakdown.length ? (
                    <span className="muted">
                      {" — "}
                      {day.breakdown
                        .map((part) => `${part.model ?? COST_TYPE_LABELS[part.costType] ?? part.costType} ${formatUsd(part.usd)}`)
                        .join(" · ")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
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
