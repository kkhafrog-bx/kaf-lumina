import type { NextRequest } from 'next/server';
import { generateText } from 'ai';
import nodemailer from 'nodemailer';
import JSZip from 'jszip';
import { createClient } from '@/lib/supabase';
import { US_PROMPT, KR_PROMPT } from '@/lib/prompts';
import { insertImagesIntoReport } from '@/lib/imageUtils';

export async function POST(req: NextRequest) {
  try {
    const { ticker, companyName, preferredLLM, userId } = await req.json();

    console.log('API 호출됨:', { ticker, companyName, preferredLLM, userId });

    if (!ticker) {
      return Response.json({ error: "티커가 없습니다" }, { status: 400 });
    }

    const market = ticker.includes('.KS') || companyName?.includes('주식회사') ? 'KR' : 'US';
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
    const { data, error: dbError } = await supabase
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

    if (dbError) {
      console.error('Supabase 저장 실패:', dbError);
      return Response.json({ error: dbError.message }, { status: 500 });
    }

    // Gmail 발송 (실패해도 보고서는 생성됨)
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_EMAIL,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      });

      const userEmail = (await supabase.auth.getUser()).data.user?.email;
      if (userEmail) {
        await transporter.sendMail({
          from: `"Lumina Investment Intelligence" <${process.env.GMAIL_EMAIL}>`,
          to: userEmail,
          subject: `[Lumina Investment Intelligence] ${ticker} 분석 보고서`,
          html: `<p>보고서가 생성되었습니다.</p><a href="${process.env.NEXT_PUBLIC_BASE_URL}/report/${data.id}">보고서 보기</a>`,
        });
      }
    } catch (mailErr) {
      console.error('Gmail 발송 실패 (보고서는 생성됨):', mailErr);
    }

    return Response.json({ reportId: data.id, report: reportJson });

  } catch (err: any) {
    console.error('API 전체 에러:', err);
    return Response.json({ 
      error: err.message || '알 수 없는 오류',
      stack: err.stack 
    }, { status: 500 });
  }
}