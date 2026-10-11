// GitHub Actions(pipeline.yml)가 호출하는 진입점.
//
//   npm run pipeline -- run  <step> <episodeId>            단계 실행
//   npm run pipeline -- fail <step> <episodeId> <message>  러너가 중간에 죽었을 때 실패 기록
//
// 환경변수: DATABASE_URL, RUN_URL(이 Actions 실행 링크), GITHUB_STEP_SUMMARY(있으면 요약을 씀)
import { appendFile } from "node:fs/promises";
import { getPool, hasDatabase } from "@/lib/db";
import { failStep } from "@/pipeline/episodes";
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

async function summary(lines: string[]): Promise<void> {
  const text = lines.join("\n") + "\n";
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text);
}

async function main(argv: string[]): Promise<number> {
  const [command, stepArg, idArg, ...rest] = argv;
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
