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

    setReports(Array.isArray(data) ? data : []);
  };

  // 🔥 안전 URL 생성
  const getUrl = (path?: string | null) => {
    if (!path) return '';
    return supabase.storage.from('reports').getPublicUrl(path).data.publicUrl;
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-orange-400 mb-6">
        Reports
      </h2>

      <div className="space-y-6">
        {reports.map((r) => {
          const pdfUrl = getUrl(r.pdf_path);
          const zipUrl = getUrl(r.notebook_zip_path || r.json_path);

          return (
            <div
              key={r.id}
              onClick={() => router.push(`/report/${r.id}`)}
              className="border border-gray-800 rounded-lg p-4 bg-black cursor-pointer hover:border-orange-400"
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-white font-bold">{r.ticker}</div>
                  <div className="text-gray-400 text-sm">
                    {r.created_at
                      ? new Date(r.created_at).toLocaleString()
                      : ''}
                  </div>
                </div>

                <div className="text-sm text-gray-500">
                  {r.region || ''}
                </div>
              </div>

              {/* 🔥 여기 안전하게 */}
              <DownloadButtons
                pdfUrl={pdfUrl}
                zipUrl={zipUrl}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}