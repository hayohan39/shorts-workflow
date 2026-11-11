import type { Metadata } from "next";
import { project } from "@/lib/project";
import "./globals.css";

// next/font/google 은 빌드 때 Google 에서 폰트를 받아온다. 네트워크가 막힌
// 환경(Claude 클라우드 세션 등)에서는 빌드가 깨지므로 시스템 폰트를 쓴다.
// 아이콘은 같은 폴더의 icon.svg·apple-icon.png·favicon.ico, 홈 화면 정보는 manifest.ts 가 정한다.
export const metadata: Metadata = {
  title: project.name,
  description: project.description,
  appleWebApp: { title: project.name, capable: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
