import { isLoggedIn } from "@/lib/auth";
import { buildManifest } from "@/pipeline/clips/attribution";
import { getCollection, listClips } from "@/pipeline/clips/store";

export const dynamic = "force-dynamic";

/** 선택된 클립의 출처·라이선스·파일 주소(JSON). */
export async function GET(_request: Request, { params }: RouteContext<"/clips/[id]/manifest">) {
  if (!(await isLoggedIn())) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const id = Number((await params).id);
  const collection = Number.isInteger(id) && id > 0 ? await getCollection(id) : null;
  if (!collection) return Response.json({ error: "수집을 찾을 수 없습니다." }, { status: 404 });
  const manifest = buildManifest(collection, await listClips(id));
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="clips-${id}-manifest.json"`,
    },
  });
}
