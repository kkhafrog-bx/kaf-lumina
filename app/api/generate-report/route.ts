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

async function generateWithGeminiWithRetry(systemPrompt: string, prompt: string) {
  let lastError: any;

  for (const modelName of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { text } = await generateText({
          model: google(modelName),
          system: systemPrompt,
          prompt,
        });

        const cleaned = cleanJson(text);
        const parsed = JSON.parse(cleaned);

        if (validateReportJson(parsed)) {
          return parsed;
        } else {
          throw new Error('JSON validation failed');
        }

      } catch (err) {
        lastError = err;
      }
    }
  }

  throw new Error('모든 Gemini 모델 실패: ' + lastError?.message);
}

/**
 * 🔥 NEW: JSON → 읽을 수 있는 보고서 텍스트
 */
function formatReport(report: any): string {
  const lines: string[] = [];

  const safe = (v: any) =>
    v === null || v === undefined ? '' : String(v);

  const section = (title: string) => {
    lines.push('');
    lines.push(`==============================`);
    lines.push(title);
    lines.push(`==============================`);
  };

  const add = (label: string, value: any) => {
    if (!value) return;
    lines.push(`${label}: ${safe(value)}`);
  };

  const addParagraph = (text: any) => {
    if (!text) return;
    lines.push(safe(text));
    lines.push('');
  };

  const addList = (arr: any[], mapper: (item: any, i: number) => string) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((item, i) => {
      lines.push(`${i + 1}. ${mapper(item, i)}`);
    });
    lines.push('');
  };

  if (report.title) {
    lines.push(report.title);
  }

  if (report.overview) {
    section('Overview');
    add('Company', report.overview.company_description);
    add('Business Model', report.overview.business_model);
    add('Recent Trends', report.overview.recent_trends);
    add('Competitive Position', report.overview.competitive_position);
  }

  if (Array.isArray(report.key_insights)) {
    section('Key Insights');
    report.key_insights.forEach((ins: any, i: number) => {
      lines.push(`${i + 1}. ${safe(ins.insight)}`);
      addParagraph(ins.details);
    });
  }

  if (Array.isArray(report.risks)) {
    section('Risks');
    report.risks.forEach((r: any, i: number) => {
      lines.push(`${i + 1}. ${safe(r.risk)}`);
      add('Impact', r.impact);
      add('Probability', r.probability);
      add('Mitigation', r.mitigation);
      lines.push('');
    });
  }

  if (report.valuation) {
    section('Valuation');
    add('DCF Price', report.valuation.dcf_derived_price);
    add('WACC', report.valuation.wacc);
    addParagraph(report.valuation.notes);
  }

  if (report.outlook) {
    section('Outlook');
    addParagraph(report.outlook);
  }

  if (report.rationale) {
    section('Investment Thesis');
    addParagraph(report.rationale);
  }

  return lines.join('\n');
}

/**
 * 🔥 NEW: 진짜 리포트 스타일 PDF
 */
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

  const maxWidth = pageWidth - margin * 2;
  const lineHeight = 14;

  const drawLine = (text: string, size = 10) => {
    const words = text.split(' ');
    let line = '';

    for (const word of words) {
      const test = line + word + ' ';
      const width = font.widthOfTextAtSize(test, size);

      if (width > maxWidth) {
        if (y < margin) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }

        page.drawText(line, { x: margin, y, size, font });
        y -= lineHeight;
        line = word + ' ';
      } else {
        line = test;
      }
    }

    if (line) {
      if (y < margin) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }

      page.drawText(line, { x: margin, y, size, font });
      y -= lineHeight;
    }
  };

  const text = formatReport(report);
  const lines = text.split('\n');

  if (report.title) {
    page.drawText(report.title, {
      x: margin,
      y,
      size: 18,
      font,
    });
    y -= 25;
  }

  for (const line of lines) {
    if (!line.trim()) {
      y -= lineHeight / 2;
      continue;
    }

    if (line.includes('====')) continue;

    if (
      line.includes('Overview') ||
      line.includes('Insights') ||
      line.includes('Risks') ||
      line.includes('Valuation') ||
      line.includes('Outlook')
    ) {
      y -= 10;
      page.drawText(line, {
        x: margin,
        y,
        size: 14,
        font,
      });
      y -= lineHeight;
      continue;
    }

    drawLine(line);
  }

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