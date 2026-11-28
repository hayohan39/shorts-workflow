import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { isLoggedIn } from "@/lib/auth";
import { getEpisode } from "@/pipeline/episodes";
import { AUDIO_CONTENT_TYPES, AUDIO_MAX_BYTES, canEditMusic, parseMusicUploadPath } from "@/pipeline/music/rules";

// 음원 업로드 토큰(Vercel Blob 클라이언트 업로드). 함수 요청 본문 한도(4.5MB)를 피해 브라우저가 Blob 에 바로 올린다.
// 토큰은 로그인한 사용자에게만, 음원을 바꿀 수 있는 음악형 에피소드의 폴더(music/<id>/)로만 준다.
// 업로드가 끝나면 브라우저가 saveMusicAudioAction 으로 주소를 저장한다(완료 콜백은 쓰지 않는다).

export async function POST(request: Request): Promise<Response> {
  if (!(await isLoggedIn())) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (body.type !== "blob.generate-client-token") return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const id = parseMusicUploadPath(pathname);
        const episode = id ? await getEpisode(id) : null;
        if (!episode || !canEditMusic(episode)) throw new Error("이 쇼츠에는 지금 음원을 올릴 수 없습니다.");
        return {
          allowedContentTypes: AUDIO_CONTENT_TYPES,
          maximumSizeInBytes: AUDIO_MAX_BYTES,
          addRandomSuffix: true,
          // 15분 안에 올리기 시작해야 한다.
          validUntil: Date.now() + 15 * 60 * 1000,
        };
      },
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "업로드를 준비하지 못했습니다." }, { status: 400 });
  }
}
