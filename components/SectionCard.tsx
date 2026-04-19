export default function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-orange-400 mb-4">
        {title}
      </h2>
      <div className="text-gray-200 leading-relaxed">{children}</div>
    </div>
  );
}