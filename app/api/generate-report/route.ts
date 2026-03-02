import type { NextRequest } from 'next/server';
import { generateText } from 'ai';
import nodemailer from 'nodemailer';
import JSZip from 'jszip';
import { createClient } from '@/lib/supabase';
import { US_PROMPT, KR_PROMPT } from '@/lib/prompts';
import { insertImagesIntoReport } from '@/lib/imageUtils';

export async function POST(req: NextRequest) {
  const { ticker, companyName, preferredLLM, userId } = await req.json();

  const market = ticker?.includes('.KS') || companyName?.includes('주식회사') ? 'KR' : 'US';
  const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;

  type ModelKey = 'grok' | 'gpt' | 'claude' | 'gemini';

  const modelMap: Record<ModelKey, any> = {
    grok: require('@ai-sdk/xai').xai('grok-4.2'),
    gpt: require('@ai-sdk/openai').openai('gpt-4o'),
    claude: require('@ai-sdk/anthropic').anthropic('claude-3-5-sonnet'),
    gemini: require('@ai-sdk/google').google('gemini-1.5-pro'),
  };

  const selectedKey: ModelKey = (preferredLLM || (market === 'US' ? 'grok' : 'claude')) as ModelKey;
  const model = modelMap[selectedKey];

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: `Reference Date: ${new Date().toISOString().split('T')[0]}\nCompany: ${ticker || companyName}\nOutput strictly as JSON.`,
  });

  let reportJson = JSON.parse(text);
  reportJson = await insertImagesIntoReport(reportJson);

  const zip = new JSZip();
  zip.file("report.json", JSON.stringify(reportJson, null, 2));
  const zipBlob = await zip.generateAsync({ type: "blob" });

  const supabase = createClient();
  const { data } = await supabase
    .from('reports')
    .insert({
      user_id: userId,
      ticker,
      market,
      report_json: reportJson,
      notebook_zip: zipBlob,
    })
    .select()
    .single();

  // Gmail 발송
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_EMAIL,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  const userEmail = (await supabase.auth.getUser()).data.user?.email;

  await transporter.sendMail({
    from: `"Lumina Investment Intelligence" <${process.env.GMAIL_EMAIL}>`,
    to: userEmail,
    subject: `[Lumina Investment Intelligence] ${ticker || companyName} 분석 보고서`,
    html: `
      <h2>Lumina Investment Intelligence</h2>
      <p>요청하신 보고서가 준비되었습니다.</p>
      <a href="${process.env.NEXT_PUBLIC_BASE_URL}/report/${data.id}" style="background:#67e8f9;color:#0f172a;padding:12px 24px;border-radius:8px;">보고서 보기</a>
    `,
  });

  return Response.json({ reportId: data.id, report: reportJson });
}