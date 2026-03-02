'use client';

import NewReportForm from '@/components/NewReportForm';
import ReportCard from '@/components/ReportCard';

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-[#0f172a] p-8">
      <h1 className="text-5xl font-bold text-center mb-12 text-teal-400">
        Lumina Investment Intelligence
      </h1>
      <NewReportForm />
      {/* 보고서 리스트는 나중에 추가 */}
    </div>
  );
}