'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

export default function ReportList() {
  const [reports, setReports] = useState<any[]>([]);

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

  const getPdfUrl = (path?: string) => {
    if (!path) return '';
    return supabase.storage.from('reports').getPublicUrl(path).data.publicUrl;
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h2 className="text-orange-400 font-bold mb-4">Reports</h2>

      <div className="space-y-3">
        {reports.map((r) => {
          const pdfUrl = getPdfUrl(r.pdf_path);

          return (
            <div key={r.id} className="p-4 border border-gray-700 rounded">
              <div className="flex justify-between items-center">
                <div className="text-white font-bold">
                  {r.ticker || 'N/A'}
                </div>

                <div className="text-gray-400 text-sm">
                  {r.created_at
                    ? new Date(r.created_at).toLocaleString()
                    : ''}
                </div>
              </div>

              <div className="mt-3">
                {pdfUrl ? (
                  <a
                    href={pdfUrl}
                    target="_blank"
                    className="px-4 py-2 bg-orange-500 rounded text-sm font-bold hover:bg-orange-600"
                  >
                    PDF 다운로드
                  </a>
                ) : (
                  <div className="text-gray-500 text-sm">
                    PDF 없음
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}