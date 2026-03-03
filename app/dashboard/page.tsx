'use client';

import NewReportForm from '@/components/NewReportForm';
import LogoutButton from '@/components/LogoutButton';

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-[#0f172a] p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-teal-400">
            Lumina Investment Intelligence
          </h1>

          <LogoutButton />
        </div>

        {/* Body */}
        <NewReportForm />
      </div>
    </div>
  );
}