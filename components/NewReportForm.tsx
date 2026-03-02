'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

export default function NewReportForm() {
  const [ticker, setTicker] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [llm, setLlm] = useState('grok');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker && !companyName) {
      toast.error('티커나 회사명을 입력해주세요');
      return;
    }

    const res = await fetch('/api/generate-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, companyName, preferredLLM: llm }),
    });

    const data = await res.json();
    if (data.reportId) {
      toast.success('보고서 생성 완료!');
      router.push(`/report/${data.reportId}`);
    } else {
      toast.error('보고서 생성 실패');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="glass p-8 rounded-3xl max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6 text-center warm-accent">새 보고서 생성</h2>
      <div className="space-y-6">
        <div>
          <Label htmlFor="ticker">티커 (예: FYBR)</Label>
          <Input id="ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="companyName">회사명 (선택)</Label>
          <Input id="companyName" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </div>
        <div>
          <Label>사용할 AI 모델</Label>
          <Select value={llm} onValueChange={setLlm}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="grok">Grok 4.2 (추천)</SelectItem>
              <SelectItem value="gpt">GPT-4o</SelectItem>
              <SelectItem value="claude">Claude 3.5</SelectItem>
              <SelectItem value="gemini">Gemini 1.5</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" className="w-full bg-teal-500 hover:bg-teal-600 py-6 text-lg">
          보고서 생성하기
        </Button>
      </div>
    </form>
  );
}