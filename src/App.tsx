/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User 
} from 'firebase/auth';
import { auth } from './lib/firebase';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import VisitForm from './components/VisitForm';
import VisitList from './components/VisitList';
import Inventory from './components/Inventory';
import MasterDatabase from './components/MasterDatabase';
import Reports from './components/Reports';
import { Stethoscope, LogIn, Loader2 } from 'lucide-react';
// import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    setLoginError(null);
    setIsLoggingIn(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: 'select_account'
    });
    
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Login failed:', error);
      if (error.code === 'auth/unauthorized-domain') {
        setLoginError('Domain ini belum diizinkan di Firebase. Pastikan https://med-log-seven.vercel.app/ (tanpa trailing slash) sudah ada di Authorized Domains di Firebase Console.');
      } else if (error.code === 'auth/popup-blocked') {
        setLoginError('Popup diblokir oleh browser. Silakan izinkan popup untuk situs ini.');
      } else if (error.code === 'auth/cancelled-popup-request' || error.code === 'auth/popup-closed-by-user') {
        // Silent fail for user cancellation
      } else {
        setLoginError('Gagal masuk: ' + (error.message || 'Error tidak dikenal'));
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setActiveTab('dashboard');
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full space-y-6">
          <div className="flex flex-col items-center gap-2">
            <div className="bg-blue-600 p-3 rounded-lg shadow-lg">
              <Stethoscope className="w-8 h-8 text-white" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-black text-slate-900 tracking-tighter uppercase italic">SiUKS <span className="text-blue-600">Pro</span></h1>
              <p className="label-caps !text-slate-400 mt-1">Medical Records & Logistics System</p>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
            <div className="mb-6">
              <h2 className="text-xs font-bold text-slate-800 uppercase tracking-widest mb-1">Otentikasi Petugas</h2>
              <p className="text-[11px] text-slate-500 font-medium">Gunakan kredensial resmi sekolah untuk akses sistem.</p>
            </div>

            {loginError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded text-[11px] text-red-600 font-medium">
                {loginError}
              </div>
            )}
            
            <button
              onClick={handleLogin}
              disabled={isLoggingIn}
              className="w-full flex items-center justify-center gap-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded text-xs transition-all shadow-sm group"
            >
              {isLoggingIn ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4 brightness-200" />
              )}
              {isLoggingIn ? 'AUTHORIZING...' : 'AUTHORIZE WITH GOOGLE'}
            </button>

            <div className="mt-6 pt-6 border-t border-slate-100 grid grid-cols-2 gap-4">
              <div className="text-center p-2 rounded bg-slate-50">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Status</p>
                <p className="text-[11px] font-bold text-emerald-600">ENCRYPT_AES256</p>
              </div>
              <div className="text-center p-2 rounded bg-slate-50">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Region</p>
                <p className="text-[11px] font-bold text-slate-600">IDN-JKT-01</p>
              </div>
            </div>
          </div>
          
          <p className="text-[9px] text-center text-slate-400 font-mono">
            SYS_VERSION: 2.1.0-STABLE | &copy; 2026 MEDICAL_INFRASTRUCTURE
          </p>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard setActiveTab={setActiveTab} />;
      case 'visits':
        return <VisitList />;
      case 'add-visit':
        return <VisitForm onSuccess={() => setActiveTab('visits')} />;
      case 'inventory':
        return <Inventory />;
      case 'master-data':
        return <MasterDatabase />;
      case 'reports':
        return <Reports />;
      default:
        return <Dashboard setActiveTab={setActiveTab} />;
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        onLogout={handleLogout} 
      />
      
      <main className="flex-1 min-h-screen overflow-y-auto">
        <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-6">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}
