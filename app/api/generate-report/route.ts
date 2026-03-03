import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import JSZip from 'jszip';
import nodemailer from 'nodemailer';

import { createSupabaseRouteClient } from '@/lib/supabase/route';
import { US_PROMPT, KR_PROMPT } from '@/lib/prompts';
import { insertImagesIntoReport } from '@/lib/imageUtils';

export const runtime = 'nodejs';

// ================= Gemini 자동 선택 =================
let cachedGeminiModelId: string | null = null;

const GEMINI_PRIORITY = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2-flash',
  'gemini-2-flash-exp',
  'gemini-2-flash-lite',
  'gemini-2.0',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-1.0',
] as const;

async function pickGeminiModelIdOnce(): Promise<string> {
  if (cachedGeminiModelId) return cachedGeminiModelId;

  for (const modelId of GEMINI_PRIORITY) {
    try {
      const testModel = google(modelId);
      await generateText({ model: testModel, prompt: 'ping', temperature: 0 });
      cachedGeminiModelId = modelId;
      return modelId;
    } catch {}
  }

  throw new Error('사용 가능한 Gemini 모델을 찾을 수 없습니다.');
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
  const { supabase, res } = createSupabaseRouteClient(req);

  try {
    const body = await req.json();
    const { ticker, companyName, preferredLLM } = body as {
      ticker?: string;
      companyName?: string;
      preferredLLM?: 'gemini' | 'grok' | 'gpt' | 'claude';
    };

    if (!ticker && !companyName) {
      return NextResponse.json(
        { error: '티커 또는 회사명이 필요합니다.' },
        { status: 400, headers: res.headers }
      );
    }

    // ===== 로그인 확인 =====
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: res.headers }
      );
    }

    const market =
      ticker?.includes('.KS') || ticker?.includes('.KQ') || companyName?.includes('주식회사')
        ? 'KR'
        : 'US';

    const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;

    // ===== 모델 선택 =====
    let model: any;

    if (!preferredLLM || preferredLLM === 'gemini') {
      const modelId = await pickGeminiModelIdOnce();
      model = google(modelId);
    } else {
      type ModelKey = 'grok' | 'gpt' | 'claude';
      const modelMap: Record<ModelKey, any> = {
        grok: require('@ai-sdk/xai').xai('grok-4.2'),
        gpt: require('@ai-sdk/openai').openai('gpt-4o'),
        claude: require('@ai-sdk/anthropic').anthropic('claude-3-5-sonnet'),
      };
      model = modelMap[preferredLLM as ModelKey];
    }

    // ===== 보고서 생성 =====
    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: `Reference Date: ${new Date().toISOString().split('T')[0]}
Company: ${ticker || companyName}
Output strictly as JSON.`,
    });

    const cleaned = cleanJson(text);

    let reportJson: any;
    try {
      reportJson = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: '모델 JSON 파싱 실패', raw: cleaned },
        { status: 502, headers: res.headers }
      );
    }

    reportJson = await insertImagesIntoReport(reportJson);

    // ===== ZIP 생성 =====
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    const safeTicker = (ticker || companyName || 'report').replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${user.id}/${safeTicker}-${Date.now()}.zip`;

    // ===== Storage 업로드 =====
    const { error: uploadErr } = await supabase.storage
      .from('reports')
      .upload(filePath, zipBytes, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadErr) {
      return NextResponse.json(
        { error: uploadErr.message },
        { status: 500, headers: res.headers }
      );
    }

    // ===== DB 저장 =====
    const { data: dbData, error: dbErr } = await supabase
      .from('reports')
      .insert({
        user_id: user.id,
        ticker: ticker || null,
        market,
        report_json: reportJson,
        notebook_zip_path: filePath,
      })
      .select()
      .single();

    if (dbErr) {
      return NextResponse.json(
        { error: dbErr.message },
        { status: 500, headers: res.headers }
      );
    }

    return NextResponse.json(
      { reportId: dbData.id, report: reportJson },
      { headers: res.headers }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? String(err) },
      { status: 500, headers: res.headers }
    );
  }
}