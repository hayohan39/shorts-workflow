import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { CHANNEL_NAME_MAX, getChannel } from "@/pipeline/channels";
import { listCategories } from "@/pipeline/ideas/store";
import { categoryIdeaPromptKey, channelIdeaPromptKey, PROMPT_MAX, promptHistory } from "@/pipeline/prompts";
import { ChannelSettingsForm } from "./channel-settings-form";
import { IdeaSettingsForm, PromptForm } from "./idea-settings-forms";

export const dynamic = "force-dynamic";

const SETUP_DOC = "https://github.com/hayohan39/shorts-workflow/blob/main/docs/youtube-setup.md";

export default async function ChannelSettingsPage({ params }: PageProps<"/channels/[slug]/settings">) {
  await requireSession();
  const channel = await getChannel((await params).slug);
  if (!channel) notFound();
  const categories = await listCategories(channel.slug);
  const prompts = [
    {
      key: channelIdeaPromptKey(channel.slug),
      label: "채널 공통",
      hint: "채널 소개·시청자·말투·피할 것. 모든 카테고리 추천에 함께 들어갑니다.",
    },
    ...categories.map((category) => ({
      key: categoryIdeaPromptKey(category.id),
      label: `카테고리: ${category.name}`,
      hint: "이 카테고리에서 어떤 쇼츠 거리를 원하는지.",
    })),
  ];
  const histories = categories.length ? await Promise.all(prompts.map((prompt) => promptHistory(prompt.key))) : [];

  return (
    <>
      <section>
        <ChannelSettingsForm key={channel.slug} channel={channel} nameMax={CHANNEL_NAME_MAX} />
      </section>
      {categories.length ? (
        <section id="ideas" className="stack">
          <h2>추천</h2>
          <IdeaSettingsForm slug={channel.slug} auto={channel.ideasAuto} everyDays={channel.ideasEveryDays} />
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
              history={histories[index].map((item) => ({
                version: item.version,
                body: item.body,
                savedAt: formatDateTime(item.createdAt),
              }))}
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
