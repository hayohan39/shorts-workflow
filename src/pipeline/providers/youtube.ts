// YouTube Data API v3 로 영상 올리기. 키는 GitHub Secrets 에만 있다(업로드 단계에만 넘긴다).
//   1. 리프레시 토큰 → 액세스 토큰 (https://oauth2.googleapis.com/token)
//   2. resumable 업로드 시작: 메타데이터(JSON)를 보내고 Location(업로드 주소)을 받는다
//   3. 그 주소로 파일을 PUT → 만들어진 영상 리소스(id)
// 구글 감사(YouTube API Services Audit)를 받지 않은 API 프로젝트에서 올린 영상은 "비공개로 잠김" 이 되고
// Studio 에서도 공개로 바꿀 수 없다(이의 제기 불가, 다시 올려야 함). 그래서 지금은 비공개로만 올린다.
// 리프레시 토큰 발급: scripts/youtube-auth.mjs (docs/youtube-setup.md)

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

export interface YoutubeCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface VideoMetadata {
  snippet: { title: string; description: string; tags: string[]; categoryId: string; defaultLanguage: string };
  status: {
    privacyStatus: "private" | "unlisted" | "public";
    selfDeclaredMadeForKids: boolean;
    /** AI 로 만들었거나 바꾼 실사풍 콘텐츠 공개 표시 */
    containsSyntheticMedia: boolean;
  };
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

/** 영상을 올리고 YouTube 영상 ID 를 돌려준다. */
export async function uploadVideo(options: {
  accessToken: string;
  metadata: VideoMetadata;
  video: Buffer;
  fetchImpl?: typeof fetch;
}): Promise<string> {
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
  const video = (await put.json()) as { id?: string };
  if (!video.id) throw new Error("YouTube 업로드 응답에 영상 ID 가 없습니다.");
  return video.id;
}

export const studioUrl = (videoId: string) => `https://studio.youtube.com/video/${videoId}/edit`;
export const watchUrl = (videoId: string) => `https://youtu.be/${videoId}`;
