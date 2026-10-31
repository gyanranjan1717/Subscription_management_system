import React, { useState } from 'react';
import { User } from '../types.js';
import { DEMO_USERS } from '../services/api.js';
import {
  Layers, LayoutDashboard, FileText, PlayCircle, CreditCard,
  Package, ShieldCheck, UserCheck, RefreshCw, LogOut, CheckCircle
} from 'lucide-react';

interface NavbarProps {
  currentUser: User | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onSwitchPersona: (personaKey: keyof typeof DEMO_USERS) => void;
  onRefresh: () => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  activeTab,
  setActiveTab,
  onSwitchPersona,
  onRefresh,
  onLogout
}) => {
  const [switching, setSwitching] = useState(false);

  const handlePersonaClick = async (key: keyof typeof DEMO_USERS) => {
    setSwitching(true);
    await onSwitchPersona(key);
    setSwitching(false);
  };

  type Tab = { id: string; label: string; icon: React.ComponentType<{ className?: string }>; roles: Array<User['role']> };
  const TABS: Tab[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'staff'] },
    { id: 'catalog', label: 'Catalog & Rules', icon: Package, roles: ['admin', 'staff'] },
    { id: 'subscriptions', label: 'Subscriptions', icon: FileText, roles: ['admin', 'staff'] },
    { id: 'billing', label: 'Billing Run', icon: PlayCircle, roles: ['admin', 'staff'] },
    { id: 'invoices', label: 'Invoices & Payments', icon: CreditCard, roles: ['admin', 'staff', 'customer'] },
    { id: 'portal', label: 'Customer Portal', icon: ShieldCheck, roles: ['admin', 'staff', 'customer'] },
    { id: 'staff', label: 'Staff Admin', icon: UserCheck, roles: ['admin'] }
  ];
  const visibleTabs = TABS.filter(t => !currentUser || t.roles.includes(currentUser.role));

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white sticky top-0 z-50 shadow-md">
      {/* Top Banner with Quick Persona Switcher for Evaluators */}
      <div className="bg-slate-950 px-4 py-1.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between text-xs gap-2">
        <div className="flex items-center space-x-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-odoo-500 text-white">
            Odoo x Make-A-Ton 9.0
          </span>
          <span className="text-slate-400 font-medium hidden sm:inline">
            Evaluation Persona Switcher (1-Click Test RBAC & Isolation):
          </span>
        </div>

        <div className="flex items-center flex-wrap gap-1.5">
          {(Object.keys(DEMO_USERS) as Array<keyof typeof DEMO_USERS>).map(key => {
            const persona = DEMO_USERS[key];
            const isCurrent = currentUser?.email.toLowerCase() === persona.email.toLowerCase();
            return (
              <button
                key={key}
                disabled={switching}
                onClick={() => handlePersonaClick(key)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1 ${
                  isCurrent
                    ? 'bg-odoo-teal text-white ring-2 ring-emerald-400 shadow-sm'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                {isCurrent && <CheckCircle className="w-3 h-3 text-white" />}
                {persona.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Navigation Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-odoo-500 to-odoo-teal flex items-center justify-center shadow-lg">
              <Layers className="w-6 h-6 text-white" />
            </div>
            <div>
              <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                Brightloop Software
              </span>
              <span className="block text-[11px] text-slate-400 font-medium">Subscription & Billing Platform</span>
            </div>
          </div>

          {/* Navigation Links (desktop). Each role only sees the pages it may use; the server enforces it anyway. */}
          <nav className="hidden lg:flex items-center space-x-1" aria-label="Main">
            {visibleTabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === t.id ? (t.id === 'portal' ? 'bg-odoo-teal text-white' : 'bg-odoo-500 text-white') : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <t.icon className="w-4 h-4" />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>

          {/* User profile & Refresh */}
          <div className="flex items-center space-x-3">
            <button
              onClick={onLogout}
              title="Sign out"
              aria-label="Sign out"
              className="p-2 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
            <button
              onClick={onRefresh}
              title="Refresh Data"
              className="p-2 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <div className="text-right hidden sm:block">
              <div className="text-sm font-semibold text-white">{currentUser?.full_name || 'Guest User'}</div>
              <div className="text-xs text-slate-400 capitalize">{currentUser?.role} Mode</div>
            </div>
          </div>
        </div>

        {/* Navigation (small screens): scrollable row so every page stays reachable */}
        <nav className="lg:hidden flex gap-1 overflow-x-auto pb-2" aria-label="Main (mobile)">
          {visibleTabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
                activeTab === t.id ? 'bg-odoo-500 text-white' : 'text-slate-300 bg-slate-800'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
};
