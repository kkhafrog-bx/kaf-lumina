'use client';

export default function DownloadButtons({
  pdfUrl,
  zipUrl,
}: {
  pdfUrl: string;
  zipUrl: string;
}) {
  const download = (url: string, name: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  };

  return (
    <div className="flex gap-4 mt-6 justify-center">
      <button
        onClick={() => download(pdfUrl, 'report.pdf')}
        className="px-6 py-3 bg-teal-500 rounded-xl text-white font-bold hover:bg-teal-600"
      >
        PDF 다운로드
      </button>

      <button
        onClick={() => download(zipUrl, 'report.zip')}
        className="px-6 py-3 bg-slate-700 rounded-xl text-white font-bold hover:bg-slate-800"
      >
        LM ZIP 다운로드
      </button>
    </div>
  );
}