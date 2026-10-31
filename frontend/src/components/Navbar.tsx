import React from 'react';
import { User } from '../types.js';
import { LayoutDashboard, FileText, PlayCircle, CreditCard, Package, UserCheck, LogOut, Home } from 'lucide-react';
import { cx } from './ui.js';

interface NavbarProps {
  currentUser: User | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
}

type Tab = { id: string; label: string; icon: React.ComponentType<{ className?: string }>; roles: Array<User['role']> };

// Order follows the business flow: set up, sell, bill, collect, report.
const TABS: Tab[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'staff'] },
  { id: 'catalog', label: 'Catalog', icon: Package, roles: ['admin', 'staff'] },
  { id: 'subscriptions', label: 'Subscriptions', icon: FileText, roles: ['admin', 'staff'] },
  { id: 'billing', label: 'Billing run', icon: PlayCircle, roles: ['admin', 'staff'] },
  { id: 'portal', label: 'My account', icon: Home, roles: ['customer'] },
  { id: 'invoices', label: 'Invoices', icon: CreditCard, roles: ['admin', 'staff', 'customer'] },
  { id: 'staff', label: 'Staff', icon: UserCheck, roles: ['admin'] }
];

const ROLE_LABEL: Record<User['role'], string> = { admin: 'Admin', staff: 'Staff', customer: 'Customer' };

export const Navbar: React.FC<NavbarProps> = ({ currentUser, activeTab, setActiveTab, onLogout }) => {
  const tabs = TABS.filter(t => !currentUser || t.roles.includes(currentUser.role));

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-12 gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-6 w-6 rounded bg-brand-700 text-white text-xs font-bold flex items-center justify-center" aria-hidden="true">B</span>
            <span className="font-semibold text-slate-900 truncate">Brightloop</span>
            <span className="hidden sm:inline text-xs text-slate-500 border-l border-slate-300 pl-2">Subscription billing</span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium text-slate-900 max-w-[10rem] truncate">{currentUser?.full_name}</div>
              <div className="text-xs text-slate-500">{currentUser ? ROLE_LABEL[currentUser.role] : ''}</div>
            </div>
            <button
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" /> Sign out
            </button>
          </div>
        </div>

        {/* One navigation row at every width; it scrolls sideways instead of disappearing */}
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto -mb-px">
          {tabs.map(t => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.label}
                onClick={() => setActiveTab(t.id)}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2',
                  active ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                )}
              >
                <t.icon className="w-4 h-4" aria-hidden="true" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
