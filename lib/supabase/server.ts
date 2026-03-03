// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';

export function createSupabaseServerClient(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing');
  if (!anon) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing');

  // ✅ App Route에서는 NextResponse.next() 쓰지 말고,
  // ✅ headers에 Set-Cookie를 직접 쌓아서 응답에 붙이는 방식으로 간다.
  const headers = new Headers();

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          // Set-Cookie 헤더 누적
          // @supabase/ssr가 알아서 옵션을 string으로 직렬화해줌
          // (Next의 Response에 headers를 그대로 넣어주면 된다)
          headers.append(
            'Set-Cookie',
            `${name}=${value}; Path=${options?.path ?? '/'}${
              options?.maxAge ? `; Max-Age=${options.maxAge}` : ''
            }${options?.httpOnly ? '; HttpOnly' : ''}${options?.secure ? '; Secure' : ''}${
              options?.sameSite ? `; SameSite=${options.sameSite}` : ''
            }`
          );
        }
      },
    },
  });

  return { supabase, headers };
}