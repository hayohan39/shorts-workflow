// 일회성 시험 2 (이 브랜치에서만, main 에 넣지 않음)
//  1) 한국어 목소리 목록을 JSON 으로 받을 수 있는지 + 미리 듣기(preview) 주소가 있는지 (에이전트 지시 1회, 5크레딧)
//  2) media_forge_generate 로 이미지 1장(Seedream 4.5, 23크레딧) → job_status 응답 형태
import { fetchManyMotionsAccount, readManyMotionsKey, createManyMotionsClient } from "@/pipeline/providers/manymotions";
import { redact } from "@/lib/health";

const show = (label: string, value: unknown, max = 8000) =>
  console.log(`\n===== ${label}\n${redact(typeof value === "string" ? value : JSON.stringify(value, null, 2)).slice(0, max)}`);

async function main() {
  const key = readManyMotionsKey();
  const before = (await fetchManyMotionsAccount(key)) as { credits_remaining?: number };
  show("잔액(시작)", before.credits_remaining);
  const client = createManyMotionsClient(key);

  const project = (await client.callTool("video_editor_create_project", { name: "voice-preview-test", aspect_ratio: "9:16" })) as { project_id: string };
  const reply = (await client.callTool("video_editor_instruct", {
    project_id: project.project_id,
    instruction:
      "API 시험입니다. 아무것도 생성하지 마세요. 내레이션에 쓸 수 있는 한국어 목소리 전체 목록을 JSON 코드 블록 하나로만 답해 주세요. " +
      '형식: [{"voice_id":"...","name":"...","gender":"...","age":"...","description":"...","preview_url":"..."}]. ' +
      "preview_url 은 각 목소리의 공식 미리 듣기(샘플) 오디오 주소이고, 없으면 null 로 두세요. 다른 설명은 쓰지 마세요.",
  })) as Record<string, unknown>;
  show("목소리 목록 응답", reply, 20000);

  const models = (await client.callTool("list_models", {})) as { list_models?: { image?: { id: string; name: string }[] }; image?: { id: string; name: string }[] };
  const images = models.image ?? models.list_models?.image ?? [];
  const seedream = images.find((m) => /seedream.*4\.?5/i.test(m.name) && !/edit/i.test(m.name));
  show("Seedream 4.5", seedream ?? Object.keys(models));
  if (seedream) {
    const submitted = await client.callTool("media_forge_generate", {
      type: "image",
      model_id: seedream.id,
      params: { prompt: "Macro photo of a glass skincare serum bottle on a white marble surface, soft daylight, no text", aspect_ratio: "9:16", count: 1 },
    });
    show("생성 요청 응답", submitted);
    const jobId = (submitted as { job_id?: string }).job_id;
    for (let i = 0; jobId && i < 40; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const status = (await client.callTool("job_status", { job_id: jobId })) as { status?: string };
      if (i === 0 || status.status === "completed" || status.status === "failed") show(`job_status (${i})`, status);
      if (status.status === "completed" || status.status === "failed") break;
    }
  }
  const after = (await fetchManyMotionsAccount(key)) as { credits_remaining?: number };
  console.log(`\n차감: ${(before.credits_remaining ?? 0) - (after.credits_remaining ?? 0)} 크레딧 (남은 ${after.credits_remaining})`);
}

main().catch((error) => {
  console.error(redact(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exit(1);
});
