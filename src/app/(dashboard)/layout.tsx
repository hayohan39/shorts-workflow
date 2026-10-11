import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { dispatchAvailability } from "@/lib/github";
import { project } from "@/lib/project";
import { logoutAction } from "./actions";

// 로그인 확인이 요청마다 일어나야 한다. 이 아래 화면은 전부 동적으로 렌더한다.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  await requireSession();
  const availability = dispatchAvailability();

  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          {project.name}
        </Link>
        <nav>
          <Link href="/episodes/new">새 에피소드</Link>
          <Link href="/settings">설정</Link>
          <form action={logoutAction}>
            <button type="submit" className="link">
              로그아웃
            </button>
          </form>
        </nav>
      </header>
      {availability.ok ? null : <p className="banner">{availability.reason}</p>}
      <main>{children}</main>
    </>
  );
}
