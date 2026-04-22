'use client';

import { useState } from 'react';

export default function NewReportForm() {
  const [ticker, setTicker] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!ticker.trim()) {
      setError('티커는 필수다');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, companyName }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      // 🔥 핵심: 생성 후 리스트 갱신
      window.location.reload();

    } catch (err: any) {
      setError(err.message || '에러');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">

      <input
        value={ticker}
        onChange={(e) => setTicker(e.target.value)}
        placeholder="Ticker (필수)"
        className="w-full px-4 py-3 bg-black border border-gray-700 rounded text-white"
      />

      <input
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
        placeholder="Company Name (선택)"
        className="w-full px-4 py-3 bg-black border border-gray-700 rounded text-white"
      />

      <button
        onClick={handleGenerate}
        className="w-full py-3 bg-teal-500 rounded font-bold"
      >
        {loading ? '생성 중...' : '리포트 생성'}
      </button>

      {error && <div className="text-red-400">{error}</div>}
    </div>
  );
}