'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { toast } from 'sonner';

export default function LogoutButton() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    try {
      setLoading(true);

      const { error } = await supabase.auth.signOut();

      if (error) {
        toast.error('로그아웃 실패');
        return;
      }

      toast.success('로그아웃되었습니다');

      // 세션 완전 초기화 후 로그인 페이지로
      router.replace('/login');
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error('로그아웃 중 오류 발생');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleLogout}
      disabled={loading}
      className="border-red-500 text-red-400 hover:bg-red-500 hover:text-white"
    >
      {loading ? '로그아웃 중...' : '로그아웃'}
    </Button>
  );
}