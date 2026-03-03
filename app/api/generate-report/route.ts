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

// -------------------- Gemini 자동 선택 (캐시) --------------------
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
      // generateText 옵션은 SDK 버전에 따라 다름 -> 안전하게 최소 인자만 사용
      await generateText({ model: testModel, prompt: 'ping' });
      cachedGeminiModelId = modelId;
      console.log(`✅ Gemini 선택 성공: ${modelId}`);
      return modelId;
    } catch (e: any) {
      console.log(`❌ ${modelId} 실패: ${e?.message ?? e}`);
    }
  }

  throw new Error('사용 가능한 Gemini 모델을 찾을 수 없습니다.');
}

// -------------------- JSON 클린 --------------------
function cleanJson(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

export async function POST(req: NextRequest) {
  const { supabase, res } = createSupabaseServerClient(req);

  try {
    // ✅ 디버그: 쿠키/ENV 확인
    const cookieNames = req.cookies.getAll().map((c) => c.name);
    console.log('=== generate-report start ===');
    console.log('COOKIE NAMES:', cookieNames);
    console.log('HAS sb-* COOKIE:', cookieNames.some((n) => n.startsWith('sb-')));
    console.log('ENV CHECK:', {
      supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      baseUrl: !!process.env.NEXT_PUBLIC_BASE_URL,
    });

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

    // ✅ 서버에서 로그인 유저 검증 (B안 핵심)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.log('AUTH FAIL:', { authError: authError?.message ?? authError, user: !!user });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: res.headers });
    }

    // ✅ 시장 판별 + 시스템 프롬프트
    const market =
      ticker?.includes('.KS') || ticker?.includes('.KQ') || companyName?.includes('주식회사')
        ? 'KR'
        : 'US';

    const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;

    // -------------------- 모델 선택 --------------------
    let model: any;

    if (!preferredLLM || preferredLLM === 'gemini') {
      const modelId = await pickGeminiModelIdOnce();
      model = google(modelId);
    } else {
      // 선택 모델은 설치/환경변수 있어야 동작
      type ModelKey = 'grok' | 'gpt' | 'claude';
      const modelMap: Record<ModelKey, any> = {
        grok: require('@ai-sdk/xai').xai('grok-4.2'),
        gpt: require('@ai-sdk/openai').openai('gpt-4o'),
        claude: require('@ai-sdk/anthropic').anthropic('claude-3-5-sonnet'),
      };
      model = modelMap[preferredLLM as ModelKey];
    }

    // -------------------- 보고서 생성 --------------------
    const refDate = new Date().toISOString().slice(0, 10);
    const company = ticker || companyName;

    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: `Reference Date: ${refDate}\nCompany: ${company}\nOutput strictly as JSON.`,
    });

    const cleaned = cleanJson(text);

    let reportJson: any;
    try {
      reportJson = JSON.parse(cleaned);
    } catch {
      console.error('❌ JSON 파싱 실패 원문:', cleaned);
      throw new Error('모델이 올바른 JSON을 반환하지 않았습니다.');
    }

    reportJson = await insertImagesIntoReport(reportJson);

    // -------------------- ZIP 생성 --------------------
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    // -------------------- Storage 업로드 --------------------
    const safeName = (ticker || companyName || 'report').replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${user.id}/${safeName}-${Date.now()}.zip`;

    const { error: uploadErr } = await supabase.storage
      .from('reports')
      .upload(filePath, zipBytes, { contentType: 'application/zip', upsert: true });

    if (uploadErr) {
      console.error('UPLOAD FAIL:', uploadErr);
      throw new Error(`Storage 업로드 실패: ${uploadErr.message}`);
    }

    // -------------------- DB 저장 --------------------
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
      console.error('DB FAIL:', dbErr);
      throw new Error(`DB 저장 실패: ${dbErr.message}`);
    }

    // -------------------- Gmail 발송(선택) --------------------
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
          subject: `[Lumina] ${company} 보고서 생성 완료`,
          html: `<p>보고서가 준비되었습니다.</p><a href="${reportUrl}">바로 보기</a>`,
        });
      }
    } catch (mailErr) {
      console.error('Gmail 발송 실패(무시 가능):', mailErr);
    }

    return NextResponse.json(
      { reportId: dbData.id, report: reportJson },
      { status: 200, headers: res.headers }
    );
  } catch (err: any) {
    console.error('🚨 generate-report failed:', err?.message ?? err);
    console.error(err?.stack ?? err);

    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? String(err),
        stack: process.env.NODE_ENV === 'development' ? (err?.stack ?? null) : undefined,
      },
      { status: 500, headers: res.headers }
    );
  }
}