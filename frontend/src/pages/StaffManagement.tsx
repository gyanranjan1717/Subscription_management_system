import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import { UserCheck, Plus, ShieldAlert, CheckCircle2, User, Mail, Phone, Lock } from 'lucide-react';

export const StaffManagement: React.FC = () => {
  const [staffList, setStaffList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('Brightloop#2026');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStaff = async () => {
    setLoading(true);
    try {
      const res = await api.getStaff();
      setStaffList(res.staff);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStaff();
  }, []);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.createStaff({
        email,
        full_name: fullName,
        phone,
        password
      });
      setFeedback(`Staff member ${res.staff.full_name} (${res.staff.email}) created successfully!`);
      setEmail('');
      setFullName('');
      setPhone('');
      loadStaff();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Internal Staff & Team Provisioning</h1>
          <p className="text-sm text-slate-500 mt-1">
            Requirement: <strong>Only the admin can add a new member of staff.</strong> Internal staff handle day-to-day operations with limited administrative rights.
          </p>
        </div>
      </div>

      {feedback && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-950 px-4 py-3 rounded-lg text-sm flex items-center justify-between shadow-sm">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" /> {feedback}
          </span>
          <button onClick={() => setFeedback(null)} className="text-emerald-800 font-bold">×</button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-950 px-4 py-3 rounded-lg text-sm flex items-center justify-between shadow-sm">
          <span className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-red-600" /> {error}
          </span>
          <button onClick={() => setError(null)} className="text-red-800 font-bold">×</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form: Add Staff Member */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
            <Plus className="w-4 h-4 text-odoo-500" /> Provision Internal Staff
          </h3>
          <form onSubmit={handleCreateStaff} className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="e.g. Jason Myers"
                className="w-full border border-slate-300 rounded p-2 text-sm"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Company Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="e.g. jason@brightloop.com"
                className="w-full border border-slate-300 rounded p-2 text-sm"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Phone</label>
              <input
                type="text"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="e.g. +1-555-0199"
                className="w-full border border-slate-300 rounded p-2 text-sm"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Password (&gt;8 chars, Upper, Lower, Special)
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full border border-slate-300 rounded p-2 text-sm"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2 bg-odoo-500 hover:bg-odoo-600 text-white rounded font-bold text-xs shadow-sm mt-2 transition-colors"
            >
              Add Staff Member
            </button>
          </form>
        </div>

        {/* Existing Staff Roster */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h3 className="font-bold text-slate-900 text-base">Current Internal Staff Roster</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Date Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {staffList.map(st => (
                  <tr key={st.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">{st.full_name}</td>
                    <td className="px-4 py-3 text-slate-600">{st.email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded font-bold uppercase text-[11px] ${
                        st.role === 'admin' ? 'bg-purple-100 text-odoo-500' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {st.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{st.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
