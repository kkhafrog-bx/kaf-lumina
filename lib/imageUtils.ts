export async function insertImagesIntoReport(report: any) {
  const sections = ['overview', 'financial_summary', 'key_insights', 'risks', 'valuation', 'scenario_analysis', 'should_i_buy'];

  for (const sec of sections) {
    if (report[sec]) {
      const query = `${report.company || report.ticker} ${sec.replace('_', ' ')}`;
      // 고품질 이미지 (Unsplash 스타일 대체)
      report[`${sec}_image`] = `https://picsum.photos/id/${Math.floor(Math.random() * 100) + 20}/900/500`;
    }
  }

  // 회사 로고
  report.logo = `https://logo.clearbit.com/${(report.ticker || 'verizon').toLowerCase()}.com`;

  return report;
}