'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Redirect directly to dashboard — no login required
export default function Home() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard'); }, [router]);
  return (
    <div className="min-h-screen bg-indigo-900 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
