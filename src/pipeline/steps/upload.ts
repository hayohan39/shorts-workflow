import { listAssets, type Asset } from "@/pipeline/assets";
import { getChannel } from "@/pipeline/channels";
import { sceneClips } from "@/pipeline/clips/episode";
import { saveUpload, type Episode } from "@/pipeline/episodes";
import {
  checkChannel,
  getAccessToken,
  getVideoStatus,
  readYoutubeCredentials,
  updatePublishAt,
  uploadVideo,
  type VideoMetadata,
  type YoutubeCredentials,
} from "@/pipeline/providers/youtube";
import { MAX_VIDEO_SECONDS } from "@/pipeline/script/schema";
import { latestScript } from "@/pipeline/scripts";
import { scenesDone } from "@/pipeline/steps/render";
import { studioUrl } from "@/pipeline/youtube/links";
import { buildUploadText, hasAiScenes, type UploadText } from "@/pipeline/youtube/metadata";

// 유튜브 자동 업로드(⑦): 승인된 최신 완성 영상을 대시보드에서 고른 공개 상태로 올린다.
// 크레딧을 쓰지 않는다(YouTube API 는 무료, 하루 업로드 한도만 있음).
//   제목·설명·태그·합성 콘텐츠 표시는 직접 올리기 도우미와 같은 값(youtube/metadata.ts).
//   예약 공개: 비공개로 올리고 publishAt 에 공개 시각을 넣는다.

/** 교육 */
const CATEGORY_ID = "27";

export function buildMetadata(
  text: UploadText,
  plan: Pick<Episode, "uploadPrivacy" | "scheduledAt">,
): VideoMetadata {
  const scheduled = plan.scheduledAt && plan.uploadPrivacy === "private" ? plan.scheduledAt : null;
  return {
    snippet: { title: text.title, description: text.description, tags: text.tags, categoryId: CATEGORY_ID, defaultLanguage: "ko" },
    status: {
      privacyStatus: plan.uploadPrivacy ?? "private",
      ...(scheduled ? { publishAt: scheduled.toISOString() } : {}),
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: text.synthetic,
    },
  };
}

/** 이 대본 버전으로 합성한 가장 최근 완성 영상. */
export function latestFinal(assets: Asset[], scriptVersion: number): Asset | null {
  return assets.find((asset) => asset.kind === "final" && asset.url && asset.meta.scriptVersion === scriptVersion) ?? null;
}

export interface UploadDeps {
  credentials?: YoutubeCredentials;
  fetchImpl?: typeof fetch;
  /** 업로드 결과 기록. 테스트에서 실패를 흉내 낼 때만 바꾼다. */
  save?: typeof saveUpload;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * 업로드가 끝난 뒤의 DB 기록. 여기서 실패한 채로 "다시 시도" 하면 같은 영상이 또 올라가므로
 * 몇 번 다시 해 보고, 그래도 안 되면 이미 올라간 영상 ID·Studio 링크를 에러에 남긴다(화면에 보인다).
 */
async function recordUpload(id: number, record: Parameters<typeof saveUpload>, deps: UploadDeps): Promise<void> {
  const save = deps.save ?? saveUpload;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const videoId = record[1];
  for (let attempt = 1; ; attempt++) {
    try {
      await save(...record);
      return;
    } catch (error) {
      if (attempt >= 3) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `YouTube 에는 올라갔지만(영상 ID ${videoId}, ${studioUrl(videoId)}) 기록하지 못했습니다: ${reason}. ` +
            "다시 시도하면 한 번 더 올라가니, Studio 에서 이 영상을 확인하고 필요하면 지운 뒤 다시 시도하세요.",
        );
      }
      await sleep(1000 * 2 ** attempt);
    }
  }
}

const PRIVACY_LABELS = { public: "공개", unlisted: "일부 공개", private: "비공개" } as const;

async function uploadTarget(episode: Pick<Episode, "channel">) {
  const channel = await getChannel(episode.channel);
  if (!channel) throw new Error(`채널 ${episode.channel} 을 찾을 수 없습니다.`);
  return channel;
}

export async function runUploadStep(
  episode: Episode,
  options: { progress?: (text: string) => Promise<void>; deps?: UploadDeps } = {},
): Promise<{ videoId: string; privacy: string }> {
  const progress = options.progress ?? (async () => {});
  const deps = options.deps ?? {};
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  if (episode.youtubeVideoId) throw new Error(`이미 업로드한 에피소드입니다(영상 ID ${episode.youtubeVideoId}).`);
  if (!episode.uploadPrivacy) throw new Error("공개 상태를 고르지 않았습니다. 업로드 탭에서 고른 뒤 다시 시도하세요.");
  if (episode.scheduledAt && episode.uploadPrivacy === "private" && episode.scheduledAt.getTime() <= now() + 60_000) {
    throw new Error("예약 공개 시각이 지났습니다. 업로드 탭에서 시각을 다시 고르세요.");
  }
  const script = await latestScript(episode.id);
  if (!script) throw new Error("대본이 없습니다.");
  const assets = await listAssets(episode.id);
  const final = latestFinal(assets, script.version);
  if (!final?.url) throw new Error("완성 영상이 없습니다. 영상 합성을 먼저 끝내세요.");
  const seconds = Number(final.meta.seconds);
  if (seconds > MAX_VIDEO_SECONDS) throw new Error(`완성 영상이 ${seconds}초라 1분 미만 기준을 넘습니다. 올리지 않았습니다.`);

  const scenes = scenesDone(assets, script.version);
  const metadata = buildMetadata(buildUploadText(script, await sceneClips(scenes), hasAiScenes(scenes)), episode);
  const credentials = deps.credentials ?? readYoutubeCredentials(await uploadTarget(episode));

  // 인증·채널 확인을 먼저 한다(다른 채널 토큰이면 영상을 받기 전에 멈춘다).
  const accessToken = await getAccessToken(credentials, fetchImpl);
  const channel = await checkChannel(credentials, accessToken, fetchImpl);

  await progress("완성 영상 내려받는 중");
  const response = await fetchImpl(final.url);
  if (!response.ok) throw new Error(`완성 영상을 내려받지 못했습니다(HTTP ${response.status}).`);
  const video = Buffer.from(await response.arrayBuffer());

  const plan = metadata.status.publishAt ? "예약 공개" : PRIVACY_LABELS[metadata.status.privacyStatus];
  await progress(`YouTube "${channel.title}" 채널에 ${plan}로 올리는 중 (${(video.length / 1024 / 1024).toFixed(1)}MB)`);
  const uploaded = await uploadVideo({ accessToken, metadata, video, fetchImpl });
  // 요청한 값이 아니라 YouTube 가 실제로 적용한 공개 상태를 남긴다(화면에 보인다).
  const privacy = uploaded.privacyStatus ?? metadata.status.privacyStatus;
  const publishAt = uploaded.publishAt ?? metadata.status.publishAt ?? null;
  await recordUpload(episode.id, [episode.id, uploaded.id, privacy, publishAt ? new Date(publishAt) : null], deps);
  return { videoId: uploaded.id, privacy };
}

/**
 * 예약 공개 시각 바꾸기(업로드 큐): 비공개 + 예약으로 올린 영상의 publishAt 을 episodes.scheduled_at 으로 바꾼다.
 * 이미 공개됐거나 예약이 아닌 영상은 건드리지 않는다. 바뀐 시각을 업로드 기록에 남긴다.
 */
export async function runRescheduleStep(
  episode: Episode,
  options: { progress?: (text: string) => Promise<void>; deps?: UploadDeps } = {},
): Promise<{ videoId: string; publishAt: Date }> {
  const progress = options.progress ?? (async () => {});
  const deps = options.deps ?? {};
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const videoId = episode.youtubeVideoId;
  if (!videoId) throw new Error("아직 유튜브에 올리지 않은 에피소드입니다.");
  const at = episode.scheduledAt;
  if (!at || at.getTime() <= now() + 60_000) throw new Error("새 공개 시각이 없거나 지났습니다. 업로드 큐에서 다시 고르세요.");

  const credentials = deps.credentials ?? readYoutubeCredentials(await uploadTarget(episode));
  const accessToken = await getAccessToken(credentials, fetchImpl);
  const channel = await checkChannel(credentials, accessToken, fetchImpl);
  const current = await getVideoStatus(accessToken, videoId, fetchImpl);
  if (current.privacyStatus !== "private" || typeof current.publishAt !== "string" || Date.parse(current.publishAt) <= now()) {
    throw new Error("이미 공개됐거나 예약 공개가 아닌 영상이라 바꾸지 않았습니다. YouTube Studio 에서 확인하세요.");
  }
  await progress(`YouTube "${channel.title}" 채널 영상의 공개 시각을 바꾸는 중`);
  const updated = await updatePublishAt({ accessToken, videoId, current, publishAt: at, fetchImpl });
  const publishAt = typeof updated.publishAt === "string" ? new Date(updated.publishAt) : at;
  await recordUpload(episode.id, [episode.id, videoId, "private", publishAt], deps);
  return { videoId, publishAt };
}
