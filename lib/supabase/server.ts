import { createServerClient } from "@supabase/ssr";

/**
 * Route Handler(NextRequest)에서만 사용.
 * cookies()가 Promise로 바뀌어도 영향 없음.
 */
export function createSupabaseServerClientFromRequest(cookieHeader: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing");
  if (!anon) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is missing");

  // Supabase SSR은 cookie getAll/setAll을 요구하지만,
  // Route Handler에서는 우리가 "요청 쿠키 문자열"만 읽어 전달하고,
  // 응답 쿠키 세팅은 현재 단계에서는 필요 최소화(로그인 플로우는 클라이언트에서 진행)로 둔다.
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        // cookieHeader: "a=b; c=d" 형태 → 배열로 파싱
        if (!cookieHeader) return [];
        return cookieHeader
          .split(";")
          .map((p) => p.trim())
          .filter(Boolean)
          .map((kv) => {
            const eq = kv.indexOf("=");
            if (eq === -1) return { name: kv, value: "" };
            return { name: kv.slice(0, eq), value: kv.slice(eq + 1) };
          });
      },
      setAll() {
        // Route Handler에서 세션 갱신 쿠키를 세팅해야 하는 경우가 생기면
        // 여기서 Response에 Set-Cookie를 반영하도록 확장 가능.
        // 지금은 “보고서 생성/조회” 용도로 읽기만 하므로 noop 처리.
      },
    },
  });
}