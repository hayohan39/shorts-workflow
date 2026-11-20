import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { dispatchAvailability } from "@/lib/github";
import { getChannel } from "@/pipeline/channels";
import { isRunActive, latestIdeaRun, listCategories, listIdeas, type Idea, type IdeaRun } from "@/pipeline/ideas/store";
import { formatUsd } from "@/pipeline/script/pricing";
import { IdeaActions, RequestIdeasButton } from "./idea-forms";

export const dynamic = "force-dynamic";

/** 렌더 중에 Date.now() 를 직접 부르지 않게(react-hooks/purity) 모듈 함수로 둔다. */
const runActive = (run: IdeaRun | null) => isRunActive(run);

function RunStatus({ run }: { run: IdeaRun | null }) {
  if (!run) return <p className="muted small">아직 추천을 받은 적이 없습니다.</p>;
  const cost = run.costUsd === null ? "" : ` · 비용 약 ${formatUsd(run.costUsd)}`;
  const when = `${formatDateTime(run.createdAt)} ${run.trigger === "schedule" ? "자동" : "직접"}`;
  if (runActive(run)) {
    return (
      <p className="small">⏳ 기획안을 만드는 중입니다 ({run.progress ?? "Actions 가 시작하기를 기다리는 중"}). 보통 1분 안팎.</p>
    );
  }
  if (run.status === "failed") {
    return (
      <p className="error small">
        최근 추천 실패({when}): {run.error}
        {run.runUrl ? (
          <>
            {" "}
            <a href={run.runUrl} target="_blank" rel="noreferrer">
              실행 로그
            </a>
          </>
        ) : null}
      </p>
    );
  }
  return (
    <p className="muted small">
      최근 추천: {when}
      {cost}
    </p>
  );
}

function IdeaCard({ idea, category, canStart }: { idea: Idea; category: string | null; canStart: boolean }) {
  return (
    <li className="card idea-card">
      <div className="row between">
        <span className="badge">{category ?? "카테고리 없음"}</span>
        <span className="muted small">
          {idea.targetSeconds}초 · {formatDateTime(idea.createdAt)}
        </span>
      </div>
      <strong className="card-title idea-title">{idea.title}</strong>
      <p className="idea-hook">“{idea.hook}”</p>
      <p className="prewrap small">{idea.outline}</p>
      {idea.reason ? <p className="muted small">💡 {idea.reason}</p> : null}
      <IdeaActions idea={idea} canStart={canStart} />
    </li>
  );
}

/** 채널 추천: 카테고리마다 하나씩 받은 기획안을 보고 고른다. 고른 것만 대본(근거 조사)으로 만든다. */
export default async function ChannelIdeasPage({ params }: PageProps<"/channels/[slug]/ideas">) {
  await requireSession();
  const channel = await getChannel((await params).slug);
  if (!channel) notFound();
  const [categories, run, fresh, saved, discarded] = await Promise.all([
    listCategories(channel.slug),
    latestIdeaRun(channel.slug),
    listIdeas(channel.slug, ["new"]),
    listIdeas(channel.slug, ["saved"]),
    listIdeas(channel.slug, ["discarded"], 20),
  ]);
  if (!categories.length) notFound();
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const availability = dispatchAvailability();
  const active = runActive(run);
  const card = (idea: Idea) => (
    <IdeaCard
      key={idea.id}
      idea={idea}
      category={idea.categoryId ? (names.get(idea.categoryId) ?? null) : null}
      canStart={availability.ok}
    />
  );

  return (
    <>
      <AutoRefresh active={active} />
      <section className="stack">
        <p className="small">
          {channel.ideasAuto ? (
            <>
              🔁 자동 추천 켜짐: {channel.ideasEveryDays === 1 ? "매일" : `${channel.ideasEveryDays}일마다`} 새벽 3시 무렵,
              카테고리(
              {categories.map((category) => category.name).join(" · ")})마다 하나씩.
            </>
          ) : (
            <>
              자동 추천은 꺼져 있습니다. <Link href={`/channels/${channel.slug}/settings#ideas`}>채널 설정</Link>에서 켜거나, 지금
              바로 받을 수 있습니다.
            </>
          )}
        </p>
        <RunStatus run={run} />
        <RequestIdeasButton
          slug={channel.slug}
          disabled={!availability.ok || active}
          label={`지금 추천 받기 (${categories.length}개, 약 $0.05)`}
        />
        {availability.ok ? null : <p className="warn small">{availability.reason}</p>}
        <p className="muted small">
          기획안은 제목·훅·목차·길이까지만 만듭니다. 고른 기획안만 근거 조사와 대본으로 넘어갑니다(대본 1편 약 $0.1).
        </p>
      </section>

      <h2 className="list-title">새 추천 {fresh.length ? `(${fresh.length})` : ""}</h2>
      {fresh.length ? <ul className="cards">{fresh.map(card)}</ul> : <p className="muted small">새 기획안이 없습니다.</p>}

      <h2 className="list-title">저장한 기획안 {saved.length ? `(${saved.length})` : ""}</h2>
      {saved.length ? <ul className="cards">{saved.map(card)}</ul> : <p className="muted small">저장한 기획안이 없습니다.</p>}

      {discarded.length ? (
        <details className="manual idea-discarded">
          <summary>폐기한 기획안 (최근 {discarded.length}개)</summary>
          <p className="muted small">폐기한 주제도 다음 추천에서 겹치지 않게 참고합니다.</p>
          <ul className="cards">{discarded.map(card)}</ul>
        </details>
      ) : null}
    </>
  );
}
