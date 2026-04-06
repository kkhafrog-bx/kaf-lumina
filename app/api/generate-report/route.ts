import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateObject } from 'ai';
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
      await testModel.doGenerate?.({ prompt: 'ping' });
      cachedGeminiModelId = modelId;
      console.log(`✅ Gemini 선택: ${modelId}`);
      return modelId;
    } catch {}
  }

  throw new Error('사용 가능한 Gemini 모델 없음');
}

// ==================== JSON Schema (핵심) ====================
const ReportSchema = z.object({
  company: z.string().optional(),
  ticker: z.string().optional(),

  overview: z.any(),
  financial_summary: z.any().optional(),
  valuation: z.any().optional(),
  scenario_analysis: z.any().optional(),

  key_insights: z.any(),
  risks: z.any(),

  decision: z.any().optional(),
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

    // 로그인 확인
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

    // ==================== 🔥 핵심: generateObject ====================
    const { object: reportJson } = await generateObject({
      model,
      schema: ReportSchema,
      system: systemPrompt,
      prompt: `Reference Date: ${new Date().toISOString().split('T')[0]}
Company: ${ticker || companyName}

Return structured investment report as JSON.`,
      temperature: 0,
    });

    // 이미지 삽입
    const finalReport = await insertImagesIntoReport(reportJson);

    // ZIP 생성
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(finalReport, null, 2));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    // 업로드
    const filePath = `${user.id}/${Date.now()}.zip`;

    const { error: uploadErr } = await supabase.storage
      .from('reports')
      .upload(filePath, zipBytes, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadErr) throw uploadErr;

    // DB 저장
    const { data: dbData, error: dbErr } = await supabase
      .from('reports')
      .insert({
        user_id: user.id,
        ticker: ticker || null,
        market,
        report_json: finalReport,
        notebook_zip_path: filePath,
      })
      .select()
      .single();

    if (dbErr) throw dbErr;

    return NextResponse.json(
      {
        reportId: dbData.id,
        report: finalReport,
      },
      { headers }
    );
  } catch (err: any) {
    console.error('🚨 generate-report failed:', err);

    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}