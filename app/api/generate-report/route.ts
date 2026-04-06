// app/api/generate-report/route.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import JSZip from 'jszip';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { US_PROMPT, KR_PROMPT } from '@/lib/prompts';
import { insertImagesIntoReport } from '@/lib/imageUtils';

export const runtime = 'nodejs';

// ==================== Gemini 자동 선택 ====================
let cachedGeminiModelId: string | null = null;

const GEMINI_PRIORITY = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2-flash',
  'gemini-2-flash-exp',
  'gemini-2-flash-lite',
  'gemini-2.0',
] as const;

async function pickGeminiModelIdOnce(): Promise<string> {
  if (cachedGeminiModelId) return cachedGeminiModelId;

  for (const modelId of GEMINI_PRIORITY) {
    try {
      const testModel = google(modelId);
      await generateText({ model: testModel, prompt: 'ping', temperature: 0 });
      cachedGeminiModelId = modelId;
      console.log(`✅ Gemini 선택: ${modelId}`);
      return modelId;
    } catch {}
  }
  throw new Error('사용 가능한 Gemini 모델 없음');
}

function cleanJson(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

export async function POST(req: NextRequest) {
  const { supabase, headers } = createSupabaseServerClient(req);

  try {
    const body = await req.json();
    const { ticker, companyName } = body;

    if (!ticker && !companyName) {
      return NextResponse.json({ error: '티커 또는 회사명 필요' }, { status: 400, headers });
    }

    // 로그인 체크
    const { data } = await supabase.auth.getUser();
    const user = data?.user;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    }

    const market =
      ticker?.includes('.KS') || ticker?.includes('.KQ') ? 'KR' : 'US';

    const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;

    const modelId = await pickGeminiModelIdOnce();
    const model = google(modelId);

    // ==================== 🔥 핵심: 재시도 포함 생성 ====================
    let textResult = '';

    const first = await generateText({
      model,
      system: systemPrompt,
      prompt: `Reference Date: ${new Date().toISOString().split('T')[0]}
Company: ${ticker || companyName}

IMPORTANT:
Return ONLY valid JSON.
No explanation.
Ensure JSON is complete and closed.`,
      temperature: 0,
      maxOutputTokens: 6000,
    });

    textResult = first.text;

    // 🔁 재시도
    for (let i = 0; i < 2; i++) {
      const cleaned = cleanJson(textResult);

      if (cleaned.trim().endsWith('}')) break;

      console.log('🔁 JSON 잘림 → 재시도', i + 1);

      const retry = await generateText({
        model,
        system: systemPrompt,
        prompt: `Return ONLY valid complete JSON for ${ticker || companyName}`,
        temperature: 0,
        maxOutputTokens: 6000,
      });

      textResult = retry.text;
    }

    const cleaned = cleanJson(textResult);

    if (!cleaned.trim().endsWith('}')) {
      throw new Error('JSON truncated');
    }

    let reportJson = JSON.parse(cleaned);

    // 이미지 삽입
    reportJson = await insertImagesIntoReport(reportJson);

    // ZIP 생성
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    // 업로드
    const filePath = `${user.id}/${Date.now()}.zip`;

    await supabase.storage
      .from('reports')
      .upload(filePath, zipBytes, { upsert: true });

    const { data: dbData } = await supabase
      .from('reports')
      .insert({
        user_id: user.id,
        ticker,
        market,
        report_json: reportJson,
        notebook_zip_path: filePath,
      })
      .select()
      .single();

    return NextResponse.json({ reportId: dbData.id, report: reportJson }, { headers });

  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500, headers });
  }
}