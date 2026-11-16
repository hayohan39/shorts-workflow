import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Claude API 키(사용량 과금)는 쇼츠 파이프라인에만 넘긴다.
// 리뷰·자동 수정·@claude 는 구독 토큰만 쓴다: API 키를 함께 넘기면 action 이 API 키를 먼저 써서 요금이 나간다.
const dir = path.join(process.cwd(), ".github", "workflows");
const workflows = readdirSync(dir)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf8") }));

describe("워크플로의 Claude 키", () => {
  it("ANTHROPIC_API_KEY·ANTHROPIC_ADMIN_KEY 는 pipeline.yml 에서만 쓴다", () => {
    const users = workflows.filter(({ text }) => /secrets\.ANTHROPIC_(API|ADMIN)_KEY/.test(text)).map(({ name }) => name);
    expect(users).toEqual(["pipeline.yml"]);
  });

  it("claude-code-action 은 모두 구독 토큰을 쓰고 API 키를 받지 않는다", () => {
    const actions = workflows.filter(({ text }) => text.includes("anthropics/claude-code-action"));
    expect(actions.map(({ name }) => name).sort()).toEqual(["ci.yml", "claude-mention.yml", "claude-review.yml"]);
    for (const { name, text } of actions) {
      expect(text, name).not.toMatch(/anthropic_api_key\s*:/);
      expect(text, name).toMatch(/claude_code_oauth_token:\s*\$\{\{\s*secrets\.CLAUDE_CODE_OAUTH_TOKEN\s*\}\}/);
    }
  });
});
