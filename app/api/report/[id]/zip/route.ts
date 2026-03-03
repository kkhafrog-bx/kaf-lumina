import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const { supabase, headers } = createSupabaseServerClient(req);

  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const { data: report, error } = await supabase
    .from('reports')
    .select('ticker, notebook_zip_path')
    .eq('id', id)
    .single();

  if (error || !report?.notebook_zip_path) {
    return NextResponse.json({ error: 'ZIP not found' }, { status: 404, headers });
  }

  const { data: blob } = await supabase.storage
    .from('reports')
    .download(report.notebook_zip_path);

  if (!blob) {
    return NextResponse.json({ error: 'Download failed' }, { status: 500, headers });
  }

  const buffer = Buffer.from(await blob.arrayBuffer());

  const resHeaders = new Headers(headers);
  resHeaders.set('Content-Type', 'application/zip');
  resHeaders.set(
    'Content-Disposition',
    `attachment; filename="${report.ticker}-notebooklm.zip"`
  );

  return new NextResponse(buffer, { headers: resHeaders });
}