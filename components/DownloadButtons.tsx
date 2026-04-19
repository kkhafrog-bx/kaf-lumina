'use client';

export default function DownloadButtons({
  pdfUrl,
  zipUrl,
}: {
  pdfUrl: string;
  zipUrl: string;
}) {
  return (
    <div className="flex gap-3 mt-4">
      <a
        href={pdfUrl}
        target="_blank"
        className="px-4 py-2 bg-orange-500 rounded text-sm font-bold hover:bg-orange-600"
      >
        PDF
      </a>

      <a
        href={zipUrl}
        target="_blank"
        className="px-4 py-2 bg-gray-700 rounded text-sm font-bold hover:bg-gray-800"
      >
        LM.ZIP
      </a>
    </div>
  );
}