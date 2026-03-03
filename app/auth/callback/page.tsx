'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

export default function AuthCallbackPage() {
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    (async () => {
      const code = new URLSearchParams(window.location.search).get('code');

      if (!code) {
        // code가 없으면 그냥 로그인으로 보냄
        router.replace('/login');
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error('exchangeCodeForSession error:', error);
        router.replace('/login');
        return;
      }

      // ✅ 여기서부터 세션이 localStorage에 저장됨
      router.replace('/dashboard');
    })();
  }, [router, supabase]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      로그인 처리 중...
    </div>
  );
}