import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import JSZip from 'jszip';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { US_PROMPT, KR_PROMPT } from '@/lib/prompts';

export const runtime = 'nodejs';

// ================= JSON 안정화 =================
function extractJson(text: string) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('JSON 구조 없음');
  }
  return text.slice(start, end + 1);
}

function repairJson(text: string) {
  let fixed = text;

  fixed = fixed.replace(/```json/g, '');
  fixed = fixed.replace(/```/g, '');

  fixed = fixed.replace(/,\s*}/g, '}');
  fixed = fixed.replace(/,\s*]/g, ']');

  fixed = fixed.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');

  fixed = fixed.replace(/\n/g, ' ');

  return fixed;
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch (e) {
    console.log('❌ JSON 깨짐 → 복구 시도');

    try {
      const repaired = repairJson(text);
      return JSON.parse(repaired);
    } catch (e2) {
      console.log('❌ JSON 복구 실패 → fallback');

      return {
        company: 'UNKNOWN',
        ticker: 'UNKNOWN',
        overview: {
          company_profile: '데이터 파싱 실패',
          business_model: '',
          recent_trends: '',
        },
        key_insights: [],
        risks: [],
        should_i_buy: '데이터 오류',
        investment_score: 0,
      };
    }
  }
}

// ================= 시장 판단 =================
function detectMarket(ticker?: string, companyName?: string) {
  if (ticker && /^\d{6}$/.test(ticker)) return 'KR';
  if (ticker?.endsWith('.KS') || ticker?.endsWith('.KQ')) return 'KR';
  if (companyName?.includes('전자')) return 'KR';
  return 'US';
}

// ================= MAIN =================
export async function POST(req: NextRequest) {
  const { supabase, headers } = createSupabaseServerClient(req);

  try {
    const body = await req.json();
    const { ticker, companyName } = body;

    const { data } = await supabase.auth.getUser();
    const user = data?.user;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('USER ID:', user.id);

    const market = detectMarket(ticker, companyName);
    const systemPrompt = market === 'KR' ? KR_PROMPT : US_PROMPT;

    // ===== Gemini 호출 =====
    let text = '';
    let lastError: any;

    const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];

    for (const modelId of models) {
      try {
        console.log('🚀 모델 시도:', modelId);

        const result = await generateText({
          model: google(modelId),
          system: systemPrompt,
          prompt: `Company: ${ticker || companyName}\nReturn ONLY JSON`,
        });

        text = result.text;

        console.log('✅ 성공 모델:', modelId);
        break;

      } catch (e) {
        lastError = e;
        console.log('❌ 실패 모델:', modelId);
      }
    }

    if (!text) {
      throw new Error(`모델 실패: ${lastError?.message}`);
    }

    console.log('RAW TEXT:', text.slice(0, 500));

    // ===== JSON 처리 =====
    const extracted = extractJson(text);
    const reportJson = safeJsonParse(extracted);

    // ===== ZIP 생성 =====
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    const safeTicker = (ticker || companyName || 'report').replace(/[^a-zA-Z0-9._-]/g, '_');

    const zipPath = `${user.id}/${safeTicker}-${Date.now()}.zip`;

    // ===== Storage 업로드 =====
    const { error: zipErr } = await supabase.storage
      .from('reports')
      .upload(zipPath, zipBytes, {
        contentType: 'application/zip',
      });

    if (zipErr) throw zipErr;

    // ===== DB 저장 =====
    const { data: dbData, error: dbErr } = await supabase
      .from('reports')
      .insert([
        {
          user_id: user.id,
          ticker,
          region: market,
          report_json: reportJson,
          json_path: zipPath,
          status: 'completed',
        },
      ])
      .select()
      .single();

    if (dbErr) throw dbErr;

    const zipUrl = supabase.storage
      .from('reports')
      .getPublicUrl(zipPath).data.publicUrl;

    return NextResponse.json(
      {
        reportId: dbData.id,
        zipUrl,
      },
      { headers }
    );

  } catch (err: any) {
    console.error('🚨 ERROR:', err);

    return NextResponse.json(
      {
        ok: false,
        error: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}