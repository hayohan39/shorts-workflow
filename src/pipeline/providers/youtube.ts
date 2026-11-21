// YouTube Data API v3 로 영상 올리기. 키는 GitHub Secrets 에만 있다(업로드 단계에만 넘긴다).
//   1. 리프레시 토큰 → 액세스 토큰 (https://oauth2.googleapis.com/token)
//   2. resumable 업로드 시작: 메타데이터(JSON)를 보내고 Location(업로드 주소)을 받는다
//   3. 그 주소로 파일을 PUT → 만들어진 영상 리소스(id, 실제 공개 상태)
// 2026-11-02 부터 감사를 받지 않은 API 프로젝트가 올린 영상도 비공개로 잠기지 않는다(YouTube Data API 변경 기록).
// 그래도 채널 설정 등으로 다르게 적용될 수 있어, 요청한 값이 아니라 응답의 공개 상태를 기록한다.
// 리프레시 토큰 발급: scripts/youtube-auth.mjs (docs/youtube-setup.md). 토큰은 채널마다 따로다(channels.youtube_token_secret).
// 채널 확인: 올리기 전에 토큰의 채널이 대시보드 채널 설정의 유튜브 채널 ID 와 같은지 본다(다르면 올리지 않는다).

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const CHANNEL_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";

export type Privacy = "private" | "unlisted" | "public";

export interface YoutubeCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** 리프레시 토큰이 든 GitHub Secret 이름(오류 안내용). */
  tokenSecret: string;
  /** 올려야 하는 유튜브 채널 ID(대시보드 채널 설정). */
  channelId: string;
}

export interface YoutubeChannel {
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

/** 올릴 대시보드 채널: 토큰이 든 Secret 이름과 유튜브 채널 ID. */
export interface UploadTarget {
  name: string;
  youtubeTokenSecret: string;
  youtubeChannelId: string | null;
}

export function readYoutubeCredentials(
  target: UploadTarget,
  env: Record<string, string | undefined> = process.env,
): YoutubeCredentials {
  // 채널이 여럿이라 채널 ID 없이 올리면 엉뚱한 채널에 올라갈 수 있다. 확인할 수 있을 때만 올린다.
  if (!target.youtubeChannelId) {
    throw new Error(`"${target.name}" 채널 설정에 유튜브 채널 ID 가 없습니다. 대시보드 → 채널 → 채널 설정에서 넣으세요.`);
  }
  const keys = ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", target.youtubeTokenSecret];
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`${missing.join(", ")} 가 없습니다. docs/youtube-setup.md 대로 발급해 GitHub Secrets 에 넣으세요.`);
  }
  return {
    clientId: env.YOUTUBE_CLIENT_ID!,
    clientSecret: env.YOUTUBE_CLIENT_SECRET!,
    refreshToken: env[target.youtubeTokenSecret]!,
    tokenSecret: target.youtubeTokenSecret,
    channelId: target.youtubeChannelId,
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
export async function getChannel(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<YoutubeChannel> {
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

/** 올리기 전에 토큰의 채널이 설정한 채널 ID 와 같은지 본다. 다르면 올리지 않는다. */
export async function checkChannel(
  credentials: YoutubeCredentials,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YoutubeChannel> {
  const channel = await getChannel(accessToken, fetchImpl);
  if (channel.id !== credentials.channelId) {
    throw new Error(
      `올리지 않았습니다: 토큰은 "${channel.title}" 채널(${channel.id})인데, 설정한 채널은 ${credentials.channelId} 입니다. ` +
        `${credentials.tokenSecret} 를 맞는 채널로 다시 발급하거나 대시보드 채널 설정의 유튜브 채널 ID 를 고치세요.`,
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

const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

/** videos.update(part=status) 에 다시 보내도 되는 status 필드. 보내지 않은 필드는 기본값으로 돌아가므로 지금 값을 그대로 담는다. */
const WRITABLE_STATUS = ["privacyStatus", "publishAt", "selfDeclaredMadeForKids", "containsSyntheticMedia", "embeddable", "license", "publicStatsViewable"] as const;
export type VideoStatus = Partial<Record<(typeof WRITABLE_STATUS)[number], string | boolean>>;

/** 영상의 지금 status(쓸 수 있는 필드만). 영상이 없거나 이 토큰의 채널 것이 아니면 오류. */
export async function getVideoStatus(accessToken: string, videoId: string, fetchImpl: typeof fetch = fetch): Promise<VideoStatus> {
  const response = await fetchImpl(`${VIDEOS_URL}?part=status&id=${encodeURIComponent(videoId)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`YouTube 영상 조회 실패 (HTTP ${response.status}) ${await errorReason(response)}.`);
  const body = (await response.json()) as { items?: { status?: Record<string, unknown> }[] };
  const status = body.items?.[0]?.status;
  if (!status) throw new Error(`YouTube 에서 영상 ${videoId} 을 찾을 수 없습니다(지웠거나 다른 채널의 영상).`);
  return Object.fromEntries(WRITABLE_STATUS.filter((key) => key in status).map((key) => [key, status[key] as string | boolean]));
}

/** 예약 공개 시각을 바꾼다(비공개 + publishAt 유지). 바뀐 status 를 돌려준다. */
export async function updatePublishAt(options: {
  accessToken: string;
  videoId: string;
  current: VideoStatus;
  publishAt: Date;
  fetchImpl?: typeof fetch;
}): Promise<VideoStatus> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${VIDEOS_URL}?part=status`, {
    method: "PUT",
    headers: { authorization: `Bearer ${options.accessToken}`, "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      id: options.videoId,
      status: { ...options.current, privacyStatus: "private", publishAt: options.publishAt.toISOString() },
    }),
  });
  if (!response.ok) throw new Error(`YouTube 예약 시각 변경 실패 (HTTP ${response.status}) ${await errorReason(response)}.`);
  const body = (await response.json()) as { status?: VideoStatus };
  return body.status ?? {};
}
