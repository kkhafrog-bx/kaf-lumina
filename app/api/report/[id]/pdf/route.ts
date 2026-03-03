import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type AnyObj = Record<string, any>;

function isPlainObject(v: any): v is AnyObj {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function toSafeString(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function readPublicFile(relPath: string) {
  const abs = path.join(process.cwd(), 'public', relPath);
  return fs.readFileSync(abs);
}

function makePdfBuffer(args: {
  reportId: string;
  ticker: string;
  market: string;
  createdAtIso: string;
  reportJson: any;
}) {
  const { reportId, ticker, market, createdAtIso, reportJson } = args;

  const fontRegular = path.join(process.cwd(), 'public', 'fonts', 'NotoSansKR-Regular.ttf');
  const fontBold = path.join(process.cwd(), 'public', 'fonts', 'NotoSansKR-Bold.ttf');

  const logo = readPublicFile('brand/kafcore.png');

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
    bufferPages: true,
  });

  doc.registerFont('KR', fontRegular);
  doc.registerFont('KR-B', fontBold);

  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const marginL = doc.page.margins.left;
  const marginR = doc.page.margins.right;
  const marginT = doc.page.margins.top;
  const marginB = doc.page.margins.bottom;

  const contentW = pageW - marginL - marginR;

  const headerH = 70;
  const footerH = 42;

  const ink = '#0B1222';
  const subInk = '#42526B';
  const accent = '#14B8A6';
  const border = '#E2E8F0';

  function drawHeader() {
    doc.save();

    doc.roundedRect(marginL, 18, contentW, headerH, 14).fill('#FFFFFF');
    doc.lineWidth(1).strokeColor(border).roundedRect(marginL, 18, contentW, headerH, 14).stroke();

    doc.image(logo, marginL + 16, 30, { fit: [140, 32] });

    doc.fillColor(ink).font('KR-B').fontSize(16);
    doc.text('Investment Intelligence Report', marginL + 190, 32);

    doc.fillColor(subInk).font('KR').fontSize(10);
    doc.text(
      `Ticker: ${ticker}   •   Market: ${market}   •   ${new Date(createdAtIso).toLocaleString()}`,
      marginL + 190,
      52
    );

    doc.moveTo(marginL, 18 + headerH + 10)
      .lineTo(marginL + contentW, 18 + headerH + 10)
      .lineWidth(2)
      .strokeColor(accent)
      .stroke();

    doc.restore();
  }

  function drawFooter(pageNum: number, pageCount: number) {
    const y = pageH - marginB + 10;

    doc.moveTo(marginL, y)
      .lineTo(marginL + contentW, y)
      .lineWidth(1)
      .strokeColor(border)
      .stroke();

    doc.fillColor(subInk).font('KR').fontSize(9);
    doc.text(
      `© ${new Date().getFullYear()} KAFCORE`,
      marginL,
      y + 10,
      { width: contentW * 0.7 }
    );

    doc.text(
      `${pageNum} / ${pageCount}`,
      marginL,
      y + 10,
      { width: contentW, align: 'right' }
    );
  }

  doc.addPage();
  drawHeader();
  doc.y = 18 + headerH + 28;

  doc.fillColor(ink).font('KR-B').fontSize(22);
  doc.text(ticker, marginL, doc.y);
  doc.moveDown(0.5);

  doc.fillColor(subInk).font('KR').fontSize(11);
  doc.text(`Report ID: ${reportId}`);
  doc.moveDown(1);

  doc.fillColor(ink).font('KR').fontSize(10);
  doc.text(JSON.stringify(reportJson, null, 2), {
    width: contentW,
    lineGap: 4,
  });

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    drawFooter(i + 1, range.count);
  }

  doc.end();
  return done;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const { supabase, headers } = createSupabaseServerClient(req);

  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const { data: report, error } = await supabase
    .from('reports')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !report) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers });
  }

  const pdfBuffer = await makePdfBuffer({
    reportId: report.id,
    ticker: report.ticker ?? 'REPORT',
    market: report.market ?? '',
    createdAtIso: report.created_at,
    reportJson: report.report_json,
  });

  const resHeaders = new Headers(headers);
  resHeaders.set('Content-Type', 'application/pdf');
resHeaders.set('Content-Disposition', `attachment; filename="${(report.ticker ?? 'report')}-report.pdf"`);
return new NextResponse(new Uint8Array(pdfBuffer), { headers: resHeaders });
}