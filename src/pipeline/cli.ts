// GitHub Actions(pipeline.yml)가 호출하는 진입점.
//
//   npm run pipeline -- run  <step> <episodeId>            단계 실행
//   npm run pipeline -- fail <step> <episodeId> <message>  러너가 중간에 죽었을 때 실패 기록
//   npm run pipeline -- run  probe                         ManyMotions 모델 조회 (에피소드 없음)
//   npm run pipeline -- fail probe "" <message>
//
// 환경변수: DATABASE_URL, RUN_URL(이 Actions 실행 링크), GITHUB_STEP_SUMMARY(있으면 요약을 씀),
//           MANYMOTIONS_API_KEY(probe), ANTHROPIC_API_KEY(script·probe),
//           ANTHROPIC_ADMIN_KEY(probe, 선택: 실제 청구 비용 조회), ANTHROPIC_COST_WORKSPACE_ID(선택: 그 워크스페이스만)
import { appendFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { getPool, hasDatabase } from "@/lib/db";
import { redact } from "@/lib/health";
import { failStep } from "@/pipeline/episodes";
import { refreshManyMotionsAccount } from "@/pipeline/accounts";
import { refreshActualCosts } from "@/pipeline/costs";
import { collectCatalog, failProbe, finishProbe, startProbe } from "@/pipeline/probe";
import { listClaudeModels, readAnthropicKey } from "@/pipeline/providers/anthropic";
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

async function main(argv: string[]): Promise<number> {
  const [command, stepArg, idArg, ...rest] = argv;
  if (stepArg === "probe") return probe(command, rest.join(" "));
  const { step, id } = parseTarget(stepArg, idArg);
  const title = `### 에피소드 #${id} · ${STEP_LABELS[step]}`;

  if (command === "run") {
    try {
      const result = await runStep(id, step, { handlers, runUrl: process.env.RUN_URL || null });
      if (result.ok) {
        await summary([title, "", `✅ 완료 → ${STATUS_LABELS[result.episode.status]}`]);
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
