'use client';

import { createBrowserClient } from '@supabase/ssr';

export default function Header() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <div className="border-b border-gray-800 bg-black">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        
        <h1 className="text-xl font-bold text-orange-400">
          LUMINA INVESTMENT
        </h1>

        <button
          onClick={logout}
          className="px-4 py-2 border border-gray-600 rounded hover:bg-gray-800"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}