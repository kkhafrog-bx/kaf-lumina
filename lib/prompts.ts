export const US_PROMPT = `당신은 미국 주식시장에 특화된 전문 리서치 어시스턴트입니다. 
주어진 회사에 대해 정확하고 전문적인 투자 보고서를 JSON 형식으로 작성하세요.`;

export const KR_PROMPT = `당신은 한국 주식시장에 특화된 전문 리서치 어시스턴트입니다. 
주어진 회사에 대해 정확하고 전문적인 투자 보고서를 JSON 형식으로 작성하세요.`;

export const JSON_SCHEMA = {
  type: "object",
  properties: {
    company: { type: "string" },
    ticker: { type: "string" },
    overview: { type: "string" },
    financial_summary: { type: "object" },
    key_insights: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    valuation: { type: "object" },
    scenario_analysis: { type: "object" },
    should_i_buy: { type: "string" }
  },
  required: ["company", "ticker", "overview", "financial_summary", "key_insights", "risks", "valuation", "scenario_analysis", "should_i_buy"]
};