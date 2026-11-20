"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 채널 화면의 하위 탭. */
export function ChannelTabs({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/channels/${slug}`;
  const tabs = [
    { href: base, label: "에피소드" },
    { href: `${base}/settings`, label: "채널 설정" },
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
          </Link>
        );
      })}
    </nav>
  );
}
