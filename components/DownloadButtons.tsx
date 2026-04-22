'use client';

export default function DownloadButtons({
  pdfUrl,
  zipUrl,
}: {
  pdfUrl: string;
  zipUrl: string;
}) {
  if (!pdfUrl && !zipUrl) return null;

  return (
    <div className="flex gap-3 mt-4">
      {pdfUrl && (
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-orange-500 rounded text-sm font-bold hover:bg-orange-600"
        >
          PDF 다운로드
        </a>
      )}

      {zipUrl && (
        <a
          href={zipUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-gray-700 rounded text-sm font-bold hover:bg-gray-800"
        >
          LM.ZIP 다운로드
        </a>
      )}
    </div>
  );
}