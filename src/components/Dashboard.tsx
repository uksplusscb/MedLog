import { useEffect, useState } from 'react';
import { cn, sanitizeMedicines } from '../lib/utils';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy, 
  limit, 
  Timestamp,
  collectionGroup,
  onSnapshot
} from 'firebase/firestore';
import { startOfMonth, endOfMonth, format, parseISO } from 'date-fns';
import { db, handleFirestoreError, OperationType, runWithRetry, isNetworkAvailable } from '../lib/firebase';
import { Visit, Medicine } from '../types';
import { 
  Users, 
  Activity, 
  Package, 
  Calendar,
  ChevronRight,
  TrendingUp,
  AlertCircle,
  LogIn,
  Lock,
  Loader2
} from 'lucide-react';
import { 
  PieChart, 
  Pie,
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  Legend
} from 'recharts';

interface DashboardProps {
  setActiveTab: (tab: string) => void;
  user?: any;
  onLoginClick?: () => void;
}

export default function Dashboard({ setActiveTab, user, onLoginClick }: DashboardProps) {
  const [stats, setStats] = useState({
    todayVisits: 0,
    monthVisits: 0,
    lowStock: 0,
    uniqueStudents: 0,
    activeMonthName: ''
  });
  const [recentVisits, setRecentVisits] = useState<Visit[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [diagnosisData, setDiagnosisData] = useState<any[]>([]);
  const [isOfflineWarning, setIsOfflineWarning] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  // Helper utility to format Indonesian month names safely to avoid system locale issues
  const getIndonesianMonthYear = (date: Date) => {
    const months = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  };

  // Load cache immediately on mount (First-paint instant optimization)
  useEffect(() => {
    try {
      const cached = localStorage.getItem('uks_dashboard_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.stats) setStats(parsed.stats);
        if (parsed.recentVisits) setRecentVisits(parsed.recentVisits);
        if (parsed.chartData) setChartData(parsed.chartData);
        if (parsed.diagnosisData) setDiagnosisData(parsed.diagnosisData);
      }
    } catch (e) {
      console.warn("Failed to load dashboard cache from localStorage:", e);
    }
  }, []);

  const [allVisits, setAllVisits] = useState<Visit[] | null>(null);
  const [allMedicines, setAllMedicines] = useState<any[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Real-time subscription to Visits directly from Firestore (No auth requirement for READ)
  useEffect(() => {
    const startTime = performance.now();
    setIsLoading(true);
    
    console.log('[Dashboard Client] Memulai subscription real-time ke koleksi "visits" di Firestore...');
    
    const q = query(collection(db, 'visits'), orderBy('date', 'desc'), limit(1500));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const queryTime = Math.round(performance.now() - startTime);
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Visit));
      
      console.log('--- FIRESTORE VISIT LOADED ---');
      console.log('Dashboard Public Loaded');
      console.log('Firestore Collection: visits');
      console.log(`Jumlah Dokumen: ${docs.length}`);
      console.log(`Query Time: ${queryTime}ms`);
      
      if (docs.length === 0) {
        console.warn('Peringatan: Koleksi "visits" mengembalikan dokumen kosong.');
      }
      
      setAllVisits(docs);
      setIsOfflineWarning(false);
      setHasError(false);
      setErrorMessage('');
    }, (err) => {
      console.error("Dashboard visits subscription failed:", err);
      setIsOfflineWarning(true);
      setHasError(true);
      setIsLoading(false);
      setErrorMessage(err.message || String(err));
      handleFirestoreError(err, OperationType.GET, 'dashboard_visits');
    });
    
    return () => unsubscribe();
  }, []);

  // Real-time subscription to Medicines directly from Firestore (No auth requirement for READ)
  useEffect(() => {
    const startTime = performance.now();
    console.log('[Dashboard Client] Memulai subscription real-time ke koleksi "medicines" di Firestore...');
    
    const unsubscribe = onSnapshot(collection(db, 'medicines'), (snapshot) => {
      const queryTime = Math.round(performance.now() - startTime);
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      console.log('--- FIRESTORE MEDICINES LOADED ---');
      console.log('Firestore Collection: medicines');
      console.log(`Jumlah Dokumen: ${docs.length}`);
      console.log(`Query Time: ${queryTime}ms`);
      
      if (docs.length === 0) {
        console.warn('Peringatan: Koleksi "medicines" mengembalikan dokumen kosong.');
      }
      
      setAllMedicines(docs);
      setHasError(false);
      setErrorMessage('');
    }, (err) => {
      console.error("Dashboard medicines subscription failed:", err);
      setHasError(true);
      setIsLoading(false);
      setErrorMessage(err.message || String(err));
      handleFirestoreError(err, OperationType.GET, 'dashboard_medicines');
    });
    
    return () => unsubscribe();
  }, []);

  // Reactive calculations of statistics directly from in-memory collections loaded from Firestore
  useEffect(() => {
    if (allVisits === null || allMedicines === null) {
      return; // Wait until both subscriptions have received their initial payloads from Firestore
    }

    console.log('[Dashboard Client] Menghitung ulang statistik dari data Firestore...');
    
    // Merge cached Google Sheets medicines for precise low-stock statistics
    let mergedMedicinesForStats = sanitizeMedicines([...allMedicines]);
    try {
      const cached = localStorage.getItem('uks_cache_medicines');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          const sanitizedCached = sanitizeMedicines(parsed);
          const seenNames = new Set(mergedMedicinesForStats.map(m => (m.name || '').trim().toLowerCase()));
          sanitizedCached.forEach(item => {
            if (item && item.name) {
              const key = item.name.trim().toLowerCase();
              if (!seenNames.has(key)) {
                seenNames.add(key);
                mergedMedicinesForStats.push({
                  ...item,
                  stock: item.stock !== undefined ? item.stock : 0
                });
              }
            }
          });
        }
      }
    } catch (e) {
      console.warn("Gagal parse cache obat untuk stats dashboard:", e);
    }

    const lowStockCount = mergedMedicinesForStats.filter(mData => {
      const stock = mData.stock !== undefined ? mData.stock : mData.stok || 0;
      return Number(stock) < 10;
    }).length;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const hasCurrentMonthData = allVisits.some(v => {
      if (!v.date) return false;
      try {
        const d = new Date(v.date);
        return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
      } catch (_) {
        return false;
      }
    });

    let targetYear = currentYear;
    let targetMonth = currentMonth;

    if (!hasCurrentMonthData) {
      // Fallback to the latest visit with a valid date (safeguard older historical records)
      const latestWithDate = allVisits.find(v => v.date && !isNaN(new Date(v.date).getTime()));
      if (latestWithDate) {
        const d = new Date(latestWithDate.date);
        targetYear = d.getFullYear();
        targetMonth = d.getMonth();
      }
    }

    const activeMonthLabel = getIndonesianMonthYear(new Date(targetYear, targetMonth, 1));

    // Filter and calculate metrics
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTodayStr = format(startOfToday, 'yyyy-MM-dd') + 'T00:00:00.000Z';

    const todayVisitsCount = allVisits.filter(v => v.date && v.date >= startOfTodayStr).length;

    const activeMonthVisits = allVisits.filter(v => {
      if (!v.date) return false;
      try {
        const d = new Date(v.date);
        return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
      } catch (_) {
        return false;
      }
    });

    const monthVisitsCount = activeMonthVisits.length;
    const uniqueStudentsCount = Array.from(new Set(activeMonthVisits.map(v => v.studentName || 'Siswa Anonim'))).length;

    const calculatedStats = {
      todayVisits: todayVisitsCount,
      monthVisits: monthVisitsCount,
      lowStock: lowStockCount,
      uniqueStudents: uniqueStudentsCount,
      activeMonthName: activeMonthLabel
    };

    setStats(calculatedStats);
    setRecentVisits(allVisits.slice(0, 5));

    // Prepare last 7 days chart trend (Dynamic in-memory calculation)
    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const last7Days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateLabel = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      
      const dayStartStr = format(d, 'yyyy-MM-dd') + 'T00:00:00.000Z';
      const dayEndStr = format(d, 'yyyy-MM-dd') + 'T23:59:59.999Z';
      const count = allVisits.filter(v => v.date && v.date >= dayStartStr && v.date <= dayEndStr).length;

      return {
        name: dayNames[d.getDay()],
        count: count,
        dateLabel: dateLabel
      };
    }).reverse();

    setChartData(last7Days);

    // Prepare diagnosis distribution for active month
    const diagMap: Record<string, number> = {};
    activeMonthVisits.forEach(v => {
      if (v.diagnosis) {
        const dName = v.diagnosis.trim();
        diagMap[dName] = (diagMap[dName] || 0) + 1;
      }
    });

    const topDiagnoses = Object.entries(diagMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    setDiagnosisData(topDiagnoses);

    setIsLoading(false);

    // Save successfully synchronized state to cache
    const cacheObj = {
      stats: calculatedStats,
      recentVisits: allVisits.slice(0, 5),
      chartData: last7Days,
      diagnosisData: topDiagnoses,
      timestamp: Date.now()
    };
    localStorage.setItem('uks_dashboard_cache', JSON.stringify(cacheObj));
  }, [allVisits, allMedicines, user]);

  // Dedicated logging effect to ensure console logs print even if queries are loading, failing, or completed
  useEffect(() => {
    console.log('=== DASHBOARD PUBLIC ===');
    console.log('Collection: visits, medicines');
    console.log(`Document: ${allVisits && allVisits.length > 0 ? `visits[0].id: ${allVisits[0].id}` : 'None'}`);
    console.log('Query dijalankan: YA');
    console.log(`Jumlah dokumen diterima: ${allVisits ? `visits: ${allVisits.length}` : 'visits: 0'}, ${allMedicines ? `medicines: ${allMedicines.length}` : 'medicines: 0'}`);
    console.log('Data yang diterima:', { visits: allVisits || [], medicines: allMedicines || [] });
    console.log(`Error Firebase: ${errorMessage || 'TIDAK ADA'}`);
    console.log(`Status Authentication: ${user ? 'Terotentikasi' : 'Guest (Publik)'}`);
    console.log(`UID: ${user?.uid || 'null'}`);
    console.log(`Role: ${user?.email === 'uksplus.scb@gmail.com' ? 'Admin' : (user ? 'Officer' : 'Guest')}`);
    console.log('========================');
  }, [allVisits, allMedicines, errorMessage, user]);

  const COLORS = ['#0891b2', '#7c3aed', '#db2777', '#ea580c', '#059669'];

  const cards = [
    { label: 'Kunjungan Hari Ini', value: stats.todayVisits, icon: Activity, color: 'text-cyan-600', bg: 'bg-cyan-50' },
    { label: stats.activeMonthName ? `Kunjungan (${stats.activeMonthName})` : 'Kunjungan Bulan Ini', value: stats.monthVisits, icon: Users, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: stats.activeMonthName ? `Pasien Diperiksa (${stats.activeMonthName})` : 'Pasien Diperiksa (Bulan Ini)', value: stats.uniqueStudents, icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'Obat Stok Menipis', value: stats.lowStock, icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
  ];

  if (hasError && stats.activeMonthName === '') {
    return (
      <div className="min-h-[400px] w-full flex flex-col items-center justify-center gap-3 bg-white border border-red-200 shadow-sm rounded-lg p-6 text-center">
        <AlertCircle className="w-10 h-10 text-red-600" />
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-tight">Koneksi Database Gagal</h3>
        <p className="text-xs text-slate-500 max-w-md">Data Dashboard gagal dimuat dari Cloud Firestore.</p>
        {errorMessage && (
          <div className="mt-2 p-3 bg-red-50 border border-red-100 rounded text-left font-mono text-[10px] text-red-600 max-w-lg mx-auto overflow-auto shrink-0">
            {errorMessage}
          </div>
        )}
        {!user && onLoginClick && (
          <button
            onClick={onLoginClick}
            className="mt-4 flex items-center justify-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-[10px] font-bold uppercase tracking-wider rounded border-none cursor-pointer transition-colors shadow-sm"
          >
            <LogIn className="w-3 h-3" />
            Masuk Sesi Petugas
          </button>
        )}
      </div>
    );
  }

  if (isLoading && stats.activeMonthName === '') {
    return (
      <div className="min-h-[400px] w-full flex flex-col items-center justify-center gap-3 bg-white border border-slate-200 shadow-sm rounded-lg">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-600" />
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Memuat Data Dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {isOfflineWarning && (
        <div className="p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-xs font-bold uppercase tracking-tight flex items-center gap-2 shadow-sm animate-pulse-subtle">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
          Koneksi database offline / kuota terlampaui. Menampilkan data lokal offline terakhir.
        </div>
      )}

      {!user && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wide">Mode Publik (Lihat Saja)</h4>
              <p className="text-[11px] text-amber-700 font-medium mt-0.5">
                Anda mengakses dashboard sebagai tamu. Untuk memasukkan data kunjungan, mengelola obat, mendownload laporan, atau mengakses menu administrasi, silakan masuk ke akun Petugas.
              </p>
            </div>
          </div>
          <button
            onClick={onLoginClick}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold uppercase tracking-wider rounded transition-colors border-none shrink-0 cursor-pointer shadow-sm"
          >
            <LogIn className="w-3.5 h-3.5" />
            Masuk Sesi Petugas
          </button>
        </div>
      )}

      <header className="flex items-center justify-between bg-white p-4 rounded-lg border border-slate-200 shadow-sm h-16">
        <div className="flex items-center gap-4">
          <div className="h-8 w-1 bg-cyan-600 rounded-full" />
          <h1 className="text-sm font-bold text-slate-800 tracking-tight uppercase">Dashboard Overview</h1>
        </div>
        <div className="flex items-center gap-6">
          {user ? (
            <div className="text-right hidden md:block">
              <p className="label-caps">Status Sesi</p>
              <p className="text-[10px] font-bold text-cyan-600 truncate max-w-[200px]" title={user.email || 'Super Admin'}>
                PETUGAS: {user.displayName || 'Super Admin'}
              </p>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-2">
              <button
                onClick={onLoginClick}
                className="flex items-center gap-1.5 px-3 py-1 bg-cyan-600 hover:bg-cyan-700 text-white text-[10px] font-bold uppercase tracking-wider rounded border-none cursor-pointer transition-colors shadow-xs"
              >
                <LogIn className="w-3 h-3" />
                MASUK PETUGAS
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded uppercase font-mono">
            <Calendar className="w-3.5 h-3.5" />
            {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card, i) => (
          <div key={i} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm hover:border-cyan-300 transition-colors group">
            <p className="label-caps mb-2">{card.label}</p>
            <div className="flex items-end justify-between">
              <p className="text-2xl font-bold font-mono text-slate-900">{card.value}</p>
              <div className={cn("p-1.5 rounded", card.bg)}>
                <card.icon className={cn("w-4 h-4", card.color)} />
              </div>
            </div>
            <div className="mt-3 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
              <div className={cn("h-full transition-all duration-1000", card.color.replace('text', 'bg'))} style={{ width: '60%' }} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col">
          <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 className="label-caps">Tren Kunjungan Pekanan</h3>
            <span className="text-[10px] text-slate-400 font-mono tracking-tighter">METRIC_REPORT_7D</span>
          </div>
          <div className="p-4 flex-1">
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} 
                    dy={10}
                  />
                  <YAxis hide />
                  <Tooltip 
                    cursor={{ fill: '#f8fafc', radius: 4 }}
                    contentStyle={{ borderRadius: '4px', border: '1px solid #e2e8f0', fontSize: '10px', padding: '8px' }}
                  />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]} barSize={32}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index === chartData.length - 1 ? '#0891b2' : '#cbd5e1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col">
          <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 className="label-caps">Log Aktivitas Terakhir</h3>
            <button 
              onClick={() => setActiveTab('visits')}
              className="text-cyan-600 text-[10px] font-bold hover:underline tracking-widest"
            >
              SEMUA
            </button>
          </div>
          <div className="p-2 space-y-1 flex-1 overflow-auto max-h-[340px]">
            {recentVisits.map((v) => (
              <div key={v.id} onClick={() => setActiveTab('visits')} className="flex items-center gap-3 p-3 rounded hover:bg-slate-50 transition-colors cursor-pointer border-b border-transparent hover:border-slate-100">
                <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs uppercase overflow-hidden">
                  {(v.studentName || '?').charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="font-bold text-slate-800 text-xs truncate uppercase tracking-tight">{v.studentName || 'Unknown Student'}</p>
                    <span className="text-[9px] font-mono text-slate-400">
                      {v.date ? new Date(v.date).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-cyan-600 bg-cyan-50 px-1 rounded uppercase tracking-tighter">KLS {v.grade}</span>
                    <p className="text-[10px] text-slate-400 truncate italic">{v.complaint}</p>
                  </div>
                </div>
              </div>
            ))}
            {recentVisits.length === 0 && (
              <p className="text-center text-slate-400 py-12 text-[10px] uppercase font-bold italic tracking-widest">NO_LOGDATA</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col">
          <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 className="label-caps">Distribusi Tren Diagnosa ({stats.activeMonthName || 'Bulan Ini'})</h3>
            <span className="text-[10px] text-slate-400 font-mono tracking-tighter">DIAGNOSIS_DIST_PIE</span>
          </div>
          <div className="p-6 flex-1 flex flex-col md:flex-row items-center justify-around">
            <div className="h-[300px] w-full md:w-1/2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '10px', padding: '12px' }}
                  />
                  <Pie
                    data={diagnosisData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    animationBegin={0}
                    animationDuration={1500}
                  >
                    {diagnosisData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-full md:w-1/3 space-y-3">
               {diagnosisData.map((entry, index) => (
                 <div key={entry.name} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-3">
                       <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                       <span className="text-[10px] font-black text-slate-700 uppercase tracking-tight">{entry.name}</span>
                    </div>
                    <span className="text-xs font-mono font-bold text-slate-900">{entry.value}</span>
                 </div>
               ))}
               {diagnosisData.length === 0 && (
                 <p className="text-center text-slate-400 py-12 text-[10px] uppercase font-bold italic tracking-widest">NO_DIAGDATA</p>
               )}
            </div>
          </div>
      </div>
    </div>
  );
}
