// app/api/generate-report/route.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import JSZip from 'jszip';
// import nodemailer from 'nodemailer'; // ✅ 나중에 쓸 때 다시 켜세요

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { US_PROMPT, KR_PROMPT } from '@/lib/prompts';
import { insertImagesIntoReport } from '@/lib/imageUtils';

export const runtime = 'nodejs';

// ==================== Gemini 자동 선택 (캐시) ====================
let cachedGeminiModelId: string | null = null;

const GEMINI_PRIORITY = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2-flash',
  'gemini-2-flash-lite',
  'gemini-2.0',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
] as const;

async function pickGeminiModelIdOnce(): Promise<string> {
  if (cachedGeminiModelId) return cachedGeminiModelId;

  for (const modelId of GEMINI_PRIORITY) {
    try {
      const testModel = google(modelId);
      await generateText({ model: testModel, prompt: 'ping', temperature: 0 });
      cachedGeminiModelId = modelId;
      console.log(`✅ Gemini 선택 성공: ${modelId}`);
      return modelId;
    } catch (e: any) {
      console.log(`❌ ${modelId} 실패: ${e?.message ?? e}`);
    }
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

// ==================== Report JSON 강제 정규화(저장 안정화) ====================
type AnyObj = Record<string, any>;

function isPlainObject(v: any): v is AnyObj {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function toSafeString(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function toStringArray(v: any): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => toSafeString(x)).map((s) => s.trim()).filter(Boolean);
  if (isPlainObject(v)) {
    return Object.entries(v)
      .map(([k, val]) => `${k}: ${toSafeString(val)}`.trim())
      .filter(Boolean);
  }
  const s = toSafeString(v).trim();
  return s ? [s] : [];
}

/**
 * LLM이 schema를 어겨도 저장/표시가 절대 깨지지 않게 강제 정규화
 * - overview/financial_summary/valuation/scenario_analysis/should_i_buy: string OR object도 가능(우린 UI에서 안전 렌더)
 * - key_insights/risks: 항상 array or object도 가능(우린 UI에서 안전 렌더)
 *
 * ✅ 여기서는 "최소한 company/ticker는 string"만 강제.
 * ✅ 나머지는 '원본 구조 유지'가 더 낫다(재무 데이터 같은 중첩 객체를 살리기 위해).
 */
function normalizeReportJson(raw: any) {
  const r: AnyObj = isPlainObject(raw) ? { ...raw } : {};

  r.company = toSafeString(r.company).trim();
  r.ticker = toSafeString(r.ticker).trim();

  if (!r.company && r.ticker) r.company = r.ticker;
  if (!r.ticker && r.company) r.ticker = r.company;

  // key_insights/risks가 string으로 오면 배열로만 변환(나머지는 구조 유지)
  if (typeof r.key_insights === 'string') r.key_insights = [r.key_insights];
  if (typeof r.risks === 'string') r.risks = [r.risks];

  // 비정상 null 방어
  if (r.key_insights == null) r.key_insights = [];
  if (r.risks == null) r.risks = [];

  return r;
}

export async function POST(req: NextRequest) {
  const { supabase, headers } = createSupabaseServerClient(req);

  try {
    const body = await req.json();
    const { ticker, companyName, preferredLLM } = body as {
      ticker?: string;
      companyName?: string;
      preferredLLM?: 'gemini' | 'grok' | 'gpt' | 'claude';
    };

    if (!ticker && !companyName) {
      return NextResponse.json({ error: '티커 또는 회사명이 필요합니다.' }, { status: 400, headers });
    }

    // ✅ 로그인 유저 확인(쿠키 기반)
    const { data, error: authError } = await supabase.auth.getUser();
    const user = data?.user;

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    }

    const market =
      ticker?.includes('.KS') || ticker?.includes('.KQ') || companyName?.includes('주식회사') ? 'KR' : 'US';
    const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;

    // 모델 선택
    let model: any;
    if (preferredLLM === 'gemini' || !preferredLLM) {
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

    // 보고서 생성
    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: `Reference Date: ${new Date().toISOString().split('T')[0]}\nCompany: ${
        ticker || companyName
      }\nOutput strictly as JSON.`,
    });

    const cleaned = cleanJson(text);

    let reportJson: any;
    try {
      reportJson = JSON.parse(cleaned);
    } catch {
      console.error('❌ JSON 파싱 실패 원본(앞부분):', cleaned.slice(0, 800));
      throw new Error('모델이 올바른 json을 반환하지 않았습니다');
    }

    // ✅ 저장 전 최소 정규화(구조는 유지)
    reportJson = normalizeReportJson(reportJson);

    // 이미지 삽입
    reportJson = await insertImagesIntoReport(reportJson);

    // ZIP 생성
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    // Storage 업로드
    const safeTicker = (ticker || companyName || 'report').replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${user.id}/${safeTicker}-${Date.now()}.zip`;

    const { error: uploadErr } = await supabase.storage
      .from('reports')
      .upload(filePath, zipBytes, { contentType: 'application/zip', upsert: true });

    if (uploadErr) throw uploadErr;

    // DB 저장
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

    if (dbErr) throw dbErr;

    // ==================== Gmail 발송 (주석처리) ====================
    // ✅ 지금은 기능 안정이 우선이라 꺼둠. 나중에 켤 때 아래 블록 그대로 복구하면 됨.
    //
    // try {
    //   if (process.env.GMAIL_EMAIL && process.env.GMAIL_APP_PASSWORD && user.email) {
    //     const transporter = nodemailer.createTransport({
    //       service: 'gmail',
    //       auth: {
    //         user: process.env.GMAIL_EMAIL,
    //         pass: process.env.GMAIL_APP_PASSWORD,
    //       },
    //     });
    //
    //     const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? '';
    //     const reportUrl = `${baseUrl}/report/${dbData.id}`;
    //
    //     await transporter.sendMail({
    //       from: `"Lumina Investment Intelligence" <${process.env.GMAIL_EMAIL}>`,
    //       to: user.email,
    //       subject: `[Lumina] ${ticker || companyName} 보고서 생성 완료`,
    //       html: `<p>보고서가 준비되었습니다.</p><a href="${reportUrl}">바로 보기</a>`,
    //     });
    //   }
    // } catch (mailErr) {
    //   console.error('Gmail 발송 실패(무시 가능):', mailErr);
    // }

    return NextResponse.json({ reportId: dbData.id, report: reportJson }, { headers });
  } catch (err: any) {
    console.error('🚨 generate-report failed:', err?.message ?? err);
    console.error(err?.stack ?? err);

    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? String(err),
      },
      { status: 500, headers }
    );
  }
}