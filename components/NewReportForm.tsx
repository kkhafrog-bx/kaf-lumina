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
  const [llm, setLlm] = useState<'grok' | 'gpt' | 'claude' | 'gemini'>('grok');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!ticker) {
      toast.error('티커를 입력해주세요');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // ✅ 쿠키(세션) 전송
        body: JSON.stringify({ ticker, companyName, preferredLLM: llm }),
      });

      // ✅ 서버가 500으로 빈 응답을 주더라도 절대 프론트가 죽지 않게 처리
      const raw = await res.text();
      let data: any = null;

      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = { error: raw || null };
      }

      if (!res.ok) {
        console.error('generate-report failed:', { status: res.status, raw });
        toast.error(data?.error || `보고서 생성 실패 (HTTP ${res.status})`);
        return;
      }

      if (data?.reportId) {
        toast.success('보고서가 생성되었습니다!');
        router.push(`/report/${data.reportId}`);
      } else {
        toast.error(data?.error || '보고서 생성 실패');
      }
    } catch (err) {
      console.error(err);
      toast.error('서버 연결 오류');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="glass p-8 rounded-3xl max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6 text-center warm-accent">새 보고서 생성</h2>

      <div className="space-y-6">
        <div>
          <Label htmlFor="ticker">티커 (예: FYBR 또는 VZ)</Label>
          <Input
            id="ticker"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="FYBR"
            autoComplete="off"
          />
        </div>

        <div>
          <Label htmlFor="companyName">회사명 (선택)</Label>
          <Input
            id="companyName"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="verizon"
            autoComplete="off"
          />
        </div>

        <div>
          <Label>사용할 AI 모델</Label>
          <Select value={llm} onValueChange={(v) => setLlm(v as any)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="grok">Grok 4.2</SelectItem>
              <SelectItem value="gpt">GPT-4o</SelectItem>
              <SelectItem value="claude">Claude 3.5</SelectItem>
              <SelectItem value="gemini">Gemini (자동 선택)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          type="submit"
          className="w-full bg-teal-500 hover:bg-teal-600 py-6 text-lg"
          disabled={loading}
        >
          {loading ? '보고서 생성 중...' : '보고서 생성하기'}
        </Button>
      </div>
    </form>
  );
}