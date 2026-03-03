'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import ReportTabs from '@/components/ReportTabs';

export default function ReportPage() {
  const params = useParams();
  const idParam = params?.id;

  // id 안전하게 추출
  const id =
    typeof idParam === 'string'
      ? idParam
      : Array.isArray(idParam)
      ? idParam[0]
      : undefined;

  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    if (!id) return;

    const fetchReport = async () => {
      const { data, error } = await supabase
        .from('reports')
        .select('report_json')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        console.error(error);
        setError(error.message);
        return;
      }

      if (!data) {
        setError('보고서를 찾을 수 없습니다.');
        return;
      }

      setReport(data.report_json);
    };

    fetchReport();
  }, [id]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white">
        {error}
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white">
        보고서를 불러오는 중...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] p-6">
      <div className="max-w-6xl mx-auto">
        <ReportTabs report={report} />
      </div>
    </div>
  );
}