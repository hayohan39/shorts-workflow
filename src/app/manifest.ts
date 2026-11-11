import type { MetadataRoute } from "next";
import { project } from "@/lib/project";

/** 휴대폰 "홈 화면에 추가" 때의 이름·아이콘·색. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: project.name,
    short_name: "Shorts",
    description: project.description,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#4F46E5",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
