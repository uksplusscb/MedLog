import { useEffect, useState } from 'react';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  Timestamp,
  orderBy
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Visit } from '../types';
import { startOfMonth, endOfMonth, format, parseISO } from 'date-fns';
import { id } from 'date-fns/locale';
import { 
  Download, 
  FileText, 
  Activity, 
  ChevronDown, 
  PieChart as PieIcon,
  Filter,
  FileSpreadsheet,
  Loader2
} from 'lucide-react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Legend, 
  Tooltip 
} from 'recharts';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface DailyStats {
  date: string;
  total: number;
  male: number;
  female: number;
  under12: number;
}

export default function Reports() {
  const [loading, setLoading] = useState(false);
  const [reportMonth, setReportMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [reportData, setReportData] = useState<{
    visits: Visit[];
    diagnosisCounts: Record<string, number>;
    dailyStats: DailyStats[];
    totalFemale: number;
    totalMale: number;
  }>({
    visits: [],
    diagnosisCounts: {},
    dailyStats: [],
    totalFemale: 0,
    totalMale: 0
  });

  const generateReport = async () => {
    setLoading(true);
    try {
      const targetDate = new Date(reportMonth);
      const start = startOfMonth(targetDate);
      const end = endOfMonth(targetDate);

      const startStr = format(start, 'yyyy-MM-dd') + 'T00:00:00.000Z';
      const endStr = format(end, 'yyyy-MM-dd') + 'T23:59:59.999Z';

      const q = query(
        collection(db, 'visits'),
        where('date', '>=', startStr),
        where('date', '<=', endStr),
        orderBy('date', 'asc')
      );

      const snap = await getDocs(q);
      const visits = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Visit));

      const diagnosisCounts: Record<string, number> = {};
      const dailyMap: Record<string, DailyStats> = {};
      let females = 0;
      let males = 0;

      visits.forEach(v => {
        const diag = v.diagnosis || 'Tanpa Diagnosa';
        diagnosisCounts[diag] = (diagnosisCounts[diag] || 0) + 1;
        
        const dateStr = format(parseISO(v.date), 'yyyy-MM-dd');
        if (!dailyMap[dateStr]) {
          dailyMap[dateStr] = {
            date: dateStr,
            total: 0,
            male: 0,
            female: 0,
            under12: 0
          };
        }
        
        dailyMap[dateStr].total++;
        if (v.gender === 'Perempuan') {
          dailyMap[dateStr].female++;
          females++;
        } else {
          dailyMap[dateStr].male++;
          males++;
        }
        
        if (v.age <= 12) {
          dailyMap[dateStr].under12++;
        }
      });

      setReportData({
        visits,
        diagnosisCounts,
        dailyStats: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
        totalFemale: females,
        totalMale: males
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    generateReport();
  }, [reportMonth]);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
  
  const pieData = Object.entries(reportData.diagnosisCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, 5);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    
    // Sheet 1: Rekap Diagnosa
    const diagData = Object.entries(reportData.diagnosisCounts).map(([name, count]) => ({
      'Diagnosa': name,
      'Jumlah': count
    }));
    const diagSheet = XLSX.utils.json_to_sheet(diagData);
    XLSX.utils.book_append_sheet(wb, diagSheet, 'Rekap Diagnosa');
    
    // Sheet 2: Rekap Harian
    const dailyData = reportData.dailyStats.map(s => ({
      'Tanggal': s.date,
      'Total Pasien': s.total,
      'Laki-laki': s.male,
      'Perempuan': s.female,
      'Pasien ≤ 12 Thn': s.under12
    }));
    const dailySheet = XLSX.utils.json_to_sheet(dailyData);
    XLSX.utils.book_append_sheet(wb, dailySheet, 'Rekap Harian');
    
    XLSX.writeFile(wb, `Laporan_UKS_${reportMonth}.xlsx`);
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    const monthName = format(new Date(reportMonth), 'MMMM yyyy', { locale: id });
    
    doc.setFontSize(16);
    doc.text('LAPORAN BULANAN UKS', 105, 15, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`Periode: ${monthName}`, 105, 22, { align: 'center' });
    
    doc.text('1. REKAP DIAGNOSA', 14, 35);
    autoTable(doc, {
      startY: 40,
      head: [['No', 'Diagnosa', 'Jumlah']],
      body: Object.entries(reportData.diagnosisCounts).map(([name, count], i) => [i + 1, name, count]),
      theme: 'grid',
      headStyles: { fillColor: [59, 130, 246] }
    });
    
    const finalY = (doc as any).lastAutoTable.finalY || 40;
    doc.addPage();
    doc.text('2. REKAP KUNJUNGAN HARIAN', 14, 20);
    autoTable(doc, {
      startY: 25,
      head: [['No', 'Tanggal', 'Total', 'Laki-laki', 'Perempuan', '≤ 12 Tahun']],
      body: reportData.dailyStats.map((s, i) => [
        i + 1,
        format(parseISO(s.date), 'dd/MM/yyyy'),
        s.total,
        s.male,
        s.female,
        s.under12
      ]),
      theme: 'grid',
      headStyles: { fillColor: [59, 130, 246] }
    });
    
    doc.save(`Laporan_UKS_${reportMonth}.pdf`);
  };

  return (
    <div className="space-y-6 print:p-0">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-lg border border-slate-200 shadow-sm print:hidden">
        <div className="flex items-center gap-4">
          <div className="h-8 w-1 bg-blue-600 rounded-full" />
          <h2 className="text-sm font-bold text-slate-800 tracking-tight uppercase">Sistem Laporan UKS</h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input 
              type="month" 
              value={reportMonth}
              onChange={(e) => setReportMonth(e.target.value)}
              className="pl-9 pr-4 py-1.5 border border-slate-200 rounded outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-bold uppercase transition-all bg-slate-50"
            />
          </div>
          <button 
            onClick={exportExcel}
            className="bg-emerald-600 text-white px-4 py-1.5 rounded flex items-center gap-2 text-[10px] font-bold shadow-sm uppercase tracking-widest hover:bg-emerald-700 transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Excel
          </button>
          <button 
            onClick={exportPDF}
            className="bg-slate-900 text-white px-4 py-1.5 rounded flex items-center gap-2 text-[10px] font-bold shadow-sm uppercase tracking-widest hover:bg-slate-800 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white p-20 rounded-lg border border-slate-200 shadow-sm flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Processing_Report_Data...</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Total_Visits</p>
              <p className="text-2xl font-black text-slate-900 font-mono">{reportData.visits.length}</p>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-widest text-blue-500 mb-1">Male_Count</p>
              <p className="text-2xl font-black text-blue-600 font-mono">{reportData.totalMale}</p>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-widest text-rose-500 mb-1">Female_Count</p>
              <p className="text-2xl font-black text-rose-600 font-mono">{reportData.totalFemale}</p>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-widest text-amber-500 mb-1">Age_Under_12</p>
              <p className="text-2xl font-black text-amber-600 font-mono">
                {reportData.dailyStats.reduce((acc, curr) => acc + curr.under12, 0)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="text-[11px] font-black uppercase tracking-tight text-slate-900">1. Rekap Diagnosa</h3>
              </div>
              <div className="max-h-[400px] overflow-y-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-50/50 sticky top-0 border-b border-slate-100">
                    <tr>
                      <th className="px-4 py-2 font-bold uppercase text-[9px] text-slate-400">Diagnosa</th>
                      <th className="px-4 py-2 font-bold uppercase text-[9px] text-slate-400 text-right">Jumlah</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {Object.entries(reportData.diagnosisCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([name, count]) => (
                      <tr key={name} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-bold text-slate-700">{name}</td>
                        <td className="px-4 py-3 text-right font-mono font-black text-blue-600">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="text-[11px] font-black uppercase tracking-tight text-slate-900">2. Rekap Kunjungan Harian</h3>
              </div>
              <div className="max-h-[400px] overflow-y-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-50/50 sticky top-0 border-b border-slate-100">
                    <tr>
                      <th className="px-4 py-2 font-bold uppercase text-[9px] text-slate-400">Tanggal</th>
                      <th className="px-4 py-2 font-bold uppercase text-[9px] text-slate-400 text-center">Total</th>
                      <th className="px-4 py-2 font-bold uppercase text-[9px] text-slate-400 text-center">L/P</th>
                      <th className="px-4 py-2 font-bold uppercase text-[9px] text-slate-400 text-center">≤12th</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {reportData.dailyStats.map((s) => (
                      <tr key={s.date} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-mono text-slate-500">{format(parseISO(s.date), 'dd/MM/yy')}</td>
                        <td className="px-4 py-3 text-center font-bold text-slate-900">{s.total}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-blue-600 font-bold">{s.male}</span>
                          <span className="text-slate-300 mx-1">/</span>
                          <span className="text-rose-600 font-bold">{s.female}</span>
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold text-amber-600">{s.under12}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
