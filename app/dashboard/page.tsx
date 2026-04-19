'use client';

import Header from '@/components/Header';
import NewReportForm from '@/components/NewReportForm';
import ReportList from '@/components/ReportList';

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <Header />

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-10">
        <NewReportForm />
        <ReportList />
      </div>
    </div>
  );
}