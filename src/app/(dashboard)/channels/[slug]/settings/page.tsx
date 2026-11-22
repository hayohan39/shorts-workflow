import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { CHANNEL_NAME_MAX, DESCRIPTION_FOOTER_MAX, getChannel, VIDEO_NOTICE_MAX } from "@/pipeline/channels";
import { listCategories } from "@/pipeline/ideas/store";
import {
  categoryIdeaPromptKey,
  channelIdeaPromptKey,
  PROMPT_MAX,
  promptHistory,
  scriptPromptKey,
  type PromptVersion,
} from "@/pipeline/prompts";
import { ChannelSettingsForm } from "./channel-settings-form";
import { IdeaSettingsForm, PoolKeywordsForm, PromptForm } from "./idea-settings-forms";
import { KEYWORDS_PER_RUN, listPoolKeywords, POOL_KEYWORD_MAX } from "@/pipeline/clips/pool";

export const dynamic = "force-dynamic";

const SETUP_DOC = "https://github.com/hayohan39/shorts-workflow/blob/main/docs/youtube-setup.md";

export default async function ChannelSettingsPage({ params }: PageProps<"/channels/[slug]/settings">) {
  await requireSession();
  const channel = await getChannel((await params).slug);
  if (!channel) notFound();
  const categories = await listCategories(channel.slug);
  const stories = channel.route === "clips";
  const prompts = [
    {
      key: channelIdeaPromptKey(channel.slug),
      label: stories ? "스토리 후보 요청" : "채널 공통",
      hint: stories
        ? "어떤 이야기를 원하는지(채널 성격·예시 주제·피할 것). 소재 목록과 형식은 앱이 붙입니다."
        : "채널 소개·시청자·말투·피할 것. 모든 카테고리 추천에 함께 들어갑니다.",
    },
    ...categories.map((category) => ({
      key: categoryIdeaPromptKey(category.id),
      label: `카테고리: ${category.name}`,
      hint: "이 카테고리에서 어떤 쇼츠 거리를 원하는지.",
    })),
  ];
  const hasIdeas = categories.length > 0 || stories;
  const [histories, scriptHistory, keywords] = await Promise.all([
    hasIdeas ? Promise.all(prompts.map((prompt) => promptHistory(prompt.key))) : [],
    promptHistory(scriptPromptKey(channel.slug)),
    stories ? listPoolKeywords(channel.slug) : [],
  ]);
  const historyItems = (items: PromptVersion[]) =>
    items.map((item) => ({ version: item.version, body: item.body, savedAt: formatDateTime(item.createdAt) }));

  return (
    <>
      <section>
        <ChannelSettingsForm
          key={channel.slug}
          channel={channel}
          nameMax={CHANNEL_NAME_MAX}
          limits={{ notice: VIDEO_NOTICE_MAX, footer: DESCRIPTION_FOOTER_MAX }}
        />
      </section>
      <section id="script" className="stack">
        <h2>대본 지침</h2>
        <p className="muted small">
          대본을 쓸 때 Claude 에게 주는 이 채널의 성격·근거 기준·피할 표현입니다. 분량·장면·훅·출처 같은 공통 형식은 앱이 따로
          붙입니다. 저장하면 다음 대본부터 적용되고, 새 버전으로 남아 되돌릴 수 있습니다.
        </p>
        <PromptForm
          promptKey={scriptPromptKey(channel.slug)}
          label="채널 지침"
          hint="예: 채널 소개, 근거를 찾을 곳, 쓰지 말 표현, 말투."
          body={scriptHistory[0]?.body ?? ""}
          history={historyItems(scriptHistory)}
          max={PROMPT_MAX}
        />
      </section>
      {hasIdeas ? (
        <section id="ideas" className="stack">
          <h2>추천</h2>
          <IdeaSettingsForm
            slug={channel.slug}
            auto={channel.ideasAuto}
            everyDays={channel.ideasEveryDays}
            what={
              stories
                ? "소재 풀을 채우고(무료) 스토리 후보를 만듭니다(1회 약 $0.04)"
                : "카테고리마다 기획안을 하나씩 만듭니다(1회 약 $0.05)"
            }
            costPerRun={stories ? 0.04 : 0.05}
          />
          {stories ? (
            <PoolKeywordsForm
              slug={channel.slug}
              keywords={keywords.map((keyword) => keyword.keyword)}
              max={POOL_KEYWORD_MAX}
              perRun={KEYWORDS_PER_RUN}
            />
          ) : null}
          <h3>추천 프롬프트</h3>
          <p className="muted small">
            기획안을 만들 때 Claude 에게 주는 요청입니다. 형식(제목·훅·목차·길이, 1분 미만, 최근 주제 피하기)은 앱이 따로 붙이므로
            여기에는 내용만 적으면 됩니다. 저장할 때마다 새 버전으로 남고 되돌릴 수 있습니다.
          </p>
          {prompts.map((prompt, index) => (
            <PromptForm
              key={prompt.key}
              promptKey={prompt.key}
              label={prompt.label}
              hint={prompt.hint}
              body={histories[index][0]?.body ?? ""}
              history={historyItems(histories[index])}
              max={PROMPT_MAX}
            />
          ))}
        </section>
      ) : null}
      <section>
        <h2>유튜브 연결</h2>
        <p className="small">
          이 채널의 리프레시 토큰은 GitHub Secret <code>{channel.youtubeTokenSecret}</code> 에서 읽습니다(업로드 단계에만
          넘깁니다).
        </p>
        <ol className="small setup-steps">
          <li>
            내 컴퓨터에서 <code>node scripts/youtube-auth.mjs</code> 를 실행하고, 구글 로그인 화면에서 <strong>이 채널</strong>을
            고릅니다.
          </li>
          <li>
            끝에 나오는 리프레시 토큰을 GitHub → Settings → Secrets and variables → Actions 에{" "}
            <code>{channel.youtubeTokenSecret}</code> 이름으로 넣습니다.
          </li>
          <li>함께 나오는 채널 ID(UC…)를 위 &ldquo;유튜브 채널 ID&rdquo; 에 넣고 저장합니다.</li>
        </ol>
        <p className="muted small">
          자세한 순서:{" "}
          <a href={SETUP_DOC} target="_blank" rel="noreferrer">
            docs/youtube-setup.md
          </a>
        </p>
      </section>
    </>
  );
}
