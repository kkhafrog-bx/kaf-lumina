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

const DEFAULT_MODEL = 'gemini-2.5-flash';

// ================= JSON 정리 =================
function cleanJson(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
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

  const fullText = JSON.stringify(report, null, 2).split('\n');

  for (const line of fullText) {
    drawLine(line);
  }

  return await pdfDoc.save();
}

// ================= API =================
export async function POST(req: NextRequest) {
  const { supabase, headers } = createSupabaseServerClient(req);

  try {
    const body = await req.json();
    const { ticker, companyName, engine } = body;

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

    // 🔥 핵심: engine 적용 (없으면 기본값)
    const model = google(engine || DEFAULT_MODEL);

    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: `
Company: ${ticker || companyName}

Return ONLY valid JSON.
`,
    });

    const cleaned = cleanJson(text);
    const reportJson = JSON.parse(cleaned);

    // 이미지 삽입 유지
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

    // 🔥 DB 저장 (pdf_path 반드시 포함)
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

    const { data: zipUrlData } = supabase.storage
      .from('reports')
      .getPublicUrl(zipPath);

    return NextResponse.json(
      {
        report: enriched,
        pdfUrl: pdfUrlData.publicUrl,
        zipUrl: zipUrlData.publicUrl,
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