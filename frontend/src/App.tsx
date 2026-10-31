import React, { useState, useEffect } from 'react';
import { User } from './types.js';
import { api, getCurrentUser, DEMO_USERS, setSession } from './services/api.js';
import { Navbar } from './components/Navbar.js';
import { Dashboard } from './pages/Dashboard.js';
import { Subscriptions } from './pages/Subscriptions.js';
import { BillingRun } from './pages/BillingRun.js';
import { Invoices } from './pages/Invoices.js';
import { Catalog } from './pages/Catalog.js';
import { CustomerPortal } from './pages/CustomerPortal.js';
import { StaffManagement } from './pages/StaffManagement.js';
import { RefreshCw } from 'lucide-react';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(getCurrentUser());
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [targetInvoiceId, setTargetInvoiceId] = useState<number | null>(null);
  const [initializing, setInitializing] = useState(true);

  // Auto-login as Admin on first load if no token exists
  useEffect(() => {
    const initAuth = async () => {
      if (!getCurrentUser()) {
        try {
          const res = await api.login(DEMO_USERS.admin.email, DEMO_USERS.admin.password);
          setCurrentUser(res.user);
        } catch (err) {
          console.error('Auto login failed', err);
        }
      }
      setInitializing(false);
    };
    initAuth();
  }, []);

  const handleSwitchPersona = async (key: keyof typeof DEMO_USERS) => {
    const creds = DEMO_USERS[key];
    try {
      const res = await api.login(creds.email, creds.password);
      setCurrentUser(res.user);
      // If switched to a customer, take them directly to customer portal to demonstrate data isolation
      if (res.user.role === 'customer') {
        setActiveTab('portal');
      } else {
        setActiveTab('dashboard');
      }
    } catch (err: any) {
      alert('Persona switch error: ' + err.message);
    }
  };

  const handleNavigateToInvoice = (invoiceId: number) => {
    setTargetInvoiceId(invoiceId);
    setActiveTab('invoices');
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  if (initializing) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 animate-spin text-odoo-500" />
          <span className="font-semibold text-sm">Initializing Brightloop Platform...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <Navbar
        currentUser={currentUser}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onSwitchPersona={handleSwitchPersona}
        onRefresh={handleRefresh}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'dashboard' && (
          <Dashboard
            onNavigateToInvoice={handleNavigateToInvoice}
            onNavigateToBilling={() => setActiveTab('billing')}
          />
        )}

        {activeTab === 'subscriptions' && <Subscriptions />}

        {activeTab === 'billing' && <BillingRun />}

        {activeTab === 'invoices' && <Invoices initialInvoiceId={targetInvoiceId} />}

        {activeTab === 'catalog' && (
          <Catalog
            currentUser={currentUser}
            onSelectTemplate={() => setActiveTab('subscriptions')}
          />
        )}

        {activeTab === 'portal' && (
          <CustomerPortal
            currentUser={currentUser}
            onViewInvoice={handleNavigateToInvoice}
          />
        )}

        {activeTab === 'staff' && currentUser?.role === 'admin' && <StaffManagement />}
      </main>

      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-500">
        Brightloop Software Subscription & Recurring Billing System &bull; Built for Odoo x Make-A-Ton 9.0 Kochi Hackathon
      </footer>
    </div>
  );
};

export default App;
