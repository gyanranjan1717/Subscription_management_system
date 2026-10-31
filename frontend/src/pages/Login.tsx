import React, { useState } from 'react';
import { api, DEMO_USERS, setSession } from '../services/api.js';
import { User } from '../types.js';
import { Alert } from '../components/ui.js';
import { Layers } from 'lucide-react';

interface LoginProps {
  onLoggedIn: (user: User) => void;
}

type Mode = 'signin' | 'signup' | 'forgot';

export const Login: React.FC<LoginProps> = ({ onLoggedIn }) => {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signin') {
        const res = await api.login(email, password);
        onLoggedIn(res.user);
      } else if (mode === 'signup') {
        const res = await api.register({ email, password, full_name: fullName, company_name: company || undefined });
        setSession(res.token, res.user);
        onLoggedIn(res.user);
      } else {
        const res = await api.forgotPassword(email);
        setNotice(res.message);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const useDemo = (key: keyof typeof DEMO_USERS) => {
    setMode('signin');
    setEmail(DEMO_USERS[key].email);
    setPassword(DEMO_USERS[key].password);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-odoo-500 to-odoo-teal flex items-center justify-center">
            <Layers className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="font-bold text-lg text-slate-900">Brightloop Software</div>
            <div className="text-xs text-slate-500">Subscription & Billing Platform</div>
          </div>
        </div>

        <h1 className="text-xl font-bold text-slate-900 mb-4">
          {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create a customer account' : 'Reset your password'}
        </h1>

        {error && <div className="mb-3"><Alert kind="error">{error}</Alert></div>}
        {notice && <div className="mb-3"><Alert kind="success">{notice}</Alert></div>}

        <form onSubmit={submit} className="space-y-3 text-sm">
          {mode === 'signup' && (
            <>
              <input required value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Full name" className="w-full border border-slate-300 rounded-lg p-2.5" />
              <input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company (optional)" className="w-full border border-slate-300 rounded-lg p-2.5" />
            </>
          )}
          <input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="w-full border border-slate-300 rounded-lg p-2.5" />
          {mode !== 'forgot' && (
            <div>
              <input
                required
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full border border-slate-300 rounded-lg p-2.5"
              />
              {mode === 'signup' && (
                <p className="text-[11px] text-slate-500 mt-1">More than 8 characters, with an uppercase letter, a lowercase letter and a special character.</p>
              )}
            </div>
          )}
          <button type="submit" disabled={busy} className="w-full py-2.5 bg-odoo-500 hover:bg-odoo-600 text-white rounded-lg font-semibold disabled:opacity-50">
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
          </button>
        </form>

        <div className="flex justify-between text-xs text-odoo-500 mt-4">
          {mode !== 'signin' ? (
            <button onClick={() => { setMode('signin'); setError(null); setNotice(null); }} className="hover:underline">Back to sign in</button>
          ) : (
            <button onClick={() => { setMode('forgot'); setError(null); }} className="hover:underline">Forgot password?</button>
          )}
          {mode !== 'signup' && <button onClick={() => { setMode('signup'); setError(null); setNotice(null); }} className="hover:underline">Create account</button>}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-200">
          <div className="text-[11px] font-semibold uppercase text-slate-400 mb-2">Demo accounts (fills the form)</div>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(DEMO_USERS) as Array<keyof typeof DEMO_USERS>).map(k => (
              <button key={k} type="button" onClick={() => useDemo(k)} className="text-left text-xs border border-slate-200 rounded-lg px-2.5 py-2 hover:bg-slate-50">
                {DEMO_USERS[k].label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
