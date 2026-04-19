import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { US_PROMPT, KR_PROMPT } from '@/lib/prompts';
import { insertImagesIntoReport } from '@/lib/imageUtils';

export const runtime = 'nodejs';

const GEMINI_MODEL = 'gemini-2.5-flash';

// ================= JSON 정리 =================
function cleanJson(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

// ================= 투자기간 분류 =================
function classifyInvestmentHorizon(dateStr: string) {
  const now = new Date();
  const d = new Date(dateStr);

  const diffDays =
    (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);

  if (diffDays <= 7) return '단기 투자';
  if (diffDays <= 90) return '중기 투자';
  if (diffDays <= 365) return '장기 투자';
  return '사용 불가';
}

// ================= 최신성 검증 =================
function validateFreshness(report: any) {
  const refDateStr =
    report.analysis_date ||
    report.latest_source_date ||
    report.latest_primary_source_date;

  if (!refDateStr) {
    throw new Error('최신 데이터 없음');
  }

  return refDateStr;
}

// ================= PDF 생성 (한글 완전 지원) =================
async function generatePdf(report: any) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // 👉 public/fonts/NotoSansKR-Regular.ttf 위치 필요
  const fontUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/fonts/NotoSansKR-Regular.ttf`;

  const fontBytes = await fetch(fontUrl).then((res) => res.arrayBuffer());
  const customFont = await pdfDoc.embedFont(fontBytes);

  const page = pdfDoc.addPage([595, 842]);
  const { height } = page.getSize();

  const text = `
[투자 리포트]

기업: ${report.company || ''}
티커: ${report.ticker || ''}

[투자 기준]
생성일: ${report.meta?.generated_at || ''}
기준 데이터 날짜: ${report.meta?.reference_date || ''}
투자 관점: ${report.meta?.investment_horizon || ''}

${report.warning ? `⚠️ ${report.warning}` : ''}

[개요]
${typeof report.overview === 'string'
      ? report.overview
      : JSON.stringify(report.overview, null, 2)
    }
`;

  page.drawText(text, {
    x: 50,
    y: height - 50,
    size: 10,
    font: customFont,
    maxWidth: 500,
    lineHeight: 16,
  });

  return await pdfDoc.save();
}

// ================= API =================
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

    const { data } = await supabase.auth.getUser();
    const user = data?.user;

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers }
      );
    }

    const market =
      ticker?.includes('.KS') || ticker?.includes('.KQ') || /^\d{6}$/.test(ticker || '')
        ? 'KR'
        : 'US';

    const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;

    const model = google(GEMINI_MODEL);

    // ================= Gemini =================
    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: `
Reference Date: ${new Date().toISOString().split('T')[0]}

Company: ${ticker || companyName}

IMPORTANT RULES:
- Use ONLY data from the last 6 months
- Include "analysis_date" field (YYYY-MM-DD)

Return ONLY valid JSON.
`,
    });

    const cleaned = cleanJson(text);

    let reportJson: any;
    try {
      reportJson = JSON.parse(cleaned);
    } catch {
      console.error('JSON 파싱 실패:', cleaned.slice(0, 500));
      throw new Error('모델 JSON 오류');
    }

    // ================= 최신성 + 투자기간 =================
    const refDate = validateFreshness(reportJson);
    const horizon = classifyInvestmentHorizon(refDate);

    reportJson.meta = {
      generated_at: new Date().toISOString(),
      reference_date: refDate,
      investment_horizon: horizon,
    };

    if (horizon === '사용 불가') {
      reportJson.warning =
        '⚠️ 최신 데이터 기준 미달. 투자 판단용으로 부적합';
    }

    // 이미지 삽입
    reportJson = await insertImagesIntoReport(reportJson);

    // ================= PDF =================
    const pdfBytes = await generatePdf(reportJson);

    // ================= ZIP =================
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    zip.file('report.pdf', pdfBytes);

    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    // ================= Storage =================
    const safeTicker = (ticker || companyName || 'report').replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${user.id}/${safeTicker}-${Date.now()}.zip`;

    const { error: uploadErr } = await supabase.storage
      .from('reports')
      .upload(filePath, zipBytes, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadErr) throw uploadErr;

    // ================= DB =================
    const { data: dbData, error: dbErr } = await supabase
      .from('reports')
      .insert({
        user_id: user.id,
        ticker: ticker || null,
        region: market,
        report_json: reportJson,
        json_path: filePath,
        status: 'completed',
      })
      .select()
      .single();

    if (dbErr) throw dbErr;

    // ================= 다운로드 URL =================
    const { data: publicUrlData } = supabase
      .storage
      .from('reports')
      .getPublicUrl(filePath);

    return NextResponse.json(
      {
        reportId: dbData.id,
        report: reportJson,
        downloadUrl: publicUrlData.publicUrl,
      },
      { headers }
    );
  } catch (err: any) {
    console.error('🚨 generate-report failed:', err);

    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}