// 일회성 시험(이 브랜치에서만, main 에 넣지 않음): ManyMotions 로 한국어 내레이션 음성을 만들 수 있는지 확인한다.
// 크레딧 상한: 에이전트 지시 최대 4회(회당 5) + 음성 생성 1회(ElevenLabs v3 75) ≈ 95.
import { fetchManyMotionsAccount, readManyMotionsKey, createManyMotionsClient } from "@/pipeline/providers/manymotions";
import { redact } from "@/lib/health";

const MAX_TURNS = 4;
const SAMPLE = "연어에서 뽑은 DNA 성분, 정말 피부에 효과가 있을까요?";

const show = (label: string, value: unknown, max = 3000) =>
  console.log(`\n===== ${label}\n${redact(typeof value === "string" ? value : JSON.stringify(value, null, 2)).slice(0, max)}`);

async function main() {
  const key = readManyMotionsKey();
  const before = (await fetchManyMotionsAccount(key)) as { credits_remaining?: number; api_key?: unknown };
  show("잔액(시작)", before);

  const client = createManyMotionsClient(key);
  const tools = await client.listTools();
  for (const name of ["media_forge_generate", "job_status", "video_editor_create_project", "video_editor_instruct", "video_editor_get_state"]) {
    const tool = tools.find((t) => t.name === name);
    show(`도구 ${name}`, { description: tool?.description, inputSchema: tool?.inputSchema }, 6000);
  }

  const project = (await client.callTool("video_editor_create_project", { name: "voice-api-test" })) as Record<string, unknown>;
  show("프로젝트 생성", project);
  const projectId = String(project.project_id ?? project.id ?? (project.project as Record<string, unknown> | undefined)?.id ?? "");
  if (!projectId) throw new Error("project_id 를 찾지 못했습니다.");

  const instructions = [
    "이 프로젝트는 API 시험입니다. 아직 아무것도 생성하지 마세요. 내레이션(TTS)에 쓸 수 있는 음성 모델과, 각 모델에서 한국어에 쓸 수 있는 목소리 목록(이름과 ID, 성별·톤)을 알려 주세요.",
    `ElevenLabs v3 로 다음 한국어 문장의 내레이션 음성 하나만 생성해서 voice 트랙에 넣어 주세요. 영상·이미지·음악·효과음은 만들지 마세요. 확인 질문 없이 바로 진행하세요.\n문장: "${SAMPLE}"`,
  ];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const instruction = instructions[turn] ?? "네, 그대로 진행하세요. 음성 하나만 만들고 다른 것은 만들지 마세요.";
    const reply = (await client.callTool("video_editor_instruct", { project_id: projectId, instruction })) as Record<string, unknown>;
    show(`지시 ${turn + 1}: ${instruction.slice(0, 60)}`, reply, 5000);
    const assets = (reply.assets_created as { kind?: string }[] | undefined) ?? [];
    if (turn >= 1 && assets.some((asset) => asset.kind === "audio" || asset.kind === "voice")) break;
  }

  show("프로젝트 상태", await client.callTool("video_editor_get_state", { project_id: projectId }), 6000);
  const after = (await fetchManyMotionsAccount(key)) as { credits_remaining?: number };
  show("잔액(끝)", after);
  console.log(`\n차감: ${(before.credits_remaining ?? 0) - (after.credits_remaining ?? 0)} 크레딧`);
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exit(1);
});
