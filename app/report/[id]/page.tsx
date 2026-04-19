import { createClient } from '@supabase/supabase-js';
import ReportDetail from '@/components/ReportDetail';

export default async function ReportPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data } = await supabase
    .from('reports')
    .select('*')
    .eq('id', params.id)
    .single();

  if (!data) {
    return <div className="text-white p-10">Report not found</div>;
  }

  return <ReportDetail report={data} />;
}