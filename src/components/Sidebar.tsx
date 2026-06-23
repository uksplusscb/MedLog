import { useState, useEffect } from 'react';
import { collection, query, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { 
  LayoutDashboard, 
  ClipboardList, 
  PlusCircle, 
  Package, 
  Database,
  FileSearch, 
  Users,
  LogOut,
  Stethoscope,
  FileSpreadsheet,
  FileText
} from 'lucide-react';
import { cn } from '../lib/utils';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
}

export default function Sidebar({ activeTab, setActiveTab, onLogout }: SidebarProps) {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [hasPending, setHasPending] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Monitor unsynced/pending writes in the visits collection in real-time
    let unsub = () => {};
    try {
      const q = query(collection(db, 'visits'), limit(1));
      unsub = onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
        setHasPending(snapshot.metadata.hasPendingWrites);
      });
    } catch (e) {
      console.warn("Failed to subscribe to Firestore metadata sync states:", e);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsub();
    };
  }, []);

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'visits', label: 'Data Harian', icon: ClipboardList },
    { id: 'add-visit', label: 'Formulir Pemeriksaan Baru', icon: PlusCircle },
    { id: 'master-data', label: 'Database Master', icon: Database },
    { id: 'reports', label: 'Laporan Kunjungan', icon: FileSearch },
    { id: 'medicine-reports', label: 'Laporan Pemakaian Obat', icon: FileSpreadsheet },
  ];

  return (
    <aside className="w-60 bg-white border-r border-slate-200 flex flex-col h-screen sticky top-0">
      <div className="p-6 border-b border-slate-100 bg-cyan-600">
        <div className="flex items-center gap-2 mb-1">
          <Stethoscope className="w-5 h-5 text-white" />
          <h1 className="text-white font-black text-xl tracking-tighter uppercase">MedReport</h1>
        </div>
        <p className="text-cyan-100 text-[10px] font-bold uppercase tracking-wider">Sistem Data Kesehatan</p>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={cn(
              "w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-all group",
              activeTab === item.id 
                ? "bg-cyan-50 text-cyan-700 shadow-sm" 
                : "text-slate-600 hover:bg-slate-50 hover:text-cyan-600"
            )}
          >
            <div className="flex items-center gap-3">
              <span className={cn(
                "w-1.5 h-1.5 rounded-full transition-colors",
                activeTab === item.id ? "bg-cyan-600" : "bg-slate-300 group-hover:bg-cyan-400 text-transparent"
              )} />
              {item.label}
            </div>
            <item.icon className={cn(
              "w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity",
              activeTab === item.id ? "opacity-100" : ""
            )} />
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-100 space-y-4">
        {/* Real-time Cloud Sync & Network status */}
        <div className="p-3 bg-slate-50 rounded-lg text-[10px] text-slate-500 space-y-2 border border-slate-100">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-400 uppercase tracking-widest text-[8px]">Status Koneksi</span>
            {isOnline ? (
              <span className="flex items-center gap-1 font-bold text-emerald-600">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                ONLINE
              </span>
            ) : (
              <span className="flex items-center gap-1 font-bold text-amber-600">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                OFFLINE
              </span>
            )}
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-slate-100">
            <span className="font-semibold text-slate-400 uppercase tracking-widest text-[8px]">Sinkronisasi Cloud</span>
            {hasPending ? (
              <span className="font-bold text-amber-600 animate-pulse">ADA TERTUNDA</span>
            ) : (
              <span className="font-bold text-cyan-600">TERUPDATE</span>
            )}
          </div>

          {hasPending && (
            <p className="text-[8px] text-amber-600 leading-normal pt-1.5 border-t border-dashed border-amber-200">
              ⚠️ Ada input harian di perangkat ini yang belum terunggah ke Cloud database. Harap hubungkan internet dan biarkan halaman website terbuka sampai status menjadi <strong>"TERUPDATE"</strong> sebelum beralih perangkat.
            </p>
          )}
        </div>

        <button 
          onClick={onLogout}
          className="w-full flex items-center gap-3 text-slate-400 hover:text-red-500 transition-colors text-xs font-bold uppercase tracking-wider pt-1"
        >
          <LogOut className="w-4 h-4" />
          Keluar Sesi
        </button>
      </div>
    </aside>
  );
}
