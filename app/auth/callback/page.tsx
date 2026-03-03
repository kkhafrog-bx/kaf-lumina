'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

export default function AuthCallbackPage() {
  const router = useRouter();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const supabase = createClient();

    (async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');

      if (!code) {
        router.replace('/login');
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error('exchangeCodeForSession error:', error);
        // 실패 시 재시도 루프 방지: 쿼리 제거 후 로그인 이동
        router.replace('/login');
        return;
      }

      // ✅ 쿠키 세션이든 localStorage든, 여기서 로그인 완료 상태가 됨
      router.replace('/dashboard');
    })();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center text-slate-200">
      로그인 처리 중...
    </div>
  );
}