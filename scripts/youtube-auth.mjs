#!/usr/bin/env node
// 유튜브 업로드용 리프레시 토큰을 한 번 발급받는 도우미. 내 PC 에서 실행한다(브라우저로 구글 로그인이 필요해서).
// 다른 패키지 없이 Node 만 있으면 된다(이 파일 하나만 내려받아도 된다).
//
//   node scripts/youtube-auth.mjs
//
// Google Cloud 의 OAuth 클라이언트(유형: 데스크톱 앱)의 클라이언트 ID·보안 비밀을 물어본 뒤,
// 브라우저에서 업로드할 채널의 구글 계정으로 로그인·허용하면(채널이 여러 개면 그 화면에서 채널을 고른다)
// 그 토큰이 올릴 채널 이름·ID 와 리프레시 토큰을 보여 준다.
// 클라이언트 ID·보안 비밀은 GitHub Secrets(YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET)에 한 번만 넣고,
// 리프레시 토큰은 채널마다 그 채널의 Secret(대시보드 채널 설정에 나오는 이름)에, 채널 ID 는 채널 설정 화면에 넣는다.
// 자세한 순서: docs/youtube-setup.md
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createInterface } from "node:readline/promises";

// upload: 영상 올리기. readonly: 이 토큰이 어느 채널인지 확인하기(채널 이름 조회).
const SCOPE = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const clientId = (process.env.YOUTUBE_CLIENT_ID || (await rl.question("클라이언트 ID: "))).trim();
const clientSecret = (process.env.YOUTUBE_CLIENT_SECRET || (await rl.question("클라이언트 보안 비밀번호: "))).trim();
rl.close();
if (!clientId || !clientSecret) {
  console.error("클라이언트 ID 와 보안 비밀번호가 필요합니다.");
  process.exit(1);
}

// PKCE: 인증 코드를 가로채도 쓸 수 없게 한다.
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(16).toString("hex");

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const redirectUri = `http://127.0.0.1:${server.address().port}`;

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: SCOPE,
  access_type: "offline",
  prompt: "consent",
  state,
  code_challenge: challenge,
  code_challenge_method: "S256",
}).toString();

console.log("\n아래 주소를 브라우저에서 열고, 업로드할 채널의 구글 계정으로 로그인해 허용하세요.");
console.log("('확인되지 않은 앱' 경고가 나오면 '고급' → '(앱 이름)(으)로 이동' 을 누르면 됩니다.)\n");
console.log(authUrl.toString(), "\n");

const code = await new Promise((resolve, reject) => {
  server.on("request", (req, res) => {
    const url = new URL(req.url, redirectUri);
    const error = url.searchParams.get("error");
    const received = url.searchParams.get("code");
    if (!error && !received) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (error || url.searchParams.get("state") !== state) {
      res.end("<p>허용되지 않았습니다. 터미널을 확인하세요.</p>");
      reject(new Error(error ?? "state 가 맞지 않습니다."));
    } else {
      res.end("<p>완료했습니다. 이 창을 닫고 터미널로 돌아가세요.</p>");
      resolve(received);
    }
  });
});
server.close();

const response = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  }),
});
const body = await response.json();
if (!response.ok || !body.refresh_token) {
  console.error("토큰을 받지 못했습니다:", body.error ?? response.status, body.error_description ?? "");
  process.exit(1);
}

// 이 토큰이 올릴 채널을 보여 준다(조회만, 무료). 다른 채널이면 다시 실행해 로그인 화면에서 채널을 고른다.
const channels = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
  headers: { authorization: `Bearer ${body.access_token}` },
});
const channel = channels.ok ? (await channels.json()).items?.[0] : null;
if (channel) {
  console.log(`\n이 토큰은 "${channel.snippet.title}" 채널(ID ${channel.id})에 올립니다. 맞는지 확인하세요.`);
  console.log(`  https://www.youtube.com/channel/${channel.id}\n`);
} else {
  console.log(`\n⚠️ 채널을 확인하지 못했습니다(HTTP ${channels.status}). 이 계정에 YouTube 채널이 있는지 확인하세요.\n`);
}

console.log("리프레시 토큰을 받았습니다. GitHub → Settings → Secrets and variables → Actions 에 넣으세요.");
console.log("(이 값은 비밀번호와 같습니다. 채팅·문서에 붙여 넣지 마세요.)\n");
console.log("YOUTUBE_CLIENT_ID      =", clientId, " (처음 한 번만)");
console.log("YOUTUBE_CLIENT_SECRET  = (방금 입력한 클라이언트 보안 비밀번호, 처음 한 번만)");
console.log("리프레시 토큰          =", body.refresh_token);
console.log("  → 대시보드 채널 → 채널 설정에 나오는 Secret 이름으로 넣으세요(예: 라쿤씨 YOUTUBE_REFRESH_TOKEN).");
if (channel) {
  console.log("\n채널 ID(비밀 아님): 대시보드 채널 → 채널 설정의 \"유튜브 채널 ID\" 에 넣으세요. 다른 채널 토큰이면 올리지 않습니다.");
  console.log("유튜브 채널 ID         =", channel.id);
}
