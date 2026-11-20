"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 채널 화면의 하위 탭. ideas 가 null 이면 추천 탭이 없는 채널(카테고리 없음), 숫자는 새 기획안 수. */
export function ChannelTabs({ slug, ideas }: { slug: string; ideas: number | null }) {
  const pathname = usePathname();
  const base = `/channels/${slug}`;
  const tabs = [
    { href: base, label: "에피소드", badge: 0 },
    ...(ideas === null ? [] : [{ href: `${base}/ideas`, label: "추천", badge: ideas }]),
    { href: `${base}/settings`, label: "채널 설정", badge: 0 },
  ];
  return (
    <nav className="subtabs" aria-label="채널 메뉴">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? "subtab subtab-active" : "subtab"}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
            {tab.badge ? <span className="subtab-badge">{tab.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
