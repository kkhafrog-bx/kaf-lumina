'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import ReportTabs from '@/components/ReportTabs';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    (async () => {
      setLoading(true);

      // 로그인 세션 확인 (없으면 로그인으로)
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        toast.error('로그인이 필요합니다.');
        router.replace('/login');
        return;
      }

      // 보고서 로드
      const { data, error } = await supabase
        .from('reports')
        .select('report_json')
        .eq('id', params.id)
        .single();

      if (error) {
        console.error('report load error:', error);
        toast.error('보고서를 찾을 수 없습니다.');
        setReport(null);
      } else {
        setReport(data?.report_json ?? null);
      }

      setLoading(false);
    })();
  }, [params.id, router]);

  const downloadPDF = () => toast.success('PDF 다운로드 준비 중...');
  const downloadZip = () => toast.success('NotebookLM ZIP 다운로드 준비 중...');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-xl text-slate-200">
        보고서를 불러오는 중입니다...
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen flex items-center justify-center text-xl text-slate-200">
        보고서를 찾을 수 없습니다.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-teal-400">
            Lumina Investment Intelligence
          </h1>
          <div className="flex gap-3">
            <Button onClick={downloadPDF} className="bg-teal-500 hover:bg-teal-600">
              PDF 다운로드
            </Button>
            <Button onClick={downloadZip} variant="outline">
              NotebookLM ZIP
            </Button>
          </div>
        </div>

        <ReportTabs report={report} />
      </div>
    </div>
  );
}