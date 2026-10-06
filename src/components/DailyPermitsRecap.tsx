import React, { useState, useMemo, useRef } from 'react';
import { StudentPermit } from '../types';
import { format, subDays, isWithinInterval, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { id } from 'date-fns/locale';
import Papa from 'papaparse';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import {
  Calendar,
  CalendarDays,
  FileSpreadsheet,
  Printer,
  Search,
  Filter,
  TrendingUp,
  AlertCircle,
  Users,
  CheckCircle2,
  Clock,
  Car,
  Home,
  ChevronRight,
  ArrowUpDown,
  Download,
  Info,
  ExternalLink,
  X,
  Stethoscope,
  Activity,
  Layers,
  Sparkles
} from 'lucide-react';

interface DailyPermitsRecapProps {
  permits: StudentPermit[];
  onSelectDate: (date: string) => void;
  onNewPermit?: () => void;
}

interface DayGroup {
  date: string; // yyyy-MM-dd
  formattedDate: string;
  dayName: string;
  total: number;
  maleCount: number;
  femaleCount: number;
  waitingCount: number;
  transitCount: number;
  arrivedCount: number;
  students: StudentPermit[];
  complaintsSummary: { name: string; count: number }[];
  gradesSummary: { name: string; count: number }[];
}

const formatDateIndo = (dateStr?: string) => {
  if (!dateStr) return '-';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
      ];
      const year = parts[0];
      const monthIndex = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      if (monthIndex >= 0 && monthIndex < 12) {
        return `${day} ${months[monthIndex]} ${year}`;
      }
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return format(d, 'd MMMM yyyy', { locale: id });
    }
  } catch (e) {
    // fallback
  }
  return dateStr;
};

const getDayNameIndo = (dateStr?: string) => {
  if (!dateStr) return '';
  try {
    const d = parseISO(dateStr);
    if (!isNaN(d.getTime())) {
      return format(d, 'EEEE', { locale: id });
    }
  } catch (e) {
    // fallback
  }
  return '';
};

export default function DailyPermitsRecap({
  permits,
  onSelectDate,
  onNewPermit
}: DailyPermitsRecapProps) {
  // Filter States
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const currentMonthStr = format(new Date(), 'yyyy-MM');

  const [periodFilter, setPeriodFilter] = useState<'month' | 'last7' | 'last30' | 'custom' | 'all'>('month');
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [startDate, setStartDate] = useState<string>(format(subDays(new Date(), 29), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(todayStr);

  const [genderFilter, setGenderFilter] = useState<string>('all');
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  // Modal Detail Day State
  const [selectedDayGroup, setSelectedDayGroup] = useState<DayGroup | null>(null);
  
  // Print Modal State
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const printRecapRef = useRef<HTMLDivElement>(null);

  // Available grades list from permits
  const availableGrades = useMemo(() => {
    const set = new Set<string>();
    permits.forEach(p => {
      if (p.grade && p.grade.trim()) {
        set.add(p.grade.trim());
      }
    });
    return Array.from(set).sort();
  }, [permits]);

  // Filtered raw permits based on period & criteria
  const filteredPermits = useMemo(() => {
    return permits.filter(permit => {
      if (!permit.date) return false;

      // 1. Period filter
      if (periodFilter === 'month') {
        if (!permit.date.startsWith(selectedMonth)) return false;
      } else if (periodFilter === 'last7') {
        const pDate = permit.date;
        const sevenDaysAgo = format(subDays(new Date(), 6), 'yyyy-MM-dd');
        if (pDate < sevenDaysAgo || pDate > todayStr) return false;
      } else if (periodFilter === 'last30') {
        const pDate = permit.date;
        const thirtyDaysAgo = format(subDays(new Date(), 29), 'yyyy-MM-dd');
        if (pDate < thirtyDaysAgo || pDate > todayStr) return false;
      } else if (periodFilter === 'custom') {
        if (startDate && permit.date < startDate) return false;
        if (endDate && permit.date > endDate) return false;
      }

      // 2. Gender filter
      if (genderFilter !== 'all') {
        const g = permit.gender?.toLowerCase() || '';
        if (genderFilter === 'Laki-laki' && !g.startsWith('l')) return false;
        if (genderFilter === 'Perempuan' && !g.startsWith('p')) return false;
      }

      // 3. Grade filter
      if (gradeFilter !== 'all' && permit.grade !== gradeFilter) {
        return false;
      }

      // 4. Search keyword
      if (searchKeyword.trim()) {
        const q = searchKeyword.toLowerCase();
        const matchName = permit.studentName?.toLowerCase().includes(q);
        const matchGrade = permit.grade?.toLowerCase().includes(q);
        const matchComplaint = permit.complaint?.toLowerCase().includes(q);
        const matchNotes = permit.additionalNotes?.toLowerCase().includes(q);
        if (!matchName && !matchGrade && !matchComplaint && !matchNotes) {
          return false;
        }
      }

      return true;
    });
  }, [permits, periodFilter, selectedMonth, startDate, endDate, todayStr, genderFilter, gradeFilter, searchKeyword]);

  // Group permits by date
  const dailyGroups = useMemo<DayGroup[]>(() => {
    const map = new Map<string, StudentPermit[]>();

    filteredPermits.forEach(p => {
      const d = p.date;
      if (!map.has(d)) {
        map.set(d, []);
      }
      map.get(d)!.push(p);
    });

    const groups: DayGroup[] = [];

    map.forEach((items, dateStr) => {
      let maleCount = 0;
      let femaleCount = 0;
      let waitingCount = 0;
      let transitCount = 0;
      let arrivedCount = 0;

      const complaintMap = new Map<string, number>();
      const gradeMap = new Map<string, number>();

      items.forEach(item => {
        const g = item.gender?.toLowerCase() || '';
        if (g.startsWith('l')) maleCount++;
        else if (g.startsWith('p')) femaleCount++;

        if (item.status === 'Menunggu Penjemputan') waitingCount++;
        else if (item.status === 'Dalam Perjalanan') transitCount++;
        else if (item.status === 'Sampai di Rumah') arrivedCount++;

        if (item.complaint) {
          const comp = item.complaint.trim();
          complaintMap.set(comp, (complaintMap.get(comp) || 0) + 1);
        }

        if (item.grade) {
          const gr = item.grade.trim();
          gradeMap.set(gr, (gradeMap.get(gr) || 0) + 1);
        }
      });

      const complaintsSummary = Array.from(complaintMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      const gradesSummary = Array.from(gradeMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      groups.push({
        date: dateStr,
        formattedDate: formatDateIndo(dateStr),
        dayName: getDayNameIndo(dateStr),
        total: items.length,
        maleCount,
        femaleCount,
        waitingCount,
        transitCount,
        arrivedCount,
        students: items,
        complaintsSummary,
        gradesSummary
      });
    });

    // Sort by date
    groups.sort((a, b) => {
      if (sortOrder === 'desc') {
        return b.date.localeCompare(a.date);
      }
      return a.date.localeCompare(b.date);
    });

    return groups;
  }, [filteredPermits, sortOrder]);

  // Overall Statistics for KPI Cards
  const kpiStats = useMemo(() => {
    const totalPermits = filteredPermits.length;
    const activeDaysCount = dailyGroups.length;
    const avgPerActiveDay = activeDaysCount > 0 ? (totalPermits / activeDaysCount).toFixed(1) : '0';

    let maxPermits = 0;
    let peakDay: DayGroup | null = null;

    dailyGroups.forEach(grp => {
      if (grp.total > maxPermits) {
        maxPermits = grp.total;
        peakDay = grp;
      }
    });

    const todayGroup = dailyGroups.find(g => g.date === todayStr);
    const todayTotal = todayGroup ? todayGroup.total : permits.filter(p => p.date === todayStr).length;

    let totalMale = 0;
    let totalFemale = 0;
    let totalWaiting = 0;
    let totalTransit = 0;
    let totalArrived = 0;

    filteredPermits.forEach(p => {
      const g = p.gender?.toLowerCase() || '';
      if (g.startsWith('l')) totalMale++;
      else if (g.startsWith('p')) totalFemale++;

      if (p.status === 'Menunggu Penjemputan') totalWaiting++;
      else if (p.status === 'Dalam Perjalanan') totalTransit++;
      else if (p.status === 'Sampai di Rumah') totalArrived++;
    });

    return {
      totalPermits,
      activeDaysCount,
      avgPerActiveDay,
      peakDay,
      maxPermits,
      todayTotal,
      todayGroup,
      totalMale,
      totalFemale,
      totalWaiting,
      totalTransit,
      totalArrived
    };
  }, [filteredPermits, dailyGroups, todayStr, permits]);

  // Top Complaints overall
  const topComplaints = useMemo(() => {
    const countMap: Record<string, number> = {};
    filteredPermits.forEach(p => {
      if (p.complaint) {
        const c = p.complaint.trim();
        countMap[c] = (countMap[c] || 0) + 1;
      }
    });
    return Object.entries(countMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredPermits]);

  // Top Grades overall
  const topGrades = useMemo(() => {
    const countMap: Record<string, number> = {};
    filteredPermits.forEach(p => {
      if (p.grade) {
        const g = p.grade.trim();
        countMap[g] = (countMap[g] || 0) + 1;
      }
    });
    return Object.entries(countMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredPermits]);

  // Chart data sorted chronologically (ascending date)
  const chartData = useMemo(() => {
    const sorted = [...dailyGroups].sort((a, b) => a.date.localeCompare(b.date));
    return sorted.map(item => {
      const parts = item.date.split('-');
      const shortLabel = parts.length === 3 ? `${parts[2]}/${parts[1]}` : item.date;
      return {
        date: item.date,
        label: shortLabel,
        fullDate: item.formattedDate,
        dayName: item.dayName,
        total: item.total,
        male: item.maleCount,
        female: item.femaleCount,
        isToday: item.date === todayStr
      };
    });
  }, [dailyGroups, todayStr]);

  // Export Daily Recap to CSV
  const handleExportCSV = () => {
    if (dailyGroups.length === 0) {
      alert('Tidak ada data rekap harian untuk diekspor.');
      return;
    }

    // 1. Data Rekap Harian (Summary per date)
    const exportRows: any[] = [];
    dailyGroups.forEach(grp => {
      exportRows.push({
        'Tanggal': grp.date,
        'Hari': grp.dayName,
        'Format Tanggal': grp.formattedDate,
        'Total Siswa Sakit': grp.total,
        'Laki-laki': grp.maleCount,
        'Perempuan': grp.femaleCount,
        'Menunggu Penjemputan': grp.waitingCount,
        'Dalam Perjalanan': grp.transitCount,
        'Sampai di Rumah': grp.arrivedCount,
        'Keluhan Terbanyak': grp.complaintsSummary.map(c => `${c.name} (${c.count})`).join(', '),
        'Daftar Siswa': grp.students.map(s => `${s.studentName} [${s.grade}]`).join('; ')
      });
    });

    const csvString = Papa.unparse(exportRows);
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Rekap_Harian_Izin_Sakit_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export Detailed Students CSV
  const handleExportDetailedCSV = () => {
    if (filteredPermits.length === 0) {
      alert('Tidak ada data siswa untuk diekspor.');
      return;
    }

    const exportRows = filteredPermits.map((p, idx) => ({
      'No': idx + 1,
      'Tanggal Izin': p.date,
      'Hari': getDayNameIndo(p.date),
      'Jam Keluar UKS': p.checkoutTime || '-',
      'Nama Siswa': p.studentName,
      'Kelas': p.grade,
      'Jenis Kelamin': p.gender,
      'Keluhan / Diagnosis': p.complaint,
      'Catatan / Rekomendasi': p.additionalNotes || '-',
      'Lama Istirahat (s.d)': p.returnDate || p.date,
      'Status Kepulangan': p.status,
      'Penjemput': p.penjemput || '-',
      'Wali Kelas': p.waliKelas || '-',
      'WA Wali': p.waWaliKelas || '-',
      'Pembina': p.pembina || '-',
      'WA Pembina': p.waPembina || '-',
      'Status WA': p.deliveryStatus || 'Belum Dikirim',
      'Waktu Kirim WA': p.deliveryTime || '-'
    }));

    const csvString = Papa.unparse(exportRows);
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Detail_Siswa_Izin_Sakit_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Trigger Print Recap
  const handlePrintRecap = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Sub-header & Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white rounded-xl shadow-md border border-slate-700">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-rose-500/20 text-rose-400 rounded-lg">
              <Activity className="w-4 h-4" />
            </span>
            <span className="text-[10px] uppercase font-bold tracking-wider text-rose-300 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-800/50">
              Analitik & Rekapitulasi
            </span>
          </div>
          <h2 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
            Rekap Harian Jumlah Perizinan Sakit
          </h2>
          <p className="text-xs text-slate-300">
            Monitoring rekapitulasi harian frekuensi siswa yang izin pulang karena sakit, sebaran gender, keluhan, dan status kepulangan.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap self-start md:self-auto">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2 px-3.5 rounded-lg transition-all shadow-sm cursor-pointer"
            title="Unduh rekap ringkasan harian dalam format CSV/Excel"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Ekspor Rekap Harian</span>
          </button>

          <button
            onClick={handleExportDetailedCSV}
            className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold py-2 px-3 rounded-lg transition-all border border-slate-600 cursor-pointer"
            title="Unduh seluruh data siswa yang izin pada periode ini"
          >
            <Download className="w-3.5 h-3.5 text-slate-300" />
            <span>Ekspor Detail Siswa</span>
          </button>

          <button
            onClick={() => setIsPrintModalOpen(true)}
            className="flex items-center gap-1.5 bg-slate-100 hover:bg-white text-slate-900 text-xs font-bold py-2 px-3.5 rounded-lg transition-all shadow-sm cursor-pointer"
            title="Cetak lembar laporan rekapitulasi harian resmi"
          >
            <Printer className="w-3.5 h-3.5 text-slate-700" />
            <span>Cetak Rekap</span>
          </button>
        </div>
      </div>

      {/* KPI Highlights Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Total Siswa Sakit */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Izin Periode</span>
            <Users className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-800">{kpiStats.totalPermits}</span>
            <span className="text-[11px] font-semibold text-slate-500">siswa</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            Tersebar di {kpiStats.activeDaysCount} hari aktif
          </p>
        </div>

        {/* Hari Ini */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600">Izin Hari Ini</span>
            <Calendar className="w-4 h-4 text-rose-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-rose-600">{kpiStats.todayTotal}</span>
            <span className="text-[11px] font-semibold text-slate-500">siswa</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span>{format(new Date(), 'dd MMMM yyyy', { locale: id })}</span>
          </div>
        </div>

        {/* Rata-rata per Hari */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Rata-rata Harian</span>
            <TrendingUp className="w-4 h-4 text-blue-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-blue-600">{kpiStats.avgPerActiveDay}</span>
            <span className="text-[11px] font-semibold text-slate-500">siswa/hari</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            Pada hari terdapat perizinan
          </p>
        </div>

        {/* Hari Tertinggi / Peak Day */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Puncak Izin (Peak)</span>
            <AlertCircle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-amber-600">{kpiStats.maxPermits}</span>
            <span className="text-[11px] font-semibold text-slate-500">siswa</span>
          </div>
          <p className="text-[10px] text-slate-500 mt-1 truncate" title={kpiStats.peakDay ? `${kpiStats.peakDay.dayName}, ${kpiStats.peakDay.formattedDate}` : '-'}>
            {kpiStats.peakDay ? `${kpiStats.peakDay.dayName}, ${kpiStats.peakDay.formattedDate}` : 'Belum ada data'}
          </p>
        </div>

        {/* Proporsi Gender */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs hover:shadow-sm transition-shadow col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sebaran Gender</span>
            <Users className="w-4 h-4 text-teal-500" />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs font-bold">
            <span className="text-blue-600 flex items-center gap-1">
              👨 {kpiStats.totalMale} <span className="text-[9px] text-slate-400">({kpiStats.totalPermits ? Math.round((kpiStats.totalMale / kpiStats.totalPermits) * 100) : 0}%)</span>
            </span>
            <span className="text-pink-600 flex items-center gap-1">
              👩 {kpiStats.totalFemale} <span className="text-[9px] text-slate-400">({kpiStats.totalPermits ? Math.round((kpiStats.totalFemale / kpiStats.totalPermits) * 100) : 0}%)</span>
            </span>
          </div>
          {/* Progress bar visual */}
          <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2.5 overflow-hidden flex">
            <div 
              className="bg-blue-500 h-full" 
              style={{ width: `${kpiStats.totalPermits ? (kpiStats.totalMale / kpiStats.totalPermits) * 100 : 50}%` }} 
            />
            <div 
              className="bg-pink-500 h-full" 
              style={{ width: `${kpiStats.totalPermits ? (kpiStats.totalFemale / kpiStats.totalPermits) * 100 : 50}%` }} 
            />
          </div>
        </div>
      </div>

      {/* Control Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          {/* Period Mode Selector */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Periode:</span>
            
            <button
              onClick={() => setPeriodFilter('month')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                periodFilter === 'month'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Bulan
            </button>

            <button
              onClick={() => setPeriodFilter('last7')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                periodFilter === 'last7'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              7 Hari Terakhir
            </button>

            <button
              onClick={() => setPeriodFilter('last30')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                periodFilter === 'last30'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              30 Hari Terakhir
            </button>

            <button
              onClick={() => setPeriodFilter('custom')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                periodFilter === 'custom'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Rentang Tanggal
            </button>

            <button
              onClick={() => setPeriodFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                periodFilter === 'all'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Semua Waktu
            </button>
          </div>

          {/* Search box */}
          <div className="relative w-full lg:w-72">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Cari nama, keluhan, kelas..."
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-indigo-500 bg-slate-50/50"
            />
            {searchKeyword && (
              <button
                onClick={() => setSearchKeyword('')}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Secondary Filters row */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-3 text-xs">
          {/* Specific Month Picker */}
          {periodFilter === 'month' && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Pilih Bulan:</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="p-1 px-2 border border-slate-200 rounded text-xs bg-white text-slate-700 font-semibold focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}

          {/* Custom Date Range Picker */}
          {periodFilter === 'custom' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Dari:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="p-1 px-2 border border-slate-200 rounded text-xs bg-white text-slate-700 focus:outline-none focus:border-indigo-500"
              />
              <span className="text-[10px] font-bold text-slate-500 uppercase">s.d:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="p-1 px-2 border border-slate-200 rounded text-xs bg-white text-slate-700 focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}

          {/* Gender Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase">Gender:</span>
            <select
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value)}
              className="p-1 px-2 border border-slate-200 rounded text-xs bg-white text-slate-700 focus:outline-none focus:border-indigo-500"
            >
              <option value="all">Semua Gender</option>
              <option value="Laki-laki">Laki-laki (L)</option>
              <option value="Perempuan">Perempuan (P)</option>
            </select>
          </div>

          {/* Grade Filter */}
          {availableGrades.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Kelas:</span>
              <select
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
                className="p-1 px-2 border border-slate-200 rounded text-xs bg-white text-slate-700 focus:outline-none focus:border-indigo-500"
              >
                <option value="all">Semua Kelas</option>
                {availableGrades.map(gr => (
                  <option key={gr} value={gr}>{gr}</option>
                ))}
              </select>
            </div>
          )}

          {/* Sort Order */}
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
              className="flex items-center gap-1 text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded transition-colors"
            >
              <ArrowUpDown className="w-3 h-3" />
              <span>{sortOrder === 'desc' ? 'Terbaru Dahulu' : 'Terlama Dahulu'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Visual Bar Chart of Daily Sick Permits */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-indigo-600" />
              <span>Grafik Tren Fluktuasi Perizinan Sakit Harian</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Grafik batang menunjukkan banyaknya siswa yang diizinkan pulang sakit pada setiap tanggal.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-slate-500 font-semibold">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 bg-rose-500 rounded-2xs inline-block" />
              <span>Hari Ini</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 bg-indigo-500 rounded-2xs inline-block" />
              <span>Hari Lainnya</span>
            </span>
          </div>
        </div>

        {chartData.length > 0 ? (
          <div className="w-full h-64 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="label" 
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  angle={-30}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis 
                  tick={{ fontSize: 10, fill: '#64748b' }} 
                  allowDecimals={false}
                />
                <RechartsTooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 text-white p-3 rounded-lg shadow-xl text-xs space-y-1 z-50 border border-slate-800">
                          <p className="font-bold text-rose-300">{data.dayName}, {data.fullDate}</p>
                          <div className="pt-1 border-t border-slate-700 space-y-0.5">
                            <p className="text-white font-extrabold flex justify-between gap-4">
                              <span>Total Izin Sakit:</span>
                              <span className="text-rose-400">{data.total} Siswa</span>
                            </p>
                            <p className="text-slate-300 text-[11px] flex justify-between gap-4">
                              <span>Laki-laki / Perempuan:</span>
                              <span>{data.male} L / {data.female} P</span>
                            </p>
                            {data.isToday && (
                              <p className="text-[10px] text-amber-300 font-bold mt-1">★ Rekap Hari Ini</p>
                            )}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {chartData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.isToday ? '#e11d48' : '#6366f1'} 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="py-12 text-center text-slate-400 text-xs">
            Tidak ada data perizinan pada periode ini untuk ditampilkan di grafik.
          </div>
        )}
      </div>

      {/* 2-Column Mini Insights (Top Complaints & Top Grades) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top Diagnosa / Keluhan */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Stethoscope className="w-4 h-4 text-rose-500" />
              <span>Keluhan Sakit Paling Sering</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">Top 5 Kasus</span>
          </div>

          {topComplaints.length > 0 ? (
            <div className="space-y-2.5">
              {topComplaints.map((item, idx) => {
                const percent = kpiStats.totalPermits ? Math.round((item.count / kpiStats.totalPermits) * 100) : 0;
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-slate-700 font-semibold">{item.name}</span>
                      <span className="text-slate-500 font-mono">{item.count} siswa ({percent}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className="bg-rose-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400 py-3 text-center">Belum ada keluhan tercatat.</p>
          )}
        </div>

        {/* Top Kelas Terbanyak Izin */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-indigo-500" />
              <span>Kelas Dengan Izin Sakit Terbanyak</span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono">Top 5 Kelas</span>
          </div>

          {topGrades.length > 0 ? (
            <div className="space-y-2.5">
              {topGrades.map((item, idx) => {
                const percent = kpiStats.totalPermits ? Math.round((item.count / kpiStats.totalPermits) * 100) : 0;
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-slate-700 font-semibold">{item.name}</span>
                      <span className="text-slate-500 font-mono">{item.count} siswa ({percent}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400 py-3 text-center">Belum ada data kelas tercatat.</p>
          )}
        </div>
      </div>

      {/* Main Table: Rekap Harian Jumlah Perizinan Sakit */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-indigo-600" />
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Tabel Rincian Rekap Harian Perizinan Sakit
              </h3>
              <p className="text-[11px] text-slate-500">
                Daftar ringkasan tanggal per tanggal dengan jumlah siswa, gender, status penjemputan, dan daftar pasien.
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-slate-600 bg-white px-3 py-1 rounded-md border border-slate-200 self-start sm:self-auto">
            {dailyGroups.length} Hari Aktif Tercatat
          </span>
        </div>

        {dailyGroups.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-slate-300 mx-auto" />
            <h4 className="text-sm font-bold text-slate-700">Tidak ada rekap perizinan pada periode ini</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Cobalah ubah filter periode waktu atau tambahkan surat izin pulang sakit baru jika ada siswa yang dipulangkan.
            </p>
            {onNewPermit && (
              <button
                onClick={onNewPermit}
                className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 bg-rose-600 text-white rounded-lg text-xs font-bold hover:bg-rose-700 transition-colors"
              >
                Buat Surat Izin Sakit
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100/70 border-b border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4 w-12 text-center">No</th>
                  <th className="py-3 px-4">Hari & Tanggal</th>
                  <th className="py-3 px-4 text-center">Jumlah Izin</th>
                  <th className="py-3 px-4 text-center">Sebaran Gender</th>
                  <th className="py-3 px-4">Status Kepulangan</th>
                  <th className="py-3 px-4">Siswa & Keluhan Terbanyak</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {dailyGroups.map((group, index) => {
                  const isToday = group.date === todayStr;
                  return (
                    <tr 
                      key={group.date}
                      className={`hover:bg-indigo-50/40 transition-colors ${
                        isToday ? 'bg-rose-50/30' : ''
                      }`}
                    >
                      {/* No */}
                      <td className="py-3.5 px-4 text-center font-mono text-slate-400 text-[11px]">
                        {index + 1}
                      </td>

                      {/* Tanggal & Hari */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800">
                                {group.dayName}, {group.formattedDate}
                              </span>
                              {isToday && (
                                <span className="text-[9px] bg-rose-600 text-white font-extrabold px-1.5 py-0.5 rounded uppercase tracking-wider">
                                  HARI INI
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {group.date}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Jumlah Izin (Badge) */}
                      <td className="py-3.5 px-4 text-center">
                        <span className={`inline-flex items-center justify-center min-w-[36px] px-2 py-1 rounded-full text-xs font-black shadow-2xs ${
                          group.total >= 5 
                            ? 'bg-rose-600 text-white'
                            : group.total >= 3
                            ? 'bg-amber-500 text-white'
                            : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                        }`}>
                          {group.total} Siswa
                        </span>
                      </td>

                      {/* Sebaran Gender */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="inline-flex items-center gap-1.5 text-[11px] font-bold">
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                            {group.maleCount} L
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-pink-50 text-pink-700 border border-pink-200">
                            {group.femaleCount} P
                          </span>
                        </div>
                      </td>

                      {/* Status Kepulangan */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap items-center gap-1 text-[10px]">
                          {group.waitingCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium border border-amber-200 flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" />
                              <span>{group.waitingCount} Menunggu</span>
                            </span>
                          )}
                          {group.transitCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium border border-blue-200 flex items-center gap-1">
                              <Car className="w-2.5 h-2.5" />
                              <span>{group.transitCount} Otw</span>
                            </span>
                          )}
                          {group.arrivedCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium border border-emerald-200 flex items-center gap-1">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              <span>{group.arrivedCount} Sampai</span>
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Siswa & Keluhan */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="space-y-1">
                          {/* Student chips */}
                          <div className="flex flex-wrap gap-1">
                            {group.students.slice(0, 3).map((st, i) => (
                              <span 
                                key={i} 
                                className="inline-block bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0.5 rounded font-medium truncate max-w-[140px]"
                                title={`${st.studentName} (${st.grade}) - ${st.complaint}`}
                              >
                                {st.studentName} <span className="text-slate-400">({st.grade})</span>
                              </span>
                            ))}
                            {group.students.length > 3 && (
                              <span className="text-[9px] text-slate-400 font-bold self-center">
                                +{group.students.length - 3} lainnya
                              </span>
                            )}
                          </div>

                          {/* Complaints mini summary */}
                          {group.complaintsSummary.length > 0 && (
                            <p className="text-[10px] text-slate-500 truncate" title={group.complaintsSummary.map(c => `${c.name} (${c.count})`).join(', ')}>
                              <span className="font-semibold text-slate-600">Gejala: </span>
                              {group.complaintsSummary.slice(0, 2).map(c => `${c.name} (${c.count})`).join(', ')}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Aksi */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => setSelectedDayGroup(group)}
                            className="p-1 px-2.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 border border-slate-200 rounded text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center gap-1"
                            title="Buka rincian lengkap seluruh siswa yang izin pada hari ini"
                          >
                            <Info className="w-3 h-3" />
                            <span>Detail</span>
                          </button>

                          <button
                            onClick={() => onSelectDate(group.date)}
                            className="p-1 px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[10px] font-bold uppercase transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                            title="Buka daftar perizinan yang disaring khusus tanggal ini"
                          >
                            <span>Daftar Izin</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Detail Day */}
      {selectedDayGroup && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden border border-slate-200 flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide">
                    Rincian Rekap Izin Sakit: {selectedDayGroup.dayName}, {selectedDayGroup.formattedDate}
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Total {selectedDayGroup.total} siswa izin pulang sakit jasmani
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedDayGroup(null)}
                className="text-slate-400 hover:text-white transition-colors bg-transparent border-none cursor-pointer p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content: Summary badges & Table of students */}
            <div className="p-5 overflow-y-auto space-y-4">
              {/* Day KPI Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Total Siswa</span>
                  <p className="text-lg font-black text-slate-800">{selectedDayGroup.total} Siswa</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Gender</span>
                  <p className="text-sm font-bold text-slate-700">
                    {selectedDayGroup.maleCount} Laki-laki / {selectedDayGroup.femaleCount} Perempuan
                  </p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Status</span>
                  <p className="text-[11px] font-semibold text-slate-700">
                    {selectedDayGroup.arrivedCount} Sampai • {selectedDayGroup.transitCount} Otw • {selectedDayGroup.waitingCount} Menunggu
                  </p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Aksi Cepat</span>
                  <button
                    onClick={() => {
                      onSelectDate(selectedDayGroup.date);
                      setSelectedDayGroup(null);
                    }}
                    className="mt-0.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
                  >
                    <span>Buka di Tab Daftar Izin</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Students Table */}
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-[10px] font-black uppercase text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 w-8 text-center">No</th>
                      <th className="py-2.5 px-3">Nama Siswa</th>
                      <th className="py-2.5 px-3">Kelas & Gender</th>
                      <th className="py-2.5 px-3">Jam Keluar</th>
                      <th className="py-2.5 px-3">Keluhan / Diagnosis</th>
                      <th className="py-2.5 px-3">Status Kepulangan</th>
                      <th className="py-2.5 px-3">Penjemput</th>
                      <th className="py-2.5 px-3 text-center">Status WA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedDayGroup.students.map((st, i) => (
                      <tr key={st.id || i} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 text-center font-mono text-slate-400">{i + 1}</td>
                        <td className="py-2.5 px-3 font-bold text-slate-800">{st.studentName}</td>
                        <td className="py-2.5 px-3">
                          <span className="font-semibold text-slate-700">{st.grade}</span>
                          <span className="text-[10px] text-slate-400 block">{st.gender}</span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">{st.checkoutTime || '-'} WIB</td>
                        <td className="py-2.5 px-3">
                          <span className="font-medium text-rose-700">{st.complaint}</span>
                          {st.additionalNotes && (
                            <span className="text-[10px] text-slate-500 block">{st.additionalNotes}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            st.status === 'Sampai di Rumah'
                              ? 'bg-emerald-100 text-emerald-800'
                              : st.status === 'Dalam Perjalanan'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {st.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">{st.penjemput || '-'}</td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            st.deliveryStatus === 'Berhasil'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : st.deliveryStatus === 'Gagal'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-slate-50 text-slate-500 border border-slate-200'
                          }`}>
                            {st.deliveryStatus || 'Belum'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-50 p-3 px-5 border-t border-slate-200 flex justify-between items-center">
              <span className="text-[11px] text-slate-500">
                UKS Sekolah Cendekia BAZNAS
              </span>
              <button
                onClick={() => setSelectedDayGroup(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                Tutup Rincian
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Modal Laporan Rekapitulasi */}
      {isPrintModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <style>{`
            @media print {
              body * {
                visibility: hidden !important;
              }
              #printable-rekap-harian, #printable-rekap-harian * {
                visibility: visible !important;
              }
              #printable-rekap-harian {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                padding: 1.5rem !important;
                border: none !important;
                box-shadow: none !important;
                background: white !important;
              }
            }
          `}</style>

          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden border border-slate-200 flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-indigo-400" />
                <h3 className="text-xs font-black uppercase tracking-wider">
                  Cetak Lembar Rekap Harian Perizinan Sakit UKS
                </h3>
              </div>
              <button
                onClick={() => setIsPrintModalOpen(false)}
                className="text-slate-400 hover:text-white transition-colors bg-transparent border-none cursor-pointer p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Print Preview Canvas */}
            <div className="p-6 overflow-y-auto bg-slate-100 flex justify-center">
              <div
                id="printable-rekap-harian"
                ref={printRecapRef}
                className="w-full bg-white border border-slate-300 p-8 text-slate-900 font-sans shadow-sm rounded-sm"
                style={{ maxWidth: '800px' }}
              >
                {/* Kop Surat Resmi */}
                <div className="flex items-center justify-between border-b-2 border-black pb-3 mb-4">
                  <div className="w-16 h-16 flex-shrink-0 flex items-center justify-center">
                    <svg viewBox="0 0 100 100" className="w-14 h-14 text-emerald-800">
                      <polygon points="50,90 10,10 90,10" fill="none" stroke="currentColor" strokeWidth="6" />
                      <circle cx="50" cy="46" r="26" fill="none" stroke="currentColor" strokeWidth="3" />
                      <text x="50" y="37" fontFamily="sans-serif" fontWeight="bold" fontSize="18" textAnchor="middle" fill="currentColor">U</text>
                      <text x="36" y="58" fontFamily="sans-serif" fontWeight="bold" fontSize="16" textAnchor="middle" fill="currentColor">K</text>
                      <text x="64" y="58" fontFamily="sans-serif" fontWeight="bold" fontSize="16" textAnchor="middle" fill="currentColor">S</text>
                    </svg>
                  </div>
                  <div className="text-center flex-1 mx-2">
                    <h2 className="text-xs tracking-widest font-extrabold uppercase text-slate-700">Laporan Rekapitulasi Harian</h2>
                    <h1 className="text-base font-black uppercase tracking-wide text-emerald-800">Perizinan Pulang Sakit Siswa</h1>
                    <h3 className="text-sm font-bold text-slate-800">UKS SEKOLAH CENDEKIA BAZNAS</h3>
                    <p className="text-[9px] text-slate-500 font-medium">Jl KH Umar Kp Cirangkong No. 14, Cemplang, Kec. Cibungbulang, Bogor</p>
                  </div>
                  <div className="w-16 h-16 flex-shrink-0" />
                </div>

                {/* Info Periode */}
                <div className="text-xs text-slate-700 mb-4 flex justify-between items-center border-b border-slate-200 pb-2">
                  <div>
                    <span className="font-bold">Periode: </span>
                    <span>
                      {periodFilter === 'month' 
                        ? `Bulan ${selectedMonth}` 
                        : periodFilter === 'last7'
                        ? '7 Hari Terakhir'
                        : periodFilter === 'last30'
                        ? '30 Hari Terakhir'
                        : periodFilter === 'custom'
                        ? `${formatDateIndo(startDate)} s.d ${formatDateIndo(endDate)}`
                        : 'Semua Data'}
                    </span>
                  </div>
                  <div>
                    <span className="font-bold">Tanggal Cetak: </span>
                    <span>{format(new Date(), 'dd MMMM yyyy HH:mm', { locale: id })} WIB</span>
                  </div>
                </div>

                {/* KPI Summary Ringkas */}
                <div className="grid grid-cols-4 gap-2 mb-4 text-center">
                  <div className="border border-slate-200 p-2 rounded">
                    <p className="text-[9px] text-slate-500 uppercase font-bold">Total Izin</p>
                    <p className="text-base font-black text-slate-800">{kpiStats.totalPermits}</p>
                  </div>
                  <div className="border border-slate-200 p-2 rounded">
                    <p className="text-[9px] text-slate-500 uppercase font-bold">Hari Aktif</p>
                    <p className="text-base font-black text-slate-800">{kpiStats.activeDaysCount}</p>
                  </div>
                  <div className="border border-slate-200 p-2 rounded">
                    <p className="text-[9px] text-slate-500 uppercase font-bold">Rata-rata/Hari</p>
                    <p className="text-base font-black text-slate-800">{kpiStats.avgPerActiveDay}</p>
                  </div>
                  <div className="border border-slate-200 p-2 rounded">
                    <p className="text-[9px] text-slate-500 uppercase font-bold">Laki / Perempuan</p>
                    <p className="text-base font-black text-slate-800">{kpiStats.totalMale} / {kpiStats.totalFemale}</p>
                  </div>
                </div>

                {/* Tabel Rekap Harian */}
                <table className="w-full text-left text-[11px] border border-slate-300 border-collapse mb-6">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300 font-bold text-slate-700">
                      <th className="p-2 border-r border-slate-300 text-center w-8">No</th>
                      <th className="p-2 border-r border-slate-300">Hari & Tanggal</th>
                      <th className="p-2 border-r border-slate-300 text-center w-24">Jumlah Izin</th>
                      <th className="p-2 border-r border-slate-300 text-center w-24">Gender (L/P)</th>
                      <th className="p-2 border-r border-slate-300">Status Kepulangan</th>
                      <th className="p-2">Daftar Siswa & Keluhan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyGroups.map((g, i) => (
                      <tr key={g.date} className="border-b border-slate-200">
                        <td className="p-1.5 border-r border-slate-200 text-center">{i + 1}</td>
                        <td className="p-1.5 border-r border-slate-200 font-semibold">
                          {g.dayName}, {g.formattedDate}
                        </td>
                        <td className="p-1.5 border-r border-slate-200 text-center font-bold">
                          {g.total} Siswa
                        </td>
                        <td className="p-1.5 border-r border-slate-200 text-center font-semibold">
                          {g.maleCount} L / {g.femaleCount} P
                        </td>
                        <td className="p-1.5 border-r border-slate-200 text-[10px]">
                          {g.arrivedCount} Sampai, {g.transitCount} Otw, {g.waitingCount} Menunggu
                        </td>
                        <td className="p-1.5 text-[10px]">
                          {g.students.map(s => `${s.studentName} (${s.grade} - ${s.complaint})`).join('; ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Tanda Tangan */}
                <div className="mt-8 flex justify-between text-xs text-center">
                  <div className="w-48">
                    <p>Mengetahui,</p>
                    <p className="font-bold">Kepala Ruang UKS</p>
                    <div className="h-16" />
                    <p className="border-b border-black font-semibold">( ............................................ )</p>
                  </div>
                  <div className="w-48">
                    <p>Bogor, {format(new Date(), 'dd MMMM yyyy', { locale: id })}</p>
                    <p className="font-bold">Petugas Jaga UKS</p>
                    <div className="h-16" />
                    <p className="border-b border-black font-semibold">( ............................................ )</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Print Footer */}
            <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setIsPrintModalOpen(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={handlePrintRecap}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
              >
                <Printer className="w-4 h-4" />
                <span>Cetak Sekarang (Print)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
