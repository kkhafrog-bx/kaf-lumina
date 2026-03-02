'use client';

import NewReportForm from '@/components/NewReportForm';

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-[#0f172a] p-8">
      <h1 className="text-5xl font-bold text-center mb-12 text-teal-400">
        Lumina Investment Intelligence
      </h1>
      <NewReportForm />
    </div>
  );
}