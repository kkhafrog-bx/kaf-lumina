import type { NextRequest } from 'next/server';
import { generateText } from 'ai';
import nodemailer from 'nodemailer';
import JSZip from 'jszip';
import { createClient } from '@/lib/supabase';
import { US_PROMPT, KR_PROMPT } from '@/lib/prompts';
import { insertImagesIntoReport } from '@/lib/imageUtils';
import { google } from '@ai-sdk/google';

export async function POST(req: NextRequest) {
  try {
    const { ticker, companyName, preferredLLM, userId } = await req.json();

    const market = ticker?.includes('.KS') || companyName?.includes('주식회사') ? 'KR' : 'US';
    const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;

    let model;

    if (preferredLLM === 'gemini' || !preferredLLM) {
      // ==================== Gemini 자동 선택 로직 ====================
      const geminiPriority = [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2-flash',
        'gemini-2-flash-exp',
        'gemini-2-flash-lite',
        'gemini-2.0',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-1.0'
      ];

      let selectedModelId = null;

      for (const modelId of geminiPriority) {
        try {
          const testModel = google(modelId);
          // 테스트 호출 (간단한 프롬프트로 실제 작동 여부 확인)
          await generateText({
            model: testModel,
            prompt: 'Hello',
          });
          selectedModelId = modelId;
          console.log(`✅ Gemini 자동 선택 성공: ${modelId}`);
          break;
        } catch (e) {
          console.log(`❌ ${modelId} 실패, 다음 모델 시도...`);
        }
      }

      if (!selectedModelId) {
        throw new Error('사용 가능한 Gemini 모델을 찾을 수 없습니다.');
      }

      model = google(selectedModelId);
    } else {
      // Grok, Claude, GPT는 기존 로직 그대로
      type ModelKey = 'grok' | 'gpt' | 'claude';
      const modelMap: Record<ModelKey, any> = {
        grok: require('@ai-sdk/xai').xai('grok-4.2'),
        gpt: require('@ai-sdk/openai').openai('gpt-4o'),
        claude: require('@ai-sdk/anthropic').anthropic('claude-3-5-sonnet'),
      };
      const selectedKey: ModelKey = (preferredLLM as ModelKey) || 'grok';
      model = modelMap[selectedKey];
    }

    // ==================== 보고서 생성 ====================
    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: `Reference Date: ${new Date().toISOString().split('T')[0]}\nCompany: ${ticker || companyName}\nOutput strictly as JSON.`,
    });

    let reportJson = JSON.parse(text);
    reportJson = await insertImagesIntoReport(reportJson);

    // ZIP + Supabase 저장 + Gmail 발송 (기존 로직 그대로)
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

    // Gmail 발송 (생략 가능)
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
        subject: `[Lumina Investment Intelligence] ${ticker || companyName} 분석 보고서`,
        html: `<p>보고서가 생성되었습니다.</p><a href="${process.env.NEXT_PUBLIC_BASE_URL}/report/${data.id}">보고서 보기</a>`,
      });
    }

    return Response.json({ reportId: data.id, report: reportJson });

  } catch (err: any) {
    console.error('API 전체 에러:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}