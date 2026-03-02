import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ReportCard({ report }: { report: any }) {
  return (
    <Link href={`/report/${report.id}`}>
      <Card className="glass teal-glow hover:scale-105 transition-transform cursor-pointer">
        <CardHeader>
          <CardTitle className="text-xl">{report.ticker || report.company}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-400">
            {new Date(report.created_at).toLocaleDateString('ko-KR')}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}