import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import { Alert, Button, Card, EmptyState, ErrorState, Input, Loading, PageHeader, table, useToast } from '../components/ui.js';
import { formatDate } from '../lib/format.js';

export const StaffManagement: React.FC = () => {
  const toast = useToast();
  const [staffList, setStaffList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadStaff = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setStaffList((await api.getStaff()).staff);
    } catch (err: any) {
      setLoadError('Unable to load staff. ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStaff();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const res = await api.createStaff({ email, full_name: fullName, phone: phone || undefined, password });
      toast('success', `Staff account created for ${res.staff.full_name} (${res.staff.email}).`);
      setEmail('');
      setFullName('');
      setPhone('');
      setPassword('');
      await loadStaff();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Staff" subtitle="Only an admin can add staff. Staff run billing and record payments but cannot change the catalog, discounts or staff." />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card title="Add a staff member">
          {formError && <div className="mb-3"><Alert kind="error">{formError}</Alert></div>}
          <form onSubmit={submit} className="space-y-3">
            <Input label="Full name" required value={fullName} onChange={e => setFullName(e.target.value)} />
            <Input label="Work email" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" />
            <Input label="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
            <Input label="Initial password" type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" hint="At least 9 characters with an uppercase letter, a lowercase letter and a special character." />
            <Button type="submit" variant="primary" loading={saving} className="w-full">Add staff member</Button>
          </form>
        </Card>

        <Card className="lg:col-span-2" title="Admins and staff" flush>
          {loading ? <Loading label="Loading staff…" /> : loadError ? <ErrorState message={loadError} onRetry={loadStaff} /> : staffList.length === 0 ? (
            <EmptyState title="No staff yet" />
          ) : (
            <div className={table.wrap}>
              <table className={table.table}>
                <thead className={table.head}>
                  <tr><th className={table.th}>Name</th><th className={table.th}>Email</th><th className={table.th}>Role</th><th className={table.th}>Added</th></tr>
                </thead>
                <tbody className={table.body}>
                  {staffList.map(st => (
                    <tr key={st.id} className={table.row}>
                      <td className={table.td + ' font-medium'}>{st.full_name}</td>
                      <td className={table.td + ' text-slate-600'}>{st.email}</td>
                      <td className={table.td + ' capitalize'}>{st.role}</td>
                      <td className={table.td + ' whitespace-nowrap text-slate-600'}>{formatDate(st.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
