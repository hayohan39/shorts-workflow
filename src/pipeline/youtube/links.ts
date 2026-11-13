// 유튜브 영상 주소. 화면·DB 기록이 같이 쓴다(다른 모듈에 의존하지 않는다).

/** youtu.be/ID · youtube.com/watch?v=ID · /shorts/ID · studio.youtube.com/video/ID → ID. 아니면 null. */
export function parseVideoId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, "");
  const id =
    host === "youtu.be"
      ? url.pathname.split("/")[1]
      : host === "youtube.com"
        ? (url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1])
        : host === "studio.youtube.com"
          ? url.pathname.match(/^\/video\/([^/]+)/)?.[1]
          : null;
  return id && /^[\w-]{6,20}$/.test(id) ? id : null;
}

export const studioUrl = (videoId: string) => `https://studio.youtube.com/video/${videoId}/edit`;
export const watchUrl = (videoId: string) => `https://youtu.be/${videoId}`;
