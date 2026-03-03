import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';

import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import JSZip from 'jszip';
import nodemailer from 'nodemailer';

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

function cleanJson(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    // ✅ 1) Authorization 토큰 확인
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized (no token)' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!url || !anon) throw new Error('Supabase env missing');

    // ✅ 2) 토큰을 Supabase 요청에 붙여서 "유저 권한"으로 DB/Storage 접근
    const supabase = createSupabaseJsClient(url, anon, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        persistSession: false, // 서버에서는 저장할 필요 없음
        autoRefreshToken: false,
      },
    });

    // ✅ 3) 유저 확인
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    const user = userData?.user;

    if (userErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { ticker, companyName, preferredLLM } = body as {
      ticker?: string;
      companyName?: string;
      preferredLLM?: 'gemini' | 'grok' | 'gpt' | 'claude';
    };

    if (!ticker && !companyName) {
      return NextResponse.json({ error: '티커 또는 회사명이 필요합니다.' }, { status: 400 });
    }

    const market =
      ticker?.includes('.KS') || ticker?.includes('.KQ') || companyName?.includes('주식회사')
        ? 'KR'
        : 'US';

    const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;

    // ==================== 모델 선택 ====================
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
      const key = (preferredLLM as ModelKey) || 'grok';
      model = modelMap[key];
    }

    // ==================== 보고서 생성 ====================
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
      throw new Error('모델이 올바른 JSON을 반환하지 않았습니다.');
    }

    reportJson = await insertImagesIntoReport(reportJson);

    // ==================== ZIP 생성 ====================
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    const safeTicker = (ticker || companyName || 'report').replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${user.id}/${safeTicker}-${Date.now()}.zip`;

    // ==================== Storage 업로드 ====================
    const { error: uploadErr } = await supabase.storage
      .from('reports')
      .upload(filePath, zipBytes, { contentType: 'application/zip', upsert: true });

    if (uploadErr) throw uploadErr;

    // ==================== DB 저장 ====================
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

    // ==================== Gmail 발송(옵션) ====================
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

    return NextResponse.json({ reportId: dbData.id, report: reportJson });
  } catch (err: any) {
    console.error('🚨 generate-report failed:', err?.message ?? err);
    return NextResponse.json({ error: err?.message ?? '서버 내부 오류' }, { status: 500 });
  }
}