import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import JSZip from 'jszip';
import { PDFDocument, rgb } from 'pdf-lib';
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

// ================= PDF 개선 버전 =================
async function generatePdf(report: any) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const fontUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/fonts/NotoSansKR-Regular.ttf`;
  const fontBytes = await fetch(fontUrl).then(res => res.arrayBuffer());
  const font = await pdfDoc.embedFont(fontBytes);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 50;

  const titleSize = 16;
  const sectionSize = 13;
  const textSize = 10;

  const lineHeight = 16;
  const maxWidth = pageWidth - margin * 2;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const newPage = () => {
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };

  const drawText = (text: string, size = textSize, bold = false) => {
    if (y < margin) newPage();

    page.drawText(text, {
      x: margin,
      y,
      size,
      font,
      maxWidth,
      color: bold ? rgb(0, 0, 0) : rgb(0.2, 0.2, 0.2),
    });

    y -= lineHeight;
  };

  const drawDivider = () => {
    if (y < margin) newPage();

    page.drawLine({
      start: { x: margin, y },
      end: { x: pageWidth - margin, y },
      thickness: 1,
      color: rgb(0.7, 0.7, 0.7),
    });

    y -= lineHeight;
  };

  const wrapText = (text: string, maxChars = 90) => {
    const words = text.split(' ');
    let lines: string[] = [];
    let current = '';

    for (const word of words) {
      if ((current + word).length > maxChars) {
        lines.push(current);
        current = word + ' ';
      } else {
        current += word + ' ';
      }
    }

    if (current) lines.push(current);
    return lines;
  };

  const drawParagraph = (text: string) => {
    const lines = wrapText(text);
    lines.forEach(line => drawText(line));
  };

  const drawSection = (title: string, content: any) => {
    drawText(``, sectionSize);
    drawText(title, sectionSize, true);
    drawDivider();

    if (!content) {
      drawText('내용 없음');
      return;
    }

    if (typeof content === 'string') {
      drawParagraph(content);
    } else if (typeof content === 'object') {
      for (const key in content) {
        drawText(`• ${key}`, textSize, true);

        const value = content[key];
        if (typeof value === 'string') {
          drawParagraph(value);
        } else {
          drawParagraph(JSON.stringify(value, null, 2));
        }
      }
    }
  };

  // ================= 실제 출력 =================

  drawText('LUMINA INVESTMENT REPORT', titleSize, true);
  drawDivider();

  drawSection('Company', report.company);
  drawSection('Summary', report.summary);
  drawSection('Business', report.business);
  drawSection('Financials', report.financials);
  drawSection('Valuation', report.valuation);
  drawSection('Risk', report.risk);
  drawSection('Conclusion', report.conclusion);

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

    if (llm === 'gemini') {
      rawText = await generateWithGemini(
        systemPrompt,
        `Company: ${ticker || companyName}\nReturn ONLY valid JSON.`
      );
    } else {
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
      json_path: zipPath,
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