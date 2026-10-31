import React, { useState, useEffect } from 'react';
import { User } from './types.js';
import { api, getCurrentUser, setSession } from './services/api.js';
import { Navbar } from './components/Navbar.js';
import { Dashboard } from './pages/Dashboard.js';
import { Subscriptions } from './pages/Subscriptions.js';
import { BillingRun } from './pages/BillingRun.js';
import { Invoices } from './pages/Invoices.js';
import { Catalog } from './pages/Catalog.js';
import { CustomerPortal } from './pages/CustomerPortal.js';
import { StaffManagement } from './pages/StaffManagement.js';
import { Login } from './pages/Login.js';
import { Loading, ToastProvider } from './components/ui.js';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(getCurrentUser());
  const [activeTab, setActiveTab] = useState<string>(() => (getCurrentUser()?.role === 'customer' ? 'portal' : 'dashboard'));
  const [targetInvoiceId, setTargetInvoiceId] = useState<number | null>(null);
  const [initializing, setInitializing] = useState(true);

  // A stored session is re-validated against the server; an expired or revoked token returns to sign-in.
  useEffect(() => {
    const check = async () => {
      if (getCurrentUser()) {
        try {
          setCurrentUser((await api.me()).user);
        } catch {
          setSession(null, null);
          setCurrentUser(null);
        }
      }
      setInitializing(false);
    };
    check();
  }, []);

  const landOn = (user: User) => (user.role === 'customer' ? 'portal' : 'dashboard');

  const handleLoggedIn = (user: User) => {
    setCurrentUser(user);
    setActiveTab(landOn(user));
    setTargetInvoiceId(null);
  };

  const handleLogout = () => {
    setSession(null, null);
    setCurrentUser(null);
    setTargetInvoiceId(null);
  };

  const openInvoice = (invoiceId: number) => {
    setTargetInvoiceId(invoiceId);
    setActiveTab('invoices');
  };

  if (initializing) {
    return <Loading label="Starting…" />;
  }

  if (!currentUser) {
    return (
      <ToastProvider>
        <Login onLoggedIn={handleLoggedIn} />
      </ToastProvider>
    );
  }

  const role = currentUser.role;
  const isStaff = role === 'admin' || role === 'staff';

  return (
    <ToastProvider>
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <Navbar
          currentUser={currentUser}
          activeTab={activeTab}
          setActiveTab={tab => { setActiveTab(tab); if (tab !== 'invoices') setTargetInvoiceId(null); }}
          onLogout={handleLogout}
        />

        <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6">
          {activeTab === 'dashboard' && isStaff && <Dashboard onNavigateToInvoice={openInvoice} onNavigateToBilling={() => setActiveTab('billing')} />}
          {activeTab === 'catalog' && isStaff && <Catalog currentUser={currentUser} />}
          {activeTab === 'subscriptions' && isStaff && <Subscriptions />}
          {activeTab === 'billing' && isStaff && <BillingRun onOpenInvoices={() => setActiveTab('invoices')} />}
          {activeTab === 'invoices' && <Invoices key={currentUser.id} initialInvoiceId={targetInvoiceId} />}
          {activeTab === 'portal' && role === 'customer' && <CustomerPortal currentUser={currentUser} onViewInvoice={openInvoice} />}
          {activeTab === 'staff' && role === 'admin' && <StaffManagement />}
        </main>

        <footer className="border-t border-slate-200 bg-white py-3 text-center text-xs text-slate-500">
          Brightloop subscription billing · Odoo × Make-A-Ton 9.0
        </footer>
      </div>
    </ToastProvider>
  );
};

export default App;
