import { createPixabayAdapter } from "@/pipeline/clips/sources/pixabay";
import type { SourceAdapter } from "@/pipeline/clips/types";

/** 수집에 쓰는 소스. 소스를 추가하면 여기에 넣는다. */
export function createAdapters(env: Record<string, string | undefined> = process.env): SourceAdapter[] {
  return [createPixabayAdapter(env)];
}
