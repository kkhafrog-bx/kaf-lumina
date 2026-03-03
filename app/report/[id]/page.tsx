'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

type ReportRow = {
  id: string;
  user_id: string;
  ticker: string | null;
  market: string | null;
  created_at: string;
  report_json: any;
  notebook_zip_path: string | null;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function toSafeString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function titleCaseFirst(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function normalizeSectionValue(value: unknown): Array<{ label?: string; text: string }> {
  if (value == null) return [];

  // primitive
  if (!isPlainObject(value) && !Array.isArray(value)) {
    const s = toSafeString(value).trim();
    return s ? [{ text: s }] : [];
  }

  // object
  if (isPlainObject(value)) {
    const obj = value as Record<string, unknown>;
    const out: Array<{ label?: string; text: string }> = [];

    const t = toSafeString(obj.title).trim();
    const d = toSafeString(obj.description).trim();

    if (t) out.push({ label: 'Title', text: t });
    if (d) out.push({ label: 'Description', text: d });

    const extraKeys = Object.keys(obj).filter((k) => k !== 'title' && k !== 'description');
    for (const k of extraKeys) {
      const s = toSafeString(obj[k]).trim();
      if (s) out.push({ label: titleCaseFirst(k), text: s });
    }

    return out;
  }

  // array
  if (Array.isArray(value)) {
    const arr = value as unknown[]; // ✅ TS: iterable 확정
    const rows: Array<{ label?: string; text: string }> = [];

    for (const item of arr) {
      if (isPlainObject(item)) {
        const obj = item as Record<string, unknown>;
        const t = toSafeString(obj.title).trim();
        const d = toSafeString(obj.description).trim();

        if (t) rows.push({ label: 'Title', text: t });
        if (d) rows.push({ label: 'Description', text: d });

        if (t || d) {
          rows.push({ text: '__DIVIDER__' });
        } else {
          const lines = Object.entries(obj)
            .map(([k, v]) => `${k}: ${toSafeString(v)}`)
            .join('\n');
          if (lines.trim()) rows.push({ text: lines });
          rows.push({ text: '__DIVIDER__' });
        }
      } else {
        const s = toSafeString(item).trim();
        if (s) rows.push({ text: `• ${s}` });
      }
    }

    while (rows.length && rows[rows.length - 1].text === '__DIVIDER__') rows.pop();
    return rows;
  }

  return [];
}

function Section({ title, value }: { title: string; value: unknown }) {
  const rows = useMemo(() => normalizeSectionValue(value), [value]);
  if (!rows.length) return null;

  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-6 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-3 w-3 rounded-full bg-teal-400/90" />
        <h2 className="text-sm tracking-[0.28em] text-slate-200 font-semibold">
          {title.toUpperCase()}
        </h2>
      </div>

      <div className="space-y-3">
        {rows.map((r, idx) => {
          if (r.text === '__DIVIDER__') {
            return <div key={idx} className="h-px bg-slate-700/60 my-2" />;
          }

          if (r.label) {
            return (
              <div key={idx} className="grid grid-cols-[120px_1fr] gap-4 items-start">
                <div className="text-slate-300 font-semibold">{titleCaseFirst(r.label)}</div>
                <div className="text-slate-100 whitespace-pre-wrap leading-7">{r.text}</div>
              </div>
            );
          }

          return (
            <div key={idx} className="text-slate-100 whitespace-pre-wrap leading-7">
              {r.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const reportId = params?.id;
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<'pdf' | 'zip' | null>(null);
  const [report, setReport] = useState<ReportRow | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        router.replace('/login');
        return;
      }

      const { data, error } = await supabase.from('reports').select('*').eq('id', reportId).single();

      if (error || !data) {
        setError('보고서를 찾을 수 없습니다.');
        setReport(null);
        setLoading(false);
        return;
      }

      setReport(data as ReportRow);
      setLoading(false);
    })();
  }, [reportId, router, supabase]);

  const onDownloadPdf = async () => {
    if (!reportId) return;
    setDownloading('pdf');
    try {
      window.location.href = `/api/report/${reportId}/pdf`;
    } finally {
      setTimeout(() => setDownloading(null), 800);
    }
  };

  const onDownloadZip = async () => {
    if (!reportId) return;
    setDownloading('zip');
    try {
      window.location.href = `/api/report/${reportId}/zip`;
    } finally {
      setTimeout(() => setDownloading(null), 800);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b1222] flex items-center justify-center text-slate-200">
        보고서를 불러오는 중...
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-[#0b1222] flex items-center justify-center text-slate-200">
        {error || '보고서를 찾을 수 없습니다.'}
      </div>
    );
  }

  const rj: any = report.report_json ?? {};

  return (
    <div className="min-h-screen bg-[#0b1222] p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-teal-300">
              {toSafeString(report.ticker || rj.ticker || rj.company || 'Report')}
            </h1>
            <div className="text-slate-400 mt-2">
              {report.market ? `Market: ${report.market}` : null}
              {report.created_at ? `  •  ${new Date(report.created_at).toLocaleString()}` : null}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onDownloadPdf}
              className="px-4 py-2 rounded-xl bg-teal-500 text-slate-950 font-semibold hover:bg-teal-400 disabled:opacity-60"
              disabled={downloading === 'pdf'}
            >
              {downloading === 'pdf' ? 'PDF 생성 중…' : 'PDF 다운로드'}
            </button>

            <button
              onClick={onDownloadZip}
              className="px-4 py-2 rounded-xl border border-slate-600 text-slate-200 hover:bg-slate-800 disabled:opacity-60"
              disabled={downloading === 'zip'}
            >
              {downloading === 'zip' ? 'ZIP 준비 중…' : 'NotebookLM ZIP'}
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <Section title="Overview" value={rj.overview} />
          <Section title="Financial Summary" value={rj.financial_summary} />
          <Section title="Insights" value={rj.key_insights} />
          <Section title="Risks" value={rj.risks} />
          <Section title="Valuation" value={rj.valuation} />
          <Section title="Scenario Analysis" value={rj.scenario_analysis} />
          <Section title="Should I Buy" value={rj.should_i_buy} />
        </div>
      </div>
    </div>
  );
}