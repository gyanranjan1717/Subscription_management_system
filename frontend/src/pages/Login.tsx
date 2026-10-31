import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import { User } from '../types.js';
import { Alert, Button } from '../components/ui.js';
import {
  Mail, Lock, User as UserIcon, Building2, KeyRound,
  ShieldCheck, Eye, EyeOff,
  ArrowRight, ArrowLeft, Sparkles, Check, RefreshCw, Key
} from 'lucide-react';

interface LoginProps {
  onLoggedIn: (user: User) => void;
}

type Mode = 'signin' | 'signup' | 'forgot' | 'reset';

export const Login: React.FC<LoginProps> = ({ onLoggedIn }) => {
  const [mode, setMode] = useState<Mode>('signin');

  // Sign In fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Sign Up fields
  const [fullName, setFullName] = useState('');
  const [company, setCompany] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isAdminSignup, setIsAdminSignup] = useState(false);
  const [adminKey, setAdminKey] = useState('');

  // OTP Verification state
  const [signupStep, setSignupStep] = useState<'form' | 'otp'>('form');
  const [otpCode, setOtpCode] = useState('');
  const [otpPreview, setOtpPreview] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Password Reset state
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // Status
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Check URL token for password reset
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenInUrl = params.get('token');
    if (tokenInUrl) {
      setResetToken(tokenInUrl);
      setMode('reset');
    }
  }, []);

  // Password Policy Checks (Requirement R02: > 8 chars, 1 upper, 1 lower, 1 special)
  const activePasswordToCheck = mode === 'reset' ? newPassword : password;
  const hasMinLength = activePasswordToCheck.length > 8;
  const hasUppercase = /[A-Z]/.test(activePasswordToCheck);
  const hasLowercase = /[a-z]/.test(activePasswordToCheck);
  const hasSpecial = /[^a-zA-Z0-9]/.test(activePasswordToCheck);
  const isPasswordValid = hasMinLength && hasUppercase && hasLowercase && hasSpecial;
  const passwordsMatch = mode === 'reset'
    ? (newPassword.length > 0 && newPassword === confirmNewPassword)
    : (password.length > 0 && password === confirmPassword);

  // Countdown timer for resend OTP
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setSignupStep('form');
    setOtpCode('');
    setOtpPreview(null);
  };

  // Step 1: Send OTP to verify email
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!isPasswordValid) {
      setError('Please satisfy all password complexity requirements.');
      return;
    }
    if (!passwordsMatch) {
      setError('Passwords do not match.');
      return;
    }
    if (isAdminSignup && !adminKey.trim()) {
      setError('Admin Secret Key is required to register as Administrator.');
      return;
    }

    setBusy(true);
    try {
      const res = await api.sendOtp(email.trim().toLowerCase());
      setOtpPreview(res.otpPreview || null);
      setSignupStep('otp');
      setResendCooldown(60);
      setNotice(`Verification code sent to ${email.trim()}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Step 2: Verify OTP and Complete Registration
  const handleVerifyAndRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim() || otpCode.trim().length !== 6) {
      setError('Please enter a valid 6-digit verification code.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await api.register({
        email: email.trim().toLowerCase(),
        password,
        full_name: fullName.trim(),
        company_name: company.trim() || undefined,
        otp: otpCode.trim(),
        admin_key: isAdminSignup ? adminKey.trim() : undefined
      });
      onLoggedIn(res.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Sign In submit
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.login(email.trim().toLowerCase(), password);
      onLoggedIn(res.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Forgot password submit
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.forgotPassword(email.trim().toLowerCase());
      setNotice(res.message);
      if (res.resetToken) {
        setResetToken(res.resetToken);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Complete Password Reset
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetToken.trim()) {
      setError('A valid reset token is required.');
      return;
    }
    if (!isPasswordValid) {
      setError('New password must satisfy complexity requirements.');
      return;
    }
    if (!passwordsMatch) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await api.resetPassword(resetToken.trim(), newPassword);
      setNotice(res.message || 'Password has been reset successfully. Please sign in with your new password.');
      setMode('signin');
      setPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-brand-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-brand-600 text-white font-bold text-xl shadow-lg shadow-brand-500/30 mb-3">
            B
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Brightloop</h1>
          <p className="text-xs text-slate-400 mt-1">Enterprise Subscription Billing & Management Platform</p>
        </div>

        {/* Authentication Card */}
        <div className="bg-white rounded-xl shadow-2xl border border-slate-100 overflow-hidden">

          {/* Navigation Tabs */}
          <div className="flex border-b border-slate-200 bg-slate-50">
            <button
              type="button"
              onClick={() => switchMode('signin')}
              className={`flex-1 py-3 text-xs font-semibold text-center border-b-2 transition-colors ${
                mode === 'signin'
                  ? 'border-brand-600 text-brand-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className={`flex-1 py-3 text-xs font-semibold text-center border-b-2 transition-colors ${
                mode === 'signup'
                  ? 'border-brand-600 text-brand-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Create Account
            </button>
            <button
              type="button"
              onClick={() => switchMode('forgot')}
              className={`flex-1 py-3 text-xs font-semibold text-center border-b-2 transition-colors ${
                mode === 'forgot' || mode === 'reset'
                  ? 'border-brand-600 text-brand-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Reset
            </button>
          </div>

          <div className="p-6">
            {error && (
              <div className="mb-4">
                <Alert kind="error">{error}</Alert>
              </div>
            )}
            {notice && (
              <div className="mb-4">
                <Alert kind="success">{notice}</Alert>
              </div>
            )}

            {/* ========================================================================= */}
            {/* SIGN IN FORM                                                              */}
            {/* ========================================================================= */}
            {mode === 'signin' && (
              <form onSubmit={handleSignIn} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email address</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-medium text-slate-700">Password</label>
                    <button
                      type="button"
                      onClick={() => switchMode('forgot')}
                      className="text-xs text-brand-600 hover:text-brand-800 font-medium"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      placeholder="••••••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full pl-9 pr-10 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <Button type="submit" variant="primary" loading={busy} className="w-full py-2.5 justify-center">
                  Sign In to Workspace
                </Button>
              </form>
            )}

            {/* ========================================================================= */}
            {/* SIGN UP FORM (STEP 1: DETAILS)                                            */}
            {/* ========================================================================= */}
            {mode === 'signup' && signupStep === 'form' && (
              <form onSubmit={handleSendOtp} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Full name</label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      required
                      placeholder="Alex Morgan"
                      value={fullName}
                      onChange={e => setFullName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Company name (optional)</label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Acme Corporation"
                      value={company}
                      onChange={e => setCompany(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Work email</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="email"
                      required
                      placeholder="alex@example.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                    />
                  </div>
                </div>

                {/* Password field */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="At least 9 characters"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full pl-9 pr-10 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Password requirements live meter */}
                  <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-md text-[11px] space-y-1">
                    <span className="font-semibold text-slate-600 block mb-1">Password requirements:</span>
                    <div className="grid grid-cols-2 gap-1">
                      <div className={`flex items-center gap-1 ${hasMinLength ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                        {hasMinLength ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-slate-300 inline-block" />}
                        More than 8 chars
                      </div>
                      <div className={`flex items-center gap-1 ${hasUppercase ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                        {hasUppercase ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-slate-300 inline-block" />}
                        1 Uppercase (A-Z)
                      </div>
                      <div className={`flex items-center gap-1 ${hasLowercase ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                        {hasLowercase ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-slate-300 inline-block" />}
                        1 Lowercase (a-z)
                      </div>
                      <div className={`flex items-center gap-1 ${hasSpecial ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                        {hasSpecial ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-slate-300 inline-block" />}
                        1 Special (!@#$)
                      </div>
                    </div>
                  </div>
                </div>

                {/* Confirm password */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Confirm password</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      placeholder="Re-enter password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className={`w-full pl-9 pr-10 py-2 text-sm border rounded-md focus:ring-2 outline-none font-mono ${
                        confirmPassword.length > 0 && !passwordsMatch
                          ? 'border-red-300 focus:ring-red-500'
                          : 'border-slate-300 focus:ring-brand-500'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {confirmPassword.length > 0 && !passwordsMatch && (
                    <p className="text-[11px] text-red-600 mt-1">Passwords do not match.</p>
                  )}
                </div>

                {/* Admin Master Key toggle */}
                <div className="pt-2 border-t border-slate-100">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={isAdminSignup}
                      onChange={e => setIsAdminSignup(e.target.checked)}
                      className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="font-medium flex items-center gap-1">
                      <KeyRound className="w-3.5 h-3.5 text-amber-600" /> Register as an Administrator
                    </span>
                  </label>

                  {isAdminSignup && (
                    <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-md">
                      <label className="block text-[11px] font-semibold text-amber-900 mb-1">
                        Admin Secret Key (Required)
                      </label>
                      <input
                        type="password"
                        placeholder="Enter master admin key"
                        value={adminKey}
                        onChange={e => setAdminKey(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-amber-300 rounded bg-white font-mono focus:ring-2 focus:ring-amber-500 outline-none"
                      />
                      <p className="text-[10px] text-amber-700 mt-1">
                        Ask your system owner for the key (set as ADMIN_REGISTRATION_KEY on the server).
                      </p>
                    </div>
                  )}
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  className="w-full py-2.5 justify-center flex items-center gap-1.5"
                >
                  Continue to Email Verification <ArrowRight className="w-4 h-4" />
                </Button>
              </form>
            )}

            {/* ========================================================================= */}
            {/* SIGN UP FORM (STEP 2: OTP VERIFICATION)                                   */}
            {/* ========================================================================= */}
            {mode === 'signup' && signupStep === 'otp' && (
              <form onSubmit={handleVerifyAndRegister} className="space-y-4">
                <div className="text-center">
                  <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-brand-50 text-brand-600 mb-2">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">Verify your email</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    We've sent a 6-digit confirmation code to:
                    <br />
                    <strong className="text-slate-800">{email}</strong>
                  </p>
                </div>

                {/* Demo / Evaluator auto-fill pill */}
                {otpPreview && (
                  <div className="p-3 bg-brand-50 border border-brand-200 rounded-lg text-xs text-brand-900">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-brand-600" />
                        Demo mode (no email service connected):
                      </span>
                      <button
                        type="button"
                        onClick={() => setOtpCode(otpPreview)}
                        className="text-[11px] bg-brand-600 text-white px-2 py-0.5 rounded hover:bg-brand-700 font-medium"
                      >
                        Auto-fill {otpPreview}
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1 text-center">
                    Enter 6-Digit Code
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    autoFocus
                    placeholder="123456"
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full py-2 text-center text-2xl font-mono tracking-[0.5em] border-2 border-slate-300 rounded-lg focus:border-brand-600 focus:ring-0 outline-none"
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500">
                  <button
                    type="button"
                    onClick={() => setSignupStep('form')}
                    className="flex items-center gap-1 hover:text-slate-700 text-xs"
                  >
                    <ArrowLeft className="w-3 h-3" /> Edit details
                  </button>

                  <button
                    type="button"
                    disabled={resendCooldown > 0 || busy}
                    onClick={handleSendOtp}
                    className="text-brand-600 hover:text-brand-800 disabled:text-slate-400 font-medium flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                  </button>
                </div>

                <Button type="submit" variant="primary" loading={busy} className="w-full py-2.5 justify-center">
                  Verify & Create {isAdminSignup ? 'Admin' : 'Customer'} Account
                </Button>
              </form>
            )}

            {/* ========================================================================= */}
            {/* FORGOT PASSWORD FORM                                                      */}
            {/* ========================================================================= */}
            {mode === 'forgot' && (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="text-center mb-2">
                  <p className="text-xs text-slate-500">
                    Enter your registered email and we'll dispatch a single-use password reset link.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Registered email</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="email"
                      required
                      placeholder="name@company.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                    />
                  </div>
                </div>

                <Button type="submit" variant="primary" loading={busy} className="w-full py-2.5 justify-center">
                  Send Password Reset Link
                </Button>

                {resetToken && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 mt-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold flex items-center gap-1">
                        <Key className="w-3.5 h-3.5 text-amber-600" />
                        Reset token generated!
                      </span>
                      <button
                        type="button"
                        onClick={() => setMode('reset')}
                        className="text-[11px] bg-amber-600 text-white px-2 py-0.5 rounded hover:bg-amber-700 font-medium"
                      >
                        Set new password now &rarr;
                      </button>
                    </div>
                  </div>
                )}

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => switchMode('signin')}
                    className="text-xs text-brand-600 hover:text-brand-800 font-medium"
                  >
                    Back to Sign In
                  </button>
                </div>
              </form>
            )}

            {/* ========================================================================= */}
            {/* RESET PASSWORD FORM (WITH TOKEN)                                          */}
            {/* ========================================================================= */}
            {mode === 'reset' && (
              <form onSubmit={handleResetPassword} className="space-y-3.5">
                <div className="text-center mb-1">
                  <h3 className="text-sm font-bold text-slate-900">Choose a new password</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Please choose a strong password satisfying all criteria.</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Reset token</label>
                  <div className="relative">
                    <Key className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      required
                      placeholder="Paste reset token"
                      value={resetToken}
                      onChange={e => setResetToken(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">New password</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="At least 9 characters"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="w-full pl-9 pr-10 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Requirements meter */}
                  <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-md text-[11px] space-y-1">
                    <span className="font-semibold text-slate-600 block mb-1">Password requirements:</span>
                    <div className="grid grid-cols-2 gap-1">
                      <div className={`flex items-center gap-1 ${hasMinLength ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                        {hasMinLength ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-slate-300 inline-block" />}
                        More than 8 chars
                      </div>
                      <div className={`flex items-center gap-1 ${hasUppercase ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                        {hasUppercase ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-slate-300 inline-block" />}
                        1 Uppercase (A-Z)
                      </div>
                      <div className={`flex items-center gap-1 ${hasLowercase ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                        {hasLowercase ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-slate-300 inline-block" />}
                        1 Lowercase (a-z)
                      </div>
                      <div className={`flex items-center gap-1 ${hasSpecial ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                        {hasSpecial ? <Check className="w-3 h-3" /> : <span className="w-3 h-3 rounded-full border border-slate-300 inline-block" />}
                        1 Special (!@#$)
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Confirm new password</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      placeholder="Re-enter new password"
                      value={confirmNewPassword}
                      onChange={e => setConfirmNewPassword(e.target.value)}
                      className={`w-full pl-9 pr-10 py-2 text-sm border rounded-md focus:ring-2 outline-none font-mono ${
                        confirmNewPassword.length > 0 && !passwordsMatch
                          ? 'border-red-300 focus:ring-red-500'
                          : 'border-slate-300 focus:ring-brand-500'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {confirmNewPassword.length > 0 && !passwordsMatch && (
                    <p className="text-[11px] text-red-600 mt-1">Passwords do not match.</p>
                  )}
                </div>

                <Button type="submit" variant="primary" loading={busy} className="w-full py-2.5 justify-center">
                  Update Password & Sign In
                </Button>

                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => switchMode('signin')}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

          </div>

          {/* Footer note */}
          <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span>Production RBAC System</span>
            <span>Role-Isolated Sessions</span>
          </div>

        </div>

      </div>
    </div>
  );
};
