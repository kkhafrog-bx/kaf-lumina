'use client';

import { useState } from 'react';
import DownloadButtons from './DownloadButtons';

export default function NewReportForm() {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const [zipUrl, setZipUrl] = useState('');
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setReport(null);

    try {
      const res = await fetch('/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: '005930' }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      setReport(data.report);
      setPdfUrl(data.pdfUrl);
      setZipUrl(data.zipUrl);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">

      {/* 생성 버튼 */}
      <button
        onClick={handleGenerate}
        className="px-6 py-3 bg-teal-500 rounded-xl text-white"
      >
        {loading ? '생성 중...' : '리포트 생성'}
      </button>

      {error && <div className="text-red-400">{error}</div>}

      {/* 🔥 핵심: 생성 결과 바로 보여줌 */}
      {report && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">

          <div className="text-xl font-bold text-white">
            {report?.overview?.title || 'Report'}
          </div>

          <div className="text-gray-300 text-sm whitespace-pre-wrap">
            {report?.overview?.company_profile || '내용 없음'}
          </div>

          {/* 🔥 다운로드 버튼은 여기 */}
          <DownloadButtons pdfUrl={pdfUrl} zipUrl={zipUrl} />
        </div>
      )}
    </div>
  );
}