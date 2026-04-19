import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import JSZip from 'jszip';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { US_PROMPT, KR_PROMPT } from '@/lib/prompts';
import { insertImagesIntoReport } from '@/lib/imageUtils';

export const runtime = 'nodejs';

const GEMINI_PRIORITY = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
] as const;

function detectMarket(ticker?: string, companyName?: string) {
  if (ticker && /^\d{6}$/.test(ticker)) return 'KR';
  if (ticker?.endsWith('.KS') || ticker?.endsWith('.KQ')) return 'KR';
  if (companyName?.includes('전자') || companyName?.includes('주식회사')) return 'KR';
  return 'US';
}

function cleanJson(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSON 구조 없음');
  return text.slice(start, end + 1);
}

function normalizeReportJson(raw: any) {
  const r = typeof raw === 'object' && raw ? { ...raw } : {};
  r.company = String(r.company ?? '').trim();
  r.ticker = String(r.ticker ?? '').trim();
  if (!Array.isArray(r.key_insights)) r.key_insights = [];
  if (!Array.isArray(r.risks)) r.risks = [];
  return r;
}

export async function POST(req: NextRequest) {
  const { supabase, headers } = createSupabaseServerClient(req);

  try {
    const body = await req.json();
    const { ticker, companyName } = body;

    const { data } = await supabase.auth.getUser();
    const user = data?.user;

    console.log('USER:', user);
    console.log('USER ID:', user?.id);

    if (!user || !user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
    }

    const market = detectMarket(ticker, companyName);
    const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;

    let text = '';
    let lastError: any;

    for (const modelId of GEMINI_PRIORITY) {
      try {
        const result = await generateText({
          model: google(modelId),
          system: systemPrompt,
          prompt: `Company: ${ticker || companyName}\nReturn ONLY JSON`,
        });

        text = result.text;
        break;
      } catch (e: any) {
        lastError = e;
      }
    }

    if (!text) {
      throw new Error(`모델 실패: ${lastError?.message}`);
    }

    const cleaned = cleanJson(text);
    const extracted = extractJson(cleaned);
    let reportJson = JSON.parse(extracted);

    reportJson = normalizeReportJson(reportJson);
    reportJson = await insertImagesIntoReport(reportJson);

    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    const safeTicker = (ticker || companyName || 'report').replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${user.id}/${safeTicker}-${Date.now()}.zip`;

    // STORAGE
    const { error: uploadErr } = await supabase.storage
      .from('reports')
      .upload(filePath, zipBytes, { contentType: 'application/zip' });

    if (uploadErr) throw uploadErr;

    // 🔥 핵심 FIX (배열 insert)
    const { data: dbData, error: dbErr } = await supabase
      .from('reports')
      .insert([
        {
          user_id: user.id,
          ticker: ticker || null,
          region: market,
          json_path: filePath,
          status: 'completed',
        },
      ])
      .select()
      .single();

    if (dbErr) throw dbErr;

    return NextResponse.json({ reportId: dbData.id, report: reportJson }, { headers });

  } catch (err: any) {
    console.error('🚨 ERROR:', err?.message ?? err);

    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}