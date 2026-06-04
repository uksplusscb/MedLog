import { useEffect, useState } from 'react';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  Timestamp,
  orderBy,
  collectionGroup,
  updateDoc,
  doc
} from 'firebase/firestore';
import { db, runWithRetry, handleFirestoreError, OperationType } from '../lib/firebase';
import { Visit } from '../types';
import { startOfMonth, endOfMonth, format, parseISO } from 'date-fns';
import { id } from 'date-fns/locale';
import { cn } from '../lib/utils';
import MedicineReports from './MedicineReports';
import { 
  Download, 
  FileText, 
  Activity, 
  ChevronDown, 
  PieChart as PieIcon,
  Filter,
  FileSpreadsheet,
  Loader2,
  Edit,
  X
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

interface ReportVisit extends Visit {
  path?: string;
}

const isMaleGender = (gender: any) => {
  if (!gender) return false;
  const g = String(gender).trim().toLowerCase();
  return g.startsWith('l') || g.startsWith('m') || g === 'siswa' || g === 'laki';
};

const isFemaleGender = (gender: any) => {
  if (!gender) return false;
  const g = String(gender).trim().toLowerCase();
  return g.startsWith('p') || g.startsWith('f') || g === 'siswi' || g === 'perempuan';
};

interface ReportsProps {
  onEditVisit?: (visit: Visit & { path: string }) => void;
}

export default function Reports({ onEditVisit }: ReportsProps) {
  const [activeReportTab, setActiveReportTab] = useState<'general' | 'medicines'>('general');
  const [loading, setLoading] = useState(false);
  const [reportMonth, setReportMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [reportData, setReportData] = useState<{
    visits: ReportVisit[];
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

  const [editingVisit, setEditingVisit] = useState<ReportVisit | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [savingVisit, setSavingVisit] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const handleEditClick = (v: ReportVisit) => {
    if (onEditVisit && v.path) {
      onEditVisit(v as any);
      return;
    }
    setEditingVisit({ ...v });
    setModalError(null);
    setShowEditModal(true);
  };

  const handleSaveVisit = async () => {
    if (!editingVisit || !editingVisit.path) {
      setModalError("Path pendaftaran kunjungan tidak ditemukan.");
      return;
    }
    setSavingVisit(true);
    setModalError(null);
    try {
      const visitRef = doc(db, editingVisit.path);
      await updateDoc(visitRef, {
        studentName: editingVisit.studentName || '',
        age: Number(editingVisit.age) || 0,
        grade: editingVisit.grade || '',
        gender: editingVisit.gender,
        complaint: editingVisit.complaint || '',
        bloodPressure: editingVisit.bloodPressure || '',
        weight: Number(editingVisit.weight) || 0,
        temperature: Number(editingVisit.temperature) || 0,
        diagnosis: editingVisit.diagnosis || '',
        therapy: editingVisit.therapy || '',
        action: editingVisit.action || '',
        updatedAt: new Date()
      });

      await generateReport();
      setShowEditModal(false);
      setEditingVisit(null);
    } catch (err: any) {
      console.error("Failed to update visit:", err);
      setModalError("Gagal memperbarui data kunjungan: " + (err.message || String(err)));
    } finally {
      setSavingVisit(false);
    }
  };

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

      const snap = await runWithRetry(() => getDocs(q));
      const visits = snap.docs.map(doc => ({ id: doc.id, path: doc.ref.path, ...doc.data() } as ReportVisit));

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
        if (isFemaleGender(v.gender)) {
          dailyMap[dateStr].female++;
          females++;
        } else {
          dailyMap[dateStr].male++;
          males++;
        }
        
        if (v.age && Number(v.age) <= 12) {
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
      handleFirestoreError(err, OperationType.LIST, 'visits_reports');
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
    
    // Sheet 3: Detail Kunjungan
    const detailData = reportData.visits.map(v => ({
      'Tanggal': format(parseISO(v.date), 'dd/MM/yyyy HH:mm'),
      'Nama': v.studentName,
      'Usia': v.age,
      'Kelas': v.grade,
      'Jenis Kelamin': v.gender,
      'Keluhan': v.complaint,
      'Tekanan Darah': v.bloodPressure,
      'Berat Badan (kg)': v.weight,
      'Suhu (°C)': v.temperature,
      'Diagnosa': v.diagnosis,
      'Terapi': v.therapy,
      'Tindakan': v.action
    }));
    const detailSheet = XLSX.utils.json_to_sheet(detailData);
    XLSX.utils.book_append_sheet(wb, detailSheet, 'Detail Kunjungan');
    
    XLSX.writeFile(wb, `Laporan_UKS_${reportMonth}.xlsx`);
  };

  const exportPDF = () => {
    const doc = new jsPDF('l', 'mm', 'a4'); // Use landscape for better fitting
    const monthName = format(new Date(reportMonth), 'MMMM yyyy', { locale: id });
    
    doc.setFontSize(16);
    doc.text('LAPORAN BULANAN UKS', 148.5, 15, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`Periode: ${monthName}`, 148.5, 22, { align: 'center' });
    
    doc.text('1. REKAP DIAGNOSA', 14, 35);
    autoTable(doc, {
      startY: 40,
      head: [['No', 'Diagnosa', 'Jumlah']],
      body: Object.entries(reportData.diagnosisCounts).map(([name, count], i) => [i + 1, name, count]),
      theme: 'grid',
      headStyles: { fillColor: [59, 130, 246] }
    });
    
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

    const finalYDaily = (doc as any).lastAutoTable.finalY || 25;
    
    doc.addPage();
    doc.text('3. DATA DETAIL KUNJUNGAN', 14, 20);
    autoTable(doc, {
      startY: 25,
      head: [['No', 'Tanggal', 'Nama', 'Usia', 'Kelas', 'JK', 'Keluhan', 'TD', 'BB', 'Suhu', 'Diagnosa', 'Terapi', 'Tindakan']],
      body: reportData.visits.map((v, i) => [
        i + 1,
        format(parseISO(v.date), 'dd/MM/yy HH:mm'),
        v.studentName,
        v.age,
        v.grade,
        isMaleGender(v.gender) ? 'L' : 'P',
        v.complaint,
        v.bloodPressure,
        v.weight,
        v.temperature,
        v.diagnosis,
        v.therapy,
        v.action
      ]),
      theme: 'grid',
      headStyles: { fillColor: [59, 130, 246] },
      styles: { fontSize: 7, cellPadding: 1 }, // Small font for many columns
      columnStyles: {
        0: { cellWidth: 8 },
        1: { cellWidth: 15 },
        2: { cellWidth: 25 },
        3: { cellWidth: 8 },
        4: { cellWidth: 10 },
        5: { cellWidth: 6 },
        6: { cellWidth: 35 },
        7: { cellWidth: 15 },
        8: { cellWidth: 10 },
        9: { cellWidth: 10 },
        10: { cellWidth: 25 },
        11: { cellWidth: 25 },
        12: { cellWidth: 25 },
      }
    });
    
    doc.save(`Laporan_UKS_${reportMonth}.pdf`);
  };

  return (
    <div className="space-y-6 print:p-0">
      {/* Top level Report Mode tabs */}
      <div className="flex bg-slate-200/60 p-1.5 rounded-xl gap-2 pr-2 print:hidden mb-4">
        <button
          onClick={() => setActiveReportTab('general')}
          className={cn(
            "flex-1 md:flex-none px-6 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer",
            activeReportTab === 'general'
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-800"
          )}
        >
          Laporan Kunjungan Harian
        </button>
        <button
          onClick={() => setActiveReportTab('medicines')}
          className={cn(
            "flex-1 md:flex-none px-6 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer",
            activeReportTab === 'medicines'
              ? "bg-white text-cyan-700 shadow-sm border border-cyan-100"
              : "text-slate-500 hover:text-slate-800"
          )}
        >
          Laporan Pemakaian Obat
        </button>
      </div>

      {activeReportTab === 'medicines' ? (
        <MedicineReports />
      ) : (
        <>
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
                {reportData.dailyStats.reduce((acc, curr) => acc + (curr.under12 || 0), 0)}
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
                      .sort(([, aCount], [, bCount]) => (bCount as number) - (aCount as number))
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

          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-[11px] font-black uppercase tracking-tight text-slate-900">3. Detail Kunjungan Harian</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[10px]">
                <thead className="bg-slate-50/50 border-b border-slate-100">
                  <tr>
                    <th className="px-3 py-2 font-bold uppercase text-[8px] text-slate-400">Tanggal</th>
                    <th className="px-3 py-2 font-bold uppercase text-[8px] text-slate-400">Nama</th>
                    <th className="px-3 py-2 font-bold uppercase text-[8px] text-slate-400">U/K/G</th>
                    <th className="px-3 py-2 font-bold uppercase text-[8px] text-slate-400">Keluhan</th>
                    <th className="px-3 py-2 font-bold uppercase text-[8px] text-slate-400">Vitals</th>
                    <th className="px-3 py-2 font-bold uppercase text-[8px] text-slate-400">Diagnosa</th>
                    <th className="px-3 py-2 font-bold uppercase text-[8px] text-slate-400">Terapi</th>
                    <th className="px-3 py-2 font-bold uppercase text-[8px] text-slate-400 text-center w-16">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.visits.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">
                        {format(parseISO(v.date), 'dd/MM/yy HH:mm')}
                      </td>
                      <td className="px-3 py-2 font-bold text-slate-900">{v.studentName}</td>
                      <td className="px-3 py-2 space-y-0.5">
                        <div className="text-slate-500 font-medium">{v.age} Thn</div>
                        <div className="text-slate-400 font-bold">{v.grade}</div>
                        <div className="text-slate-400">{isMaleGender(v.gender) ? 'L' : 'P'}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{v.complaint}</td>
                      <td className="px-3 py-2 space-y-0.5">
                        <div className="flex items-center gap-1 group">
                          <span className="text-slate-400 font-bold text-[7px] uppercase tracking-tighter">TD:</span>
                          <span className="text-blue-600 font-bold">{v.bloodPressure}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 font-bold text-[7px] uppercase tracking-tighter">BB:</span>
                          <span className="text-emerald-600 font-bold">{v.weight}kg</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 font-bold text-[7px] uppercase tracking-tighter">S:</span>
                          <span className="text-rose-600 font-bold">{v.temperature}°C</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-bold text-slate-800">{v.diagnosis}</td>
                      <td className="px-3 py-2 text-slate-600 text-[9px] leading-tight">
                        {v.therapy}
                        <div className="mt-1 flex gap-1">
                          <span className="text-[7px] bg-slate-100 text-slate-500 px-1 rounded uppercase font-bold">{v.action}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleEditClick(v)}
                          className="bg-slate-100 hover:bg-cyan-50 hover:text-cyan-700 text-slate-500 p-1.5 rounded transition bg-gradient-to-b hover:from-white hover:to-slate-50 border border-transparent hover:border-slate-200 shadow-sm cursor-pointer inline-flex items-center justify-center"
                          title="Edit Data Pasien"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {reportData.visits.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center text-slate-400 italic">
                        Tidak ada data kunjungan pada periode ini.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* EDIT PATIENT DATA VISIT MODAL */}
      {showEditModal && editingVisit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Edit Detail Kunjungan Pasien</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">Perbarui informasi medis pendaftaran kunjungan {editingVisit.studentName}.</p>
              </div>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingVisit(null);
                }}
                className="text-slate-400 hover:text-slate-600 transition-colors p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error Message */}
            {modalError && (
              <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded text-xs leading-relaxed font-semibold">
                {modalError}
              </div>
            )}

            {/* Body */}
            <div className="px-6 py-4 max-h-[60vh] overflow-y-auto space-y-4 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Name */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider block">Nama Lengkap Pasien</label>
                  <input
                    type="text"
                    required
                    value={editingVisit.studentName}
                    onChange={(e) => setEditingVisit({ ...editingVisit, studentName: e.target.value })}
                    className="w-full text-xs font-bold border border-slate-200 rounded p-2 focus:ring-1 focus:ring-cyan-500 font-sans text-slate-800 bg-slate-50/20"
                  />
                </div>

                {/* Age */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider block">Umur (Tahun)</label>
                  <input
                    type="number"
                    required
                    value={editingVisit.age}
                    onChange={(e) => setEditingVisit({ ...editingVisit, age: parseInt(e.target.value) || 0 })}
                    className="w-full text-xs font-bold border border-slate-200 rounded p-2 focus:ring-1 focus:ring-cyan-500 font-mono text-slate-800 bg-slate-50/20"
                  />
                </div>

                {/* Class / Grade */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider block">Kelas / Tingkat / Jabatan</label>
                  <input
                    type="text"
                    required
                    value={editingVisit.grade}
                    onChange={(e) => setEditingVisit({ ...editingVisit, grade: e.target.value })}
                    className="w-full text-xs font-bold border border-slate-200 rounded p-2 focus:ring-1 focus:ring-cyan-500 font-sans text-slate-800 bg-slate-50/20"
                  />
                </div>

                {/* Gender */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider block">Jenis Kelamin</label>
                  <select
                    value={editingVisit.gender}
                    onChange={(e) => setEditingVisit({ ...editingVisit, gender: e.target.value as 'Laki-laki' | 'Perempuan' })}
                    className="w-full text-xs font-bold border border-slate-200 rounded p-2 focus:ring-1 focus:ring-cyan-500 font-sans text-slate-800 bg-white"
                  >
                    <option value="Laki-laki">Laki-laki</option>
                    <option value="Perempuan">Perempuan</option>
                  </select>
                </div>

                {/* Complaint */}
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider block">Keluhan Utama</label>
                  <textarea
                    rows={2}
                    value={editingVisit.complaint}
                    onChange={(e) => setEditingVisit({ ...editingVisit, complaint: e.target.value })}
                    className="w-full text-xs font-bold border border-slate-200 rounded p-2 focus:ring-1 focus:ring-cyan-500 font-sans text-slate-800 bg-slate-50/20"
                  />
                </div>

                {/* Blood Pressure */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider block">Tensi Darah (TD)</label>
                  <input
                    type="text"
                    value={editingVisit.bloodPressure || ''}
                    onChange={(e) => setEditingVisit({ ...editingVisit, bloodPressure: e.target.value })}
                    placeholder="Contoh: 120/80"
                    className="w-full text-xs font-bold border border-slate-200 rounded p-2 focus:ring-1 focus:ring-cyan-500 font-mono text-slate-800 bg-slate-50/20"
                  />
                </div>

                {/* Weight */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider block">Berat Badan (kg)</label>
                  <input
                    type="number"
                    step="any"
                    value={editingVisit.weight ?? 0}
                    onChange={(e) => setEditingVisit({ ...editingVisit, weight: parseFloat(e.target.value) || 0 })}
                    className="w-full text-xs font-bold border border-slate-200 rounded p-2 focus:ring-1 focus:ring-cyan-500 font-mono text-slate-800 bg-slate-50/20"
                  />
                </div>

                {/* Temperature */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider block">Suhu Tubuh (°C)</label>
                  <input
                    type="number"
                    step="any"
                    value={editingVisit.temperature ?? 0}
                    onChange={(e) => setEditingVisit({ ...editingVisit, temperature: parseFloat(e.target.value) || 0 })}
                    className="w-full text-xs font-bold border border-slate-200 rounded p-2 focus:ring-1 focus:ring-cyan-500 font-mono text-slate-800 bg-slate-50/20"
                  />
                </div>

                {/* Action */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider block">Tindakan / Penanganan</label>
                  <input
                    type="text"
                    value={editingVisit.action || ''}
                    onChange={(e) => setEditingVisit({ ...editingVisit, action: e.target.value })}
                    placeholder="Contoh: Istirahat, dirujuk, dll"
                    className="w-full text-xs font-bold border border-slate-200 rounded p-2 focus:ring-1 focus:ring-cyan-500 font-sans text-slate-800 bg-slate-50/20"
                  />
                </div>

                {/* Diagnosis */}
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider block">Diagnosa</label>
                  <input
                    type="text"
                    value={editingVisit.diagnosis || ''}
                    onChange={(e) => setEditingVisit({ ...editingVisit, diagnosis: e.target.value })}
                    className="w-full text-xs font-bold border border-slate-200 rounded p-2 focus:ring-1 focus:ring-cyan-500 font-sans text-slate-800 bg-slate-50/20"
                  />
                </div>

                {/* Therapy */}
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider block">Terapi / Obat yang Diberikan</label>
                  <textarea
                    rows={2}
                    value={editingVisit.therapy || ''}
                    onChange={(e) => setEditingVisit({ ...editingVisit, therapy: e.target.value })}
                    className="w-full text-xs font-bold border border-slate-200 rounded p-2 focus:ring-1 focus:ring-cyan-500 font-sans text-slate-800 bg-slate-50/20"
                  />
                </div>

              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowEditModal(false);
                  setEditingVisit(null);
                }}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-500 rounded text-xs font-black uppercase tracking-wider cursor-pointer transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveVisit}
                disabled={savingVisit}
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white rounded text-xs font-black uppercase tracking-wider cursor-pointer shadow shadow-cyan-100 transition-colors flex items-center gap-2"
              >
                {savingVisit ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Menyimpan...
                  </>
                ) : (
                  'Simpan Perubahan'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
