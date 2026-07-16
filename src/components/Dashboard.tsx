import { useEffect, useState, useMemo, useCallback } from 'react';
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
  onSnapshot,
  doc,
  setDoc
} from 'firebase/firestore';
import { startOfMonth, endOfMonth, format, parseISO } from 'date-fns';
import { db, handleFirestoreError, OperationType, runWithRetry, isNetworkAvailable, updateDashboardStats } from '../lib/firebase';
import { Visit, Medicine } from '../types';
import { 
  Users, 
  Activity, 
  Package, 
  Calendar,
  ChevronLeft,
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

// Global in-memory cache for Dashboard periods and medicines (5-minute TTL)
interface CacheValue {
  visits: Visit[];
  timestamp: number;
}
const localPeriodCache: Record<string, CacheValue> = {};
let localMedicinesCache: { medicines: any[]; timestamp: number } | null = null;

interface DashboardProps {
  setActiveTab: (tab: string) => void;
  user?: any;
  onLoginClick?: () => void;
}

export default function Dashboard({ setActiveTab, user, onLoginClick }: DashboardProps) {
  // Synchronously load cache for instant first-paint optimization
  const [cachedData, setCachedData] = useState<any>(() => {
    try {
      const cached = localStorage.getItem('uks_dashboard_cache');
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (_) {}
    return null;
  });

  const [isOfflineWarning, setIsOfflineWarning] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(!cachedData);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);

  // Period Filter States
  const [selectedMonth, setSelectedMonth] = useState<number>(() => {
    const saved = localStorage.getItem('uks_selected_month');
    return saved !== null ? parseInt(saved, 10) : new Date().getMonth();
  });
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const saved = localStorage.getItem('uks_selected_year');
    return saved !== null ? parseInt(saved, 10) : new Date().getFullYear();
  });
  const [availableYears, setAvailableYears] = useState<number[]>(() => {
    const saved = localStorage.getItem('uks_available_years');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (_) {}
    }
    return [new Date().getFullYear()];
  });

  const monthsList = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  // Helper utility to format Indonesian month names safely to avoid system locale issues
  const getIndonesianMonthYear = useCallback((date: Date) => {
    return `${monthsList[date.getMonth()]} ${date.getFullYear()}`;
  }, []);

  const [allVisits, setAllVisits] = useState<Visit[] | null>(null);
  const [allMedicines, setAllMedicines] = useState<any[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Synchronously initialize statistics from localStorage for instant paint optimization
  const [stats, setStats] = useState(() => {
    try {
      const cached = localStorage.getItem('uks_dashboard_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.stats) return parsed.stats;
      }
    } catch (_) {}
    return {
      todayVisits: 0,
      monthVisits: 0,
      lowStock: 0,
      uniqueStudents: 0,
      activeMonthName: ''
    };
  });

  const [recentVisits, setRecentVisits] = useState<Visit[]>(() => {
    try {
      const cached = localStorage.getItem('uks_dashboard_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.recentVisits) return parsed.recentVisits;
      }
    } catch (_) {}
    return [];
  });

  const [chartData, setChartData] = useState<any[]>(() => {
    try {
      const cached = localStorage.getItem('uks_dashboard_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.chartData) return parsed.chartData;
      }
    } catch (_) {}
    return [];
  });

  const [diagnosisData, setDiagnosisData] = useState<any[]>(() => {
    try {
      const cached = localStorage.getItem('uks_dashboard_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.diagnosisData) return parsed.diagnosisData;
      }
    } catch (_) {}
    return [];
  });

  // Dynamically load available years from Firestore visits range
  useEffect(() => {
    const fetchYearRange = async () => {
      try {
        const qMin = query(collection(db, 'visits'), orderBy('date', 'asc'), limit(1));
        const qMax = query(collection(db, 'visits'), orderBy('date', 'desc'), limit(1));
        
        const [snapMin, snapMax] = await Promise.all([
          getDocs(qMin),
          getDocs(qMax)
        ]);
        
        let minYear = new Date().getFullYear();
        let maxYear = new Date().getFullYear();
        
        if (!snapMin.empty) {
          const dStr = snapMin.docs[0].data().date;
          if (dStr) {
            const d = new Date(dStr);
            if (!isNaN(d.getTime())) {
              minYear = d.getFullYear();
            }
          }
        }
        
        if (!snapMax.empty) {
          const dStr = snapMax.docs[0].data().date;
          if (dStr) {
            const d = new Date(dStr);
            if (!isNaN(d.getTime())) {
              maxYear = d.getFullYear();
            }
          }
        }
        
        const currentYear = new Date().getFullYear();
        const startY = Math.min(minYear, currentYear);
        const endY = Math.max(maxYear, currentYear);
        
        const years: number[] = [];
        for (let y = startY; y <= endY; y++) {
          years.push(y);
        }
        
        years.sort((a, b) => b - a);
        
        setAvailableYears(years);
        localStorage.setItem('uks_available_years', JSON.stringify(years));
      } catch (e) {
        console.warn("Gagal mengambil rentang tahun kunjungan dari Firestore:", e);
      }
    };
    
    fetchYearRange();
  }, []);

  // Filter handlers optimized with useCallback
  const handleMonthChange = useCallback((month: number) => {
    setSelectedMonth(month);
    localStorage.setItem('uks_selected_month', String(month));
  }, []);

  const handleYearChange = useCallback((year: number) => {
    setSelectedYear(year);
    localStorage.setItem('uks_selected_year', String(year));
  }, []);

  const handlePrevMonth = useCallback(() => {
    setSelectedMonth(prevMonth => {
      let newMonth = prevMonth - 1;
      let newYear = selectedYear;
      if (newMonth < 0) {
        newMonth = 11;
        newYear = selectedYear - 1;
      }
      setSelectedYear(newYear);
      localStorage.setItem('uks_selected_month', String(newMonth));
      localStorage.setItem('uks_selected_year', String(newYear));
      
      setAvailableYears(prevYears => {
        if (!prevYears.includes(newYear)) {
          const updated = [...prevYears, newYear].sort((a, b) => b - a);
          localStorage.setItem('uks_available_years', JSON.stringify(updated));
          return updated;
        }
        return prevYears;
      });
      return newMonth;
    });
  }, [selectedYear]);

  const handleNextMonth = useCallback(() => {
    setSelectedMonth(prevMonth => {
      let newMonth = prevMonth + 1;
      let newYear = selectedYear;
      if (newMonth > 11) {
        newMonth = 0;
        newYear = selectedYear + 1;
      }
      setSelectedYear(newYear);
      localStorage.setItem('uks_selected_month', String(newMonth));
      localStorage.setItem('uks_selected_year', String(newYear));
      
      setAvailableYears(prevYears => {
        if (!prevYears.includes(newYear)) {
          const updated = [...prevYears, newYear].sort((a, b) => b - a);
          localStorage.setItem('uks_available_years', JSON.stringify(updated));
          return updated;
        }
        return prevYears;
      });
      return newMonth;
    });
  }, [selectedYear]);

  const handleResetToToday = useCallback(() => {
    const today = new Date();
    const todayMonth = today.getMonth();
    const todayYear = today.getFullYear();
    setSelectedMonth(todayMonth);
    setSelectedYear(todayYear);
    localStorage.setItem('uks_selected_month', String(todayMonth));
    localStorage.setItem('uks_selected_year', String(todayYear));
  }, []);

  // Real-time subscription to Visits (for Admin/Officer) or Summary stats (for Guest) from Firestore
  useEffect(() => {
    const startTime = performance.now();
    setIsUpdating(true);
    
    const startOfMonthStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-01T00:00:00.000Z`;
    const lastDay = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    const endOfMonthStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`;

    const isGuest = !user;

    if (isGuest) {
      console.log(`[Dashboard Client] USER_TYPE: Guest (Publik)`);
      console.log(`- Nama Koleksi yang dibaca: summary`);
      console.log(`- Query: doc(db, "summary", "dashboard_stats_${selectedYear}_${selectedMonth}")`);

      const statsDocRef = doc(db, 'summary', `dashboard_stats_${selectedYear}_${selectedMonth}`);
      
      // Async fetch fallback to guarantee data existence even if pre-calculated summary is missing
      const triggerApiFallback = async () => {
        try {
          const response = await fetch(`/api/dashboard?year=${selectedYear}&month=${selectedMonth}`);
          const resData = await response.json();
          if (resData && resData.status && resData.stats) {
            console.log(`[Dashboard Client] Memuat statistik dari fallback API /api/dashboard berhasil untuk periode ${selectedYear}-${selectedMonth + 1}.`);
            setStats(resData.stats);
            if (resData.recentVisits) setRecentVisits(resData.recentVisits);
            if (resData.chartData) setChartData(resData.chartData);
            if (resData.diagnosisData) setDiagnosisData(resData.diagnosisData);
            setIsOfflineWarning(false);
            setHasError(false);
            setErrorMessage('');
            setIsLoading(false);
            setIsUpdating(false);
          }
        } catch (apiErr) {
          console.error(`[Dashboard Client] Gagal memuat data dari API fallback /api/dashboard:`, apiErr);
        }
      };

      triggerApiFallback();

      const unsubscribe = onSnapshot(statsDocRef, (docSnap) => {
        const queryTime = Math.round(performance.now() - startTime);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          console.log('--- FIRESTORE SUMMARY LOADED ---');
          console.log(`- User: Guest (Publik)`);
          console.log(`- Nama Koleksi yang dibaca: summary`);
          console.log(`- ID Dokumen: dashboard_stats_${selectedYear}_${selectedMonth}`);
          console.log(`- Jumlah Dokumen Ditemukan: 1`);
          console.log(`- Query Time: ${queryTime}ms`);

          // Update stats without replacing with 0 if data isn't missing
          if (data.stats) {
            setStats(data.stats);
          }
          if (data.recentVisits) {
            setRecentVisits(data.recentVisits);
          }
          if (data.chartData) {
            setChartData(data.chartData);
          }
          if (data.diagnosisData) {
            setDiagnosisData(data.diagnosisData);
          }
          
          setIsOfflineWarning(false);
          setHasError(false);
          setErrorMessage('');
          setIsLoading(false);
          setIsUpdating(false);
        } else {
          console.warn(`[Dashboard Client] Dokumen "summary/dashboard_stats_${selectedYear}_${selectedMonth}" tidak ditemukan di Firestore. Menggunakan API server untuk memicu auto-generation...`);
          console.log(`- User: Guest (Publik)`);
          console.log(`- Nama Koleksi yang dibaca: summary`);
          console.log(`- Jumlah Dokumen Ditemukan: 0`);
          
          // Trigger the API call to build/auto-save the document
          triggerApiFallback();
        }
      }, (err) => {
        console.error("Dashboard summary subscription failed:", err);
        console.error(`- User: Guest (Publik)`);
        console.error(`- Nama Koleksi: summary`);
        console.error(`- Jumlah Dokumen Ditemukan: 0`);
        console.error(`- Error Firebase: ${err.message || String(err)}`);
        
        // Non-fatal if we can fallback to the API
        triggerApiFallback();
      });

      return () => unsubscribe();
    } else {
      console.log(`[Dashboard Client] USER_TYPE: Terotentikasi (Admin/Officer)`);
      console.log(`- Nama Koleksi yang dibaca: visits`);
      console.log(`- Query: query(collection(db, "visits"), where("date", ">=", "${startOfMonthStr}"), where("date", "<=", "${endOfMonthStr}"), orderBy("date", "desc"))`);

      const q = query(
        collection(db, 'visits'),
        where('date', '>=', startOfMonthStr),
        where('date', '<=', endOfMonthStr),
        orderBy('date', 'desc')
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const queryTime = Math.round(performance.now() - startTime);
        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Visit));
        
        console.log('--- FIRESTORE VISIT LOADED ---');
        console.log(`- User: Terotentikasi (Admin/Officer)`);
        console.log(`- Nama Koleksi yang dibaca: visits`);
        console.log(`- Jumlah Dokumen Ditemukan: ${docs.length}`);
        console.log(`- Query Time: ${queryTime}ms`);
        
        setAllVisits(docs);
        setIsOfflineWarning(false);
        setHasError(false);
        setErrorMessage('');
        setIsLoading(false);
        setIsUpdating(false);
      }, (err) => {
        console.error("Dashboard visits subscription failed:", err);
        console.error(`- User: Terotentikasi (Admin/Officer)`);
        console.error(`- Nama Koleksi yang dibaca: visits`);
        console.error(`- Jumlah Dokumen Ditemukan: 0`);
        console.error(`- Error Firebase: ${err.message || String(err)}`);
        
        setIsOfflineWarning(true);
        setHasError(true);
        setIsLoading(false);
        setIsUpdating(false);
        setErrorMessage(err.message || String(err));
        handleFirestoreError(err, OperationType.GET, 'dashboard_visits');
      });
      
      return () => unsubscribe();
    }
  }, [user, selectedMonth, selectedYear]);

  // Real-time subscription to Medicines directly from Firestore (for Admin/Officer only)
  useEffect(() => {
    if (!user) return; // Guest doesn't need raw medicines

    const startTime = performance.now();
    console.log('[Dashboard Client] MEMULAI QUERY FIRESTORE MEDICINES REAL-TIME');
    console.log(`- User: Terotentikasi (Admin/Officer)`);
    console.log(`- Nama Koleksi yang dibaca: medicines`);
    
    const unsubscribe = onSnapshot(collection(db, 'medicines'), (snapshot) => {
      const queryTime = Math.round(performance.now() - startTime);
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      console.log('--- FIRESTORE MEDICINES LOADED ---');
      console.log(`- User: Terotentikasi (Admin/Officer)`);
      console.log(`- Nama Koleksi yang dibaca: medicines`);
      console.log(`- Jumlah Dokumen Ditemukan: ${docs.length}`);
      console.log(`- Query Time: ${queryTime}ms`);
      
      setAllMedicines(docs);
      setHasError(false);
      setErrorMessage('');
    }, (err) => {
      console.error("Dashboard medicines subscription failed:", err);
      console.error(`- User: Terotentikasi (Admin/Officer)`);
      console.error(`- Nama Koleksi yang dibaca: medicines`);
      console.error(`- Jumlah Dokumen Ditemukan: 0`);
      console.error(`- Error Firebase: ${err.message || String(err)}`);
      
      setHasError(true);
      setIsLoading(false);
      setErrorMessage(err.message || String(err));
      handleFirestoreError(err, OperationType.GET, 'dashboard_medicines');
    });
    
    return () => unsubscribe();
  }, [user]);

  // Reactive calculations of statistics directly from in-memory collections loaded from Firestore
  useEffect(() => {
    if (!user) {
      return; // Guest reads summary stats directly, no need to run raw calculation
    }
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

    const activeMonthLabel = getIndonesianMonthYear(new Date(selectedYear, selectedMonth, 1));

    // Filter and calculate metrics
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTodayStr = format(startOfToday, 'yyyy-MM-dd') + 'T00:00:00.000Z';

    const todayVisitsCount = allVisits.filter(v => v.date && v.date >= startOfTodayStr).length;
    const monthVisitsCount = allVisits.length;
    const uniqueStudentsCount = Array.from(new Set(allVisits.map(v => v.studentName || 'Siswa Anonim'))).length;

    const calculatedStats = {
      todayVisits: todayVisitsCount,
      monthVisits: monthVisitsCount,
      lowStock: lowStockCount,
      uniqueStudents: uniqueStudentsCount,
      activeMonthName: activeMonthLabel
    };

    setStats(calculatedStats);
    setRecentVisits(allVisits.slice(0, 5));

    // Prepare visit chart trend based on whether selected period is current month
    const isCurrentPeriod = selectedYear === now.getFullYear() && selectedMonth === now.getMonth();
    
    let trendData = [];
    if (isCurrentPeriod) {
      const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
      trendData = Array.from({ length: 7 }).map((_, i) => {
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
    } else {
      // Weekly trend for the selected month/year
      const weeks = [
        { name: 'W1 (1-7)', start: 1, end: 7 },
        { name: 'W2 (8-14)', start: 8, end: 14 },
        { name: 'W3 (15-21)', start: 15, end: 21 },
        { name: 'W4 (22-28)', start: 22, end: 28 },
        { name: 'W5 (29+)', start: 29, end: 31 }
      ];
      trendData = weeks.map(w => {
        const count = allVisits.filter(v => {
          if (!v.date) return false;
          try {
            const d = new Date(v.date);
            const day = d.getDate();
            return d.getFullYear() === selectedYear && d.getMonth() === selectedMonth && day >= w.start && day <= w.end;
          } catch (_) {
            return false;
          }
        }).length;

        return {
          name: w.name,
          count: count,
          dateLabel: `Minggu ${w.name.split(' ')[0].substring(1)}`
        };
      });
    }

    setChartData(trendData);

    // Prepare diagnosis distribution for active month
    const diagMap: Record<string, number> = {};
    allVisits.forEach(v => {
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
      chartData: trendData,
      diagnosisData: topDiagnoses,
      timestamp: Date.now()
    };
    localStorage.setItem('uks_dashboard_cache', JSON.stringify(cacheObj));

    // Update public summary in Firestore
    const updateStatsInFirestore = async () => {
      try {
        const statsDocRef = doc(db, 'summary', `dashboard_stats_${selectedYear}_${selectedMonth}`);
        const summaryData = {
          stats: calculatedStats,
          recentVisits: allVisits.slice(0, 5).map(v => {
            const nameParts = (v.studentName || 'Siswa Anonim').trim().split(/\s+/);
            const anonName = nameParts.map((part, idx) => idx === 0 ? part : `${part.charAt(0).toUpperCase()}.`).join(' ');
            return {
              id: v.id,
              studentName: anonName,
              date: v.date || '',
              grade: v.grade || '',
              complaint: v.complaint || '',
              diagnosis: v.diagnosis || '',
              gender: v.gender || ''
            };
          }),
          chartData: trendData,
          diagnosisData: topDiagnoses,
          updatedAt: Timestamp.now()
        };
        await setDoc(statsDocRef, summaryData);
        console.log(`[Dashboard Client] Berhasil menulis/memperbarui summary/dashboard_stats_${selectedYear}_${selectedMonth}`);
      } catch (err: any) {
        console.error(`[Dashboard Client] Gagal memperbarui summary/dashboard_stats_${selectedYear}_${selectedMonth}:`, err);
      }
    };
    updateStatsInFirestore();
  }, [allVisits, allMedicines, user, selectedMonth, selectedYear]);

  // Dedicated logging effect to ensure console logs print even if queries are loading, failing, or completed
  useEffect(() => {
    const startOfMonthStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-01T00:00:00.000Z`;
    const lastDay = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    const endOfMonthStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`;

    console.log('=== DASHBOARD PUBLIC ===');
    console.log('Collection: visits, medicines');
    console.log(`Document: ${allVisits && allVisits.length > 0 ? `visits[0].id: ${allVisits[0].id}` : 'None'}`);
    console.log('Query dijalankan: YA');
    console.log(`Rentang tanggal yang digunakan: ${startOfMonthStr} s/d ${endOfMonthStr}`);
    console.log(`Jumlah dokumen diterima: ${allVisits ? `visits: ${allVisits.length}` : 'visits: 0'}, ${allMedicines ? `medicines: ${allMedicines.length}` : 'medicines: 0'}`);
    console.log('Data yang diterima:', { visits: allVisits || [], medicines: allMedicines || [] });
    console.log(`Error Firebase: ${errorMessage || 'TIDAK ADA'}`);
    console.log(`Status Authentication: ${user ? 'Terotentikasi' : 'Guest (Publik)'}`);
    console.log(`UID: ${user?.uid || 'null'}`);
    console.log(`Role: ${user?.email === 'uksplus.scb@gmail.com' ? 'Admin' : (user ? 'Officer' : 'Guest')}`);
    console.log('========================');
  }, [allVisits, allMedicines, errorMessage, user, selectedMonth, selectedYear]);

  const COLORS = ['#0891b2', '#7c3aed', '#db2777', '#ea580c', '#059669'];

  const cards = [
    { label: 'Kunjungan Hari Ini', value: stats.todayVisits, icon: Activity, color: 'text-cyan-600', bg: 'bg-cyan-50', loading: isUpdating },
    { label: stats.activeMonthName ? `Kunjungan (${stats.activeMonthName})` : 'Kunjungan Bulan Ini', value: stats.monthVisits, icon: Users, color: 'text-emerald-600', bg: 'bg-emerald-50', loading: isUpdating },
    { label: stats.activeMonthName ? `Pasien Diperiksa (${stats.activeMonthName})` : 'Pasien Diperiksa (Bulan Ini)', value: stats.uniqueStudents, icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50', loading: isUpdating },
    { label: 'Obat Stok Menipis', value: stats.lowStock, icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', loading: false },
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

      {/* Period Filter Toolbar */}
      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
            <Calendar className="w-4 h-4 text-cyan-600" />
            Periode:
          </div>
          
          <select 
            value={selectedMonth} 
            onChange={(e) => handleMonthChange(parseInt(e.target.value, 10))}
            className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded px-3 py-2 cursor-pointer focus:outline-none focus:border-cyan-500"
          >
            {monthsList.map((m, idx) => (
              <option key={idx} value={idx}>{m}</option>
            ))}
          </select>

          <select 
            value={selectedYear} 
            onChange={(e) => handleYearChange(parseInt(e.target.value, 10))}
            className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded px-3 py-2 cursor-pointer focus:outline-none focus:border-cyan-500 notranslate"
            translate="no"
          >
            {availableYears.map(y => (
              <option key={y} value={y} className="notranslate" translate="no">{y}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePrevMonth}
            className="flex items-center gap-1 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-[11px] font-bold uppercase tracking-wider rounded border border-slate-200 cursor-pointer transition-colors"
            title="Bulan Sebelumnya"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Sebelumnya
          </button>

          <button
            onClick={handleResetToToday}
            className="flex items-center gap-1 px-3 py-2 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 text-[11px] font-bold uppercase tracking-wider rounded border border-cyan-100 cursor-pointer transition-colors"
            title="Kembali ke Bulan & Tahun Ini"
          >
            Hari Ini
          </button>

          <button
            onClick={handleNextMonth}
            className="flex items-center gap-1 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-[11px] font-bold uppercase tracking-wider rounded border border-slate-200 cursor-pointer transition-colors"
            title="Bulan Berikutnya"
          >
            Berikutnya
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {allVisits && allVisits.length === 0 && (
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-500 uppercase tracking-tight flex items-center gap-2 shadow-sm animate-pulse-subtle">
          <AlertCircle className="w-4 h-4 shrink-0 text-slate-400" />
          Tidak ada data pada periode yang dipilih.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card, i) => (
          <div key={i} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm hover:border-cyan-300 transition-colors group relative overflow-hidden">
            {card.loading && (
              <div className="absolute top-2 right-2 flex items-center justify-center">
                <Loader2 className="w-3 h-3 text-cyan-600 animate-spin" />
              </div>
            )}
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
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col relative overflow-hidden">
          {isUpdating && (
            <div className="absolute top-3 right-3 flex items-center justify-center">
              <Loader2 className="w-3.5 h-3.5 text-cyan-600 animate-spin" />
            </div>
          )}
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

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col relative overflow-hidden">
          {isUpdating && (
            <div className="absolute top-3 right-12 flex items-center justify-center">
              <Loader2 className="w-3.5 h-3.5 text-cyan-600 animate-spin" />
            </div>
          )}
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
              <p className="text-center text-slate-400 py-12 text-[10px] uppercase font-bold italic tracking-widest">Tidak ada data pada periode yang dipilih.</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col relative overflow-hidden">
          {isUpdating && (
            <div className="absolute top-3 right-3 flex items-center justify-center">
              <Loader2 className="w-3.5 h-3.5 text-cyan-600 animate-spin" />
            </div>
          )}
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
                 <p className="text-center text-slate-400 py-12 text-[10px] uppercase font-bold italic tracking-widest">Tidak ada data pada periode yang dipilih.</p>
               )}
            </div>
          </div>
      </div>
    </div>
  );
}
