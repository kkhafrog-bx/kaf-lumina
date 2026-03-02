'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Image from 'next/image';

export default function ReportTabs({ report }: { report: any }) {
  const tabs = [
    { value: 'overview', label: '개요' },
    { value: 'financial_summary', label: '재무 요약' },
    { value: 'key_insights', label: '투자 인사이트' },
    { value: 'risks', label: '리스크' },
    { value: 'valuation', label: '밸류에이션' },
    { value: 'scenario_analysis', label: '시나리오' },
    { value: 'should_i_buy', label: '매수 추천' },
  ];

  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList className="glass flex w-full justify-start mb-8 p-1 rounded-2xl overflow-x-auto">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="px-6 py-3 data-[state=active]:bg-teal-500/20">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          <div className="glass p-8 rounded-3xl">
            <h2 className="text-3xl font-bold mb-6 warm-accent">{tab.label}</h2>
            <div className="text-slate-300 leading-relaxed whitespace-pre-wrap">
              {report[tab.value]}
            </div>
            {report[`${tab.value}_image`] && (
              <Image src={report[`${tab.value}_image`]} alt="" width={900} height={500} className="mt-6 rounded-xl" />
            )}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}