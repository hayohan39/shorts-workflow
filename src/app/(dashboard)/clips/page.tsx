import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { dispatchAvailability } from "@/lib/github";
import { isJobBusy, listCollections, listSourceStates, TOPIC_MAX } from "@/pipeline/clips/store";
import { SOURCE_LABELS } from "@/pipeline/clips/types";
import { CollectForm } from "./clip-forms";
import { JobBadge } from "./job-badge";

export const dynamic = "force-dynamic";

export default async function ClipsPage() {
  await requireSession();
  const [collections, sources] = await Promise.all([listCollections(), listSourceStates()]);
  const busy = collections.some(
    (collection) =>
      isJobBusy(collection.status, collection.updatedAt) || isJobBusy(collection.adoptStatus, collection.updatedAt),
  );

  return (
    <>
      <AutoRefresh active={busy} />
      <h1>영상 소스</h1>
      <p className="muted">
        주제를 넣으면 무료 라이선스 영상 클립을 찾아 쇼츠 한 편 분량(60~120초)을 추천합니다. 마음에 들지 않는 클립은
        교체하고, 채택하면 파일을 저장하고 출처 표기를 만들어 둡니다.
      </p>

      <section>
        <CollectForm disabled={!dispatchAvailability().ok} maxLength={TOPIC_MAX} />
      </section>

      <section>
        <h2>최근 수집</h2>
        {collections.length === 0 ? (
          <p className="muted">아직 수집한 적이 없습니다.</p>
        ) : (
          <ul className="cards">
            {collections.map((collection) => (
              <li key={collection.id}>
                <Link href={`/clips/${collection.id}`} className="card">
                  <div className="row between">
                    <strong>
                      #{collection.id} {collection.topic}
                    </strong>
                    <JobBadge status={collection.status} />
                  </div>
                  <div className="muted small">
                    {collection.totalSeconds !== null ? `합계 ${collection.totalSeconds}초 · ` : ""}
                    {collection.adoptStatus === "done" ? "채택함 · " : ""}
                    {formatDateTime(collection.createdAt)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sources.length > 0 ? (
        <section>
          <h2>소스 호출 현황</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>소스</th>
                  <th>오늘 요청</th>
                  <th>마지막 응답</th>
                  <th>마지막 429</th>
                  <th>대기 해제</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((state) => (
                  <tr key={state.source}>
                    <td>{SOURCE_LABELS[state.source]}</td>
                    <td>{state.requestsToday}</td>
                    <td>{state.lastStatus ?? "—"}</td>
                    <td>{state.last429At ? formatDateTime(state.last429At) : "—"}</td>
                    <td>{state.retryAt ? formatDateTime(state.retryAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
