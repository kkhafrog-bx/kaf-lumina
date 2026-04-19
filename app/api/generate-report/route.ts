import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';

export const runtime = 'nodejs';

// ================= JSON 안전 처리 =================
function extractJson(text: string) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('JSON 구조 없음');
  }
  return text.slice(start, end + 1);
}

function repairJson(text: string) {
  let fixed = text;

  fixed = fixed.replace(/```json/g, '');
  fixed = fixed.replace(/```/g, '');

  fixed = fixed.replace(/,\s*}/g, '}');
  fixed = fixed.replace(/,\s*]/g, ']');

  fixed = fixed.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');

  fixed = fixed.replace(/\n/g, ' ');

  return fixed;
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    try {
      const repaired = repairJson(text);
      return JSON.parse(repaired);
    } catch {
      return {
        company: 'UNKNOWN',
        ticker: 'UNKNOWN',
        overview: {
          company_profile: '데이터 파싱 실패',
          business_model: '',
          recent_trends: '',
        },
        key_insights: [],
        risks: [],
        should_i_buy: '데이터 오류',
        investment_score: 0,
      };
    }
  }
}

// ================= MAIN =================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ticker, companyName } = body;

    // 👉 임시 더미 (빌드 테스트용)
    const fakeAIResponse = `
    {
      "company": "Samsung Electronics",
      "ticker": "005930",
      "overview": {
        "company_profile": "삼성전자 설명",
        "business_model": "반도체, 모바일",
        "recent_trends": "AI 반도체 성장"
      },
      "key_insights": ["HBM 성장", "AI 수요 증가"],
      "risks": ["메모리 가격 변동"],
      "should_i_buy": "긍정적",
      "investment_score": 85
    }
    `;

    const extracted = extractJson(fakeAIResponse);
    const reportJson = safeJsonParse(extracted);

    // ZIP 생성
    const zip = new JSZip();
    zip.file('report.json', JSON.stringify(reportJson, null, 2));
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });

    return NextResponse.json({
      ok: true,
      report: reportJson,
      zipSize: zipBytes.length,
    });

  } catch (err: any) {
    console.error('🚨 ERROR:', err);

    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}