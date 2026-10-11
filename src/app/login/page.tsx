import { redirect } from "next/navigation";
import { isLoggedIn, safeNextPath } from "@/lib/auth";
import { project } from "@/lib/project";
import { readAuthConfig } from "@/lib/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const next = safeNextPath((await searchParams).next);
  if (await isLoggedIn()) redirect(next);
  const auth = readAuthConfig();

  return (
    <main className="narrow">
      <h1>{project.name}</h1>
      {auth.ok ? (
        <LoginForm next={next} />
      ) : (
        <p className="error">
          대시보드 설정이 필요합니다. Vercel 환경변수에 다음 값을 넣어 주세요: {auth.missing.join(", ")}
        </p>
      )}
    </main>
  );
}
