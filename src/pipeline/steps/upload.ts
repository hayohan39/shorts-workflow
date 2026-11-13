import { listAssets, type Asset } from "@/pipeline/assets";
import { CLIP_MODEL, descriptionWithCredits, sceneClips } from "@/pipeline/clips/episode";
import type { StoredClip } from "@/pipeline/clips/store";
import { saveUpload, type Episode } from "@/pipeline/episodes";
import {
  getAccessToken,
  readYoutubeCredentials,
  uploadVideo,
  type VideoMetadata,
  type YoutubeCredentials,
} from "@/pipeline/providers/youtube";
import { latestScript, type Script } from "@/pipeline/scripts";
import { scenesDone } from "@/pipeline/steps/render";

// 유튜브 업로드(⑦): 승인된 최신 완성 영상을 비공개로 올린다. 크레딧을 쓰지 않는다(YouTube API 는 무료, 하루 업로드 한도만 있음).
// API 감사 전에는 올린 영상이 "비공개로 잠김" 이 되어 공개로 바꿀 수 없다(providers/youtube.ts).
//   제목·설명·해시태그는 대본에서, 설명 끝에 무료 클립 출처 표기와 해시태그를 붙인다.
//   AI 로 만든 장면(무료 클립이 아닌 장면)이 있으면 "변경되었거나 합성된 콘텐츠" 로 표시한다.

/** YouTube 제한: 제목 100자, 설명 5,000바이트, 태그 합계 500자. < > 는 쓸 수 없다. */
const LIMITS = { title: 100, descriptionBytes: 5000, tagsChars: 500 };
/** 교육 */
const CATEGORY_ID = "27";

const clean = (text: string) => text.replace(/[<>]/g, "");

function truncateBytes(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;
  let result = "";
  for (const char of text) {
    if (encoder.encode(result + char + "…").length > maxBytes) break;
    result += char;
  }
  return result + "…";
}

/** "#shorts" → "shorts". 공백이 있는 태그는 따옴표 2자를 더 센다(YouTube 규칙). 합계 500자 안에서 앞에서부터. */
export function apiTags(hashtags: string[]): string[] {
  const tags: string[] = [];
  let total = 0;
  for (const tag of hashtags.map((value) => clean(value.trim().replace(/^#/, "").trim())).filter(Boolean)) {
    if (tags.includes(tag)) continue;
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + (tags.length ? 1 : 0);
    if (total + cost > LIMITS.tagsChars) break;
    tags.push(tag);
    total += cost;
  }
  return tags;
}

export function buildMetadata(
  script: Pick<Script, "title" | "description" | "tags" | "needsAiDisclosure">,
  clips: StoredClip[],
  aiScenes: boolean,
): VideoMetadata {
  const hashtags = script.tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ");
  const description = [descriptionWithCredits(clean(script.description), clips), hashtags].filter(Boolean).join("\n\n");
  return {
    snippet: {
      title: [...clean(script.title).trim()].slice(0, LIMITS.title).join(""),
      description: truncateBytes(description, LIMITS.descriptionBytes),
      tags: apiTags(script.tags),
      categoryId: CATEGORY_ID,
      defaultLanguage: "ko",
    },
    status: {
      privacyStatus: "private",
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: script.needsAiDisclosure || aiScenes,
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
}

export async function runUploadStep(
  episode: Episode,
  options: { progress?: (text: string) => Promise<void>; deps?: UploadDeps } = {},
): Promise<{ videoId: string }> {
  const progress = options.progress ?? (async () => {});
  const fetchImpl = options.deps?.fetchImpl ?? fetch;
  if (episode.youtubeVideoId) throw new Error(`이미 업로드한 에피소드입니다(영상 ID ${episode.youtubeVideoId}).`);
  const script = await latestScript(episode.id);
  if (!script) throw new Error("대본이 없습니다.");
  const assets = await listAssets(episode.id);
  const final = latestFinal(assets, script.version);
  if (!final?.url) throw new Error("완성 영상이 없습니다. 영상 합성을 먼저 끝내세요.");

  const scenes = scenesDone(assets, script.version);
  const clips = await sceneClips(scenes);
  const aiScenes = [...scenes.values()].some((asset) => asset.model !== CLIP_MODEL);
  const metadata = buildMetadata(script, clips, aiScenes);
  const credentials = options.deps?.credentials ?? readYoutubeCredentials();

  await progress("완성 영상 내려받는 중");
  const response = await fetchImpl(final.url);
  if (!response.ok) throw new Error(`완성 영상을 내려받지 못했습니다(HTTP ${response.status}).`);
  const video = Buffer.from(await response.arrayBuffer());

  await progress(`YouTube 에 비공개로 올리는 중 (${(video.length / 1024 / 1024).toFixed(1)}MB)`);
  const accessToken = await getAccessToken(credentials, fetchImpl);
  const videoId = await uploadVideo({ accessToken, metadata, video, fetchImpl });
  await saveUpload(episode.id, videoId, metadata.status.privacyStatus);
  return { videoId };
}
