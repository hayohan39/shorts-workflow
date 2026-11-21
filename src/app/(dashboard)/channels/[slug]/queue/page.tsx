import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { requireSession } from "@/lib/auth";
import { formatDateTime, formatDay, formatTime, kstDayKey, kstInputValue } from "@/lib/format";
import { dispatchAvailability } from "@/lib/github";
import { getChannel } from "@/pipeline/channels";
import { listUploadQueue, SCHEDULE_MIN_LEAD_MS, type QueueEntry } from "@/pipeline/episodes";
import { isBusy, STEP_LABELS } from "@/pipeline/status";
import { studioUrl } from "@/pipeline/youtube/links";
import { RescheduleForm, ScheduleForm } from "./queue-forms";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60_000;
const DAYS_AHEAD = 14;
const PRIVACY_LABELS = { public: "공개", unlisted: "일부 공개", private: "비공개" } as const;

/** 렌더 중에 Date.now() 를 직접 부르지 않게(react-hooks/purity) 모듈 함수로 둔다. */
function clock() {
  const now = Date.now();
  return {
    now,
    // 예약으로 고를 수 있는 가장 이른 시각. 제출까지 걸리는 시간을 5분 더 둔다.
    min: kstInputValue(new Date(now + SCHEDULE_MIN_LEAD_MS + 5 * 60_000)),
    days: Array.from({ length: DAYS_AHEAD }, (_, i) => new Date(now + i * DAY_MS)),
  };
}

function isScheduled(entry: QueueEntry, now: number): entry is QueueEntry & { upload: { publishedAt: Date } } {
  return Boolean(
    entry.episode.youtubeVideoId &&
    entry.upload?.privacy === "private" &&
    entry.upload.publishedAt &&
    entry.upload.publishedAt.getTime() > now,
  );
}

function EntryHead({ entry }: { entry: QueueEntry }) {
  const { episode } = entry;
  return (
    <>
      <div className="row between">
        <Link href={`/episodes/${episode.id}?tab=upload`} className="card-title queue-title">
          <span className="muted">#{episode.id}</span> {episode.topic}
        </Link>
        {entry.category ? <span className="badge">{entry.category}</span> : null}
      </div>
      <p className="muted small queue-meta">
        {entry.seconds ? `${entry.seconds.toFixed(1)}초` : `${episode.targetSeconds}초 목표`}
        {isBusy(episode) && episode.step
          ? ` · ⏳ ${STEP_LABELS[episode.step]} 중${episode.stepProgress ? ` (${episode.stepProgress})` : ""}`
          : ""}
      </p>
      {episode.status === "failed" && episode.error ? <p className="error small">{episode.error}</p> : null}
    </>
  );
}

/** 업로드 큐: 승인된 영상의 공개 날짜·시각을 정하고(기본은 올리지 않음), 예약된 영상의 시각을 바꾼다. */
export default async function ChannelQueuePage({ params }: PageProps<"/channels/[slug]/queue">) {
  await requireSession();
  const channel = await getChannel((await params).slug);
  if (!channel) notFound();
  const entries = await listUploadQueue(channel.slug);
  const { now, min, days } = clock();
  const availability = dispatchAvailability();
  const noChannelId = !channel.youtubeChannelId;
  // 실행할 수 없는 환경이면 상단 배너가 이유를 보여 준다.
  const blocked = !availability.ok || noChannelId;

  const unscheduled = entries.filter((entry) => !entry.episode.youtubeVideoId);
  const scheduled = entries.filter((entry) => isScheduled(entry, now));
  const published = entries
    .filter((entry) => entry.episode.youtubeVideoId && !isScheduled(entry, now))
    .reverse()
    .slice(0, 10);
  const byDay = new Map<string, typeof scheduled>();
  for (const entry of scheduled) {
    const key = kstDayKey(entry.upload.publishedAt);
    byDay.set(key, [...(byDay.get(key) ?? []), entry]);
  }

  return (
    <>
      <AutoRefresh active={entries.some((entry) => isBusy(entry.episode))} />
      <p className="muted small">
        영상을 승인하면 여기에 쌓입니다. 공개 시각을 정하면 그때 유튜브에 <strong>비공개 + 예약 공개</strong>로 올리고, 그 시각에
        유튜브가 공개합니다. 시각을 정하지 않으면 올리지 않습니다.
      </p>
      {noChannelId ? (
        <p className="warn small">
          유튜브 채널 ID 가 없어 올릴 수 없습니다. <Link href={`/channels/${channel.slug}/settings`}>채널 설정</Link>에서
          넣으세요.
        </p>
      ) : null}

      <h2 className="list-title">다음 2주</h2>
      <ol className="queue-days">
        {days.map((date) => {
          const items = byDay.get(kstDayKey(date)) ?? [];
          return (
            <li key={kstDayKey(date)} className={items.length ? "queue-day" : "queue-day queue-day-empty"}>
              <span className="queue-date">{formatDay(date)}</span>
              <span className="queue-items">
                {items.length
                  ? items.map((entry) => (
                      <span key={entry.episode.id} className="queue-item">
                        {formatTime(entry.upload.publishedAt)} {entry.category ? `[${entry.category}] ` : ""}
                        {entry.episode.topic}
                      </span>
                    ))
                  : "—"}
              </span>
            </li>
          );
        })}
      </ol>

      <h2 className="list-title">날짜 미정 {unscheduled.length ? `(${unscheduled.length})` : ""}</h2>
      {unscheduled.length ? (
        <ul className="cards">
          {unscheduled.map((entry) => (
            <li key={entry.episode.id} className="card">
              <EntryHead entry={entry} />
              <ScheduleForm
                episodeId={entry.episode.id}
                min={min}
                disabled={blocked || isBusy(entry.episode)}
                retry={entry.episode.status === "failed"}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">공개 날짜를 정할 영상이 없습니다. 에피소드에서 영상을 승인하면 여기에 쌓입니다.</p>
      )}

      <h2 className="list-title">예약됨 {scheduled.length ? `(${scheduled.length})` : ""}</h2>
      {scheduled.length ? (
        <ul className="cards">
          {scheduled.map((entry) => (
            <li key={entry.episode.id} className="card">
              <EntryHead entry={entry} />
              <p className="small">
                📅 {formatDateTime(entry.upload.publishedAt)} 공개 예정 ·{" "}
                <a href={studioUrl(entry.episode.youtubeVideoId!)} target="_blank" rel="noreferrer">
                  Studio
                </a>
              </p>
              <RescheduleForm
                episodeId={entry.episode.id}
                current={kstInputValue(entry.upload.publishedAt)}
                min={min}
                disabled={blocked || isBusy(entry.episode)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">예약된 영상이 없습니다.</p>
      )}

      {published.length ? (
        <>
          <h2 className="list-title">최근 올린 영상</h2>
          <ul className="cards">
            {published.map((entry) => (
              <li key={entry.episode.id} className="card">
                <EntryHead entry={entry} />
                <p className="small">
                  {entry.upload ? PRIVACY_LABELS[entry.upload.privacy] : "올림"}
                  {entry.upload?.publishedAt ? ` · ${formatDateTime(entry.upload.publishedAt)}` : ""} ·{" "}
                  <a href={studioUrl(entry.episode.youtubeVideoId!)} target="_blank" rel="noreferrer">
                    Studio
                  </a>
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
