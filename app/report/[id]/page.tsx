// app/report/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import ReportTabs from '@/components/ReportTabs';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase';

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const reportId = params?.id;

  const [loading, setLoading] = useState(true);
  const [reportRow, setReportRow] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!reportId) return;

    const supabase = createClient();

    (async () => {
      try {
        setLoading(true);
        setErrorMsg(null);

        // ✅ 로그인 세션 확인 (RLS 때문에 필수)
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();

        if (userErr) console.error('auth.getUser error:', userErr);

        if (!user) {
          setErrorMsg('로그인이 필요합니다.');
          toast.error('로그인이 필요합니다.');
          router.push('/login');
          return;
        }

        // ✅ 보고서 조회 (RLS: auth.uid() = user_id)
        const { data, error } = await supabase
          .from('reports')
          .select('id, ticker, market, report_json, notebook_zip_path, created_at')
          .eq('id', reportId)
          .single();

        if (error) {
          console.error('reports select error:', error);
          setErrorMsg(error.message || '보고서를 불러올 수 없습니다.');
          setReportRow(null);
          return;
        }

        setReportRow(data);
      } catch (e: any) {
        console.error('ReportPage load failed:', e?.message ?? e, e?.stack);
        setErrorMsg(e?.message ?? '보고서를 불러오는 중 오류가 발생했습니다.');
        setReportRow(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [reportId, router]);

  const downloadPDF = () => {
    toast.success('PDF 다운로드 기능은 아직 연결되지 않았습니다.');
  };

  const downloadZip = async () => {
    try {
      if (!reportRow?.notebook_zip_path) {
        toast.error('ZIP 경로가 없습니다.');
        return;
      }

      const supabase = createClient();

      // ✅ private bucket이면 signed url 필요
      const { data, error } = await supabase.storage
        .from('reports')
        .createSignedUrl(reportRow.notebook_zip_path, 60);

      if (error) {
        console.error('createSignedUrl error:', error);
        toast.error('ZIP 다운로드 URL 생성 실패');
        return;
      }

      window.location.href = data.signedUrl;
    } catch (e: any) {
      console.error('downloadZip failed:', e?.message ?? e);
      toast.error('ZIP 다운로드 실패');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a] text-slate-200">
        <div className="text-lg">보고서를 불러오는 중...</div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a] text-slate-200 px-6">
        <div className="max-w-xl w-full glass p-8 rounded-3xl">
          <h2 className="text-2xl font-bold text-teal-400 mb-3">오류</h2>
          <p className="text-slate-300 mb-6">{errorMsg}</p>
          <div className="flex gap-3">
            <Button className="bg-teal-500 hover:bg-teal-600" onClick={() => router.push('/dashboard')}>
              대시보드로
            </Button>
            <Button variant="outline" onClick={() => router.push('/login')}>
              로그인으로
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!reportRow?.report_json) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a] text-slate-200">
        <div className="text-lg">보고서를 찾을 수 없습니다.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-bold text-teal-400">Lumina Investment Intelligence</h1>
            <div className="text-slate-300 mt-2">
              <span className="mr-3">ID: {reportRow.id}</span>
              {reportRow.ticker ? <span className="mr-3">Ticker: {reportRow.ticker}</span> : null}
              {reportRow.market ? <span className="mr-3">Market: {reportRow.market}</span> : null}
            </div>
          </div>

          <div className="flex gap-3">
            <Button onClick={downloadPDF} className="bg-teal-500 hover:bg-teal-600">
              PDF 다운로드
            </Button>
            <Button onClick={downloadZip} variant="outline">
              NotebookLM ZIP
            </Button>
          </div>
        </div>

        <ReportTabs report={reportRow.report_json} />
      </div>
    </div>
  );
}