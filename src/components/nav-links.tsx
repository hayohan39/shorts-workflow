"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  {
    href: "/",
    label: "에피소드",
    match: (path: string) => path === "/" || path.startsWith("/episodes"),
  },
  {
    href: "/clips",
    label: "영상 소스",
    match: (path: string) => path.startsWith("/clips"),
  },
  {
    href: "/settings",
    label: "설정",
    match: (path: string) => path.startsWith("/settings"),
  },
];

/** 상단 메뉴. 지금 보고 있는 메뉴를 표시한다. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="tabs" aria-label="메뉴">
      {LINKS.map((link) => {
        const active = link.match(pathname);
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
