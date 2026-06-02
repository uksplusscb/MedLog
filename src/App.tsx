/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, ReactNode, Component } from 'react';
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
import TeacherContacts from './components/TeacherContacts';
import LabResultViewer from './components/LabResultViewer';
import { Stethoscope, LogIn, Loader2, AlertCircle } from 'lucide-react';

class ProperErrorBoundary extends Component<any, any> {
  public state: any = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ProperErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-full flex items-center justify-center bg-slate-900 p-8 text-white">
          <div className="max-w-md w-full text-center space-y-6">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto" />
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tighter">System Crash</h1>
              <p className="text-slate-400 text-sm mt-2">Terjadi kesalahan fatal pada aplikasi. Error: {this.state.error?.message || 'Unknown'}</p>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-white text-slate-900 font-black uppercase text-xs rounded-lg tracking-widest"
            >
              Restart Application
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [editingVisit, setEditingVisit] = useState<any | null>(null);

  const handleTabChange = (tab: string) => {
    if (tab !== 'add-visit') {
      setEditingVisit(null);
    }
    setActiveTab(tab);
  };
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [viewLabId, setViewLabId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const labId = params.get('view-lab');
    if (labId) {
      setViewLabId(labId);
    }
  }, []);

  const clearLabUrl = () => {
    setViewLabId(null);
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.delete('view-lab');
    window.history.replaceState({}, '', newUrl.toString());
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    }, (err) => {
      console.error("Auth error:", err);
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
        // Silent fail
      } else {
        setLoginError('Gagal masuk: ' + (error.message || 'Error tidak dikenal'));
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setActiveTab('dashboard');
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-cyan-600 animate-spin" />
      </div>
    );
  }

  if (viewLabId) {
    return <LabResultViewer labId={viewLabId} onClose={clearLabUrl} />;
  }

  if (!user) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full space-y-6">
          <div className="flex flex-col items-center gap-4">
            <div className="bg-cyan-600 p-4 rounded-2xl shadow-xl shadow-cyan-200/50">
              <Stethoscope className="w-10 h-10 text-white" />
            </div>
            <div className="text-center">
              <h1 className="text-4xl font-black text-slate-900 tracking-tighter uppercase">Med<span className="text-cyan-600">Report</span></h1>
              <p className="label-caps !text-slate-400 mt-2">Sistem Data Kesehatan</p>
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
    try {
      switch (activeTab) {
        case 'dashboard':
          return <Dashboard setActiveTab={handleTabChange} />;
        case 'visits':
          return (
            <VisitList 
              onEdit={(visit) => {
                setEditingVisit(visit);
                setActiveTab('add-visit');
              }}
            />
          );
        case 'add-visit':
          return (
            <VisitForm 
              editVisit={editingVisit}
              onCancel={() => {
                setEditingVisit(null);
                setActiveTab('visits');
              }}
              onSuccess={() => {
                setEditingVisit(null);
                setActiveTab('visits');
              }}
            />
          );
        case 'inventory':
          return <Inventory />;
        case 'master-data':
          return <MasterDatabase />;
        case 'reports':
          return (
            <Reports 
              onEditVisit={(visit) => {
                setEditingVisit(visit);
                setActiveTab('add-visit');
              }}
            />
          );
        case 'teacher-contacts':
          return <TeacherContacts />;
        default:
          return <Dashboard setActiveTab={handleTabChange} />;
      }
    } catch (err) {
      console.error("Render error in active tab:", activeTab, err);
      return (
        <div className="p-12 text-center bg-white rounded-lg border border-red-100 shadow-sm">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight">Terjadi Kesalahan Visual</h2>
          <p className="text-slate-500 text-sm mb-6">Sistem mengalami kendala saat merender halaman ini.</p>
          <button 
            onClick={() => handleTabChange('dashboard')}
            className="px-6 py-2 bg-cyan-600 text-white rounded font-bold text-xs uppercase"
          >
            Kembali ke Dashboard
          </button>
        </div>
      );
    }
  };

  return (
    <ProperErrorBoundary>
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar 
          activeTab={activeTab} 
          setActiveTab={handleTabChange} 
          onLogout={handleLogout} 
        />
        
        <main className="flex-1 min-h-screen overflow-y-auto">
          <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-6">
            {renderContent()}
          </div>
        </main>
      </div>
    </ProperErrorBoundary>
  );
}
