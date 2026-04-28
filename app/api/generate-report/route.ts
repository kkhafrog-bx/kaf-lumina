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

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-3-flash',
  'gemini-3.1-flash-lite',
];

function cleanJson(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function validateReportJson(json: any): boolean {
  if (!json) return false;
  if (!json.title) return false;
  if (!json.overview) return false;
  if (!json.key_insights) return false;
  if (!json.risks) return false;
  if (!json.valuation) return false;
  return true;
}

/**
 * 🔥 수정된 핵심 함수 (JSON 강제 + 자동 재요청)
 */
async function generateWithGeminiWithRetry(systemPrompt: string, prompt: string) {
  let lastError: any;

  for (const modelName of GEMINI_MODELS) {
    let currentPrompt = prompt;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { text } = await generateText({
          model: google(modelName),
          system: systemPrompt,
          prompt: currentPrompt,
        });

        const cleaned = cleanJson(text);

        // 🔥 JSON 형태 빠른 검증
        if (!cleaned.startsWith('{') || !cleaned.endsWith('}')) {
          throw new Error('Not JSON format');
        }

        const parsed = JSON.parse(cleaned);

        if (validateReportJson(parsed)) {
          return parsed;
        } else {
          throw new Error('JSON validation failed');
        }

      } catch (err: any) {
        lastError = err;

        // 🔥 실패 시 강제 재요청 프롬프트
        currentPrompt = `
Your previous response was NOT valid JSON.

You MUST return ONLY valid JSON.
NO explanation.
NO markdown.
NO text.

Fix and return correct JSON only.

Original request:
${prompt}
`;
      }
    }
  }

  throw new Error('모든 Gemini 모델 + 재시도 실패: ' + lastError?.message);
}

/**
 * 기존 PDF 생성 (유지)
 */
async function generatePdf(report: any) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/fonts/NotoSansKR-Regular.ttf`;
  const fontBytes = await fetch(fontUrl).then(res => res.arrayBuffer());
  const font = await pdfDoc.embedFont(fontBytes);

  const page = pdfDoc.addPage([595, 842]);

  page.drawText(JSON.stringify(report, null, 2), {
    x: 50,
    y: 780,
    size: 10,
    font,
    maxWidth: 500,
    lineHeight: 14,
  });

  return await pdfDoc.save();
}

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

    const reportJson = await generateWithGeminiWithRetry(
      systemPrompt,
      `Company: ${ticker || companyName}\nReturn ONLY valid JSON.`
    );

    const enriched = await insertImagesIntoReport(reportJson);

    const pdfBytes = await generatePdf(enriched);

    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(enriched, null, 2));
    zip.file('report.pdf', pdfBytes);

    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    const baseName = `${ticker}-${Date.now()}`;
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

    await supabase.from('reports').insert({
      user_id: user.id,
      ticker,
      region: market,
      pdf_path: pdfPath,
    });

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
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}