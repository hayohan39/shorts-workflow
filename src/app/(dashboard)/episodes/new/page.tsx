import { requireSession } from "@/lib/auth";
import { OUTLINE_MAX, TOPIC_MAX } from "@/pipeline/episodes";
import { NewEpisodeForm } from "./new-episode-form";

export const dynamic = "force-dynamic";

export default async function NewEpisodePage() {
  await requireSession();
  return (
    <>
      <h1>새 에피소드</h1>
      <p className="muted">만들면 바로 대본 생성이 시작됩니다. 대본은 검토 후 승인해야 다음 단계로 넘어갑니다.</p>
      <NewEpisodeForm topicMax={TOPIC_MAX} outlineMax={OUTLINE_MAX} />
    </>
  );
}
