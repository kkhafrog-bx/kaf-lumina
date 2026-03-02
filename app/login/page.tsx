'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    else router.push('/dashboard');
  };

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google' });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f172a]">
      <div className="glass p-10 rounded-3xl w-full max-w-md">
        <h1 className="text-4xl font-bold mb-10 text-center text-teal-400 tracking-tight">
          Lumina Investment Intelligence
        </h1>
        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <Label htmlFor="email">이메일</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="password">비밀번호</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <Button type="submit" className="w-full bg-teal-500 hover:bg-teal-600 py-6 text-lg">로그인</Button>
        </form>
        <Button onClick={handleGoogleLogin} variant="outline" className="w-full mt-4 py-6 text-lg">Google로 로그인</Button>
      </div>
    </div>
  );
}