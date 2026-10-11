"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** active 인 동안 화면을 주기적으로 새로 받아 온다(진행 중인 단계의 상태를 보여 주기 위해). */
export function AutoRefresh({ active, intervalMs = 5000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);
  return null;
}
