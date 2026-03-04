import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // pdfkit 내부 폰트 메트릭 파일 포함 (필요한 경우)
  outputFileTracingIncludes: {
    '*': ['node_modules/pdfkit/js/data/*.afm'],
  },
};

export default nextConfig;