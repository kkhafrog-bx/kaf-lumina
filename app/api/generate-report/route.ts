import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import JSZip from 'jszip';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { US_PROMPT, KR_PROMPT } from '@/lib/prompts';
import { insertImagesIntoReport } from '@/lib/imageUtils';

export const runtime = 'nodejs';

// ==================== Gemini fallback ====================
const GEMINI_PRIORITY = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
] as const;

// ==================== 시장 판별 (수정 완료) ====================
function detectMarket(ticker?: string, companyName?: string) {
  if (!ticker && !companyName) return 'US';

  // 한국 주식: 6자리 숫자
  if (ticker && /^\d{6}$/.test(ticker)) return 'KR';

  // suffix
  if (ticker?.endsWith('.KS') || ticker?.endsWith('.KQ')) return 'KR';

  // 회사명 기반
  if (companyName?.includes('전자') || companyName?.includes('주식회사')) return 'KR';

  return 'US';
}

// ==================== JSON 클린 ====================
function cleanJson(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

// ==================== JSON 추출 ====================
function extractJson(text: string): string {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1) {
    throw new Error('JSON 형태를 찾을 수 없음');
  }
  return text.slice(first, last + 1);
}

// ==================== 최신 데이터 판정 ====================
function classifyInvestment(latestDateStr: string | null) {
  if (!latestDateStr) return 'DATA_INSUFFICIENT';

  const today = new Date();
  const latest = new Date(latestDateStr);

  const diffDays = Math.floor(
    (today.getTime() - latest.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays <= 7) return 'SHORT_TERM';
  if (diffDays <= 30) return 'MID_TERM';
  if (diffDays <= 90) return 'LONG_TERM';
  return 'INVALID';
}

// ==================== JSON 정규화 ====================
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
      return NextResponse.json(
        { error: '티커 또는 회사명이 필요합니다.' },
        { status: 400, headers }
      );
    }

    // ==================== USER ====================
    const { data } = await supabase.auth.getUser();
    const user = data?.user;

    console.log('USER:', user);
    console.log('USER ID:', user?.id);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers }
      );
    }

    // ==================== MARKET ====================
    const market = detectMarket(ticker, companyName);

    const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;

    // ==================== MODEL 실행 ====================
    let text = '';
    let lastError: any;

    for (const modelId of GEMINI_PRIORITY) {
      try {
        console.log(`🚀 시도 모델: ${modelId}`);

        const result = await generateText({
          model: google(modelId),
          system: systemPrompt,
          prompt: `
Reference Date: ${new Date().toISOString().split('T')[0]}
Company: ${ticker || companyName}

IMPORTANT:
- 반드시 "latest_source_date" 포함 (YYYY-MM-DD)
- 최신 데이터만 사용
- JSON만 반환
`,
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

    // ==================== 최신 데이터 판정 ====================
    const latestDate = reportJson.latest_source_date ?? null;
    const classification = classifyInvestment(latestDate);

    reportJson.report_meta = {
      generated_at: new Date().toISOString(),
      latest_source_date: latestDate,
      investment_horizon: classification,
    };

    // ==================== 이미지 ====================
    reportJson = await insertImagesIntoReport(reportJson);

    // ==================== ZIP ====================
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    const safeTicker = (ticker || companyName || 'report').replace(
      /[^a-zA-Z0-9._-]/g,
      '_'
    );

    const filePath = `${user.id}/${safeTicker}-${Date.now()}.zip`;

    // ==================== STORAGE ====================
    const { error: uploadErr } = await supabase.storage
      .from('reports')
      .upload(filePath, zipBytes, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadErr) {
      console.error('🚨 STORAGE ERROR:', uploadErr);
      throw uploadErr;
    }

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

    if (dbErr) {
      console.error('🚨 DB ERROR:', dbErr);
      throw dbErr;
    }

    return NextResponse.json(
      { reportId: dbData.id, report: reportJson },
      { headers }
    );

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