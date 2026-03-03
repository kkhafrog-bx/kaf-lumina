'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type AnyObj = Record<string, any>;

function isPlainObject(v: any): v is AnyObj {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function renderAny(value: any) {
  if (value == null) return <span className="text-slate-400">-</span>;

  // string/number/boolean
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <p className="whitespace-pre-wrap leading-7">{String(value)}</p>;
  }

  // array
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc pl-6 space-y-2">
        {value.map((item, idx) => (
          <li key={idx} className="whitespace-pre-wrap leading-7">
            {typeof item === 'string' ? item : JSON.stringify(item, null, 2)}
          </li>
        ))}
      </ul>
    );
  }

  // object
  if (isPlainObject(value)) {
    return (
      <div className="space-y-4">
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-white/10 p-4 bg-white/5">
            <div className="font-semibold text-teal-300 mb-2">{k}</div>
            <div className="text-slate-200">{renderAny(v)}</div>
          </div>
        ))}
      </div>
    );
  }

  // fallback
  return <pre className="whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>;
}

export default function ReportTabs({ report }: { report: any }) {
  const sections = [
    { key: 'overview', label: 'Overview' },
    { key: 'financial_summary', label: 'Financial' },
    { key: 'key_insights', label: 'Insights' },
    { key: 'risks', label: 'Risks' },
    { key: 'valuation', label: 'Valuation' },
    { key: 'scenario_analysis', label: 'Scenario' },
    { key: 'should_i_buy', label: 'Decision' },
  ] as const;

  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList className="flex flex-wrap gap-2 bg-white/5">
        {sections.map((s) => (
          <TabsTrigger key={s.key} value={s.key}>
            {s.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {sections.map((s) => (
        <TabsContent key={s.key} value={s.key} className="mt-6">
          <div className="glass rounded-3xl p-6">
            <div className="text-lg font-bold text-teal-300 mb-4">{s.label}</div>
            {renderAny(report?.[s.key])}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}