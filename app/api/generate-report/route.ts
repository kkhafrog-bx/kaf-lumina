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
    const body = await req.json();
    console.log('📥 API 요청 수신:', body);

    const { ticker, companyName, preferredLLM, userId } = body;

    if (!ticker) {
      return Response.json({ error: "티커가 없습니다" }, { status: 400 });
    }

    const market = ticker?.includes('.KS') || companyName?.includes('주식회사') ? 'KR' : 'US';
    const systemPrompt = market === 'US' ? US_PROMPT : KR_PROMPT;

    let model;

    // ==================== Gemini 자동 선택 ====================
    if (preferredLLM === 'gemini' || !preferredLLM) {
      const geminiPriority = [
        'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2-flash',
        'gemini-2-flash-exp', 'gemini-2-flash-lite', 'gemini-2.0',
        'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0'
      ];

      let selectedModelId = null;

      for (const modelId of geminiPriority) {
        try {
          const testModel = google(modelId);
          await generateText({ model: testModel, prompt: 'Test' });
          selectedModelId = modelId;
          console.log(`✅ Gemini 선택 성공: ${modelId}`);
          break;
        } catch (e) {
          console.log(`❌ ${modelId} 실패`);
        }
      }

      if (!selectedModelId) throw new Error('사용 가능한 Gemini 모델 없음');
      model = google(selectedModelId);
    } else {
      // Grok, Claude, GPT
      type ModelKey = 'grok' | 'gpt' | 'claude';
      const modelMap: Record<ModelKey, any> = {
        grok: require('@ai-sdk/xai').xai('grok-4.2'),
        gpt: require('@ai-sdk/openai').openai('gpt-4o'),
        claude: require('@ai-sdk/anthropic').anthropic('claude-3-5-sonnet'),
      };
      const selectedKey = (preferredLLM as ModelKey) || 'grok';
      model = modelMap[selectedKey];
    }

    // ==================== 보고서 생성 ====================
    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: `Reference Date: ${new Date().toISOString().split('T')[0]}\nCompany: ${ticker || companyName}\nOutput strictly as JSON.`,
    });

    // JSON 정리 (Gemini 코드블록 제거 강화)
    let cleanText = text.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    let reportJson;
    try {
      reportJson = JSON.parse(cleanText);
    } catch (e) {
      console.error('JSON 파싱 실패. 원본:', cleanText);
      throw new Error('모델이 올바른 JSON을 반환하지 않았습니다.');
    }

    reportJson = await insertImagesIntoReport(reportJson);

    // ZIP + DB 저장
    const zip = new JSZip();
    zip.file("report.json", JSON.stringify(reportJson, null, 2));
    const zipBlob = await zip.generateAsync({ type: "blob" });

    const supabase = createClient();
    const { data, error: dbError } = await supabase
      .from('reports')
      .insert({ user_id: userId, ticker, market, report_json: reportJson, notebook_zip: zipBlob })
      .select()
      .single();

    if (dbError) throw dbError;

    // Gmail 발송
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.GMAIL_EMAIL, pass: process.env.GMAIL_APP_PASSWORD },
      });
      const userEmail = (await supabase.auth.getUser()).data.user?.email;
      if (userEmail) {
        await transporter.sendMail({
          from: `"Lumina Investment Intelligence" <${process.env.GMAIL_EMAIL}>`,
          to: userEmail,
          subject: `[Lumina] ${ticker} 보고서 생성 완료`,
          html: `<p>보고서가 준비되었습니다.</p><a href="${process.env.NEXT_PUBLIC_BASE_URL}/report/${data.id}">바로 보기</a>`,
        });
      }
    } catch (mailErr) {
      console.error('Gmail 발송 실패:', mailErr);
    }

    return Response.json({ reportId: data.id, report: reportJson });

  } catch (err: any) {
    console.error('🚨 API 전체 오류:', err.message);
    console.error('Stack:', err.stack);
    return Response.json({ 
      error: err.message || '서버 내부 오류',
      detail: err.stack 
    }, { status: 500 });
  }
}