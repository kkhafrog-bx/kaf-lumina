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

// 🔥 Gemini 자동 fallback 리스트 (최신 → 하위)
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

// ================= Gemini 자동 탐색 =================
async function generateWithGemini(systemPrompt: string, prompt: string) {
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
      console.error('❌ 실패 모델:', modelName);
      lastError = err;
    }
  }

  throw new Error('모든 Gemini 모델 실패: ' + lastError?.message);
}

// ================= PDF =================
async function generatePdf(report: any) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/fonts/NotoSansKR-Regular.ttf`;
  const fontBytes = await fetch(fontUrl).then(res => res.arrayBuffer());
  const font = await pdfDoc.embedFont(fontBytes);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 50;
  const fontSize = 10;
  const lineHeight = 16;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const draw = (text: string) => {
    if (y < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }

    page.drawText(text, {
      x: margin,
      y,
      size: fontSize,
      font,
      maxWidth: pageWidth - margin * 2,
    });

    y -= lineHeight;
  };

  const lines = JSON.stringify(report, null, 2).split('\n');
  lines.forEach(draw);

  return await pdfDoc.save();
}

// ================= API =================
export async function POST(req: NextRequest) {
  const { supabase, headers } = createSupabaseServerClient(req);

  try {
    const body = await req.json();
    const { ticker, companyName, llm } = body;

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

    let rawText: string;

    // 🔥 핵심 분기
    if (llm === 'gemini') {
      rawText = await generateWithGemini(
        systemPrompt,
        `Company: ${ticker || companyName}\nReturn ONLY valid JSON.`
      );
    } else {
      // 🔥 아직 미구현 엔진
      return NextResponse.json(
        { error: `${llm} 엔진은 아직 준비되지 않았습니다.` },
        { status: 400, headers }
      );
    }

    const cleaned = cleanJson(rawText);
    const reportJson = JSON.parse(cleaned);

    const enriched = await insertImagesIntoReport(reportJson);

    const pdfBytes = await generatePdf(enriched);

    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(enriched, null, 2));
    zip.file('report.pdf', pdfBytes);

    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

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

    await supabase.from('reports').insert({
      user_id: user.id,
      ticker,
      region: market,
      pdf_path: pdfPath,
      notebook_zip_path: zipPath,
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
    console.error('🚨 generate-report failed:', err);

    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}