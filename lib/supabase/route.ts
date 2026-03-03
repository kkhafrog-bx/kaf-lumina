// lib/supabase/route.ts
import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export function createSupabaseRouteClient(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing');
  if (!anon) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing');

  // ✅ App Route에서 NextResponse.next() 금지 → 새 응답 객체로 쿠키만 싣는다
  const res = new NextResponse(null);

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          res.cookies.set(name, value, options);
        }
      },
    },
  });

  return { supabase, res };
}