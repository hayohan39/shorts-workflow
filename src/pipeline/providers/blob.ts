import { del, list, put } from "@vercel/blob";

// 생성물 저장소(Vercel Blob, 공개 스토어). 생성 서비스가 주는 주소는 임시라서 받자마자 옮겨 둔다.
// Actions 에서는 GitHub Secrets 의 BLOB_READ_WRITE_TOKEN 으로 올린다.

export type BlobPut = (pathname: string, body: Buffer, contentType: string) => Promise<{ url: string }>;

export function readBlobToken(env: Record<string, string | undefined> = process.env): string {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN 이 없습니다. Vercel Blob 토큰을 GitHub → Settings → Secrets → Actions 에 등록하세요.");
  }
  return token;
}

export function createBlobPut(token: string): BlobPut {
  return async (pathname, body, contentType) => {
    const result = await put(pathname, body, { access: "public", token, contentType, addRandomSuffix: true });
    return { url: result.url };
  };
}

/** 주소의 파일을 내려받아 Blob 에 올린다. */
export async function copyToBlob(
  sourceUrl: string,
  pathname: string,
  options: { put: BlobPut; fetchImpl?: typeof fetch; headers?: Record<string, string> },
): Promise<{ url: string }> {
  const response = await (options.fetchImpl ?? fetch)(sourceUrl, { headers: options.headers });
  if (!response.ok) throw new Error(`생성 파일을 내려받지 못했습니다(${response.status}).`);
  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  return options.put(pathname, body, contentType);
}

/** 폴더(접두어, "episodes/12/" 처럼 / 로 끝남) 아래 파일을 모두 지운다. 지운 개수를 돌려준다. */
export async function deleteBlobFolder(prefix: string, token: string): Promise<number> {
  if (!/^[a-z]+\/[0-9]+\/$/.test(prefix)) throw new Error(`지울 폴더 이름이 올바르지 않습니다: ${prefix}`);
  let count = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, token, limit: 1000 });
    if (page.blobs.length) {
      await del(
        page.blobs.map((blob) => blob.url),
        { token },
      );
      count += page.blobs.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return count;
}
