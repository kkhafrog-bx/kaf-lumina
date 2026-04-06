import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateObject, generateText } from 'ai';
import { google } from '@ai-sdk/google';
import JSZip from 'jszip';
import { z } from 'zod';

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
] as const;

async function pickGeminiModelIdOnce(): Promise<string> {
  if (cachedGeminiModelId) return cachedGeminiModelId;

  for (const modelId of GEMINI_PRIORITY) {
    try {
      const testModel = google(modelId);

      // 🔥 안전 테스트 (기존 방식으로)
      await generateText({
        model: testModel,
        prompt: 'ping',
      });

      cachedGeminiModelId = modelId;
      console.log(`✅ Gemini 선택: ${modelId}`);
      return modelId;
    } catch (e) {
      console.log(`❌ ${modelId} 실패`);
    }
  }

  throw new Error('사용 가능한 Gemini 모델 없음');
}

// ==================== Schema ====================
const ReportSchema = z.object({
  company: z.string().optional(),
  ticker: z.string().optional(),
  overview: z.any(),
  key_insights: z.any(),
  risks: z.any(),
});

// ==================== API ====================
export async function POST(req: NextRequest) {
  const { supabase, headers } = createSupabaseServerClient(req);

  try {
    const body = await req.json();
    const { ticker, companyName } = body;

    if (!ticker && !companyName) {
      return NextResponse.json(
        { error: '티커 또는 회사명 필요' },
        { status: 400, headers }
      );
    }

    const { data } = await supabase.auth.getUser();
    const user = data?.user;

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers }
      );
    }

    const market =
      ticker?.includes('.KS') || ticker?.includes('.KQ')
        ? 'KR'
        : 'US';

    const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;

    const modelId = await pickGeminiModelIdOnce();
    const model = google(modelId);

    // 🔥 핵심: 안정 generateObject
    const { object } = await generateObject({
      model,
      schema: ReportSchema,
      system: systemPrompt,
      prompt: `Company: ${ticker || companyName}
Return structured JSON.`,
    });

    const finalReport = await insertImagesIntoReport(object);

    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(finalReport, null, 2));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

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
        report_json: finalReport,
        notebook_zip_path: filePath,
      })
      .select()
      .single();

    return NextResponse.json(
      { reportId: dbData.id, report: finalReport },
      { headers }
    );
  } catch (err: any) {
    console.error(err);

    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}