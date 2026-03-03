// app/api/generate-report/route.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import JSZip from 'jszip';
import nodemailer from 'nodemailer';

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
      console.log(`✅ Gemini 선택 성공: ${modelId}`);
      return modelId;
    } catch (e: any) {
      console.log(`❌ ${modelId} 실패: ${e?.message ?? e}`);
    }
  }
  throw new Error('사용 가능한 Gemini 모델을 찾을 수 없습니다.');
}

// ==================== JSON 정리/파싱 강화 ====================
function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function extractFirstJsonObject(text: string): string {
  const s = stripCodeFence(text);

  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return s;

  return s.slice(first, last + 1).trim();
}

function parseJsonHard(text: string) {
  const a = stripCodeFence(text);
  try {
    return JSON.parse(a);
  } catch {
    const b = extractFirstJsonObject(text);
    return JSON.parse(b);
  }
}

// ==================== Report JSON 강제 정규화 ====================
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

function normalizeReportJson(raw: any) {
  const r: AnyObj = isPlainObject(raw) ? { ...raw } : {};

  r.company = toSafeString(r.company).trim();
  r.ticker = toSafeString(r.ticker).trim();

  const STRING_FIELDS = [
    'overview',
    'financial_summary',
    'valuation',
    'scenario_analysis',
    'should_i_buy',
  ] as const;

  for (const f of STRING_FIELDS) {
    r[f] = toSafeString(r[f]).trim();
  }

  r.key_insights = toStringArray(r.key_insights);
  r.risks = toStringArray(r.risks);

  if (!r.company && r.ticker) r.company = r.ticker;
  if (!r.ticker && r.company) r.ticker = r.company;

  if (!r.overview && raw != null) r.overview = toSafeString(raw.overview ?? raw).trim();

  return r;
}

async function generateJsonWithRetry(args: {
  model: any;
  system: string;
  prompt: string;
}) {
  // 1차
  const first = await generateText({
    model: args.model,
    system: args.system,
    prompt: args.prompt,
  });

  try {
    return parseJsonHard(first.text);
  } catch (e1) {
    console.error('❌ JSON parse failed (1st). Raw text head:', first.text?.slice(0, 500));

    // 2차: “JSON만” 재출력 강제
    const retryPrompt =
      `${args.prompt}\n\n` +
      `IMPORTANT: Your previous output was not valid JSON.\n` +
      `Return ONLY a valid JSON object. No markdown, no commentary, no trailing text.\n` +
      `Ensure it parses with JSON.parse().`;

    const second = await generateText({
      model: args.model,
      system: args.system,
      prompt: retryPrompt,
    });

    try {
      return parseJsonHard(second.text);
    } catch (e2) {
      console.error('❌ JSON parse failed (2nd). Raw text head:', second.text?.slice(0, 500));
      throw new Error('모델이 올바른 JSON을 반환하지 않았습니다.');
    }
  }
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
      return NextResponse.json(
        { error: '티커 또는 회사명이 필요합니다.' },
        { status: 400, headers }
      );
    }

    // ✅ 로그인 유저 확인(쿠키 기반)
    const { data, error: authError } = await supabase.auth.getUser();
    const user = data?.user;

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    }

    const market =
      ticker?.includes('.KS') || ticker?.includes('.KQ') || companyName?.includes('주식회사')
        ? 'KR'
        : 'US';
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

    const referenceDate = new Date().toISOString().split('T')[0];
    const company = ticker || companyName;

    const basePrompt =
      `Reference Date: ${referenceDate}\n` +
      `Company: ${company}\n` +
      `Output strictly as JSON.\n` +
      `The JSON must include keys: company, ticker, overview, financial_summary, key_insights, risks, valuation, scenario_analysis, should_i_buy.\n` +
      `No markdown.`;

    // ✅ JSON 생성 + 파싱 재시도
    let reportJson = await generateJsonWithRetry({
      model,
      system: systemPrompt,
      prompt: basePrompt,
    });

    // ✅ 저장 전 강제 정규화(React 크래시 방지)
    reportJson = normalizeReportJson(reportJson);

    // 이미지 삽입 후 다시 정규화
    reportJson = await insertImagesIntoReport(reportJson);
    reportJson = normalizeReportJson(reportJson);

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

    // 메일 (실패해도 무시)
    try {
      if (process.env.GMAIL_EMAIL && process.env.GMAIL_APP_PASSWORD && user.email) {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.GMAIL_EMAIL,
            pass: process.env.GMAIL_APP_PASSWORD,
          },
        });

        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? '';
        const reportUrl = `${baseUrl}/report/${dbData.id}`;

        await transporter.sendMail({
          from: `"Lumina Investment Intelligence" <${process.env.GMAIL_EMAIL}>`,
          to: user.email,
          subject: `[Lumina] ${ticker || companyName} 보고서 생성 완료`,
          html: `<p>보고서가 준비되었습니다.</p><a href="${reportUrl}">바로 보기</a>`,
        });
      }
    } catch (mailErr) {
      console.error('Gmail 발송 실패(무시 가능):', mailErr);
    }

    return NextResponse.json({ reportId: dbData.id, report: reportJson }, { headers });
  } catch (err: any) {
    console.error('🚨 generate-report failed:', err?.message ?? err);
    console.error(err?.stack ?? err);

    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500, headers }
    );
  }
}