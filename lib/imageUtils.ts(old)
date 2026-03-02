export async function insertImagesIntoReport(report: any) {
  const sections = ['overview', 'financial_summary', 'key_insights', 'risks', 'valuation', 'scenario_analysis'];

  for (const sec of sections) {
    if (report[sec]) {
      const query = `${report.company || report.ticker} ${sec.replace('_', ' ')} stock`;
      report[`${sec}_image`] = `https://picsum.photos/id/${Math.floor(Math.random() * 100) + 10}/800/400`;
    }
  }

  report.logo = `https://logo.clearbit.com/${(report.ticker || '').toLowerCase()}.com`;
  return report;
}