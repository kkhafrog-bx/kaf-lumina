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

  const fontBytes = await fetch(
    new URL('/fonts/NotoSansKR-Regular.ttf', req.url)
  ).then(res => res.arrayBuffer());

  const font = await pdfDoc.embedFont(fontBytes);

  let page = pdfDoc.addPage([595, 842]);
  const { width, height } = page.getSize();

  const margin = 50;
  const maxWidth = width - margin * 2;
  let y = height - margin;

  function newPage() {
    page = pdfDoc.addPage([595, 842]);
    y = height - margin;
  }

  function wrap(text: string, size: number) {
    const chars = text.split('');
    const lines: string[] = [];
    let cur = '';

    for (const ch of chars) {
      const test = cur + ch;
      if (font.widthOfTextAtSize(test, size) > maxWidth && cur) {
        lines.push(cur);
        cur = ch;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function draw(text: string, size = 11) {
    const lines = wrap(text, size);
    for (const line of lines) {
      if (y < margin) newPage();
      page.drawText(line, { x: margin, y, size, font });
      y -= size + 4;
    }
    y -= 6;
  }

  draw(`Investment Report`, 20);
  draw(`${report.company || ''}`, 14);
  draw(`Ticker: ${report.ticker || ''}`);

  newPage();

  draw(`[Overview]`);
  draw(JSON.stringify(report.overview ?? '', null, 2));

  draw(`[Key Insights]`);
  (report.key_insights || []).forEach((x: any) => draw(`• ${x}`));

  draw(`[Risks]`);
  (report.risks || []).forEach((x: any) => draw(`• ${x}`));

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
   // 👇 여기 추가
    console.log('USER:', user);
    console.log('USER ID:', user?.id);

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
      throw new Error(`모델 실패: ${lastError?.message}`);
    }

    const cleaned = cleanJson(text);

    let reportJson: any;
    try {
      reportJson = JSON.parse(cleaned);
    } catch {
      throw new Error('JSON 파싱 실패');
    }

    reportJson = await insertImagesIntoReport(reportJson);

    // ==================== PDF ====================
    const pdfBytes = await generatePdf(reportJson, req);

    // ==================== ZIP ====================
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    zip.file('report.pdf', pdfBytes);

    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    const filePath = `${user.id}/${Date.now()}.zip`;

    const { error: uploadErr } = await supabase.storage
      .from('reports')
      .upload(filePath, zipBytes, { upsert: true });

    if (uploadErr) {
      console.error('STORAGE ERROR:', uploadErr);
      throw new Error(uploadErr.message);
    }

    // ==================== DB INSERT (핵심 수정) ====================
    const { data: dbData, error: dbErr } = await supabase
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

    if (dbErr) {
      console.error('DB ERROR:', dbErr);
      throw new Error(dbErr.message);
    }

    if (!dbData) {
      console.error('DB DATA NULL');
      throw new Error('DB insert ok but no data returned (RLS 문제)');
    }

    return NextResponse.json(
      { reportId: dbData.id, report: reportJson },
      { headers }
    );
  } catch (err: any) {
    console.error('🚨 ERROR:', err?.message);
    return NextResponse.json(
      { error: err?.message ?? 'unknown error' },
      { status: 500 }
    );
  }
}