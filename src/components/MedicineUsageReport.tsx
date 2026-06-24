import React, { useState, useEffect } from 'react';
import { 
  FileSpreadsheet, 
  Link, 
  Save, 
  ExternalLink, 
  Loader2,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Calendar,
  RefreshCw
} from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import { getCachedDriveToken, connectGoogleDrive } from '../lib/drive';

interface MonthlyLinks {
  [key: string]: string;
}

const MONTHS = [
  { id: '01', name: 'Januari' },
  { id: '02', name: 'Februari' },
  { id: '03', name: 'Maret' },
  { id: '04', name: 'April' },
  { id: '05', name: 'Mei' },
  { id: '06', name: 'Juni' },
  { id: '07', name: 'Juli' },
  { id: '08', name: 'Agustus' },
  { id: '09', name: 'September' },
  { id: '10', name: 'Oktober' },
  { id: '11', name: 'November' },
  { id: '12', name: 'Desember' }
];

export default function MedicineUsageReport() {
  const [monthlyLinks, setMonthlyLinks] = useState<MonthlyLinks>({
    '01': '', '02': '', '03': '', '04': '', '05': '', '06': '',
    '07': '', '08': '', '09': '', '10': '', '11': '', '12': ''
  });
  const [loadedLinks, setLoadedLinks] = useState<MonthlyLinks>({
    '01': '', '02': '', '03': '', '04': '', '05': '', '06': '',
    '07': '', '08': '', '09': '', '10': '', '11': '', '12': ''
  });
  const [savingMonths, setSavingMonths] = useState<{[key: string]: 'saving' | 'saved' | null}>({});
  const [syncingMonths, setSyncingMonths] = useState<{[key: string]: { status: 'syncing' | 'success' | 'error' | null, message: string, progress: number } | null}>({});
  const [loading, setLoading] = useState(true);
  const [savingSpreadsheet, setSavingSpreadsheet] = useState(false);
  const [spreadsheetStatus, setSpreadsheetStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [activeMonthFilter, setActiveMonthFilter] = useState<string>('all');
  const [driveConnected, setDriveConnected] = useState<boolean>(!!getCachedDriveToken());

  useEffect(() => {
    const handleConnectionChanged = (e: any) => {
      setDriveConnected(e.detail?.connected ?? false);
    };
    window.addEventListener('uks_drive_connection_changed', handleConnectionChanged);
    return () => {
      window.removeEventListener('uks_drive_connection_changed', handleConnectionChanged);
    };
  }, []);

  const handleConnectDrive = async () => {
    try {
      const token = await connectGoogleDrive();
      if (token) {
        setDriveConnected(true);
      }
    } catch (err: any) {
      setSpreadsheetStatus({
        type: 'error',
        message: 'Gagal menghubungkan Google Drive: ' + (err.message || String(err))
      });
      setTimeout(() => setSpreadsheetStatus(null), 5000);
    }
  };

  useEffect(() => {
    const fetchMonthlySpreadsheetLinks = async () => {
      try {
        const docRef = doc(db, 'settings', 'global_config');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          
          // Try to load the structured monthly links object
          if (data.medicine_usage_monthly_links) {
            const currentLinks = { ...data.medicine_usage_monthly_links };
            // Pre-populate June if empty
            if (!currentLinks['06']) {
              currentLinks['06'] = 'https://docs.google.com/spreadsheets/d/1aHa0-UDDOKE4gUOZInXLlKhU9I5VVGIFiHHj1jTJZ6w/edit?gid=489092922#gid=489092922';
            }
            setMonthlyLinks(currentLinks);
            setLoadedLinks(currentLinks);
          } else if (data.medicine_usage_spreadsheet) {
            // Fallback: If only the old single spreadsheet existed, set it as default for all empty months
            const fallback: MonthlyLinks = {};
            MONTHS.forEach(m => {
              fallback[m.id] = data.medicine_usage_spreadsheet;
            });
            if (!fallback['06']) {
              fallback['06'] = 'https://docs.google.com/spreadsheets/d/1aHa0-UDDOKE4gUOZInXLlKhU9I5VVGIFiHHj1jTJZ6w/edit?gid=489092922#gid=489092922';
            }
            setMonthlyLinks(fallback);
            setLoadedLinks(fallback);
          } else {
            // Fully Empty Config
            const fallback: MonthlyLinks = {
              '01': '', '02': '', '03': '', '04': '', '05': '', '06': 'https://docs.google.com/spreadsheets/d/1aHa0-UDDOKE4gUOZInXLlKhU9I5VVGIFiHHj1jTJZ6w/edit?gid=489092922#gid=489092922',
              '07': '', '08': '', '09': '', '10': '', '11': '', '12': ''
            };
            setMonthlyLinks(fallback);
            setLoadedLinks(fallback);
          }
        } else {
          // No config exists yet, set default with pre-populated June spreadsheet URL
          const defaultLinks: MonthlyLinks = {
            '01': '', '02': '', '03': '', '04': '', '05': '', '06': 'https://docs.google.com/spreadsheets/d/1aHa0-UDDOKE4gUOZInXLlKhU9I5VVGIFiHHj1jTJZ6w/edit?gid=489092922#gid=489092922',
            '07': '', '08': '', '09': '', '10': '', '11': '', '12': ''
          };
          setMonthlyLinks(defaultLinks);
          setLoadedLinks(defaultLinks);
        }
      } catch (err) {
        console.warn("Gagal mengambil link spreadsheet global_config:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchMonthlySpreadsheetLinks();
  }, []);

  const handleBatchSync = async (monthId: string) => {
    if (syncingMonths[monthId]?.status === 'syncing') return;
    
    setSyncingMonths(prev => ({
      ...prev,
      [monthId]: { status: 'syncing', message: 'Memulai...', progress: 0 }
    }));
    setSpreadsheetStatus(null);

    try {
      const { syncMonthlyUsageBatch } = await import('../lib/sheets');
      const result = await syncMonthlyUsageBatch(monthId, (progress, msg) => {
        setSyncingMonths(prev => ({
          ...prev,
          [monthId]: { status: 'syncing', message: msg, progress }
        }));
      });

      if (result.success) {
        setSyncingMonths(prev => ({
          ...prev,
          [monthId]: { status: 'success', message: result.message, progress: 100 }
        }));
        setSpreadsheetStatus({
          type: 'success',
          message: result.message
        });
      } else {
        setSyncingMonths(prev => ({
          ...prev,
          [monthId]: { status: 'error', message: result.message, progress: 0 }
        }));
        setSpreadsheetStatus({
          type: 'error',
          message: result.message
        });
      }

      setTimeout(() => {
        setSyncingMonths(prev => ({
          ...prev,
          [monthId]: null
        }));
      }, 5000);

    } catch (err: any) {
      console.error(err);
      setSyncingMonths(prev => ({
        ...prev,
        [monthId]: { status: 'error', message: String(err), progress: 0 }
      }));
      setSpreadsheetStatus({
        type: 'error',
        message: 'Gagal sinkron data: ' + (err?.message || String(err))
      });
      setTimeout(() => {
        setSyncingMonths(prev => ({
          ...prev,
          [monthId]: null
        }));
      }, 5000);
    }
  };

  const handleLinkChange = (monthId: string, value: string) => {
    setMonthlyLinks(prev => ({
      ...prev,
      [monthId]: value
    }));
  };

  const handleSaveSingleLink = async (monthId: string, value: string) => {
    if (savingMonths[monthId] === 'saving') return;
    
    setSavingMonths(prev => ({ ...prev, [monthId]: 'saving' }));
    try {
      const updatedLinks: MonthlyLinks = { ...monthlyLinks };
      updatedLinks[monthId] = (value || '').trim();

      const firstValidLink = Object.keys(updatedLinks)
        .map(key => updatedLinks[key])
        .find(link => (link || '').trim() !== '') || '';

      await setDoc(doc(db, 'settings', 'global_config'), { 
        medicine_usage_monthly_links: updatedLinks,
        medicine_usage_spreadsheet: firstValidLink
      }, { merge: true });

      setMonthlyLinks(updatedLinks);
      setLoadedLinks(updatedLinks);
      
      setSavingMonths(prev => ({ ...prev, [monthId]: 'saved' }));
      setTimeout(() => {
        setSavingMonths(prev => ({ ...prev, [monthId]: null }));
      }, 3000);
    } catch (err: any) {
      console.error(`Gagal menyimpan link bulan ${monthId}:`, err);
      setSavingMonths(prev => ({ ...prev, [monthId]: null }));
      setSpreadsheetStatus({
        type: 'error',
        message: 'Gagal menyimpan tautan ke cloud database: ' + (err.message || String(err))
      });
      setTimeout(() => setSpreadsheetStatus(null), 5000);
    }
  };

  const handleSaveAllLinks = async () => {
    setSavingSpreadsheet(true);
    setSpreadsheetStatus(null);
    try {
      // Clean and trim all links
      const cleanedLinks: MonthlyLinks = {};
      MONTHS.forEach(m => {
        cleanedLinks[m.id] = (monthlyLinks[m.id] || '').trim();
      });

      // Find the first valid link to set as primary legacy fallback just in case
      const firstValidLink = Object.keys(cleanedLinks)
        .map(key => cleanedLinks[key])
        .find(link => (link || '').trim() !== '') || '';

      // Securely wait for document write to complete before showing success
      await setDoc(doc(db, 'settings', 'global_config'), { 
        medicine_usage_monthly_links: cleanedLinks,
        medicine_usage_spreadsheet: firstValidLink 
      }, { merge: true });
      
      setLoadedLinks(cleanedLinks);
      setSpreadsheetStatus({
        type: 'success',
        message: 'Tautan Google Spreadsheet untuk 12 Bulan berhasil disimpan secara langsung!'
      });

      setTimeout(() => setSpreadsheetStatus(null), 5000);
    } catch (err: any) {
      console.error("Gagal menyimpan link spreadsheet:", err);
      setSpreadsheetStatus({
        type: 'error',
        message: 'Gagal menyimpan konfigurasi ke database cloud: ' + (err.message || String(err))
      });
      setTimeout(() => setSpreadsheetStatus(null), 5000);
    } finally {
      setSavingSpreadsheet(false);
    }
  };

  // Helper to quickly fill all empty months with a link (useful if same spreadsheet used yearly or has multiple tabs)
  const handlePropagateFirstLink = () => {
    const firstLink = Object.keys(monthlyLinks)
      .map(key => monthlyLinks[key])
      .find(link => (link || '').trim() !== '') || '';
    if (!firstLink) {
      setSpreadsheetStatus({
        type: 'error',
        message: 'Isi setidaknya satu baris link terlebih dahulu sebelum menyalin!'
      });
      setTimeout(() => setSpreadsheetStatus(null), 3500);
      return;
    }
    const updated: MonthlyLinks = {};
    MONTHS.forEach(m => {
      updated[m.id] = monthlyLinks[m.id].trim() !== '' ? monthlyLinks[m.id] : firstLink;
    });
    setMonthlyLinks(updated);
    setSpreadsheetStatus({
      type: 'success',
      message: 'Berhasil menyalin tautan ke seluruh bulan kosong. Jangan lupa klik tombol Simpan.'
    });
    setTimeout(() => setSpreadsheetStatus(null), 4000);
  };

  const currentMonthNum = String(new Date().getMonth() + 1).padStart(2, '0');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header section with status info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm print:hidden">
        <div className="flex items-center gap-4">
          <div className="h-8 w-1 bg-emerald-600 rounded-full" />
          <div>
            <h1 className="text-sm font-black text-slate-900 tracking-wider uppercase">Laporan Pemakaian Obat (12 Bulan)</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Penyimpanan Tautan Spreadsheet Pemakaian Obat Bulanan</p>
          </div>
        </div>

        {/* Action controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePropagateFirstLink}
            className="border border-slate-200 hover:bg-slate-50 text-slate-600 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors inline-flex items-center gap-1.5 cursor-pointer"
            title="Salin tautan pertama yang diisi ke bulan-bulan kosong lainnya"
          >
            Salin Ke Bulan Kosong
          </button>
          
          <button
            type="button"
            onClick={handleSaveAllLinks}
            disabled={savingSpreadsheet}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all inline-flex items-center gap-1.5 shadow-sm shadow-emerald-100 cursor-pointer"
          >
            {savingSpreadsheet ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>{savingSpreadsheet ? 'Menyimpan...' : 'Simpan Semua Link'}</span>
          </button>
        </div>
      </div>

      <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/55 text-blue-950 text-xs font-semibold shadow-sm animate-fade-in flex items-start gap-3">
        <FileSpreadsheet className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <span className="block font-black text-[11px] uppercase tracking-wider mb-0.5 text-blue-900">Penyimpanan Tautan Laporan</span>
          <span className="text-slate-600 font-medium leading-relaxed">Halaman ini digunakan khusus untuk menyimpan, mengedit, dan mengorganisir tautan (link) dokumen laporan pemakaian obat eksternal bulanan Anda agar mudah diakses langsung dari sistem UKS.</span>
        </div>
      </div>

      {spreadsheetStatus && (
        <div className={cn(
          "p-4 rounded-xl flex items-start gap-3 border text-xs font-semibold shadow-sm animate-fade-in",
          spreadsheetStatus.type === 'success' 
            ? "bg-emerald-50 border-emerald-100 text-emerald-800" 
            : "bg-rose-50 border-rose-100 text-rose-800"
        )}>
          {spreadsheetStatus.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
          )}
          <div>
            <span className="block font-black text-[11px] uppercase tracking-wider mb-0.5">
              {spreadsheetStatus.type === 'success' ? 'Berhasil Disimpan' : 'Terjadi Kesalahan'}
            </span>
            <span>{spreadsheetStatus.message}</span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white p-12 text-center rounded-xl border border-slate-100 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
          <p className="text-xs text-slate-500 uppercase tracking-widest font-black">Memuat link spreadsheet bulanan...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          
          {/* Main Month inputs block - 12 Columns List */}
          <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-500" />
                <h2 className="text-xs font-black tracking-wider text-slate-800 uppercase">Daftar Laporan Spreadsheet Bulanan</h2>
              </div>
              
              {/* Quick filter helper */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Tampilkan:</span>
                <button
                  onClick={() => setActiveMonthFilter('all')}
                  className={cn(
                    "px-2.5 py-1 rounded text-[9px] font-black uppercase tracking-wider cursor-pointer transition-all",
                    activeMonthFilter === 'all' 
                      ? "bg-slate-950 text-white shadow-sm" 
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  Semua (12B)
                </button>
                <button
                  onClick={() => setActiveMonthFilter('filled')}
                  className={cn(
                    "px-2.5 py-1 rounded text-[9px] font-black uppercase tracking-wider cursor-pointer transition-all",
                    activeMonthFilter === 'filled' 
                      ? "bg-slate-950 text-white shadow-sm" 
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  Telah Diisi
                </button>
                <button
                  onClick={() => setActiveMonthFilter('empty')}
                  className={cn(
                    "px-2.5 py-1 rounded text-[9px] font-black uppercase tracking-wider cursor-pointer transition-all",
                    activeMonthFilter === 'empty' 
                      ? "bg-slate-950 text-white shadow-sm" 
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  Kosong
                </button>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {(() => {
                const isAnyVisible = MONTHS.some((m) => {
                  const isFilledConfirm = (loadedLinks[m.id] || '').trim() !== '';
                  if (activeMonthFilter === 'filled') return isFilledConfirm;
                  if (activeMonthFilter === 'empty') return !isFilledConfirm;
                  return true;
                });

                return (
                  <>
                    {!isAnyVisible && (
                      <div key="empty-slate-message" className="p-8 text-center text-slate-400 italic text-[11px] font-medium uppercase tracking-wider">
                        Tidak ada laporan bulanan yang sesuai dengan filter.
                      </div>
                    )}

                    {MONTHS.map((m) => {
                      const isCurrentMonth = m.id === currentMonthNum;
                      const linkValue = monthlyLinks[m.id] || '';
                      
                      const isFilledConfirm = (loadedLinks[m.id] || '').trim() !== '';
                      const hasLink = isFilledConfirm;

                      let isVisible = true;
                      if (activeMonthFilter === 'filled') {
                        isVisible = isFilledConfirm;
                      } else if (activeMonthFilter === 'empty') {
                        isVisible = !isFilledConfirm;
                      }

                      return (
                        <div 
                          key={m.id} 
                          className={cn(
                            "p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors hover:bg-slate-50/50",
                            isCurrentMonth ? "bg-amber-50/20" : "",
                            !isVisible && "hidden"
                          )}
                        >
                          <div className="flex items-center gap-3 min-w-[150px] shrink-0">
                            <div className={cn(
                              "w-7 h-7 rounded-lg text-xs font-black flex items-center justify-center shrink-0 border uppercase",
                              isCurrentMonth 
                                ? "bg-amber-100 border-amber-200 text-amber-800 shadow-sm" 
                                : "bg-slate-50 border-slate-200 text-slate-700"
                            )}>
                              {m.id}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-black text-slate-800 uppercase tracking-wide">{m.name}</span>
                                {isCurrentMonth && (
                                  <span className="bg-amber-100 text-amber-950 border border-amber-200 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider">
                                    Bulan Ini
                                  </span>
                                )}
                              </div>
                              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block">Tahun berjalan</span>
                            </div>
                          </div>

                          {/* Simple URL Input block with inline save status */}
                          <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            <div className="flex-1 relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                                <Link className="w-3.5 h-3.5" />
                              </span>
                              <input
                                type="url"
                                value={linkValue}
                                onChange={(e) => handleLinkChange(m.id, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleSaveSingleLink(m.id, linkValue);
                                  }
                                }}
                                placeholder={`Masukkan link Google Spreadsheet untuk ${m.name}...`}
                                className={cn(
                                  "w-full pl-9 pr-4 py-2 border rounded text-xs outline-none transition-all font-sans text-slate-700",
                                  hasLink 
                                    ? "border-emerald-250 focus:ring-1 focus:ring-emerald-500 bg-emerald-50/10" 
                                    : "border-slate-200 focus:ring-1 focus:ring-slate-400 bg-slate-50/20"
                                )}
                              />
                            </div>

                            {/* Inline Status indicator */}
                            <div className="flex items-center justify-end shrink-0 min-h-[32px]">
                              {savingMonths[m.id] === 'saving' ? (
                                <div className="flex items-center gap-1 px-2 py-1.5 rounded text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-100 uppercase tracking-wider shrink-0">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                                  <span>Simpan...</span>
                                </div>
                              ) : savingMonths[m.id] === 'saved' ? (
                                <div className="flex items-center gap-1 px-2 py-1.5 rounded text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-250 uppercase tracking-wider shrink-0">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>Tersimpan!</span>
                                </div>
                              ) : (linkValue || '').trim() !== (loadedLinks[m.id] || '').trim() ? (
                                <button
                                  type="button"
                                  onClick={() => handleSaveSingleLink(m.id, linkValue)}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500 px-3 py-1.5 rounded text-[9px] font-black uppercase tracking-wider shadow-sm flex items-center gap-1 cursor-pointer shrink-0 transition-all hover:scale-[1.02]"
                                  title="Simpan perubahan baris ini"
                                >
                                  <Save className="w-3.5 h-3.5" />
                                  <span>Simpan</span>
                                </button>
                              ) : null}
                            </div>
                          </div>

                          {/* Instant open/view button */}
                          <div className="shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 min-w-[100px] justify-end">
                            {hasLink ? (
                              <div className="flex items-center gap-1.5">
                                <a
                                  href={linkValue.trim()}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/60 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-colors inline-flex items-center gap-1 cursor-pointer"
                                  title="Buka Spreadsheet di Tab Baru"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span>Buka Link</span>
                                </a>
                              </div>
                            ) : (
                              <div className="flex items-center py-1.5">
                                <span className="text-[9px] px-3 py-1 text-slate-400 italic font-semibold uppercase tracking-wider">
                                  Belum Ada Link
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>

            {/* Bottom bulk save bar */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={handleSaveAllLinks}
                disabled={savingSpreadsheet}
                className="bg-slate-900 hover:bg-slate-805 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all inline-flex items-center gap-2 cursor-pointer shadow-sm shadow-slate-300"
              >
                {savingSpreadsheet ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Simpan Semua Link
              </button>
            </div>
          </div>

          {/* Guide & Right Info side Column */}
          <div className="space-y-6">
            {/* Realtime Overview quick jump card */}
            <div className="bg-slate-900 text-white p-5 rounded-xl border border-slate-800 shadow-xl space-y-4">
              <div>
                <span className="text-[8px] font-black uppercase tracking-widest text-emerald-400">Penyimpanan Tautan</span>
                <h3 className="text-xs font-black tracking-wider text-white uppercase mt-0.5">Status Tautan Bulanan</h3>
                <p className="text-[10px] text-slate-400 leading-relaxed font-semibold mt-1">
                  Pantau ketersediaan tautan (link) Google Spreadsheet laporan pemakaian obat eksternal bulanan Anda.
                </p>
              </div>

              {/* Stats progress layout */}
              <div className="grid grid-cols-2 gap-4 py-2 border-y border-slate-800">
                <div className="space-y-0.5">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Terisi</span>
                  <div className="text-lg font-black text-emerald-400">
                    {Object.keys(monthlyLinks).filter(k => (monthlyLinks[k] || '').trim() !== '').length} <span className="text-xs text-slate-500 font-normal">/ 12</span>
                  </div>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Kosong</span>
                  <div className="text-lg font-black text-rose-400">
                    {Object.keys(monthlyLinks).filter(k => (monthlyLinks[k] || '').trim() === '').length} <span className="text-xs text-slate-500 font-normal">/ 12</span>
                  </div>
                </div>
              </div>

              {/* Interactive checklist of months */}
              <div className="max-h-[140px] overflow-y-auto pr-1 space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                {MONTHS.map(m => {
                  const hasLink = (monthlyLinks[m.id] || '').trim() !== '';
                  return (
                    <div key={m.id} className="flex items-center justify-between text-[10px] font-bold">
                      <span className="text-slate-300 uppercase shrink-0">{m.name}</span>
                      <div className="flex items-center gap-2">
                        {hasLink ? (
                          <span className="text-emerald-400 text-[8px] uppercase font-black tracking-wider bg-emerald-500/10 px-2 py-0.5 rounded">Aktif</span>
                        ) : (
                          <span className="text-slate-500 text-[8px] uppercase font-black tracking-wider bg-slate-800 px-2 py-0.5 rounded">Kosong</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Instruction Checklist Card */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h2 className="text-xs font-black tracking-wider text-slate-800 uppercase flex items-center gap-1.5">
                <HelpCircle className="w-4 h-4 text-cyan-600" />
                Cara Memasukkan Tautan
              </h2>

              <ul className="space-y-3">
                <li className="flex items-start gap-2.5 text-[11px] text-slate-600">
                  <span className="w-5 h-5 rounded-full bg-cyan-50 border border-cyan-100 flex items-center justify-center font-black text-[9px] text-cyan-800 shrink-0 mt-0.5">
                    1
                  </span>
                  <span className="font-semibold leading-relaxed">
                    Buka Google Spreadsheet lalu salin URL (link) pada bar alamat browser Anda.
                  </span>
                </li>

                <li className="flex items-start gap-2.5 text-[11px] text-slate-600">
                  <span className="w-5 h-5 rounded-full bg-cyan-50 border border-cyan-100 flex items-center justify-center font-black text-[9px] text-cyan-800 shrink-0 mt-0.5">
                    2
                  </span>
                  <span className="font-semibold leading-relaxed">
                    Tempelkan link ke baris bulan yang didata (misal: <strong className="font-bold text-slate-800">Juni</strong>).
                  </span>
                </li>

                <li className="flex items-start gap-2.5 text-[11px] text-slate-600">
                  <span className="w-5 h-5 rounded-full bg-cyan-50 border border-cyan-100 flex items-center justify-center font-black text-[9px] text-cyan-800 shrink-0 mt-0.5">
                    3
                  </span>
                  <span className="font-semibold leading-relaxed">
                    Klik tombol <strong className="font-bold text-slate-800">Simpan Semua Link</strong> di bagian atas atau bawah card untuk manyimpan secara permanen.
                  </span>
                </li>
              </ul>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
