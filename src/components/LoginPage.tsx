'use client';
import { useAuth } from '@/context/AuthContext';
import { Shield } from 'lucide-react';

export default function LoginPage() {
  const { signInWithGoogle } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-indigo-800 to-purple-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl p-10 w-full max-w-md text-center">

        <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <Shield className="text-indigo-600" size={32} />
        </div>

        <h1 className="text-2xl font-bold text-gray-900">Mudhalvarin Mugavari</h1>
        <h2 className="text-lg font-semibold text-indigo-600 mt-1">Batch Audit Copilot</h2>

        <p className="text-gray-500 mt-4 text-sm leading-relaxed">
          AI-powered grievance response quality auditing for
          Mayiladuthurai District Collectorate.
        </p>

        <div className="mt-6 bg-indigo-50 rounded-xl p-4 text-left space-y-2 text-sm text-indigo-800">
          <p className="font-semibold text-indigo-900">What this tool does:</p>
          <p>📂 Upload CSV / Excel grievance exports</p>
          <p>🤖 AI grades every officer reply (A / C / F)</p>
          <p>📊 Charts pinpoint underperforming departments</p>
          <p>📥 Download audit report with Tamil corrections</p>
        </div>

        <button
          onClick={signInWithGoogle}
          className="mt-8 w-full flex items-center justify-center gap-3 border border-gray-300 rounded-xl py-3 px-4 hover:bg-gray-50 transition-colors font-medium text-gray-700"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>

        <p className="text-xs text-gray-400 mt-6">
          Restricted to authorised Collectorate personnel only.
        </p>
      </div>
    </div>
  );
}
