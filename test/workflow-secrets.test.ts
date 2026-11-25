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

describe("워크플로의 유튜브 키", () => {
  it("업로드·예약 시각 변경 단계에만 넘긴다(채널별 리프레시 토큰 포함)", () => {
    const pipeline = workflows.find(({ name }) => name === "pipeline.yml")!.text;
    const lines = pipeline.split("\n").filter((line) => /secrets\.YOUTUBE_/.test(line));
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const line of lines) expect(line).toContain("(inputs.step == 'upload' || inputs.step == 'reschedule') && secrets.YOUTUBE_");
  });

  it("채널마다 토큰 Secret 을 업로드 단계에 넘긴다(channels.youtube_token_secret 과 같은 이름, test/channels.test.ts)", () => {
    const pipeline = workflows.find(({ name }) => name === "pipeline.yml")!.text;
    for (const secret of ["YOUTUBE_REFRESH_TOKEN_RACCOON", "YOUTUBE_REFRESH_TOKEN_SAESAE", "YOUTUBE_REFRESH_TOKEN_MUSIC"]) {
      expect(pipeline, secret).toContain(`secrets.${secret} ||`);
    }
    // 라쿤씨의 옛 이름은 더 넘기지 않는다.
    expect(pipeline).not.toContain("secrets.YOUTUBE_REFRESH_TOKEN ||");
  });
});
