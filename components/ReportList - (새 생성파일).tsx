'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import DownloadButtons from './DownloadButtons';
import { useRouter } from 'next/navigation';

export default function ReportList() {
  const [reports, setReports] = useState<any[]>([]);
  const router = useRouter();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false });

    setReports(data || []);
  };

  const getUrl = (path: string) => {
    return supabase.storage.from('reports').getPublicUrl(path).data.publicUrl;
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-orange-400 mb-6">
        Reports
      </h2>

      <div className="space-y-6">
        {reports.map((r) => (
          <div
            key={r.id}
            onClick={() => router.push(`/report/${r.id}`)}
            className="border border-gray-800 rounded-lg p-4 bg-black cursor-pointer hover:border-orange-400"
          >
            <div className="flex justify-between items-center">
              <div>
                <div className="text-white font-bold">{r.ticker}</div>
                <div className="text-gray-400 text-sm">
                  {new Date(r.created_at).toLocaleString()}
                </div>
              </div>

              <div className="text-sm text-gray-500">
                {r.region}
              </div>
            </div>

            <DownloadButtons
              pdfUrl={getUrl(r.pdf_path)}
              zipUrl={getUrl(r.json_path)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}