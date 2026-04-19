import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import JSZip from 'jszip';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { US_PROMPT, KR_PROMPT } from '@/lib/prompts';
import { insertImagesIntoReport } from '@/lib/imageUtils';

export const runtime = 'nodejs';

// ==================== Gemini 순차 fallback ====================
const GEMINI_PRIORITY = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
] as const;

// ==================== JSON 클린 ====================
function cleanJson(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

// ✅ JSON 추출 (중간 쓰레기 제거)
function extractJson(text: string): string {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1) {
    throw new Error('JSON 형태를 찾을 수 없음');
  }
  return text.slice(first, last + 1);
}

// ==================== 최소 정규화 ====================
function normalizeReportJson(raw: any) {
  const r = typeof raw === 'object' && raw ? { ...raw } : {};

  r.company = String(r.company ?? '').trim();
  r.ticker = String(r.ticker ?? '').trim();

  if (!r.company && r.ticker) r.company = r.ticker;
  if (!r.ticker && r.company) r.ticker = r.company;

  if (!Array.isArray(r.key_insights)) r.key_insights = [];
  if (!Array.isArray(r.risks)) r.risks = [];

  return r;
}

// ==================== MAIN ====================
export async function POST(req: NextRequest) {
  const { supabase, headers } = createSupabaseServerClient(req);

  try {
    const body = await req.json();
    const { ticker, companyName } = body;

    if (!ticker && !companyName) {
      return NextResponse.json({ error: '티커 또는 회사명이 필요합니다.' }, { status: 400, headers });
    }

    // 🔐 사용자 확인
    const { data } = await supabase.auth.getUser();
    const user = data?.user;

    console.log('USER:', user);
    console.log('USER ID:', user?.id);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    }

    const market =
      ticker?.includes('.KS') || ticker?.includes('.KQ') || companyName?.includes('주식회사')
        ? 'KR'
        : 'US';

    const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;

    // ==================== 모델 순차 실행 ====================
    let text = '';
    let lastError: any;

    for (const modelId of GEMINI_PRIORITY) {
      try {
        console.log(`🚀 시도 모델: ${modelId}`);

        const result = await generateText({
          model: google(modelId),
          system: systemPrompt,
          prompt: `Reference Date: ${new Date().toISOString().split('T')[0]}
Company: ${ticker || companyName}
Return ONLY valid JSON.`,
        });

        text = result.text;

        console.log(`✅ 성공 모델: ${modelId}`);
        console.log('RAW TEXT:', text.slice(0, 1000));

        break;
      } catch (err: any) {
        console.log(`❌ 실패 모델: ${modelId}`, err?.message);
        lastError = err;
      }
    }

    if (!text) {
      throw new Error(`모든 Gemini 모델 실패: ${lastError?.message}`);
    }

    // ==================== JSON 처리 ====================
    const cleaned = cleanJson(text);
    console.log('CLEANED TEXT:', cleaned.slice(0, 1000));

    let reportJson: any;

    try {
      const extracted = extractJson(cleaned);
      reportJson = JSON.parse(extracted);
    } catch (e) {
      console.error('❌ JSON PARSE FAIL:', cleaned);
      throw new Error('모델이 올바른 JSON을 반환하지 않았습니다');
    }

    reportJson = normalizeReportJson(reportJson);

    // 이미지 삽입
    reportJson = await insertImagesIntoReport(reportJson);

    // ==================== ZIP 생성 ====================
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    const safeTicker = (ticker || companyName || 'report').replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${user.id}/${safeTicker}-${Date.now()}.zip`;

    // ==================== Storage ====================
    const { error: uploadErr } = await supabase.storage
      .from('reports')
      .upload(filePath, zipBytes, { contentType: 'application/zip', upsert: true });

    if (uploadErr) throw uploadErr;

    // ==================== DB ====================
    const { data: dbData, error: dbErr } = await supabase
      .from('reports')
      .insert({
        user_id: user.id,
        ticker: ticker || null,
        region: market,
        json_path: filePath,
        status: 'completed',
      })
      .select()
      .single();

    if (dbErr) throw dbErr;

    return NextResponse.json({ reportId: dbData.id, report: reportJson }, { headers });
  } catch (err: any) {
    console.error('🚨 generate-report failed:', err?.message ?? err);

    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}