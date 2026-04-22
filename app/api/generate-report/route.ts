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

// 🔥 Gemini fallback 순서 (최신 → 구버전)
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-1.5-pro',
  'gemini-1.5-flash'
];

// ================= JSON 정리 =================
function cleanJson(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

// ================= Gemini 자동 fallback =================
async function generateWithGeminiFallback(systemPrompt: string, prompt: string) {
  let lastError: any;

  for (const modelName of GEMINI_MODELS) {
    try {
      console.log('🚀 시도 모델:', modelName);

      const { text } = await generateText({
        model: google(modelName),
        system: systemPrompt,
        prompt,
      });

      console.log('✅ 성공 모델:', modelName);
      return text;

    } catch (err) {
      console.error('❌ 실패 모델:', modelName, err);
      lastError = err;
    }
  }

  throw new Error('모든 Gemini 모델 실패: ' + lastError?.message);
}

// ================= PDF 생성 =================
async function generatePdf(report: any) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/fonts/NotoSansKR-Regular.ttf`;
  const fontBytes = await fetch(fontUrl).then((res) => res.arrayBuffer());
  const font = await pdfDoc.embedFont(fontBytes);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 50;
  const fontSize = 10;
  const lineHeight = 16;
  const maxWidth = pageWidth - margin * 2;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawLine = (text: string) => {
    if (y < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }

    page.drawText(text, {
      x: margin,
      y,
      size: fontSize,
      font,
      maxWidth,
    });

    y -= lineHeight;
  };

  const lines = JSON.stringify(report, null, 2).split('\n');

  for (const line of lines) {
    drawLine(line);
  }

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
      ticker?.includes('.KS') || /^\d{6}$/.test(ticker || '')
        ? 'KR'
        : 'US';

    const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;

    // 🔥 Gemini fallback 실행
    const rawText = await generateWithGeminiFallback(
      systemPrompt,
      `
Company: ${ticker || companyName}

Return ONLY valid JSON.
`
    );

    const cleaned = cleanJson(rawText);
    const reportJson = JSON.parse(cleaned);

    const enriched = await insertImagesIntoReport(reportJson);

    // ================= PDF =================
    const pdfBytes = await generatePdf(enriched);

    // ================= ZIP =================
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(enriched, null, 2));
    zip.file('report.pdf', pdfBytes);

    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    // ================= Storage =================
    const baseName = `${user.id}/${(ticker || 'report')}-${Date.now()}`;

    const zipPath = `${baseName}.zip`;
    const pdfPath = `${baseName}.pdf`;

    await supabase.storage.from('reports').upload(zipPath, zipBytes, {
      contentType: 'application/zip',
      upsert: true,
    });

    await supabase.storage.from('reports').upload(pdfPath, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    });

    // ================= DB =================
    await supabase.from('reports').insert({
      user_id: user.id,
      ticker,
      region: market,
      pdf_path: pdfPath,
      notebook_zip_path: zipPath,
    });

    // ================= URL =================
    const { data: pdfUrlData } = supabase.storage
      .from('reports')
      .getPublicUrl(pdfPath);

    return NextResponse.json(
      {
        report: enriched,
        pdfUrl: pdfUrlData.publicUrl,
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