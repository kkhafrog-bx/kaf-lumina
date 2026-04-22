'use client';

import { useState } from 'react';
import DownloadButtons from './DownloadButtons';

export default function NewReportForm() {
  const [loading, setLoading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setPdfUrl(null);
    setZipUrl(null);

    try {
      const res = await fetch('/api/generate-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ticker: '005930' }),
      });

      let data: any = null;

      try {
        data = await res.json();
      } catch {
        throw new Error('응답 JSON 파싱 실패');
      }

      if (!res.ok) {
        throw new Error(data?.error || '서버 오류');
      }

      // 🔥 안전하게 존재 확인
      if (typeof data?.pdfUrl === 'string') {
        setPdfUrl(data.pdfUrl);
      }

      if (typeof data?.zipUrl === 'string') {
        setZipUrl(data.zipUrl);
      }

    } catch (err: any) {
      console.error('generate error:', err);
      setError(err?.message || '에러 발생');
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

      {/* 🔥 안전 렌더링 */}
      {(pdfUrl || zipUrl) && (
        <DownloadButtons
          pdfUrl={pdfUrl || ''}
          zipUrl={zipUrl || ''}
        />
      )}
    </div>
  );
}