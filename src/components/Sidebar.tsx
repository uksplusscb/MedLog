import { 
  LayoutDashboard, 
  ClipboardList, 
  PlusCircle, 
  Package, 
  Database,
  FileSearch, 
  Users,
  LogOut,
  Stethoscope
} from 'lucide-react';
import { cn } from '../lib/utils';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
}

export default function Sidebar({ activeTab, setActiveTab, onLogout }: SidebarProps) {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'visits', label: 'Data Harian', icon: ClipboardList },
    { id: 'add-visit', label: 'Formulir Pemeriksaan Baru', icon: PlusCircle },
    { id: 'master-data', label: 'Database Master', icon: Database },
    { id: 'reports', label: 'Laporan Bulanan', icon: FileSearch },
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

      <div className="p-6 border-t border-slate-100">
        <button 
          onClick={onLogout}
          className="w-full flex items-center gap-3 text-slate-400 hover:text-red-500 transition-colors text-xs font-bold uppercase tracking-wider"
        >
          <LogOut className="w-4 h-4" />
          Keluar Sesi
        </button>
      </div>
    </aside>
  );
}
