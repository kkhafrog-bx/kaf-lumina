'use client';

import NewReportForm from '@/components/NewReportForm';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function DashboardPage() {
  const supabase = createClient();
  const router = useRouter();

  const onLogout = async () => {
    await supabase.auth.signOut();
    // ✅ 쿠키/상태 꼬임 방지: 강제 이동
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-[#0f172a] p-6">
      <div className="max-w-6xl mx-auto">
        {/* 상단바 */}
        <div className="relative mb-8 flex items-center justify-center">
          {/* 가운데 타이틀 */}
          <h1 className="text-4xl font-bold text-teal-400 text-center">
            Lumina Investment Intelligence
          </h1>

          {/* 우측 로그아웃 */}
          <button
            onClick={onLogout}
            className="absolute right-0 px-4 py-2 rounded-xl border border-slate-600 text-slate-200 hover:bg-slate-800"
          >
            로그아웃
          </button>
        </div>

        <NewReportForm />
      </div>
    </div>
  );
}