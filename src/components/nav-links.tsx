"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavChannel {
  slug: string;
  label: string;
}

const FIXED = [
  { href: "/clips", label: "클립 보관함" },
  { href: "/settings", label: "설정" },
];

/** 상단 메뉴: 채널마다 탭 하나 + 클립 보관함 + 설정. 지금 보고 있는 메뉴를 표시한다. */
export function NavLinks({ channels }: { channels: NavChannel[] }) {
  const pathname = usePathname();
  const links = [...channels.map((channel) => ({ href: `/channels/${channel.slug}`, label: channel.label })), ...FIXED];
  return (
    <nav className="tabs" aria-label="메뉴">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={active ? "tab tab-active" : "tab"}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
