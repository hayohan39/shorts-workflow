import Image from "next/image";
import Link from "next/link";
import { NavLinks } from "@/components/nav-links";
import { requireSession } from "@/lib/auth";
import { dispatchAvailability } from "@/lib/github";
import { project } from "@/lib/project";
import { channelLabel, listChannels } from "@/pipeline/channels";
import { logoutAction } from "./actions";

// 로그인 확인이 요청마다 일어나야 한다. 이 아래 화면은 전부 동적으로 렌더한다.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  await requireSession();
  const availability = dispatchAvailability();
  const channels = await listChannels();

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <Image src="/icon.svg" alt="" width={28} height={28} className="brand-icon" unoptimized />
            <span>{project.name}</span>
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="link small">
              로그아웃
            </button>
          </form>
        </div>
        <NavLinks channels={channels.map((channel) => ({ slug: channel.slug, label: channelLabel(channel) }))} />
      </header>
      {availability.ok ? null : <p className="banner">{availability.reason}</p>}
      <main>{children}</main>
    </>
  );
}
