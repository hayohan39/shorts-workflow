import { requireSession } from "@/lib/auth";
import { dispatchAvailability } from "@/lib/github";
import { OUTLINE_MAX, TOPIC_MAX } from "@/pipeline/episodes";
import { NewEpisodeForm } from "./new-episode-form";

export const dynamic = "force-dynamic";

export default async function NewEpisodePage() {
  await requireSession();
  const availability = dispatchAvailability();
  return (
    <>
      <h1>새 에피소드</h1>
      {availability.ok ? (
        <p className="muted">만들면 바로 대본 생성이 시작됩니다. 대본은 검토 후 승인해야 다음 단계로 넘어갑니다.</p>
      ) : (
        <p className="warn">이 화면에서는 에피소드만 만들어지고 대본 생성은 시작되지 않습니다. {availability.reason}</p>
      )}
      <NewEpisodeForm topicMax={TOPIC_MAX} outlineMax={OUTLINE_MAX} startsRun={availability.ok} />
    </>
  );
}
