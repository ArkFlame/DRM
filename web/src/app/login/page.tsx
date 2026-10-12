'use client';
import { useState, type FormEvent } from 'react';
import { Flame, LockKeyhole, ArrowRight, ShieldCheck } from 'lucide-react';
export default function Login() {
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password}) });
      if (!r.ok) throw Error(r.status === 429 ? 'Too many attempts. Try again later.' : 'Invalid password or server configuration.');
      window.location.assign('/');
    } catch (e) { setError(e instanceof Error ? e.message : 'Login failed'); setBusy(false); }
  }
  return <main className="min-h-screen bg-grid flex items-center justify-center p-5"><div className="w-full max-w-[420px]">
    <div className="mb-9 flex items-center justify-center gap-3"><div className="h-12 w-12 rounded-2xl glass-icon flex items-center justify-center text-[#ffb6a3]"><Flame size={27} strokeWidth={2.8}/></div><div><p className="font-bold text-[22px] leading-tight tracking-tight">ARKFLAME</p><p className="text-[11px] uppercase tracking-[.22em] text-[#91a0af]">Licensing intelligence</p></div></div>
    <section className="panel p-8 shadow-2xl shadow-black/40"><div className="flex items-center justify-start text-[#afc4ff]"><LockKeyhole size={22}/></div><h1 className="text-2xl font-bold mt-6">Administrator access</h1><p className="subtle mt-2 leading-relaxed">Private access to node telemetry, licensing activity and review decisions.</p>
      <form onSubmit={submit} className="mt-7"><label className="text-xs font-semibold text-[#b3bdc9]" htmlFor="password">Admin password</label><input id="password" type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your password" className="input input-bordered w-full mt-2 bg-white/[.055] border-white/15 focus:border-[#8da9ff] rounded-xl"/>
        {error && <p role="alert" className="text-error text-xs mt-3">{error}</p>}<button disabled={busy} className="btn w-full mt-5 border border-white/15 bg-gradient-to-r from-[#879ffd] to-[#afbbff] hover:from-[#a3b5ff] hover:to-[#ccd4ff] text-[#10192e] font-bold rounded-xl">{busy?'Authenticating…':'Enter dashboard'} <ArrowRight size={17}/></button></form>
    </section><div className="flex items-center justify-center gap-2 mt-5 subtle text-xs"><ShieldCheck size={14}/> Private console · HTTPS required in production</div>
  </div></main>;
}
