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
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  activeTab,
  setActiveTab,
  onSwitchPersona,
  onRefresh
}) => {
  const [switching, setSwitching] = useState(false);

  const handlePersonaClick = async (key: keyof typeof DEMO_USERS) => {
    setSwitching(true);
    await onSwitchPersona(key);
    setSwitching(false);
  };

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

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center space-x-1">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'dashboard' ? 'bg-odoo-500 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Dashboard</span>
            </button>

            <button
              onClick={() => setActiveTab('subscriptions')}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'subscriptions' ? 'bg-odoo-500 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Subscriptions</span>
            </button>

            <button
              onClick={() => setActiveTab('billing')}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'billing' ? 'bg-odoo-500 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <PlayCircle className="w-4 h-4" />
              <span>Billing Run Engine</span>
            </button>

            <button
              onClick={() => setActiveTab('invoices')}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'invoices' ? 'bg-odoo-500 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <CreditCard className="w-4 h-4" />
              <span>Invoices & Payments</span>
            </button>

            <button
              onClick={() => setActiveTab('catalog')}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'catalog' ? 'bg-odoo-500 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Package className="w-4 h-4" />
              <span>Catalog & Rules</span>
            </button>

            <button
              onClick={() => setActiveTab('portal')}
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'portal' ? 'bg-odoo-teal text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Customer Portal</span>
            </button>

            {currentUser?.role === 'admin' && (
              <button
                onClick={() => setActiveTab('staff')}
                className={`flex items-center space-x-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'staff' ? 'bg-odoo-500 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <UserCheck className="w-4 h-4" />
                <span>Staff Admin</span>
              </button>
            )}
          </nav>

          {/* User profile & Refresh */}
          <div className="flex items-center space-x-3">
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
      </div>
    </header>
  );
};
