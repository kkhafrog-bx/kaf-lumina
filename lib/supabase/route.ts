// lib/supabase/route.ts
import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';

export function createSupabaseRouteClient(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing');
  if (!anon) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing');

  // ✅ App Route에서는 NextResponse.next() 금지
  // ✅ 대신 cookies.set을 "해도 되고 안 해도 되는" 형태로 무해하게 처리
  const cookieStore = req.cookies;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // App Route에서는 응답 객체에 set-cookie를 싣기 어렵다.
        // (필요한 경우: middleware에서 세션 갱신 처리)
        // 여기서는 NO-OP로 둔다.
        // cookiesToSet.forEach(...) 하지 마세요.
      },
    },
  });

  return { supabase };
}