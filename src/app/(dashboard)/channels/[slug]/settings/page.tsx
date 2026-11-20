import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { CHANNEL_NAME_MAX, getChannel } from "@/pipeline/channels";
import { ChannelSettingsForm } from "./channel-settings-form";

export const dynamic = "force-dynamic";

const SETUP_DOC = "https://github.com/hayohan39/shorts-workflow/blob/main/docs/youtube-setup.md";

export default async function ChannelSettingsPage({ params }: PageProps<"/channels/[slug]/settings">) {
  await requireSession();
  const channel = await getChannel((await params).slug);
  if (!channel) notFound();
  return (
    <>
      <section>
        <ChannelSettingsForm key={channel.slug} channel={channel} nameMax={CHANNEL_NAME_MAX} />
      </section>
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
