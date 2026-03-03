'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Props = {
  report: any;
};

function isPlainObject(v: any) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function toText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);

  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function normalizeArray(v: any): any[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * 라벨(Title/Description/기타 key)과 내용이
 * 항상 같은 기준선에서 시작하도록 "라벨 고정폭" 렌더
 */
function KVRow({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-start gap-3">
      {/* 라벨 고정폭 */}
      <div className="w-28 shrink-0 text-sm font-semibold text-slate-200">
        {label}
        <span className="opacity-60"> :</span>
      </div>
      {/* 내용 */}
      <div className="flex-1 text-sm leading-7 text-slate-100 whitespace-pre-wrap">
        {toText(value)}
      </div>
    </div>
  );
}

function renderInsightLike(item: any) {
  // string이면 그냥 본문
  if (typeof item === 'string') {
    return (
      <div className="text-sm leading-7 text-slate-100 whitespace-pre-wrap">
        {item}
      </div>
    );
  }

  // { title, description } 형태
  if (isPlainObject(item) && (item.title || item.description)) {
    return (
      <div className="space-y-3">
        {item.title != null && <KVRow label="Title" value={item.title} />}
        {item.description != null && <KVRow label="Description" value={item.description} />}
      </div>
    );
  }

  // 기타 object → key/value 렌더
  if (isPlainObject(item)) {
    const entries = Object.entries(item);
    return (
      <div className="space-y-2">
        {entries.map(([k, v]) => (
          <KVRow
            key={k}
            // 키는 소제목처럼 첫 글자만 대문자 느낌으로 (원하면 그대로 두기 가능)
            label={k.length ? k[0].toUpperCase() + k.slice(1) : k}
            value={v}
          />
        ))}
      </div>
    );
  }

  // array/기타
  return (
    <div className="text-sm leading-7 text-slate-100 whitespace-pre-wrap">
      {toText(item)}
    </div>
  );
}

function SectionBox({ title, children }: { title: string; children: any }) {
  return (
    <div className="glass p-6 rounded-3xl">
      {/* 섹션 타이틀: 대문자 */}
      <div className="text-xl font-bold text-teal-300 mb-4 tracking-wide">
        {title.toUpperCase()}
      </div>
      <div className="border-t border-white/10 pt-5">{children}</div>
    </div>
  );
}

export default function ReportTabs({ report }: Props) {
  const overview = toText(report?.overview);
  const financial = toText(report?.financial_summary);
  const valuation = toText(report?.valuation);
  const scenario = toText(report?.scenario_analysis);
  const buy = toText(report?.should_i_buy);

  const insights = normalizeArray(report?.key_insights);
  const risks = normalizeArray(report?.risks);

  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList className="grid w-full grid-cols-6 mb-6">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="financial">Financial</TabsTrigger>
        <TabsTrigger value="insights">Insights</TabsTrigger>
        <TabsTrigger value="risks">Risks</TabsTrigger>
        <TabsTrigger value="valuation">Valuation</TabsTrigger>
        <TabsTrigger value="scenario">Scenario</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <SectionBox title="OVERVIEW">
          <div className="whitespace-pre-wrap leading-7 text-slate-100">
            {overview}
          </div>
        </SectionBox>
      </TabsContent>

      <TabsContent value="financial">
        <SectionBox title="FINANCIAL SUMMARY">
          <div className="whitespace-pre-wrap leading-7 text-slate-100">
            {financial}
          </div>
        </SectionBox>
      </TabsContent>

      <TabsContent value="insights">
        <SectionBox title="INSIGHTS">
          {insights.length === 0 ? (
            <div className="opacity-70 text-slate-300">인사이트가 없습니다.</div>
          ) : (
            <div className="space-y-5">
              {insights.map((it: any, idx: number) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                >
                  {/* 아이템 내부 구분선 + 정렬 */}
                  <div className="mb-4 flex items-center gap-3">
                    <div className="text-xs font-semibold text-slate-300">
                      #{idx + 1}
                    </div>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>

                  {renderInsightLike(it)}
                </div>
              ))}
            </div>
          )}
        </SectionBox>
      </TabsContent>

      <TabsContent value="risks">
        <SectionBox title="RISKS">
          {risks.length === 0 ? (
            <div className="opacity-70 text-slate-300">리스크가 없습니다.</div>
          ) : (
            <div className="space-y-5">
              {risks.map((it: any, idx: number) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                >
                  <div className="mb-4 flex items-center gap-3">
                    <div className="text-xs font-semibold text-slate-300">
                      #{idx + 1}
                    </div>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>

                  {renderInsightLike(it)}
                </div>
              ))}
            </div>
          )}
        </SectionBox>
      </TabsContent>

      <TabsContent value="valuation">
        <SectionBox title="VALUATION">
          <div className="whitespace-pre-wrap leading-7 text-slate-100">
            {valuation}
          </div>
        </SectionBox>
      </TabsContent>

      <TabsContent value="scenario">
        <SectionBox title="SCENARIO ANALYSIS">
          <div className="whitespace-pre-wrap leading-7 text-slate-100">
            {scenario}
          </div>

          <div className="mt-10">
            <div className="text-xl font-bold text-teal-300 mb-4 tracking-wide">
              SHOULD I BUY
            </div>
            <div className="border-t border-white/10 pt-5 whitespace-pre-wrap leading-7 text-slate-100">
              {buy}
            </div>
          </div>
        </SectionBox>
      </TabsContent>
    </Tabs>
  );
}