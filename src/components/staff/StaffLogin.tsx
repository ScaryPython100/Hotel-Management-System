import React, { useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { getClientSupabase } from "../../lib/supabaseClient";

interface StaffLoginProps {
  title: string;
}

/**
 * Staff sign-in (Supabase Auth email + password).
 * Staff accounts are created in Supabase: Authentication -> Users -> Add user.
 */
export default function StaffLogin({ title }: StaffLoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = getClientSupabase();
    if (!sb) {
      setError("The database is not configured for this site.");
      return;
    }
    setIsSigningIn(true);
    setError(null);
    const { error: signInError } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    setIsSigningIn(false);
    if (signInError) {
      setError("Incorrect email or password.");
      setPassword("");
    }
  };

  return (
    <div className="min-h-screen bg-[#F9F7F4] flex items-center justify-center p-6 font-sans text-[#2D2926]">
      <form onSubmit={handleSubmit} className="bg-white border border-[#E5E1DB] p-8 max-w-sm w-full shadow-sm space-y-4">
        <div className="text-center mb-2">
          <div className="w-12 h-12 bg-[#2D2926] text-[#A68966] flex items-center justify-center mx-auto mb-3">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-serif italic">{title}</h1>
          <p className="text-xs text-[#8C857D] mt-1 uppercase tracking-[0.15em]">Staff Sign In</p>
        </div>

        <label className="block">
          <span className="block text-[10px] uppercase tracking-[0.2em] font-bold text-[#8C857D] mb-1">Email</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-3 bg-[#F9F7F4] border border-[#E5E1DB] focus:outline-none focus:border-[#A68966] text-sm"
          />
        </label>

        <label className="block">
          <span className="block text-[10px] uppercase tracking-[0.2em] font-bold text-[#8C857D] mb-1">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-3 bg-[#F9F7F4] border border-[#E5E1DB] focus:outline-none focus:border-[#A68966] text-sm"
          />
        </label>

        {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 p-2">{error}</p>}

        <button
          type="submit"
          disabled={isSigningIn}
          className="w-full py-3.5 bg-[#2D2926] text-white text-xs uppercase tracking-[0.2em] font-medium hover:bg-black transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {isSigningIn && <Loader2 className="w-4 h-4 animate-spin" />}
          Sign In
        </button>
      </form>
    </div>
  );
}
