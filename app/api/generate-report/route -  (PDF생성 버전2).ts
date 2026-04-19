import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import JSZip from 'jszip';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { US_PROMPT, KR_PROMPT } from '@/lib/prompts';
import { insertImagesIntoReport } from '@/lib/imageUtils';

// ✅ PDF (reportlab 대신 node 환경용 pdf-lib + 커스텀 폰트)
import { PDFDocument, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const GEMINI_PRIORITY = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
] as const;

// ================= JSON 처리 =================
function cleanJson(text: string) {
  return text.replace(/```json|```/g, '').trim();
}

function extractJson(text: string) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('JSON 구조 없음');
  return text.slice(s, e + 1);
}

// ================= 줄바꿈 처리 =================
function wrapText(text: string, maxLen = 45) {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    if ((line + word).length > maxLen) {
      lines.push(line);
      line = word + ' ';
    } else {
      line += word + ' ';
    }
  }

  if (line) lines.push(line);
  return lines;
}

// ================= PDF 생성 =================
async function createPdf(report: any) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);

  // ✅ 한글 폰트 로드
  const fontPath = path.join(process.cwd(), 'public/fonts/NotoSansKR-Regular.ttf');
  const fontBytes = fs.readFileSync(fontPath);
  const font = await pdfDoc.embedFont(fontBytes);

  let y = 800;

  function draw(text: string, size = 12) {
    page.drawText(text, {
      x: 40,
      y,
      size,
      font,
      color: rgb(0, 0, 0),
    });
    y -= size + 6;
  }

  // ===== 제목 =====
  draw('Lumina Investment Report', 20);
  draw('', 10);

  draw(`Company: ${report.company || ''}`, 12);
  draw(`Ticker: ${report.ticker || ''}`, 12);
  draw('', 10);

  // ===== 섹션 =====
  const sections = [
    ['Overview', report.overview?.company_profile],
    ['Business Model', report.overview?.business_model],
    ['Trends', report.overview?.recent_trends],
  ];

  for (const [title, content] of sections) {
    if (!content) continue;

    draw(title, 14);

    const lines = wrapText(content, 50);
    lines.forEach((l) => draw(l, 11));

    draw('', 10);
  }

  return await pdfDoc.save();
}

// ================= MAIN =================
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

    const isKR = ticker?.match(/^\d{6}$/);
    const systemPrompt = isKR ? KR_PROMPT : US_PROMPT;

    let text = '';

    for (const modelId of GEMINI_PRIORITY) {
      try {
        const result = await generateText({
          model: google(modelId),
          system: systemPrompt,
          prompt: `Company: ${ticker || companyName}\nReturn ONLY JSON`,
        });

        text = result.text;
        break;
      } catch {}
    }

    const cleaned = cleanJson(text);
    const extracted = extractJson(cleaned);
    let reportJson = JSON.parse(extracted);

    reportJson = await insertImagesIntoReport(reportJson);

    // ================= ZIP =================
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    const safeTicker = (ticker || companyName || 'report').replace(/[^a-zA-Z0-9._-]/g, '_');

    const zipPath = `${user.id}/${safeTicker}-${Date.now()}.zip`;

    await supabase.storage.from('reports').upload(zipPath, zipBytes, {
      contentType: 'application/zip',
    });

    // ================= PDF =================
    const pdfBytes = await createPdf(reportJson);

    const pdfPath = `${user.id}/${safeTicker}-${Date.now()}.pdf`;

    await supabase.storage.from('reports').upload(pdfPath, pdfBytes, {
      contentType: 'application/pdf',
    });

    // ================= DB =================
    const { data: dbData } = await supabase
      .from('reports')
      .insert([
        {
          user_id: user.id,
          ticker: ticker || null,
          region: isKR ? 'KR' : 'US',
          json_path: zipPath,
          pdf_path: pdfPath,
          status: 'completed',
        },
      ])
      .select()
      .single();

    // ================= 다운로드 링크 생성 =================
    const { data: pdfUrl } = supabase.storage
      .from('reports')
      .getPublicUrl(pdfPath);

    const { data: zipUrl } = supabase.storage
      .from('reports')
      .getPublicUrl(zipPath);

    return NextResponse.json(
      {
        reportId: dbData.id,
        pdfUrl: pdfUrl.publicUrl,
        zipUrl: zipUrl.publicUrl,
      },
      { headers }
    );

  } catch (err: any) {
    console.error('🚨 ERROR:', err);

    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}