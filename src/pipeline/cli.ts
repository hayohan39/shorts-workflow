// GitHub Actions(pipeline.yml)가 호출하는 진입점.
//
//   npm run pipeline -- run  <step> <episodeId>            단계 실행
//   npm run pipeline -- fail <step> <episodeId> <message>  러너가 중간에 죽었을 때 실패 기록
//   npm run pipeline -- run  probe                         ManyMotions 모델 조회 (에피소드 없음)
//   npm run pipeline -- fail probe "" <message>
//   npm run pipeline -- run  clips|clips-adopt <collectionId>   영상 클립 수집 / 채택(다운로드·변환·Blob)
//   npm run pipeline -- fail clips|clips-adopt <collectionId> <message>
//   npm run pipeline -- run  clips-daily                       매일 자동 수집(켜져 있을 때만, 태그 하나)
//   npm run pipeline -- run  ideas <ideaRunId>                 채널 추천(기획안) 만들기
//   npm run pipeline -- fail ideas <ideaRunId> <message>
//   npm run pipeline -- run  ideas-daily                       매일 실행: 자동 추천이 켜져 있고 주기가 된 채널만
//
// 환경변수: DATABASE_URL, RUN_URL(이 Actions 실행 링크), GITHUB_STEP_SUMMARY(있으면 요약을 씀),
//           MANYMOTIONS_API_KEY(probe), ANTHROPIC_API_KEY(script·probe·ideas),
//           ANTHROPIC_ADMIN_KEY(probe, 선택: 실제 청구 비용 조회), ANTHROPIC_COST_WORKSPACE_ID(선택: 그 워크스페이스만),
//           PIXABAY_API_KEY(clips), BLOB_READ_WRITE_TOKEN(clips-adopt),
//           YOUTUBE_CLIENT_ID·YOUTUBE_CLIENT_SECRET·채널별 리프레시 토큰(upload, channels.youtube_token_secret 이 이름)
import { appendFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { getPool, hasDatabase } from "@/lib/db";
import { redact } from "@/lib/health";
import { failStep, getEpisode } from "@/pipeline/episodes";
import { refreshManyMotionsAccount } from "@/pipeline/accounts";
import { listAssets } from "@/pipeline/assets";
import { adoptClips } from "@/pipeline/clips/adopt";
import { fillScenesFromPicks } from "@/pipeline/clips/picks";
import { collectClips } from "@/pipeline/clips/collect";
import { createAdapters } from "@/pipeline/clips/sources";
import {
  createDailyCollection,
  failAdopt,
  failCollection,
  finishAdopt,
  isDailyEnabled,
  pickDailyTag,
  startAdopt,
  startCollection,
} from "@/pipeline/clips/store";
import { SOURCE_LABELS, type ClipSourceId } from "@/pipeline/clips/types";
import { ideasDaily, runIdeaRun, type IdeaRunResult } from "@/pipeline/ideas/run";
import { failIdeaRun } from "@/pipeline/ideas/store";
import { createSender } from "@/pipeline/script/generate";
import { formatUsd } from "@/pipeline/script/pricing";
import { refreshActualCosts } from "@/pipeline/costs";
import { collectCatalog, failProbe, finishProbe, startProbe } from "@/pipeline/probe";
import { listClaudeModels, readAnthropicKey } from "@/pipeline/providers/anthropic";
import { createBlobPut, readBlobToken } from "@/pipeline/providers/blob";
import { createManyMotionsClient, readManyMotionsKey } from "@/pipeline/providers/manymotions";
import { runStep } from "@/pipeline/runner";
import { isStep, STATUS_LABELS, STEP_LABELS, TransitionError, type Step } from "@/pipeline/status";
import { handlers } from "@/pipeline/steps";

const USAGE = "사용법: pipeline run <step> <episodeId> | pipeline fail <step> <episodeId> <message>";

function parseTarget(stepArg: string | undefined, idArg: string | undefined): { step: Step; id: number } {
  if (!isStep(stepArg)) throw new Error(`알 수 없는 단계: ${stepArg ?? "(없음)"}\n${USAGE}`);
  const id = Number(idArg);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`에피소드 ID 가 올바르지 않습니다: ${idArg ?? "(없음)"}`);
  return { step: stepArg, id };
}

/** 실행 요약(로그·GITHUB_STEP_SUMMARY). 오류 메시지에 섞인 비밀값은 가린다. */
async function summary(lines: string[]): Promise<void> {
  const text = redact(lines.join("\n") + "\n");
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text);
}

async function probe(command: string | undefined, message: string): Promise<number> {
  const title = "### 모델 목록·실제 비용·잔여 크레딧 조회";
  if (command === "fail") {
    await failProbe(message || "Actions 실행이 중간에 중단되었습니다.");
    await summary([title, "", "중단 기록"]);
    return 0;
  }
  if (command !== "run") throw new Error(USAGE);

  const started = await startProbe(process.env.RUN_URL || null);
  // 실제 청구 비용은 모델 목록과 따로 가져온다. 실패해도 모델 목록 조회를 막지 않는다(상태만 남김).
  const costs = await refreshActualCosts();
  try {
    const manyMotionsKey = readManyMotionsKey();
    const balance = await refreshManyMotionsAccount(manyMotionsKey);
    const client = createManyMotionsClient(manyMotionsKey);
    const collected = await collectCatalog(client, () =>
      listClaudeModels(new Anthropic({ apiKey: readAnthropicKey() })),
    );
    const result = await finishProbe(started.id, collected);
    const tools = result.tools ?? [];
    const { catalog } = result;
    const claude = Array.isArray(collected.claudeModels)
      ? `Claude 모델 ${collected.claudeModels.length}개`
      : `Claude 모델 조회 실패: ${collected.claudeModels.error}`;
    await summary([
      title,
      "",
      `✅ 도구 ${tools.length}개 · 영상 ${catalog.video.length} · 이미지 ${catalog.image.length} · 음성 ${catalog.audio.length} · ${claude}`,
      "",
      costs,
      "",
      balance,
      "",
      ...tools.map((tool) => `- \`${tool.name}\` ${tool.description?.split("\n")[0] ?? ""}`),
    ]);
    return 0;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    await failProbe(text, started.id);
    await summary([title, "", `❌ 실패: ${text}`, "", costs]);
    return 1;
  }
}

/** 영상 클립 수집(clips)·채택(clips-adopt). 대상은 clip_collections 의 ID. */
async function clips(command: string | undefined, step: "clips" | "clips-adopt", idArg: string | undefined, message: string) {
  const id = Number(idArg);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`수집 ID 가 올바르지 않습니다: ${idArg ?? "(없음)"}`);
  const adopt = step === "clips-adopt";
  const title = `### 영상 클립 ${adopt ? "채택" : "수집"} #${id}`;
  if (command === "fail") {
    const reason = message || "Actions 실행이 중간에 중단되었습니다.";
    await (adopt ? failAdopt(id, reason) : failCollection(id, reason));
    await summary([title, "", "중단 기록"]);
    return 0;
  }
  if (command !== "run") throw new Error(USAGE);

  const runUrl = process.env.RUN_URL || null;
  const started = await (adopt ? startAdopt(id, runUrl) : startCollection(id, runUrl));
  if (!started) {
    await summary([title, "", `⏭️ 시작하지 않음: ${adopt ? "수집이 끝나지 않았거나 없는 수집입니다." : "없거나 이미 끝난 수집입니다."}`]);
    return 1;
  }
  try {
    if (adopt) {
      const count = await adoptClips(id, {
        put: createBlobPut(readBlobToken()),
        progress: async (text) => console.log(`채택 ${text}`),
      });
      await finishAdopt(id);
      // 에피소드에서 고른 클립이면, 대본이 이미 승인됐을 때 바로 장면을 채운다(아니면 승인할 때 채운다).
      const episode = started.episodeId ? await getEpisode(started.episodeId) : null;
      // 채우기가 실패해도 채택은 끝났다. 대본을 승인할 때 다시 채운다.
      const filled = episode
        ? await fillScenesFromPicks(episode).catch((error: unknown) => {
            console.warn(`장면 채우기 실패: ${error instanceof Error ? error.message : String(error)}`);
            return 0;
          })
        : 0;
      await summary([title, "", `✅ ${count}개 채택${filled ? ` · 에피소드 #${episode!.id} 장면 ${filled}개 채움` : ""}`]);
    } else {
      const done = await collectClips(started, {
        adapters: createAdapters(),
        send: (params) => new Anthropic({ apiKey: readAnthropicKey() }).messages.create(params),
      });
      const sources = Object.entries(done.sourceResults).map(
        ([source, result]) =>
          `- ${SOURCE_LABELS[source as ClipSourceId]}: ${result.found}개 중 ${result.kept}개 선택${result.error ? ` (⚠️ ${result.error})` : ""}`,
      );
      await summary([
        title,
        "",
        `✅ 키워드 ${done.keywords.join(", ")} · 합계 ${done.totalSeconds ?? 0}초${done.shortfall ? ` · ${done.shortfall}` : ""}`,
        "",
        ...sources,
      ]);
    }
    return 0;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    await (adopt ? failAdopt(id, text) : failCollection(id, text));
    await summary([title, "", `❌ 실패: ${text}`]);
    return 1;
  }
}

/** 매일 자동 수집: 켜져 있으면 최근 7일 안에 쓰지 않은 태그 하나로 수집한다. */
async function clipsDaily(command: string | undefined): Promise<number> {
  if (command !== "run") throw new Error(USAGE);
  const title = "### 영상 클립 매일 수집";
  if (!(await isDailyEnabled())) {
    await summary([title, "", "⏭️ 꺼져 있어 건너뜀 (클립 보관함 화면에서 켤 수 있습니다)"]);
    return 0;
  }
  const tag = await pickDailyTag();
  if (!tag) {
    await summary([title, "", "⏭️ 쓸 수 있는 태그가 없습니다(켜진 태그가 없거나 모두 최근 7일 안에 썼습니다)."]);
    return 0;
  }
  const collection = await createDailyCollection(tag);
  return clips("run", "clips", String(collection.id), "");
}

function ideaLines(result: IdeaRunResult): string[] {
  const cost = result.costUsd === null ? "" : ` · 비용 약 ${formatUsd(result.costUsd)}`;
  return [`✅ 기획안 ${result.ideas.length}개${cost}`, "", ...result.ideas.map((idea) => `- ${idea.title} (${idea.targetSeconds}초)`)];
}

/** 채널 추천 한 번(대시보드 "지금 추천 받기"). */
async function ideas(command: string | undefined, idArg: string | undefined, message: string): Promise<number> {
  const id = Number(idArg);
  if (!Number.isInteger(id) || id <= 0) throw new Error(USAGE);
  const title = `### 채널 추천 #${id}`;
  if (command === "fail") {
    await failIdeaRun(id, message || "Actions 실행이 중간에 중단되었습니다.");
    await summary([title, "", "실패로 기록했습니다."]);
    return 0;
  }
  if (command !== "run") throw new Error(USAGE);
  try {
    const send = createSender(new Anthropic({ apiKey: readAnthropicKey() }));
    await summary([title, "", ...ideaLines(await runIdeaRun(id, { send, runUrl: process.env.RUN_URL || null }))]);
    return 0;
  } catch (error) {
    await summary([title, "", `❌ 실패: ${error instanceof Error ? error.message : String(error)}`]);
    return 1;
  }
}

/** 매일 실행: 자동 추천이 켜져 있고 주기가 된 채널만(기본 꺼짐). */
async function ideasDailyCommand(command: string | undefined): Promise<number> {
  if (command !== "run") throw new Error(USAGE);
  const title = "### 채널 추천 매일 실행";
  const send = createSender(new Anthropic({ apiKey: readAnthropicKey() }));
  const outcomes = await ideasDaily({ send, runUrl: process.env.RUN_URL || null });
  if (!outcomes.length) {
    await summary([title, "", "⏭️ 주기가 된 채널이 없습니다(자동 추천이 꺼져 있거나, 최근에 만들었거나, 보지 않은 기획안이 많음)."]);
    return 0;
  }
  for (const outcome of outcomes) {
    await summary([`${title} · ${outcome.channel}`, "", ...(outcome.result ? ideaLines(outcome.result) : [`❌ 실패: ${outcome.error}`])]);
  }
  return outcomes.every((outcome) => outcome.result) ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const [command, stepArg, idArg, ...rest] = argv;
  if (stepArg === "probe") return probe(command, rest.join(" "));
  if (stepArg === "clips" || stepArg === "clips-adopt") return clips(command, stepArg, idArg, rest.join(" "));
  if (stepArg === "clips-daily") return clipsDaily(command);
  if (stepArg === "ideas") return ideas(command, idArg, rest.join(" "));
  if (stepArg === "ideas-daily") return ideasDailyCommand(command);
  const { step, id } = parseTarget(stepArg, idArg);
  const title = `### 에피소드 #${id} · ${STEP_LABELS[step]}`;

  if (command === "run") {
    try {
      const runUrl = process.env.RUN_URL || null;
      const result = await runStep(id, step, { handlers, runUrl });
      if (result.ok) {
        await summary([title, "", `✅ 완료 → ${STATUS_LABELS[result.episode.status]}`]);
        // 장면 생성이 끝났고 내레이션이 있으면 같은 실행에서 바로 합성까지 한다(크레딧 없음).
        if (step === "render" && (await listAssets(id, "voice")).length) {
          const composed = await runStep(id, "compose", { handlers, runUrl });
          await summary([
            `### 에피소드 #${id} · ${STEP_LABELS.compose}`,
            "",
            composed.ok ? `✅ 완료 → ${STATUS_LABELS[composed.episode.status]}` : `❌ 실패: ${composed.error}`,
          ]);
          return composed.ok ? 0 : 1;
        }
        return 0;
      }
      await summary([title, "", `❌ 실패: ${result.error}`]);
      return 1;
    } catch (error) {
      if (error instanceof TransitionError) {
        await summary([title, "", `⏭️ 시작하지 않음: ${error.message}`]);
        return 1;
      }
      throw error;
    }
  }

  if (command === "fail") {
    const message = rest.join(" ") || "Actions 실행이 중간에 중단되었습니다.";
    const episode = await failStep(id, step, message);
    await summary([title, "", `상태: ${STATUS_LABELS[episode.status]}${episode.error ? ` (${episode.error})` : ""}`]);
    return 0;
  }

  throw new Error(USAGE);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => (hasDatabase() ? getPool().end().catch(() => {}) : undefined));
