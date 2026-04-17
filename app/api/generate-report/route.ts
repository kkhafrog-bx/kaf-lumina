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

// ==================== Gemini 모델 ====================
const GEMINI_PRIORITY = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
] as const;

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
async function generatePdf(report: any, req: NextRequest) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // 🔥 Vercel 대응 폰트 로드
  const fontBytes = await fetch(
    new URL('/fonts/NotoSansKR-Regular.ttf', req.url)
  ).then(res => res.arrayBuffer());

  const font = await pdfDoc.embedFont(fontBytes);

  let page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  const fontSize = 11;
  const lineHeight = 16;
  const margin = 50;
  const maxWidth = width - margin * 2;

  let y = height - margin;

  function wrapText(text: string) {
    const chars = text.split('');
    const lines: string[] = [];
    let current = '';

    for (const ch of chars) {
      const test = current + ch;
      const w = font.widthOfTextAtSize(test, fontSize);

      if (w > maxWidth && current !== '') {
        lines.push(current);
        current = ch;
      } else {
        current = test;
      }
    }

    if (current) lines.push(current);
    return lines;
  }

  function drawBlock(text: string) {
    const lines = wrapText(text);

    for (const line of lines) {
      if (y < margin) {
        page = pdfDoc.addPage([595, 842]);
        y = height - margin;
      }

      page.drawText(line, {
        x: margin,
        y,
        size: fontSize,
        font,
      });

      y -= lineHeight;
    }

    y -= lineHeight / 2;
  }

  const content = `
회사명: ${report.company || ''}
티커: ${report.ticker || ''}

[개요]
${formatSection(report.overview)}

[핵심 인사이트]
${formatArray(report.key_insights)}

[리스크]
${formatArray(report.risks)}
`;

  drawBlock(content);

  return await pdfDoc.save();
}

// ==================== 헬퍼 ====================
function formatSection(v: any) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v, null, 2);
}

function formatArray(arr: any) {
  if (!arr) return '';
  if (Array.isArray(arr)) {
    return arr.map((x, i) => `${i + 1}. ${x}`).join('\n');
  }
  return JSON.stringify(arr, null, 2);
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

    // ==================== 모델 fallback ====================
    let text = '';
    let lastError: any;

    for (const modelId of GEMINI_PRIORITY) {
      try {
        const model = google(modelId);

        const result = await generateText({
          model,
          system: systemPrompt,
          prompt: `Company: ${ticker || companyName}
Return ONLY valid JSON.`,
        });

        text = result.text;
        break;
      } catch (err: any) {
        lastError = err;
      }
    }

    if (!text) {
      throw new Error(`모든 Gemini 모델 실패: ${lastError?.message}`);
    }

    const cleaned = cleanJson(text);

    let reportJson: any;
    try {
      reportJson = JSON.parse(cleaned);
    } catch {
      throw new Error('모델이 올바른 json을 반환하지 않았습니다');
    }

    reportJson = await insertImagesIntoReport(reportJson);

    // ==================== PDF 생성 ====================
    const pdfBytes = await generatePdf(reportJson, req);

    // ==================== ZIP ====================
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    zip.file('report.pdf', pdfBytes);

    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    const filePath = `${user.id}/${Date.now()}.zip`;

    await supabase.storage
      .from('reports')
      .upload(filePath, zipBytes, { upsert: true });

    const { data: dbData } = await supabase
      .from('reports')
      .insert({
        user_id: user.id,
        ticker,
        market,
        report_json: reportJson,
        notebook_zip_path: filePath,
      })
      .select()
      .single();

    return NextResponse.json(
      { reportId: dbData.id, report: reportJson },
      { headers }
    );
  } catch (err: any) {
    console.error(err);

    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}