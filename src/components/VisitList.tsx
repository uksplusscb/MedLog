import { useEffect, useState } from 'react';
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot,
  deleteDoc,
  doc,
  collectionGroup,
  where,
  getDocs
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, runWithRetry } from '../lib/firebase';
import { Visit } from '../types';
import { formatDate, cn } from '../lib/utils';
import { syncMedicineUsageToGoogleSheets } from '../lib/sheets';
import { Search, User, Clock, Thermometer, Activity, Loader2, Trash2, FileText, Pencil, Calendar, Users, Send, Share2, Check, AlertCircle, MessageSquare } from 'lucide-react';

const isMale = (gender: any) => {
  if (!gender) return false;
  const g = String(gender).trim().toLowerCase();
  return g.startsWith('l') || g.startsWith('m') || g === 'siswa' || g === 'laki';
};

const isFemale = (gender: any) => {
  if (!gender) return false;
  const g = String(gender).trim().toLowerCase();
  return g.startsWith('p') || g.startsWith('f') || g === 'siswi' || g === 'perempuan';
};

function generateReportMessage(dateStr: string, list: any[]) {
  const male = list.filter(v => isMale(v.gender));
  const female = list.filter(v => isFemale(v.gender));
  
  let dateFormatted = dateStr;
  try {
    const d = new Date(dateStr + 'T12:00:00');
    if (!isNaN(d.getTime())) {
      dateFormatted = formatDate(d);
    }
  } catch (e) {
    console.error("Error formatting date:", e);
  }

  let text = `*LAPORAN HARIAN UKS SCB*\n`;
  text += `📅 Tanggal: *${dateFormatted}*\n\n`;
  text += `*RINGKASAN KUNJUNGAN:*\n`;
  text += `• Total Pasien: *${list.length}* Siswa/i\n`;
  text += `• Laki-laki: *${male.length}* Siswa\n`;
  text += `• Perempuan: *${female.length}* Siswi\n\n`;
  text += `UKS PLUS SCB`;
  return text;
}

interface VisitListProps {
  onEdit: (visit: Visit & { path: string }) => void;
}

export default function VisitList({ onEdit }: VisitListProps) {
  const [visits, setVisits] = useState<(Visit & { path: string })[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  const [activeSubTab, setActiveSubTab] = useState<'list' | 'report'>('list');
  const [reportDate, setReportDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [reportVisits, setReportVisits] = useState<(Visit & { path: string })[]>([]);
  const [reportLoading, setReportLoading] = useState<boolean>(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // New WhatsApp states
  const [teachers, setTeachers] = useState<{ id: string; name: string; whatsapp: string }[]>([]);
  const [whatsappNumber, setWhatsappNumber] = useState<string>('');
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [customWord, setCustomWord] = useState<string>('');
  const [isWaSending, setIsWaSending] = useState<boolean>(false);
  const [waStatus, setWaStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isMsgCustomized, setIsMsgCustomized] = useState<boolean>(false);

  useEffect(() => {
    const q = query(collection(db, 'visits'), orderBy('date', 'desc'), limit(50));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(docSnap => ({ 
        id: docSnap.id, 
        path: docSnap.ref.path,
        ...docSnap.data() 
      } as Visit & { path: string }));
      setVisits(data);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'visits');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (activeSubTab !== 'report') return;

    let active = true;
    const fetchReportData = async () => {
      setReportLoading(true);
      setReportError(null);
      try {
        const startOfDay = new Date(reportDate + 'T00:00:00');
        const endOfDay = new Date(reportDate + 'T23:59:59');
        
        let startISO = '';
        let endISO = '';
        
        if (isNaN(startOfDay.getTime()) || isNaN(endOfDay.getTime())) {
          startISO = `${reportDate}T00:00:00.000Z`;
          endISO = `${reportDate}T23:59:59.999Z`;
        } else {
          startISO = startOfDay.toISOString();
          endISO = endOfDay.toISOString();
        }

        const q = query(
          collection(db, 'visits'),
          where('date', '>=', startISO),
          where('date', '<=', endISO)
        );

        const snap = await runWithRetry(() => getDocs(q));
        
        if (!active) return;

        const fetched = snap.docs.map(docSnap => ({
          id: docSnap.id,
          path: docSnap.ref.path,
          ...docSnap.data()
        } as Visit & { path: string }));

        fetched.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        setReportVisits(fetched);
      } catch (err: any) {
        console.error("Error fetching report data:", err);
        setReportError(err?.message || "Gagal memuat data laporan.");
      } finally {
        if (active) {
          setReportLoading(false);
        }
      }
    };

    fetchReportData();

    return () => {
      active = false;
    };
  }, [reportDate, activeSubTab]);

  // Load teachers for reports
  useEffect(() => {
    if (activeSubTab !== 'report') return;
    
    const teachersRef = collection(db, 'teachers');
    const q = query(teachersRef, orderBy('name', 'asc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || 'Tanpa Nama',
        whatsapp: doc.data().whatsapp || ''
      }));
      setTeachers(data);
    }, (err) => {
      console.error("Error loading teachers for reports:", err);
    });

    return () => unsubscribe();
  }, [activeSubTab]);

  // Handle auto-generation of customWord report message
  useEffect(() => {
    if (!isMsgCustomized) {
      setCustomWord(generateReportMessage(reportDate, reportVisits));
    }
  }, [reportVisits, reportDate, isMsgCustomized]);

  // Reset customization flag when date changes so it regenerates fresh date data
  useEffect(() => {
    setIsMsgCustomized(false);
    setWaStatus(null);
  }, [reportDate]);

  const filteredVisits = visits.filter(v => 
    (v.studentName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.grade || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.complaint || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const safeLocaleDate = (dateVal: string | undefined) => {
    if (!dateVal) return '-';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit' });
    } catch (e) {
      return '-';
    }
  };

  const safeLocaleTime = (dateVal: string | undefined) => {
    if (!dateVal) return '-';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '-';
    }
  };

  const handleDelete = async (visit: any) => {
    if (!window.confirm('Hapus data kunjungan ini?')) return;
    const path = visit.path;
    if (!path) return;
    try {
      await deleteDoc(doc(db, path));

      // Sync deletion of medicine usage harian to monthly Google Sheets in background!
      if (visit.id && visit.date) {
        syncMedicineUsageToGoogleSheets(
          visit.id,
          visit.date,
          visit.studentName || '',
          [],
          true
        ).catch(err => {
          console.error("Gagal sinkron menghapus data pemakaian obat:", err);
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const sendReportViaProxy = async () => {
    if (!whatsappNumber) {
      setWaStatus({ success: false, message: 'Harap isi nomor WhatsApp terlebih dahulu!' });
      return;
    }

    setIsWaSending(true);
    setWaStatus(null);

    const cleanNumber = whatsappNumber.replace(/\D/g, '');
    const formattedNumber = cleanNumber.startsWith('0') 
      ? '62' + cleanNumber.slice(1) 
      : (cleanNumber.startsWith('62') ? cleanNumber : '62' + cleanNumber);

    try {
      const customToken = localStorage.getItem('uks_fonnte_token') || '';
      const response = await fetch('/api/send-wa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          target: formattedNumber, 
          message: customWord,
          token: customToken
        })
      });

      const resData = await response.json().catch(() => ({}));

      if (response.ok && resData.status !== false) {
        const extraMsg = resData.is_fallback_used 
          ? ' (Melalui Jalur Cadangan UKS karena perangkat kustom terputus)' 
          : '';
        setWaStatus({ 
          success: true, 
          message: `Laporan berhasil dikirim secara otomatis ke nomor ${formattedNumber}!${extraMsg}` 
        });
      } else {
        const errorReason = resData.reason || resData.detail || 'Fonnte/API error response';
        console.warn("Fonnte failed, falling back to manual redirect:", errorReason);
        setWaStatus({ 
          success: false, 
          message: `Pengiriman otomatis gagal (${errorReason}). Gunakan tombol "Buka WhatsApp" di bawah.` 
        });
      }
    } catch (err: any) {
      console.error("Error sending WA report via proxy:", err);
      setWaStatus({ 
        success: false, 
        message: 'Gagal menghubungkan ke server WhatsApp proxy. Gunakan tombol "Buka WhatsApp" untuk mengirim manual.' 
      });
    } finally {
      setIsWaSending(false);
    }
  };

  const openWhatsAppReportManual = () => {
    if (!whatsappNumber) {
      setWaStatus({ success: false, message: 'Harap isi nomor WhatsApp atau pilih guru terlebih dahulu!' });
      return;
    }

    const cleanNumber = whatsappNumber.replace(/\D/g, '');
    const formattedNumber = cleanNumber.startsWith('0') 
      ? '62' + cleanNumber.slice(1) 
      : (cleanNumber.startsWith('62') ? cleanNumber : '62' + cleanNumber);

    const redirectUrl = `https://wa.me/${formattedNumber}?text=${encodeURIComponent(customWord)}`;
    window.open(redirectUrl, '_blank');
    setWaStatus({ 
      success: true, 
      message: 'Membuka WhatsApp/WhatsApp Web. Silakan tekan tombol kirim di aplikasi WhatsApp.' 
    });
  };

  const maleVisits = reportVisits.filter(v => isMale(v.gender));
  const femaleVisits = reportVisits.filter(v => isFemale(v.gender));
  
  const totalReportCount = reportVisits.length;
  const maleCount = maleVisits.length;
  const femaleCount = femaleVisits.length;

  const malePercentage = totalReportCount > 0 ? Math.round((maleCount / totalReportCount) * 100) : 0;
  const femalePercentage = totalReportCount > 0 ? Math.round((femaleCount / totalReportCount) * 100) : 0;

  return (
    <div className="space-y-4 font-sans">
      {/* Sub-tab Switcher Bar */}
      <div className="flex bg-slate-200/60 p-1 rounded-lg w-fit border border-slate-300/30 shadow-sm">
        <button
          onClick={() => setActiveSubTab('list')}
          className={cn(
            "px-4 py-1.5 rounded-md text-[10px] font-black tracking-wider uppercase transition-all flex items-center gap-1.5",
            activeSubTab === 'list'
              ? "bg-white text-slate-800 shadow-sm"
              : "text-slate-500 hover:text-slate-800"
          )}
        >
          <Activity className="w-3.5 h-3.5 text-cyan-600" />
          <span>Daftar Kunjungan</span>
        </button>
        <button
          onClick={() => setActiveSubTab('report')}
          className={cn(
            "px-4 py-1.5 rounded-md text-[10px] font-black tracking-wider uppercase transition-all flex items-center gap-1.5",
            activeSubTab === 'report'
              ? "bg-white text-slate-800 shadow-sm"
              : "text-slate-500 hover:text-slate-800"
          )}
        >
          <Calendar className="w-3.5 h-3.5 text-indigo-600" />
          <span>Laporan Harian</span>
        </button>
      </div>

      {activeSubTab === 'report' ? (
        <div className="space-y-4">
          {/* Laporan Header & Date Selector */}
          <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                <Calendar className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase text-slate-700 tracking-wider">Laporan Harian Gender</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Pilih tanggal untuk melihat statistik kunjungan harian.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider whitespace-nowrap">Tanggal Kunjungan:</label>
              <input
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className="bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded px-2.5 py-1 text-xs font-bold outline-none text-slate-700 transition-colors cursor-pointer"
              />
            </div>
          </div>

          {/* Report Loading / Error / Content */}
          {reportLoading ? (
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-16 text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-600 mb-2" />
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider animate-pulse">Memuat data laporan...</p>
            </div>
          ) : reportError ? (
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-8 text-center text-red-600">
              <p className="text-xs font-bold">{reportError}</p>
            </div>
          ) : (
            <>
              {/* Stat Bento Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Total Kunjungan */}
                <div className="bg-slate-900 text-white p-4 rounded-lg border border-slate-800 shadow-sm relative overflow-hidden flex flex-col justify-between h-28 group hover:border-slate-700 transition-colors">
                  <div className="absolute right-2 top-2 text-slate-800/80 group-hover:text-slate-800 transition-colors">
                    <Users className="w-16 h-16 stroke-[1]" />
                  </div>
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider z-10 font-mono">Total Kunjungan</span>
                  <div className="z-10 mt-2">
                    <span className="text-3xl font-black">{totalReportCount}</span>
                    <span className="text-[10px] font-bold text-slate-400 ml-1 font-mono">KASUS</span>
                  </div>
                  <span className="text-[9px] font-bold text-slate-400 z-10 uppercase tracking-wider">Tanggal {formatDate(reportDate)}</span>
                </div>

                {/* Laki-laki */}
                <div className="bg-gradient-to-br from-cyan-50/50 to-emerald-50/30 p-4 rounded-lg border border-cyan-100 shadow-sm relative overflow-hidden flex flex-col justify-between h-28 group hover:border-cyan-200 transition-colors">
                  <div className="absolute right-2 top-2 text-cyan-200/55 group-hover:text-cyan-200/70 transition-colors">
                    <User className="w-16 h-16 stroke-[1]" />
                  </div>
                  <span className="text-[10px] font-black uppercase text-cyan-700 tracking-wider z-10 font-mono">Pasien Laki-laki</span>
                  <div className="z-10 mt-2">
                    <span className="text-3xl font-black text-cyan-900">{maleCount}</span>
                    <span className="text-[10px] font-bold text-cyan-700 ml-1 font-mono">Siswa ({malePercentage}%)</span>
                  </div>
                  <span className="text-[9px] font-bold text-cyan-600 z-10 uppercase tracking-widest">GENDER: Laki-laki</span>
                </div>

                {/* Perempuan */}
                <div className="bg-gradient-to-br from-rose-50/50 to-pink-50/30 p-4 rounded-lg border border-rose-100 shadow-sm relative overflow-hidden flex flex-col justify-between h-28 group hover:border-rose-200 transition-colors">
                  <div className="absolute right-2 top-2 text-rose-200/55 group-hover:text-rose-200/70 transition-colors">
                    <User className="w-16 h-16 stroke-[1]" />
                  </div>
                  <span className="text-[10px] font-black uppercase text-rose-700 tracking-wider z-10 font-mono">Pasien Perempuan</span>
                  <div className="z-10 mt-2">
                    <span className="text-3xl font-black text-rose-900">{femaleCount}</span>
                    <span className="text-[10px] font-bold text-rose-700 ml-1 font-mono">Siswi ({femalePercentage}%)</span>
                  </div>
                  <span className="text-[9px] font-bold text-rose-600 z-10 uppercase tracking-widest">GENDER: Perempuan</span>
                </div>
              </div>

              {/* Proportional Bar Chart */}
              {totalReportCount > 0 && (
                <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-3">
                  <div className="flex justify-between items-center text-[10px] font-black uppercase text-slate-500 tracking-wider">
                    <span>Rasio Distribusi Gender</span>
                    <span className="text-slate-400 font-mono">Laki:Perempuan</span>
                  </div>
                  <div className="h-4 bg-slate-100 rounded-full flex overflow-hidden shadow-inner border border-slate-200/40">
                    <div 
                      style={{ width: `${malePercentage}%` }} 
                      className="bg-gradient-to-r from-cyan-500 to-teal-500 h-full transition-all duration-500 ease-out flex items-center justify-center text-[8px] font-black text-white"
                      title={`Laki-laki: ${malePercentage}%`}
                    >
                      {malePercentage >= 15 && `Laki-laki (${malePercentage}%)`}
                    </div>
                    <div 
                      style={{ width: `${femalePercentage}%` }} 
                      className="bg-gradient-to-r from-rose-500 to-pink-500 h-full transition-all duration-500 ease-out flex items-center justify-center text-[8px] font-black text-white"
                      title={`Perempuan: ${femalePercentage}%`}
                    >
                      {femalePercentage >= 15 && `Perempuan (${femalePercentage}%)`}
                    </div>
                  </div>
                  <div className="flex justify-between text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                    <div className="flex items-center gap-1.5 text-cyan-600">
                      <div className="w-2 h-2 rounded-full bg-cyan-500" />
                      <span>{maleCount} Laki-laki</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-rose-600">
                      <div className="w-2 h-2 rounded-full bg-rose-500" />
                      <span>{femaleCount} Perempuan</span>
                    </div>
                  </div>
                </div>
              )}

              {/* WhatsApp Report Sender Section */}
              <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-emerald-600 animate-bounce" />
                    <h3 className="text-xs font-black uppercase text-slate-700 tracking-wider">Bagikan Laporan Harian via WhatsApp</h3>
                  </div>
                  <span className="text-[8px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">
                    WHATSAPP_INTEGRATION_STABLE
                  </span>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Recipient Side */}
                  <div className="space-y-3 flex flex-col justify-between">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                          Pilih Kontak Guru (Opsional)
                        </label>
                        <select
                          value={selectedTeacherId}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSelectedTeacherId(val);
                            const t = teachers.find(item => item.id === val);
                            if (t && t.whatsapp) {
                              setWhatsappNumber(t.whatsapp);
                            }
                          }}
                          className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded px-2.5 py-1.5 text-xs font-bold text-slate-700 transition-colors cursor-pointer"
                        >
                          <option value="">-- Pilih Kontak Guru / Staff --</option>
                          {teachers.map(t => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.whatsapp || 'Tidak ada nomor'})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                          Nomor WhatsApp Penerima
                        </label>
                        <input
                          type="tel"
                          placeholder="Contoh: 08123456789 atau 6281234..."
                          value={whatsappNumber}
                          onChange={(e) => setWhatsappNumber(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded px-2.5 py-1.5 text-xs font-bold text-slate-700 transition-colors"
                        />
                      </div>

                      {waStatus && (
                        <div className={cn(
                          "p-3 rounded text-[11px] flex gap-2 border leading-relaxed",
                          waStatus.success 
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200" 
                            : "bg-rose-50 text-rose-800 border-rose-200"
                        )}>
                          {waStatus.success ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                          )}
                          <span className="font-bold">{waStatus.message}</span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                      <button
                        type="button"
                        onClick={sendReportViaProxy}
                        disabled={isWaSending}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-black uppercase text-[10px] tracking-wider py-3 rounded-xl flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99] shadow-md cursor-pointer shrink-0"
                      >
                        {isWaSending ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>MENGIRIM...</span>
                          </>
                        ) : (
                          <>
                            <Send className="w-3.5 h-3.5" />
                            <span>Kirim Lap. Otomatis (Fonnte)</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={openWhatsAppReportManual}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-[10px] tracking-wider py-3 rounded-xl flex items-center justify-center gap-2 transition-all hover:scale-[1.01] active:scale-[0.99] shadow-md cursor-pointer shrink-0"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Buka WhatsApp Web (Manual)</span>
                      </button>
                    </div>
                  </div>

                  {/* Message Side */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                        Draf Laporan ({reportVisits.length} kunjungan)
                      </label>
                      {isMsgCustomized && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsMsgCustomized(false);
                            setCustomWord(generateReportMessage(reportDate, reportVisits));
                          }}
                          className="text-[9px] text-indigo-600 hover:underline font-bold uppercase tracking-wider cursor-pointer"
                        >
                          Reset ke Default
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={8}
                      value={customWord}
                      onChange={(e) => {
                        setCustomWord(e.target.value);
                        setIsMsgCustomized(true);
                      }}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded p-2.5 font-mono text-[10px] text-slate-700 leading-relaxed outline-none resize-none"
                      placeholder="Menghasilkan draf laporan..."
                    />
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                      * Teks di atas dapat Anda sunting sebelum dikirim. Gunakan tanda bintang (*) untuk menebalkan teks WhatsApp.
                    </p>
                  </div>
                </div>
              </div>

              {/* Detailed Visit List for Selected Date */}
              <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Detail Kunjungan ({totalReportCount})</h4>
                  <span className="text-[8px] text-slate-400 font-mono">REPORT_RECORDS_STABLE</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-[9px] font-bold tracking-wider border-b border-slate-100">
                      <tr>
                        <th className="p-3">Waktu</th>
                        <th className="p-3">Nama Siswa</th>
                        <th className="p-3">Gender</th>
                        <th className="p-3">Kelas</th>
                        <th className="p-3">Keluhan</th>
                        <th className="p-3">Diagnosa</th>
                        <th className="p-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reportVisits.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-12 text-center text-slate-400 italic font-bold uppercase text-[10px] tracking-widest bg-slate-50/20">
                            Tidak ada kunjungan tercatat pada tanggal {formatDate(reportDate)}
                          </td>
                        </tr>
                      ) : (
                        reportVisits.map((visit, idx) => (
                          <tr key={visit.id || idx} className="hover:bg-slate-50/80 transition-colors group">
                            <td className="p-3 text-slate-500 font-mono text-[10px] whitespace-nowrap">
                              {safeLocaleTime(visit.date)}
                            </td>
                            <td className="p-3 font-bold text-slate-900">
                              <div className="flex flex-col gap-1">
                                <span>{visit.studentName}</span>
                                {visit.labPhoto && (() => {
                                  const segments = visit.path.split('/');
                                  const sId = segments[1];
                                  const vId = segments[3];
                                  return (
                                    <a
                                      href={`/?view-lab=${sId}_${vId}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex items-center gap-1 bg-cyan-100 hover:bg-cyan-200 text-cyan-800 font-extrabold uppercase text-[8px] tracking-wider px-1.5 py-0.5 rounded w-fit border border-cyan-200/40 animate-pulse"
                                    >
                                      <FileText className="w-2.5 h-2.5 text-cyan-600" />
                                      <span>HASIL LAB</span>
                                    </a>
                                  );
                                })()}
                              </div>
                            </td>
                            <td className="p-3 font-medium">
                              {isMale(visit.gender) ? (
                                <span className="bg-cyan-50 text-cyan-700 border border-cyan-100 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider">Laki-laki</span>
                              ) : (
                                <span className="bg-rose-50 text-rose-700 border border-rose-100 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider">Perempuan</span>
                              )}
                            </td>
                            <td className="p-3 text-slate-500 font-medium">{visit.grade}</td>
                            <td className="p-3 text-slate-600 max-w-[150px] truncate">{visit.complaint}</td>
                            <td className="p-3 font-medium text-blue-600">{visit.diagnosis || '-'}</td>
                            <td className="p-3 text-right">
                              <button
                                onClick={() => onEdit(visit)}
                                className="p-1.5 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded transition-colors opacity-0 group-hover:opacity-100 mr-2"
                                title="Edit"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => visit.path && handleDelete(visit)}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                title="Hapus"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-3 rounded-lg border border-slate-200 shadow-sm animate-fade-in">
            <h2 className="text-xs font-bold uppercase text-slate-500 tracking-wider px-2">Data Terakhir (Hari Ini)</h2>
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Cari..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-blue-500 outline-none text-[11px] transition-all"
              />
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider sticky top-0 bg-white">
                  <tr className="border-b border-slate-100">
                    <th className="p-3">Waktu</th>
                    <th className="p-3">Nama Siswa</th>
                    <th className="p-3">Kelas</th>
                    <th className="p-3">Vital</th>
                    <th className="p-3">Keluhan</th>
                    <th className="p-3">Diagnosa</th>
                    <th className="p-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center">
                        <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" />
                      </td>
                    </tr>
                  ) : filteredVisits.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-slate-400 italic">
                        Tidak ada data ditemukan
                      </td>
                    </tr>
                  ) : filteredVisits.map((visit, i) => (
                    <tr key={visit.id} className={cn("hover:bg-slate-50/80 transition-colors group", i % 2 !== 0 ? "bg-slate-50/30" : "")}>
                      <td className="p-3 font-mono text-slate-400 text-[10px] whitespace-nowrap">
                        <span className="block text-slate-600 font-bold mb-0.5">
                          {safeLocaleDate(visit.date)}
                        </span>
                        {safeLocaleTime(visit.date)}
                      </td>
                      <td className="p-3 font-bold text-slate-900">
                        <div className="flex flex-col gap-1">
                          <span>{visit.studentName}</span>
                          {visit.labPhoto && (() => {
                            const segments = visit.path.split('/');
                            const studentId = segments[1];
                            const visitId = segments[3];
                            return (
                              <a
                                href={`/?view-lab=${studentId}_${visitId}`}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 bg-cyan-100 hover:bg-cyan-200 text-cyan-800 font-extrabold uppercase text-[8px] tracking-wider px-1.5 py-0.5 rounded w-fit border border-cyan-200/40"
                              >
                                <FileText className="w-2.5 h-2.5 text-cyan-600" />
                                <span>HASIL LAB</span>
                              </a>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="p-3 text-slate-500 font-medium">{visit.grade}</td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <span className="bg-red-50 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-bold">{visit.temperature}&deg;C</span>
                          <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-bold">{visit.bloodPressure}</span>
                        </div>
                      </td>
                      <td className="p-3 text-slate-600 max-w-[200px] truncate">{visit.complaint}</td>
                      <td className="p-3 font-medium text-blue-600">{visit.diagnosis || '-'}</td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => onEdit(visit)}
                          className="p-1.5 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded transition-colors opacity-0 group-hover:opacity-100 mr-2"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => visit.path && handleDelete(visit)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                          title="Hapus"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
