import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { WorkflowTabs } from "@/components/workflow-steps";
import { formatClock, formatDateTime } from "@/lib/format";
import { channelLabel, type Channel } from "@/pipeline/channels";
import { isScheduledAhead, type Episode } from "@/pipeline/episodes";
import { isBusy } from "@/pipeline/status";
import { isStale } from "@/pipeline/trigger";
import { canEditMusic, musicSegment } from "@/pipeline/music/rules";
import { getMusicTrack } from "@/pipeline/music/track";
import { isStage, ROUTE_ICONS, ROUTE_LABELS, ROUTE_STAGES, stageLabel, workflow, type Stage } from "@/pipeline/workflow";
import { DeleteEpisodeForm } from "./delete-form";
import { MusicSegmentPicker, MusicUploader } from "./music-forms";

// 음악형 에피소드 화면: 음원 → 가사 → 이미지 → 영상 → 업로드.
// 지금은 음원 올리기와 구간 고르기까지. 가사 타이밍(탭 싱크)·이미지·합성·업로드는 다음 PR 에서 연다(docs/decisions.md).

const NEXT_ACTION: Partial<Record<Stage, string>> = {
  audio: "음원을 올리고 영상에 쓸 구간을 고르세요.",
  lyrics: "가사를 붙여 넣고 박자에 맞춰 타이밍을 맞추세요.",
  scenes: "곡에 맞는 이미지를 만들거나 올리세요.",
  video: "영상을 합성하고, 휴대폰으로 확인한 뒤 승인하세요.",
  upload: "제목·설명·태그를 적고 유튜브에 올리세요.",
};

const COMING: Partial<Record<Stage, string>> = {
  lyrics: "가사 붙여 넣기와 탭으로 타이밍 맞추기는 다음 업데이트에서 열립니다.",
  scenes: "이미지 만들기(ManyMotions)·올리기는 가사 다음 업데이트에서 열립니다.",
  video: "음원·가사·이미지가 준비되면 영상을 합성합니다(크레딧 없음).",
  upload: "영상을 승인하면 제목·설명·태그를 직접 적고 올립니다.",
};

export async function MusicEpisode({ episode, channel, tab: tabParam }: { episode: Episode; channel: Channel; tab: unknown }) {
  const track = await getMusicTrack(episode.id);
  const editable = canEditMusic(episode);
  const segment = track ? musicSegment(track, episode.targetSeconds) : null;
  // 이미지는 아직 없다(다음 PR). 장면이 남아 있는 것으로 둔다.
  const flow = workflow(episode, { hasNarration: false, scenesLeft: 1, hasAudio: Boolean(track), lyricsSynced: false });
  const tab: Stage = isStage(tabParam) && ROUTE_STAGES.music.includes(tabParam) ? tabParam : flow.current;

  return (
    <>
      <Link href={`/channels/${episode.channel}`} className="back">
        ← {channelLabel(channel)}
      </Link>
      <div className="row between episode-head">
        <h1>
          <span className="muted">#{episode.id}</span> {episode.topic}
        </h1>
        <StatusBadge episode={episode} />
      </div>
      <p className="muted small route-label">
        {ROUTE_ICONS.music} {ROUTE_LABELS.music} · {episode.targetSeconds}초 구간
      </p>

      <WorkflowTabs episodeId={episode.id} flow={flow} active={tab} />

      <div className={`now now-${flow.activity ?? "done"}`}>
        <p className="now-title">{flow.activity === null ? "🎉 모든 단계가 끝났습니다." : NEXT_ACTION[flow.current]}</p>
        {episode.error ? <p className="error prewrap small">{episode.error}</p> : null}
        {tab !== flow.current && flow.activity ? (
          <Link href={`/episodes/${episode.id}?tab=${flow.current}`} scroll={false} className="button small-button">
            {stageLabel("music", flow.current)} 단계로 가기 →
          </Link>
        ) : null}
      </div>

      <div className="tab-panel">
        {tab === "audio" ? (
          <>
            {episode.outline ? (
              <section>
                <h2>컨셉</h2>
                <p className="prewrap">{episode.outline}</p>
              </section>
            ) : null}
            {track && segment ? (
              <section className="stack">
                <h2>음원</h2>
                <p className="muted small">
                  {track.fileName} · {formatClock(track.durationSeconds)} · {formatDateTime(track.updatedAt)} 올림
                </p>
                <MusicSegmentPicker
                  key={track.audioUrl}
                  episodeId={episode.id}
                  audioUrl={track.audioUrl}
                  duration={track.durationSeconds}
                  start={segment.start}
                  seconds={segment.seconds}
                  editable={editable}
                />
                {segment.seconds < episode.targetSeconds ? (
                  <p className="warn small">
                    곡이 {episode.targetSeconds}초보다 짧아 곡 전체({segment.seconds}초)를 씁니다.
                  </p>
                ) : null}
              </section>
            ) : null}
            {editable ? (
              <section>
                <MusicUploader episodeId={episode.id} replacing={Boolean(track)} />
              </section>
            ) : track ? (
              <p className="muted small">다음 단계로 넘어가서 음원·구간은 바꿀 수 없습니다.</p>
            ) : (
              <Empty>지금은 음원을 올릴 수 없습니다.</Empty>
            )}
          </>
        ) : (
          <Empty>{COMING[tab]}</Empty>
        )}
      </div>

      <DeleteEpisodeForm
        episodeId={episode.id}
        uploaded={Boolean(episode.youtubeVideoId)}
        scheduled={isScheduledAhead(episode)}
        busy={isBusy(episode) && !isStale(episode)}
      />

      <p className="muted small meta">
        만든 시각 {formatDateTime(episode.createdAt)} · 마지막 변경 {formatDateTime(episode.updatedAt)}
      </p>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty muted">{children}</p>;
}
