import { put } from "@vercel/blob";

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
