import React, { useState } from 'react';
import { api, setSession } from '../services/api.js';
import { User } from '../types.js';
import { Alert, Button, Input } from '../components/ui.js';

interface LoginProps {
  onLoggedIn: (user: User) => void;
}

type Mode = 'signin' | 'signup' | 'forgot';

const TITLES: Record<Mode, string> = { signin: 'Sign in', signup: 'Create a customer account', forgot: 'Reset your password' };

export const Login: React.FC<LoginProps> = ({ onLoggedIn }) => {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signin') {
        onLoggedIn((await api.login(email, password)).user);
      } else if (mode === 'signup') {
        const res = await api.register({ email, password, full_name: fullName, company_name: company || undefined });
        setSession(res.token, res.user);
        onLoggedIn(res.user);
      } else {
        setNotice((await api.forgotPassword(email)).message);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-5">
          <span className="h-7 w-7 rounded bg-brand-700 text-white text-sm font-bold flex items-center justify-center" aria-hidden="true">B</span>
          <div className="leading-tight">
            <div className="font-semibold text-slate-900">Brightloop</div>
            <div className="text-xs text-slate-500">Subscription billing</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5">
          <h1 className="text-lg font-semibold text-slate-900 mb-4">{TITLES[mode]}</h1>

          {error && <div className="mb-3"><Alert kind="error">{error}</Alert></div>}
          {notice && <div className="mb-3"><Alert kind="success">{notice}</Alert></div>}

          <form onSubmit={submit} className="space-y-3" noValidate={false}>
            {mode === 'signup' && (
              <>
                <Input label="Full name" required value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" />
                <Input label="Company" value={company} onChange={e => setCompany(e.target.value)} autoComplete="organization" />
              </>
            )}
            <Input label="Email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
            {mode !== 'forgot' && (
              <Input
                label="Password"
                type="password"
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                hint={mode === 'signup' ? 'At least 9 characters with an uppercase letter, a lowercase letter and a special character (for example !, # or $).' : undefined}
              />
            )}
            <Button type="submit" variant="primary" loading={busy} className="w-full">
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
            </Button>
          </form>

          <div className="flex justify-between text-sm mt-4">
            {mode === 'signin' ? (
              <button onClick={() => switchMode('forgot')} className="text-brand-700 hover:underline">Forgot password?</button>
            ) : (
              <button onClick={() => switchMode('signin')} className="text-brand-700 hover:underline">Back to sign in</button>
            )}
            {mode !== 'signup' && <button onClick={() => switchMode('signup')} className="text-brand-700 hover:underline">Create account</button>}
          </div>
        </div>

      </div>
    </div>
  );
};
