'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import ReportTabs from '@/components/ReportTabs';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function ReportPage() {
  const params = useParams();
  const [report, setReport] = useState<any>(null);
  const supabase = createClient();

  useEffect(() => {
    supabase
      .from('reports')
      .select('report_json')
      .eq('id', params.id)
      .single()
      .then(({ data }) => setReport(data?.report_json));
  }, [params.id]);

  const downloadPDF = () => toast.success('PDF 다운로드 준비 중...');
  const downloadZip = () => toast.success('NotebookLM ZIP 다운로드 준비 중...');

  if (!report) {
    return <div className="min-h-screen flex items-center justify-center text-xl">보고서를 불러오는 중...</div>;
  }

  return (
    <div className="min-h-screen bg-[#0f172a] p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-teal-400">Lumina Investment Intelligence</h1>
          <div className="flex gap-4">
            <Button onClick={downloadPDF} className="bg-teal-500">PDF 다운로드</Button>
            <Button onClick={downloadZip} variant="outline">NotebookLM ZIP</Button>
          </div>
        </div>
        <ReportTabs report={report} />
      </div>
    </div>
  );
}