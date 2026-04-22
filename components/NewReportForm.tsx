'use client';

import { useState } from 'react';

export default function NewReportForm() {
  const [ticker, setTicker] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [llm, setLlm] = useState<'grok' | 'gpt' | 'claude' | 'gemini'>('gemini');

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
        body: JSON.stringify({
          ticker,
          companyName,
          llm, // 🔥 핵심: llm으로 통일
        }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      window.location.reload();
    } catch (err: any) {
      setError(err.message || '에러');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">

      {/* 티커 */}
      <input
        value={ticker}
        onChange={(e) => setTicker(e.target.value)}
        placeholder="Ticker (필수) 예: 005930 / AAPL"
        className="w-full px-4 py-3 bg-black border border-gray-700 rounded text-white"
      />

      {/* 회사명 */}
      <input
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
        placeholder="Company Name (선택)"
        className="w-full px-4 py-3 bg-black border border-gray-700 rounded text-white"
      />

      {/* 🔥 엔진 선택 복구 */}
      <select
        value={llm}
        onChange={(e) => setLlm(e.target.value as any)}
        className="w-full px-4 py-3 bg-black border border-gray-700 rounded text-white"
      >
        <option value="grok">Grok</option>
        <option value="gpt">GPT</option>
        <option value="claude">Claude</option>
        <option value="gemini">Gemini (자동 선택)</option>
      </select>

      {/* 버튼 */}
      <button
        onClick={handleGenerate}
        className="w-full py-3 bg-teal-500 rounded font-bold hover:bg-teal-600"
      >
        {loading ? '생성 중...' : '리포트 생성'}
      </button>

      {error && <div className="text-red-400 text-sm">{error}</div>}
    </div>
  );
}