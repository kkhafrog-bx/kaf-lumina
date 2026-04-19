export default function ScoreBadge({ score }: { score: number }) {
  const color =
    score > 75 ? 'bg-green-500' :
    score > 50 ? 'bg-yellow-500' :
    'bg-red-500';

  return (
    <div className={`px-4 py-2 rounded-xl font-bold ${color}`}>
      {score} / 100
    </div>
  );
}