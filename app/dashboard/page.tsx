'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import NewReportForm from '@/components/NewReportForm';
import { toast } from 'sonner';

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('로그아웃 완료');
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-[#0f172a] p-6">
      <div className="max-w-6xl mx-auto">
        {/* ✅ 3열 그리드: 가운데 제목 고정 */}
        <div className="grid grid-cols-3 items-center mb-8">
          <div />
          <h1 className="text-center text-4xl font-bold text-teal-400">
            Lumina Investment Intelligence
          </h1>
          <div className="flex justify-end">
            <Button onClick={handleLogout} variant="outline">
              로그아웃
            </Button>
          </div>
        </div>

        <NewReportForm />
      </div>
    </div>
  );
}