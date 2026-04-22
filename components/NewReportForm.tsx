'use client';

import { useState } from 'react';
import DownloadButtons from './DownloadButtons';

export default function NewReportForm() {
  const [loading, setLoading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string>('');
  const [zipUrl, setZipUrl] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setPdfUrl('');
    setZipUrl('');

    try {
      const res = await fetch('/api/generate-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ticker: '005930',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '생성 실패');
      }

      // 🔥 핵심: 여기서 반드시 세팅
      setPdfUrl(data.pdfUrl || '');
      setZipUrl(data.zipUrl || '');
    } catch (err: any) {
      console.error(err);
      setError(err.message || '에러 발생');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-8 flex flex-col items-center gap-4">
      <button
        onClick={handleGenerate}
        className="px-6 py-3 bg-teal-500 text-white rounded-xl hover:bg-teal-600"
      >
        {loading ? '생성 중...' : '리포트 생성'}
      </button>

      {error && (
        <div className="text-red-400 text-sm">{error}</div>
      )}

      {/* 🔥 버튼 렌더링 */}
      <DownloadButtons pdfUrl={pdfUrl} zipUrl={zipUrl} />
    </div>
  );
}