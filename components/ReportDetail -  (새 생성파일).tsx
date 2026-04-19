'use client';

import SectionCard from './SectionCard';
import ScoreBadge from './ScoreBadge';

export default function ReportDetail({ report }: any) {
  const json = report.report_json || {};

  return (
    <div className="min-h-screen bg-black text-white px-6 py-10">
      <div className="max-w-5xl mx-auto space-y-10">

        {/* ===== 헤더 ===== */}
        <div className="flex justify-between items-center border-b border-gray-800 pb-4">
          <div>
            <h1 className="text-3xl font-bold text-orange-400">
              {json.company || report.ticker}
            </h1>
            <p className="text-gray-400 text-sm">
              {report.region} · {new Date(report.created_at).toLocaleDateString()}
            </p>
          </div>

          <ScoreBadge score={json.investment_score || 70} />
        </div>

        {/* ===== 투자 판단 ===== */}
        <SectionCard title="Investment Decision">
          <p className="text-lg">
            {json.should_i_buy || '데이터 없음'}
          </p>
        </SectionCard>

        {/* ===== 개요 ===== */}
        <SectionCard title="Overview">
          <p>{json.overview?.company_profile}</p>
        </SectionCard>

        {/* ===== 비즈니스 ===== */}
        <SectionCard title="Business Model">
          <p>{json.overview?.business_model}</p>
        </SectionCard>

        {/* ===== 트렌드 ===== */}
        <SectionCard title="Recent Trends">
          <p>{json.overview?.recent_trends}</p>
        </SectionCard>

        {/* ===== 인사이트 ===== */}
        <SectionCard title="Key Insights">
          <ul className="list-disc ml-6 space-y-2">
            {(json.key_insights || []).map((i: string, idx: number) => (
              <li key={idx}>{i}</li>
            ))}
          </ul>
        </SectionCard>

        {/* ===== 리스크 ===== */}
        <SectionCard title="Risks">
          <ul className="list-disc ml-6 space-y-2 text-red-400">
            {(json.risks || []).map((r: string, idx: number) => (
              <li key={idx}>{r}</li>
            ))}
          </ul>
        </SectionCard>

      </div>
    </div>
  );
}