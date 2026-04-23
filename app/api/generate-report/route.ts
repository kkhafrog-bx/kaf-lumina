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
  'gemini-1.5-pro',
];

function cleanJson(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

async function generateWithGemini(systemPrompt: string, prompt: string) {
  let lastError: any;

  for (const modelName of GEMINI_MODELS) {
    try {
      const { text } = await generateText({
        model: google(modelName),
        system: systemPrompt,
        prompt,
      });
      return text;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error('모든 Gemini 모델 실패: ' + lastError?.message);
}

/* =========================
   🔥 여기만 수정된 부분
   ========================= */
async function generatePdf(report: any) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/fonts/NotoSansKR-Regular.ttf`;
  const fontBytes = await fetch(fontUrl).then(res => res.arrayBuffer());
  const font = await pdfDoc.embedFont(fontBytes);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 50;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawText = (text: string, size = 10) => {
    if (y < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }

    page.drawText(text, {
      x: margin,
      y,
      size,
      font,
      maxWidth: pageWidth - margin * 2,
    });

    y -= size + 6;
  };

  const sectionTitle = (title: string) => {
    drawText(`\n${title}`, 14);
  };

  const paragraph = (text: string) => {
    text.split('\n').forEach(line => drawText(line, 10));
    y -= 6;
  };

  // ===== 렌더링 =====

  drawText(report.title || 'Report', 18);

  if (report.overview) {
    sectionTitle('Overview');
    paragraph(report.overview.company_name || '');
    paragraph(report.overview.business_model || '');
    paragraph(report.overview.recent_trends || '');
  }

  if (report.financial_summary) {
    sectionTitle('Financial Summary');
    paragraph(report.financial_summary.trend_analysis || '');
  }

  if (report.key_insights) {
    sectionTitle('Key Insights');
    report.key_insights.forEach((item: any) => {
      drawText(`- ${item.insight}`, 12);
      paragraph(item.details);
    });
  }

  if (report.risks) {
    sectionTitle('Risks');
    report.risks.forEach((r: any) => {
      drawText(`- ${r.risk}`, 12);
      paragraph(r.description);
    });
  }

  if (report.valuation) {
    sectionTitle('Valuation');
    paragraph(report.valuation.pbr_per_analysis?.comment || '');
  }

  if (report.should_i_buy) {
    sectionTitle('Investment Opinion');
    drawText(`Recommendation: ${report.should_i_buy.recommendation}`, 12);
    paragraph(report.should_i_buy.reason);
  }

  return await pdfDoc.save();
}
/* ========================= */

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

    if (llm === 'gemini') {
      rawText = await generateWithGemini(
        systemPrompt,
        `Company: ${ticker || companyName}\nReturn ONLY valid JSON.`
      );
    } else {
      // 🔥 다른 엔진도 즉시 사용 가능하게 구조 유지
      const { text } = await generateText({
        model: google('gemini-2.5-flash'), // placeholder (API만 바꾸면 바로 작동 구조)
        system: systemPrompt,
        prompt: `Company: ${ticker || companyName}\nReturn ONLY valid JSON.`,
      });
      rawText = text;
    }

    const cleaned = cleanJson(rawText);
    const reportJson = JSON.parse(cleaned);

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
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}