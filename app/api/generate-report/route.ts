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

const GEMINI_MODEL = 'gemini-2.5-flash';

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

  const fullText = JSON.stringify(report, null, 2);
  const lines = wrapText(fullText);

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

    const { data } = await supabase.auth.getUser();
    const user = data?.user;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const market =
      ticker?.includes('.KS') || /^\d{6}$/.test(ticker || '')
        ? 'KR'
        : 'US';

    const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;
    const model = google(GEMINI_MODEL);

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

    // ================= PDF =================
    const pdfBytes = await generatePdf(reportJson);

    // ================= ZIP =================
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    zip.file('report.pdf', pdfBytes);

    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    // ================= Storage =================
    const baseName = `${user.id}/${(ticker || 'report')}-${Date.now()}`;

    const zipPath = `${baseName}.zip`;
    const pdfPath = `${baseName}.pdf`;

    // ZIP 업로드
    await supabase.storage.from('reports').upload(zipPath, zipBytes, {
      contentType: 'application/zip',
      upsert: true,
    });

    // PDF 업로드 (단독 다운로드용)
    await supabase.storage.from('reports').upload(pdfPath, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    });

    // ================= URL 생성 =================
    const { data: zipUrlData } = supabase.storage
      .from('reports')
      .getPublicUrl(zipPath);

    const { data: pdfUrlData } = supabase.storage
      .from('reports')
      .getPublicUrl(pdfPath);

    return NextResponse.json(
      {
        report: reportJson,
        pdfUrl: pdfUrlData.publicUrl,
        zipUrl: zipUrlData.publicUrl,
      },
      { headers }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}