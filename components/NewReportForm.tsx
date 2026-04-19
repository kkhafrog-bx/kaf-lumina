'use client';

import { useState } from 'react';

export default function NewReportForm() {
  const [ticker, setTicker] = useState('');
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!ticker) return;

    setLoading(true);

    const res = await fetch('/api/generate-report', {
      method: 'POST',
      body: JSON.stringify({ ticker }),
    });

    const data = await res.json();

    setLoading(false);

    if (data.error) {
      alert(data.error);
      return;
    }

    alert('보고서 생성 완료');
    location.reload();
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-orange-400 mb-4">
        New Report
      </h2>

      <div className="flex gap-4">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker (ex: AAPL, 005930)"
          className="flex-1 bg-black border border-gray-700 rounded px-4 py-2 text-white"
        />

        <button
          onClick={generate}
          disabled={loading}
          className="bg-orange-500 px-6 py-2 rounded font-bold hover:bg-orange-600"
        >
          {loading ? '생성중...' : 'Generate'}
        </button>
      </div>
    </div>
  );
}