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
import { Login } from './pages/Login.js';
import { RefreshCw } from 'lucide-react';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(getCurrentUser());
  const [activeTab, setActiveTab] = useState<string>(() => (getCurrentUser()?.role === 'customer' ? 'portal' : 'dashboard'));
  const [targetInvoiceId, setTargetInvoiceId] = useState<number | null>(null);
  const [initializing, setInitializing] = useState(true);

  // A stored session is re-validated against the server; an expired or revoked token sends the user back to sign-in.
  useEffect(() => {
    const check = async () => {
      if (getCurrentUser()) {
        try {
          const me = await api.me();
          setCurrentUser(me.user);
        } catch {
          setSession(null, null);
          setCurrentUser(null);
        }
      }
      setInitializing(false);
    };
    check();
  }, []);

  const startPage = (user: User) => (user.role === 'customer' ? 'portal' : 'dashboard');

  const handleLoggedIn = (user: User) => {
    setCurrentUser(user);
    setActiveTab(startPage(user));
  };

  const handleLogout = () => {
    setSession(null, null);
    setCurrentUser(null);
  };

  const handleSwitchPersona = async (key: keyof typeof DEMO_USERS) => {
    const creds = DEMO_USERS[key];
    try {
      const res = await api.login(creds.email, creds.password);
      setCurrentUser(res.user);
      // If switched to a customer, take them directly to customer portal to demonstrate data isolation
      setActiveTab(startPage(res.user));
    } catch (err: any) {
      console.error('Persona switch failed', err);
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

  if (!currentUser) {
    return <Login onLoggedIn={handleLoggedIn} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <Navbar
        currentUser={currentUser}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onSwitchPersona={handleSwitchPersona}
        onRefresh={handleRefresh}
        onLogout={handleLogout}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {activeTab === 'dashboard' && currentUser?.role !== 'customer' && (
          <Dashboard
            onNavigateToInvoice={handleNavigateToInvoice}
            onNavigateToBilling={() => setActiveTab('billing')}
          />
        )}

        {activeTab === 'subscriptions' && currentUser?.role !== 'customer' && <Subscriptions />}

        {activeTab === 'billing' && currentUser?.role !== 'customer' && <BillingRun />}

        {activeTab === 'invoices' && <Invoices key={currentUser?.id} initialInvoiceId={targetInvoiceId} />}

        {activeTab === 'catalog' && currentUser?.role !== 'customer' && (
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
