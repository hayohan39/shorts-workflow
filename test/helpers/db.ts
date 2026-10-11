import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// 실제 Postgres 테스트용. CI 는 서비스 컨테이너로 TEST_DATABASE_URL 을 준다. 없으면 건너뛴다.
export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** 테스트 전용 스키마를 만들고 실제 마이그레이션을 적용한 뒤, 그 스키마를 보는 연결 문자열을 돌려준다. */
export async function createMigratedSchema(prefix: string): Promise<{ url: string; drop: () => Promise<void> }> {
  const base = testDatabaseUrl!;
  const schema = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const url = `${base}${base.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}`;
  const admin = async (sql: string) => {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: base });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  };

  await admin(`create schema ${schema}`);
  const env = { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: "" };
  await run("node", [path.resolve("scripts", "migrate.mjs")], { env });
  return { url, drop: () => admin(`drop schema if exists ${schema} cascade`) };
}
