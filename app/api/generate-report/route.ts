// app/api/generate-report/route.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { US_PROMPT, KR_PROMPT } from '@/lib/prompts';
import { insertImagesIntoReport } from '@/lib/imageUtils';

export const runtime = 'nodejs';

// ==================== Gemini 모델 ====================
const GEMINI_MODEL = 'gemini-1.5-flash';

// ==================== JSON 정리 ====================
function cleanJson(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

// ==================== PDF 생성 ====================
async function generatePdf(report: any) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const page = pdfDoc.addPage([595, 842]);
  const { height } = page.getSize();

  const text = `
Company: ${report.company || ''}
Ticker: ${report.ticker || ''}

Overview:
${typeof report.overview === 'string'
      ? report.overview
      : JSON.stringify(report.overview, null, 2)
    }
`;

  page.drawText(text, {
    x: 50,
    y: height - 50,
    size: 10,
    font,
    maxWidth: 500,
    lineHeight: 14,
  });

  return await pdfDoc.save();
}

// ==================== API ====================
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
      ticker?.includes('.KS') || ticker?.includes('.KQ')
        ? 'KR'
        : 'US';

    const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;

    // ==================== AI 생성 ====================
    const model = google(GEMINI_MODEL);

    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: `Company: ${ticker || companyName}
Return ONLY valid JSON.`,
    });

    const cleaned = cleanJson(text);

    let reportJson: any;
    try {
      reportJson = JSON.parse(cleaned);
    } catch {
      console.error('JSON 파싱 실패:', cleaned.slice(0, 500));
      throw new Error('모델이 올바른 json을 반환하지 않았습니다');
    }

    // 이미지 삽입
    reportJson = await insertImagesIntoReport(reportJson);

    // ==================== PDF 생성 ====================
    const pdfBytes = await generatePdf(reportJson);

    // ==================== ZIP 생성 ====================
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    zip.file('report.pdf', pdfBytes);

    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    // ==================== Storage ====================
    const safeTicker = (ticker || companyName || 'report').replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${user.id}/${safeTicker}-${Date.now()}.zip`;

    const { error: uploadErr } = await supabase.storage
      .from('reports')
      .upload(filePath, zipBytes, {
        contentType: 'application/zip',
        upsert: true,
      });

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

    return NextResponse.json(
      { reportId: dbData.id, report: reportJson },
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