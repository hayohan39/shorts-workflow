// "모델 조회" 응답에서 고를 수 있는 항목(모델·목소리)을 뽑는다.
// 응답 형식을 미리 알 수 없어서(문서 확인 불가) 흔한 필드 이름으로 찾고, 원문도 함께 저장해 둔다.

export interface CatalogItem {
  id: string;
  label: string;
  kind: string | null;
  credits: string | null;
  source: string;
}

const ID_KEYS = ["model_id", "modelId", "voice_id", "voiceId", "id", "slug"];
const LABEL_KEYS = ["name", "display_name", "displayName", "title", "label"];
const KIND_KEYS = ["type", "kind", "category", "modality", "media_type", "mediaType"];
const CREDIT_KEYS = ["credits", "credit", "cost", "price", "credits_per_second", "creditsPerSecond", "pricing"];

function pick(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
    if (value && typeof value === "object" && key === "pricing") return JSON.stringify(value).slice(0, 120);
  }
  return null;
}

export function extractCatalog(listings: Record<string, unknown>): CatalogItem[] {
  const items = new Map<string, CatalogItem>();
  const visit = (value: unknown, source: string, depth: number) => {
    if (depth > 6 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, source, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    const id = pick(record, ID_KEYS);
    // 식별자만 있고 다른 정보가 하나도 없는 객체(예: 작업 ID)는 항목으로 보지 않는다.
    const label = pick(record, LABEL_KEYS);
    const kind = pick(record, KIND_KEYS);
    const credits = pick(record, CREDIT_KEYS);
    if (id && (label || kind || credits) && !items.has(id)) {
      items.set(id, { id, label: label ?? id, kind, credits, source });
    }
    for (const child of Object.values(record)) visit(child, source, depth + 1);
  };
  for (const [source, value] of Object.entries(listings)) visit(value, source, 0);
  return [...items.values()];
}
