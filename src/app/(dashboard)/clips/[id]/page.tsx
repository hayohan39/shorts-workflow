import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { dispatchAvailability } from "@/lib/github";
import { clipsToAdopt } from "@/pipeline/clips/adopt";
import { attributionText, hasShareAlike } from "@/pipeline/clips/attribution";
import { isSelectable } from "@/pipeline/clips/select";
import { getCollection, isJobBusy, listClips, type StoredClip } from "@/pipeline/clips/store";
import { orientationOf, SOURCE_LABELS, type ClipSourceId, type Orientation } from "@/pipeline/clips/types";
import { formatUsd } from "@/pipeline/script/pricing";
import { AdoptButton, RetryCollectButton, SwapButton } from "../clip-forms";
import { JobBadge } from "../job-badge";

export const dynamic = "force-dynamic";

/** [교체] 목록에 보여 줄 후보 수 */
const SWAP_OPTIONS = 6;

const ORIENTATION_LABELS: Record<Orientation, string> = { vertical: "세로", square: "정사각", horizontal: "가로" };

function ClipMeta({ clip }: { clip: StoredClip }) {
  const orientation = orientationOf(clip.width, clip.height);
  return (
    <div className="stack">
      <a href={clip.pageUrl} target="_blank" rel="noreferrer">
        {clip.title}
      </a>
      <div className="muted small">
        {clip.durationSec !== null ? `${clip.durationSec}초` : "길이 모름"}
        {orientation ? ` · ${ORIENTATION_LABELS[orientation]} ${clip.width}×${clip.height}` : ""} ·{" "}
        {SOURCE_LABELS[clip.source]}
        {clip.author ? ` · ${clip.author}` : ""} · 검색어 “{clip.keyword}”
      </div>
      <div className="row">
        <span className="badge">{clip.license.name}</span>
        {clip.license.code === "cc-by-sa" ? <span className="badge badge-failed">동일조건(SA)</span> : null}
        {clip.blobUrl ? <span className="badge badge-ready">채택됨</span> : null}
      </div>
    </div>
  );
}

function ClipMedia({ clip }: { clip: StoredClip }) {
  const src = clip.blobUrl ?? clip.previewUrl;
  if (!src) return null;
  return (
    <video
      className="scene-media"
      src={src}
      poster={clip.thumbnailUrl ?? undefined}
      controls
      muted
      playsInline
      preload="none"
    />
  );
}

export default async function ClipCollectionPage({ params }: PageProps<"/clips/[id]">) {
  await requireSession();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [collection, clips] = await Promise.all([getCollection(id), listClips(id)]);
  if (!collection) notFound();

  const collecting = isJobBusy(collection.status, collection.updatedAt);
  const adopting = isJobBusy(collection.adoptStatus, collection.updatedAt);
  const canDispatch = dispatchAvailability().ok;
  const selected = clips.filter((clip) => clip.rank !== null);
  const swapOptions = clips.filter((clip) => clip.rank === null && isSelectable(clip)).slice(0, SWAP_OPTIONS);
  const toAdopt = clipsToAdopt(clips).length;
  const attribution = attributionText(clips);
  const runUrl = collection.adoptRunUrl ?? collection.runUrl;

  return (
    <>
      <AutoRefresh active={collecting || adopting} />
      <Link href="/clips" className="back">
        ← 영상 소스
      </Link>
      <div className="row between">
        <h1>
          #{collection.id} {collection.topic}
        </h1>
        <JobBadge status={collection.status} prefix="수집 " />
      </div>
      <p className="muted small">
        {formatDateTime(collection.createdAt)}
        {collection.keywordCostUsd !== null ? ` · 키워드 비용 ${formatUsd(collection.keywordCostUsd)}` : ""}
        {runUrl ? (
          <>
            {" · "}
            <a href={runUrl} target="_blank" rel="noreferrer">
              실행 로그
            </a>
          </>
        ) : null}
      </p>

      {collecting ? <p className="callout">수집 중입니다. 보통 1분 안에 끝납니다.</p> : null}
      {!collecting && collection.status !== "done" ? (
        <section className="stack">
          {collection.error ? <p className="error prewrap">{collection.error}</p> : null}
          <RetryCollectButton id={collection.id} />
        </section>
      ) : null}

      {collection.status === "done" ? (
        <>
          <section>
            <p>
              키워드: {collection.keywords.join(", ")} · 선택 {selected.length}개 · 합계{" "}
              <strong>{collection.totalSeconds ?? 0}초</strong>
            </p>
            {collection.shortfall ? <p className="warn">{collection.shortfall}</p> : null}
            <ul className="small muted">
              {Object.entries(collection.sourceResults).map(([source, result]) => (
                <li key={source}>
                  {SOURCE_LABELS[source as ClipSourceId]}: {result.found}개 중 {result.kept}개 선택
                  {result.error ? <span className="warn"> · {result.error}</span> : null}
                </li>
              ))}
            </ul>
            {hasShareAlike(clips) ? (
              <p className="warn-box">
                CC BY-SA(동일조건) 클립이 있습니다. 이 클립을 넣은 영상도 같은 조건으로 공개해야 한다는 해석이 있으니,
                원치 않으면 교체하세요.
              </p>
            ) : null}
          </section>

          <section>
            <h2>선택된 클립</h2>
            {selected.length === 0 ? <p className="muted">선택된 클립이 없습니다.</p> : null}
            <ol className="scenes">
              {selected.map((clip) => (
                <li key={clip.id}>
                  <ClipMeta clip={clip} />
                  <ClipMedia clip={clip} />
                  {swapOptions.length > 0 && !adopting ? (
                    <details>
                      <summary>교체</summary>
                      <ul className="scenes">
                        {swapOptions.map((option) => (
                          <li key={option.id}>
                            <ClipMeta clip={option} />
                            <ClipMedia clip={option} />
                            <SwapButton id={collection.id} selected={clip.id} alternate={option.id} />
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          <section className="stack">
            <h2>채택</h2>
            <p className="muted small">
              선택된 클립을 내려받아 mp4 로 바꾼 뒤 저장합니다(무료). 교체한 뒤 다시 누르면 새 클립만 받습니다.
            </p>
            {collection.adoptStatus ? (
              <p>
                <JobBadge status={collection.adoptStatus} prefix="채택 " />
              </p>
            ) : null}
            {collection.adoptError && !adopting ? <p className="error prewrap">{collection.adoptError}</p> : null}
            {toAdopt > 0 ? (
              <AdoptButton
                id={collection.id}
                label={`채택 (${toAdopt}개)`}
                disabled={!canDispatch || adopting}
              />
            ) : selected.length > 0 ? (
              <p className="ok">선택된 클립을 모두 채택했습니다.</p>
            ) : null}
          </section>

          {attribution ? (
            <section className="stack">
              <h2>출처 표기</h2>
              <pre className="raw prewrap">{attribution}</pre>
              <a href={`/clips/${collection.id}/manifest`}>manifest.json 내려받기</a>
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
