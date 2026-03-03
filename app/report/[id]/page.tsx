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

function isPlainObject(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function prettyKey(k: string): string {
  return String(k || '').replace(/_/g, ' ').trim();
}

function formatNumber(n: number): string {
  const s = String(n);
  const dec = s.includes('.') ? s.split('.')[1].length : 0;
  const max = Math.min(Math.max(dec, 0), 4); // 소수는 최대 4자리까지만 표시
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: max }).format(n);
}

function toDisplayText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  return ''; // object/array는 별도 렌더
}

function smartWrapKorean(text: string): string {
  const t = (text || '').trim();
  if (!t) return '';

  // 이미 줄바꿈 있으면 그대로
  if (t.includes('\n')) return t;

  // 문장 단위로 끊어서 줄바꿈(가독성)
  const parts = t
    .split(/(?<=다\.)\s+|(?<=\.)\s+|(?<=\!)\s+|(?<=\?)\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

  if (parts.length >= 2) return parts.join('\n');

  // 문장 구분이 거의 없으면 길이 기준 강제 줄바꿈
  const maxLen = 80;
  if (t.length <= maxLen) return t;

  const words = t.split(' ');
  let line = '';
  const out: string[] = [];
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxLen) {
      out.push(line.trim());
      line = w;
    } else {
      line += ' ' + w;
    }
  }
  if (line.trim()) out.push(line.trim());
  return out.join('\n');
}

type Row = { label?: string; text: string; kind?: 'divider'; indent?: number };

/**
 * 재무 데이터처럼 중첩된 객체를 사람이 읽는 형태로 "펼쳐서" 렌더링
 * - 숫자는 1,000,000 포맷
 * - 키의 _ 제거
 * - 큰 문장은 smartWrap
 */
function flattenValue(value: unknown, indent = 0): Row[] {
  if (value == null) return [];

  // primitive
  if (!isPlainObject(value) && !Array.isArray(value)) {
    const txt = smartWrapKorean(toDisplayText(value) || String(value));
    return txt ? [{ text: txt, indent }] : [];
  }

  // array
  if (Array.isArray(value)) {
    const rows: Row[] = [];
    for (const item of value as any[]) {
      if (item == null) continue;
      if (isPlainObject(item) || Array.isArray(item)) {
        rows.push(...flattenValue(item, indent));
        rows.push({ text: '', kind: 'divider' });
      } else {
        const s = smartWrapKorean(toDisplayText(item) || String(item));
        if (s) rows.push({ text: `• ${s}`, indent });
      }
    }
    while (rows.length && rows[rows.length - 1].kind === 'divider') rows.pop();
    return rows;
  }

  // object
  const obj = value as Record<string, any>;
  const rows: Row[] = [];

  // title/description 있으면 그걸 우선 정리
  const hasTD = typeof obj.title !== 'undefined' || typeof obj.description !== 'undefined';
  if (hasTD) {
    const t = smartWrapKorean(String(toDisplayText(obj.title) || obj.title || '').trim());
    const d = smartWrapKorean(String(toDisplayText(obj.description) || obj.description || '').trim());
    if (t) rows.push({ label: 'Title', text: t, indent });
    if (d) rows.push({ label: 'Description', text: d, indent });

    for (const [k, v] of Object.entries(obj)) {
      if (k === 'title' || k === 'description') continue;
      rows.push(...flattenValue({ [k]: v }, indent));
    }
    return rows;
  }

  // 일반 object: key별로
  for (const [k, v] of Object.entries(obj)) {
    const label = prettyKey(k);

    if (v == null) continue;

    // primitive면 label: text 한 줄
    if (!isPlainObject(v) && !Array.isArray(v)) {
      const text = smartWrapKorean(toDisplayText(v) || String(v));
      if (text) rows.push({ label, text, indent });
      continue;
    }

    // nested면 "label"을 한 줄로 먼저 보여주고 내부 들여쓰기
    rows.push({ text: label, indent, kind: 'divider' });
    rows.push(...flattenValue(v, indent + 1));
    rows.push({ text: '', kind: 'divider' });
  }

  while (rows.length && rows[rows.length - 1].kind === 'divider') rows.pop();
  return rows;
}

function titleCaseFirst(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function Section({ title, value }: { title: string; value: any }) {
  const rows = useMemo(() => flattenValue(value, 0), [value]);

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
          // divider는 섹션 헤더/구분선 용도로 사용
          if (r.kind === 'divider') {
            // label-only divider: "재무 데이터" 같은 걸 제목처럼 표시
            if (r.text) {
              const pad = (r.indent ?? 0) * 16;
              return (
                <div key={idx} style={{ paddingLeft: pad }} className="mt-2">
                  <div className="text-slate-200 font-semibold">{r.text}</div>
                  <div className="h-px bg-slate-700/60 mt-2" />
                </div>
              );
            }
            return <div key={idx} className="h-px bg-slate-700/60 my-2" />;
          }

          const pad = (r.indent ?? 0) * 16;

          // label 있는 경우: 정렬된 2열 레이아웃
          if (r.label) {
            return (
              <div
                key={idx}
                style={{ paddingLeft: pad }}
                className="grid grid-cols-[160px_1fr] gap-4 items-start"
              >
                <div className="text-slate-300 font-semibold">
                  {titleCaseFirst(prettyKey(r.label))}
                </div>
                <div className="text-slate-100 whitespace-pre-wrap leading-7">
                  {r.text}
                </div>
              </div>
            );
          }

          // label 없는 경우: 일반 문단
          return (
            <div
              key={idx}
              style={{ paddingLeft: pad }}
              className="text-slate-100 whitespace-pre-wrap leading-7"
            >
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

      const { data, error } = await supabase
        .from('reports')
        .select('*')
        .eq('id', reportId)
        .single();

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

  const rj = report.report_json ?? {};

  return (
    <div className="min-h-screen bg-[#0b1222] p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-teal-300">
              {String(report.ticker || rj.ticker || rj.company || 'Report')}
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