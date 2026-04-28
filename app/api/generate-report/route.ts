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

  throw new Error('모든 Gemini 모델 + 재시도 실패: ' + lastError?.message);
}

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

    /**
     * 🔥 안정형 + 분량 확보 + 숫자 강제 프롬프트
     */
    const reportJson = await generateWithGeminiWithRetry(
      systemPrompt,
      `
Company: ${ticker || companyName}

Return ONLY valid JSON. Do not include any explanation or error messages.

Generate a detailed equity research report.

[Length Requirements]
- Total output MUST exceed 2000 words
- Each major section MUST be at least 200 words
- Do NOT summarize

[Data Requirements]
- Every section MUST include specific numerical data (growth rates, revenue, margins, etc.)
- If exact data is unavailable, provide reasonable estimates

[Key Insights]
- At least 6 insights
- Each insight MUST be at least 80 words
- Each must include:
  metric → interpretation → implication

[Risks]
- At least 5 risks
- Each risk MUST be at least 80 words
- Include probability, impact, monitoring indicators

[Financials]
- Include at least 5 years of financial data
- Include revenue, net income, and free cash flow
- Provide explanation of trends

[Strict Rules]
- No vague expressions like:
  "strong growth", "market leader", "well known"
- Replace with actual data

[JSON Rules]
- Must be valid JSON
- No markdown
- No text outside JSON
- No empty fields
- Fully expand all fields
      `
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