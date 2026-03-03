import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function createSupabaseRouteClient(req: NextRequest) {
  // ✅ Route Handler에서는 NextResponse.next() 쓰지 말고 일반 Response를 만든다
  const res = new NextResponse(null, {
    status: 200,
    headers: new Headers(),
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing");
  if (!anon) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is missing");

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          res.cookies.set(name, value, options);
        });
      },
    },
  });

  return { supabase, res };
}