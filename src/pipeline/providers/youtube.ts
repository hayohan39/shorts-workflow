// YouTube Data API v3 로 영상 올리기. 키는 GitHub Secrets 에만 있다(업로드 단계에만 넘긴다).
//   1. 리프레시 토큰 → 액세스 토큰 (https://oauth2.googleapis.com/token)
//   2. resumable 업로드 시작: 메타데이터(JSON)를 보내고 Location(업로드 주소)을 받는다
//   3. 그 주소로 파일을 PUT → 만들어진 영상 리소스(id, 실제 공개 상태)
// 2026-11-02 부터 감사를 받지 않은 API 프로젝트가 올린 영상도 비공개로 잠기지 않는다(YouTube Data API 변경 기록).
// 그래도 채널 설정 등으로 다르게 적용될 수 있어, 요청한 값이 아니라 응답의 공개 상태를 기록한다.
// 리프레시 토큰 발급: scripts/youtube-auth.mjs (docs/youtube-setup.md)
// 채널 확인: GitHub 변수 YOUTUBE_CHANNEL_ID 가 있으면 올리기 전에 토큰의 채널과 같은지 본다(다르면 올리지 않는다).

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const CHANNEL_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";

export type Privacy = "private" | "unlisted" | "public";

export interface YoutubeCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** 올려야 하는 채널 ID(GitHub 변수 YOUTUBE_CHANNEL_ID). 없으면 확인하지 않는다. */
  channelId?: string;
}

export interface Channel {
  id: string;
  title: string;
}

export interface VideoMetadata {
  snippet: { title: string; description: string; tags: string[]; categoryId: string; defaultLanguage: string };
  status: {
    privacyStatus: Privacy;
    /** 예약 공개 시각(ISO). 있으면 privacyStatus 는 private 이어야 한다. */
    publishAt?: string;
    selfDeclaredMadeForKids: boolean;
    /** AI 로 만들었거나 바꾼 실사풍 콘텐츠 공개 표시 */
    containsSyntheticMedia: boolean;
  };
}

export interface UploadedVideo {
  id: string;
  /** YouTube 가 실제로 적용한 공개 상태 */
  privacyStatus: Privacy | null;
  publishAt: string | null;
}

const KEYS = ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"] as const;

export function readYoutubeCredentials(env: Record<string, string | undefined> = process.env): YoutubeCredentials {
  const missing = KEYS.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`${missing.join(", ")} 가 없습니다. docs/youtube-setup.md 대로 발급해 GitHub Secrets 에 넣으세요.`);
  }
  return {
    clientId: env.YOUTUBE_CLIENT_ID!,
    clientSecret: env.YOUTUBE_CLIENT_SECRET!,
    refreshToken: env.YOUTUBE_REFRESH_TOKEN!,
    ...(env.YOUTUBE_CHANNEL_ID?.trim() ? { channelId: env.YOUTUBE_CHANNEL_ID.trim() } : {}),
  };
}

/** 구글 오류 응답에서 사람이 읽을 이유를 뽑는다(토큰 값은 응답에 들어 있지 않다). */
async function errorReason(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as {
      error?: string | { message?: string; errors?: { reason?: string }[] };
      error_description?: string;
    };
    if (typeof body.error === "string") return `${body.error}${body.error_description ? `: ${body.error_description}` : ""}`;
    const reason = body.error?.errors?.[0]?.reason;
    return `${reason ? `${reason}: ` : ""}${body.error?.message ?? text.slice(0, 200)}`;
  } catch {
    return text.slice(0, 200);
  }
}

export async function getAccessToken(credentials: YoutubeCredentials, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
    }),
  });
  if (!response.ok) {
    const reason = await errorReason(response);
    const hint = reason.startsWith("invalid_grant")
      ? " 리프레시 토큰이 만료·취소됐습니다. OAuth 동의 화면이 '프로덕션' 인지 확인하고 토큰을 다시 발급하세요(docs/youtube-setup.md)."
      : "";
    throw new Error(`YouTube 인증 실패 (HTTP ${response.status}) ${reason}.${hint}`);
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("YouTube 인증 응답에 액세스 토큰이 없습니다.");
  return body.access_token;
}

/** 이 토큰이 올리는 채널(youtube.readonly 범위가 필요하다). */
export async function getChannel(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<Channel> {
  const response = await fetchImpl(CHANNEL_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const reason = await errorReason(response);
    const hint = /insufficient|scope/i.test(reason)
      ? " 토큰에 채널 확인 권한(youtube.readonly)이 없습니다. scripts/youtube-auth.mjs 로 토큰을 다시 발급하세요."
      : "";
    throw new Error(`YouTube 채널 확인 실패 (HTTP ${response.status}) ${reason}.${hint}`);
  }
  const body = (await response.json()) as { items?: { id: string; snippet?: { title?: string } }[] };
  const channel = body.items?.[0];
  if (!channel) throw new Error("이 토큰의 구글 계정에 YouTube 채널이 없습니다.");
  return { id: channel.id, title: channel.snippet?.title ?? channel.id };
}

/** 올리기 전에 토큰의 채널이 설정한 채널(YOUTUBE_CHANNEL_ID)과 같은지 본다. 설정이 없으면 확인하지 않는다(null). */
export async function checkChannel(
  credentials: YoutubeCredentials,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Channel | null> {
  if (!credentials.channelId) return null;
  const channel = await getChannel(accessToken, fetchImpl);
  if (channel.id !== credentials.channelId) {
    throw new Error(
      `올리지 않았습니다: 토큰은 "${channel.title}" 채널(${channel.id})인데, 설정한 채널은 ${credentials.channelId} 입니다. ` +
        "YOUTUBE_REFRESH_TOKEN 을 맞는 채널로 다시 발급하거나 GitHub 변수 YOUTUBE_CHANNEL_ID 를 고치세요.",
    );
  }
  return channel;
}

/** 영상을 올리고 만들어진 영상(ID·실제 공개 상태)을 돌려준다. */
export async function uploadVideo(options: {
  accessToken: string;
  metadata: VideoMetadata;
  video: Buffer;
  fetchImpl?: typeof fetch;
}): Promise<UploadedVideo> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const auth = { authorization: `Bearer ${options.accessToken}` };
  const start = await fetchImpl(UPLOAD_URL, {
    method: "POST",
    headers: {
      ...auth,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": "video/mp4",
      "x-upload-content-length": String(options.video.length),
    },
    body: JSON.stringify(options.metadata),
  });
  const location = start.headers.get("location");
  if (!start.ok || !location) {
    const reason = start.ok ? "업로드 주소(Location)가 없습니다" : await errorReason(start);
    const hint = /quota/i.test(reason) ? " 오늘 YouTube API 한도를 다 썼습니다. 내일(태평양 시간 자정 이후) 다시 시도하세요." : "";
    throw new Error(`YouTube 업로드 시작 실패 (HTTP ${start.status}) ${reason}.${hint}`);
  }

  const put = await fetchImpl(location, {
    method: "PUT",
    headers: { ...auth, "content-type": "video/mp4" },
    body: new Uint8Array(options.video),
  });
  if (!put.ok) throw new Error(`YouTube 업로드 실패 (HTTP ${put.status}) ${await errorReason(put)}.`);
  const video = (await put.json()) as { id?: string; status?: { privacyStatus?: Privacy; publishAt?: string } };
  if (!video.id) throw new Error("YouTube 업로드 응답에 영상 ID 가 없습니다.");
  return { id: video.id, privacyStatus: video.status?.privacyStatus ?? null, publishAt: video.status?.publishAt ?? null };
}
