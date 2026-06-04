import React, { useState } from 'react';
import { 
  collection, 
  writeBatch,
  doc, 
  getDocs,
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  AlertCircle, 
  CheckCircle2, 
  Loader2,
  Cloud,
  FileJson,
  Download,
  Check,
  RefreshCw,
  Server,
  Eye,
  EyeOff,
  MessageSquare
} from 'lucide-react';
import { cn } from '../lib/utils';
import { 
  getCachedDriveToken, 
  connectGoogleDrive, 
  listBackupsFromDrive, 
  uploadBackupToDrive, 
  downloadBackupFromDrive, 
  deleteBackupFromDrive,
  triggerAutoBackup 
} from '../lib/drive';
import { 
  syncMasterDataToSheets
} from '../lib/sheets';

export default function MasterDatabase() {
  const [loading, setLoading] = useState(false);
  const [driveConnected, setDriveConnected] = useState(false);
  const [backupHistory, setBackupHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupSuccess, setBackupSuccess] = useState<string | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<{ message: string; progress: number } | null>(null);

  const [autoBackupEnabled, setAutoBackupEnabled] = useState(() => {
    return localStorage.getItem('uks_auto_backup') !== 'false';
  });
  const [lastAutoBackup, setLastAutoBackup] = useState(() => {
    return localStorage.getItem('uks_last_auto_backup');
  });
  const [lastAutoBackupName, setLastAutoBackupName] = useState(() => {
    return localStorage.getItem('uks_last_auto_backup_name');
  });

  const [sheetsSyncLoading, setSheetsSyncLoading] = useState(false);
  const [sheetsSyncStatus, setSheetsSyncStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const handleSyncAllVisitsToSheets = async () => {
    setSheetsSyncLoading(true);
    setSheetsSyncStatus(null);
    try {
      const { syncAllVisitsToGoogleSheets } = await import('../lib/sheets');
      const result = await syncAllVisitsToGoogleSheets();
      if (result.success) {
        setSheetsSyncStatus({
          type: 'success',
          message: `Berhasil menyinkronkan seluruh ${result.count} data pemeriksaan klinik secara lengkap ke Google Sheets!`
        });
      } else {
        setSheetsSyncStatus({
          type: 'error',
          message: result.error || 'Gagal menyinkronkan data pemeriksaan ke Google Sheets. Pastikan akun Google sudah terhubung.'
        });
      }
    } catch (err: any) {
      console.error(err);
      setSheetsSyncStatus({
        type: 'error',
        message: err.message || 'Kesalahan sistem saat sinkronisasi Google Sheets.'
      });
    } finally {
      setSheetsSyncLoading(false);
    }
  };

  const [masterSheetsSyncLoading, setMasterSheetsSyncLoading] = useState(false);
  const [masterSheetsSyncStatus, setMasterSheetsSyncStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const handleSyncAllMasterToSheets = async () => {
    const token = getCachedDriveToken();
    if (!token) return;
    setMasterSheetsSyncLoading(true);
    setMasterSheetsSyncStatus(null);
    try {
      const { db } = await import('../lib/firebase');
      const { getDocs, collection } = await import('firebase/firestore');

      const [studentsSnap, medicinesSnap, diagnosesSnap] = await Promise.all([
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'medicines')),
        getDocs(collection(db, 'diagnoses'))
      ]);

      const students = studentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const medicines = medicinesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const diagnoses = diagnosesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const [resStudents, resMedicines, resDiagnoses] = await Promise.all([
        syncMasterDataToSheets(token, 'students', students),
        syncMasterDataToSheets(token, 'medicines', medicines),
        syncMasterDataToSheets(token, 'diagnoses', diagnoses)
      ]);

      if (resStudents && resMedicines && resDiagnoses) {
        setMasterSheetsSyncStatus({
          type: 'success',
          message: 'Berhasil menyinkronkan seluruh database master Pasien (Siswa), Obat, dan Diagnosa dari cloud ke Google Sheets!'
        });
      } else {
        setMasterSheetsSyncStatus({
          type: 'error',
          message: 'Gagal menyinkronkan satu atau lebih tabel master ke Google Sheets.'
        });
      }
    } catch (err: any) {
      console.error(err);
      setMasterSheetsSyncStatus({
        type: 'error',
        message: err.message || 'Kesalahan sistem saat sinkronisasi database master.'
      });
    } finally {
      setMasterSheetsSyncLoading(false);
    }
  };

  const [fonnteToken, setFonnteToken] = useState(() => {
    return localStorage.getItem('uks_fonnte_token') || '';
  });
  const [showFonnteToken, setShowFonnteToken] = useState(false);
  const [fonnteTestNumber, setFonnteTestNumber] = useState('');
  const [fonnteTestLoading, setFonnteTestLoading] = useState(false);
  const [fonnteTestStatus, setFonnteTestStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const handleSaveFonnteToken = () => {
    localStorage.setItem('uks_fonnte_token', fonnteToken);
    setFonnteTestStatus({
      type: 'success',
      message: 'Token Fonnte berhasil disimpan secara lokal!'
    });
  };

  const handleTestFonnteMessage = async () => {
    if (!fonnteTestNumber.trim()) {
      setFonnteTestStatus({
        type: 'error',
        message: 'Silakan isi nomor WhatsApp pengetesan terlebih dahulu!'
      });
      return;
    }
    setFonnteTestLoading(true);
    setFonnteTestStatus(null);
    try {
      const cleanNumber = fonnteTestNumber.replace(/\D/g, '');
      const formattedNumber = cleanNumber.startsWith('0') 
        ? '62' + cleanNumber.slice(1) 
        : (cleanNumber.startsWith('62') ? cleanNumber : '62' + cleanNumber);

      const response = await fetch('/api/send-wa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: formattedNumber,
          message: 'Halo! Ini adalah pesan pengujian integrasi WhatsApp dari aplikasi UKS PLUS SCB. Integrasi Fonnte Anda berjalan dengan sukses!',
          token: fonnteToken
        })
      });

      const resData = await response.json().catch(() => ({}));
      if (response.ok && resData.status !== false) {
        setFonnteTestStatus({
          type: 'success',
          message: 'Pesan tes koneksi Fonnte berhasil dipublikasikan! Silakan periksa HP Anda.'
        });
      } else {
        const detail = resData.reason || resData.detail || 'Fonnte device belum terkoneksi atau token salah.';
        setFonnteTestStatus({
          type: 'error',
          message: `Gagal mengirim pesan tes: ${detail}`
        });
      }
    } catch (err: any) {
      console.error(err);
      setFonnteTestStatus({
        type: 'error',
        message: err.message || 'Gagal menyambungkan ke server proxy WhatsApp.'
      });
    } finally {
      setFonnteTestLoading(false);
    }
  };

  React.useEffect(() => {
    const handleAutoBackupCompleted = () => {
      setLastAutoBackup(localStorage.getItem('uks_last_auto_backup'));
      setLastAutoBackupName(localStorage.getItem('uks_last_auto_backup_name'));
      const token = getCachedDriveToken();
      if (token) {
        loadBackupHistory(token);
      }
    };

    const handleConnectionChanged = (e: any) => {
      const isConnected = e.detail?.connected;
      setDriveConnected(isConnected);
      if (isConnected) {
        const token = getCachedDriveToken();
        if (token) {
          loadBackupHistory(token);
        }
      } else {
        setBackupHistory([]);
      }
    };

    window.addEventListener('uks_auto_backup_completed', handleAutoBackupCompleted);
    window.addEventListener('uks_drive_connection_changed', handleConnectionChanged);
    return () => {
      window.removeEventListener('uks_auto_backup_completed', handleAutoBackupCompleted);
      window.removeEventListener('uks_drive_connection_changed', handleConnectionChanged);
    };
  }, []);

  const checkDriveConnection = async () => {
    try {
      const token = getCachedDriveToken();
      if (token) {
        setDriveConnected(true);
        loadBackupHistory(token);
      } else {
        setDriveConnected(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  React.useEffect(() => {
    checkDriveConnection();
  }, []);

  const handleConnectDrive = async () => {
    setLoading(true);
    setBackupError(null);
    setBackupSuccess(null);
    try {
      const token = await connectGoogleDrive();
      if (token) {
        setDriveConnected(true);
        setBackupSuccess('Berhasil terhubung dengan Google Drive!');
        loadBackupHistory(token);
      }
    } catch (err: any) {
      console.error(err);
      setBackupError(err.message || 'Gagal menghubungkan ke Google Drive.');
    } finally {
      setLoading(false);
    }
  };

  const loadBackupHistory = async (token?: string) => {
    setHistoryLoading(true);
    try {
      const activeToken = token || getCachedDriveToken();
      if (!activeToken) return;
      const files = await listBackupsFromDrive(activeToken);
      setBackupHistory(files);
    } catch (err: any) {
      console.error('Error loading backup list:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleBackup = async () => {
    setBackupLoading(true);
    setBackupError(null);
    setBackupSuccess(null);
    try {
      let token = getCachedDriveToken();
      if (!token) {
        token = await connectGoogleDrive();
        setDriveConnected(true);
      }
      if (!token) throw new Error('Token Google Drive tidak tersedia.');

      const collectionsToBackup = [
        'students',
        'medicines',
        'diagnoses',
        'teachers',
        'visits',
        'medicineLogs',
        'medicineMonthlyData'
      ];

      const backupData: Record<string, any[]> = {};
      for (const colName of collectionsToBackup) {
        const snap = await getDocs(collection(db, colName));
        backupData[colName] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }

      const formattedDate = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `backup_uks_${formattedDate}.json`;
      
      await uploadBackupToDrive(token, backupData, filename);
      setBackupSuccess(`Pencadangan berhasil! File "${filename}" telah disimpan di Google Drive.`);
      loadBackupHistory(token);
    } catch (err: any) {
      console.error(err);
      setBackupError(err.message || 'Proses pencadangan gagal.');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleRestore = async (fileId: string, filename: string) => {
    const isConfirmed = window.confirm(
      `PERINGATAN SANGAT PENTING!\n\nApakah Anda yakin ingin memulihkan database dari file "${filename}" di Google Drive?\n\nTindakan ini akan mengosongkan seluruh database UKS Anda terlebih dahulu, lalu memasukkan data cadangan ini. Data yang ada saat ini akan hilang selamanya.`
    );
    if (!isConfirmed) return;

    setRestoreLoading(true);
    setRestoreStatus({ message: 'Menghubungkan ke Google Drive...', progress: 5 });
    try {
      const token = getCachedDriveToken();
      if (!token) throw new Error('Google Drive belum terhubung.');

      setRestoreStatus({ message: 'Mengunduh data cadangan dari Drive...', progress: 15 });
      const backupData = await downloadBackupFromDrive(token, fileId);

      const collectionsToRestore = [
        'students',
        'medicines',
        'diagnoses',
        'teachers',
        'visits',
        'medicineLogs',
        'medicineMonthlyData'
      ];

      let collectionIndex = 0;
      const totalCollections = collectionsToRestore.length;

      // Clean old data
      for (const colName of collectionsToRestore) {
        const percentage = 20 + Math.round((collectionIndex / totalCollections) * 30);
        setRestoreStatus({ message: `Sistem sedang menghapus data lama: ${colName}...`, progress: percentage });

        const snap = await getDocs(collection(db, colName));
        let batch = writeBatch(db);
        let count = 0;
        for (const d of snap.docs) {
          batch.delete(d.ref);
          count++;
          if (count >= 200) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) {
          await batch.commit();
        }
        collectionIndex++;
      }

      // Populate new backup data
      collectionIndex = 0;
      for (const colName of collectionsToRestore) {
        const dataToInsert = backupData[colName] || [];
        if (dataToInsert.length === 0) {
          collectionIndex++;
          continue;
        }

        const percentage = 50 + Math.round((collectionIndex / totalCollections) * 45);
        setRestoreStatus({ 
          message: `Mengisi data baru pada koleksi ${colName} (${dataToInsert.length} baris)...`, 
          progress: percentage 
        });

        let batch = writeBatch(db);
        let count = 0;
        for (const item of dataToInsert) {
          const { id, ...fields } = item;
          const docRef = doc(db, colName, id);
          batch.set(docRef, fields);
          count++;
          if (count >= 200) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) {
          await batch.commit();
        }
        collectionIndex++;
      }

      setRestoreStatus({ message: 'Proses sinkronisasi selesai!', progress: 100 });
      alert('Database UKS berhasil dipulihkan dari cadangan Google Drive anda!');
      window.location.reload();
    } catch (err: any) {
      console.error(err);
      alert(`Gagal memulihkan database: ${err.message}`);
    } finally {
      setRestoreLoading(false);
      setRestoreStatus(null);
    }
  };

  const handleDeleteBackup = async (fileId: string, filename: string) => {
    if (!window.confirm(`Hapus file cadangan "${filename}" dari Google Drive Anda?`)) return;
    try {
      const token = getCachedDriveToken();
      if (!token) return;
      await deleteBackupFromDrive(token, fileId);
      setBackupSuccess(`File cadangan "${filename}" berhasil dihapus.`);
      loadBackupHistory(token);
    } catch (err: any) {
      console.error(err);
      setBackupError(`Gagal menghapus file: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-slate-900 p-6 rounded-2xl text-white shadow-xl">
        <div>
          <h1 className="text-xl font-black uppercase tracking-tighter">Database <span className="text-blue-400">Master</span></h1>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Update referensi sistem global</p>
        </div>
      </div>

      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden space-y-6">
        {/* Header with connection status */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-black uppercase text-slate-900 tracking-tight flex items-center gap-2">
              <Cloud className="w-5 h-5 text-emerald-600 animate-pulse" /> Google Drive Cloud Storage & Cadangan
            </h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
              Integrasi Pencadangan Basis Data Utama UKS Terenkripsi
            </p>
          </div>
          
          {driveConnected ? (
            <div className="flex items-center gap-3 bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-100">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] font-black uppercase text-emerald-700">Terhubung ke Drive</span>
            </div>
          ) : (
            <button
              onClick={handleConnectDrive}
              disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-wider px-5 py-2.5 rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer border-none"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Hubungkan Google Drive'}
            </button>
          )}
        </div>

        {/* Status messages indicator */}
        {backupError && (
          <div className="p-4 bg-red-50 text-red-700 border border-red-100 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 font-bold" />
            <span className="text-[10px] font-black uppercase">{backupError}</span>
          </div>
        )}
        {backupSuccess && (
          <div className="p-4 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <span className="text-[10px] font-black uppercase">{backupSuccess}</span>
          </div>
        )}

        {/* Main control action block */}
        <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1 max-w-lg">
              <h4 className="text-[11px] font-black uppercase text-slate-900 tracking-wider">Arsip Otomatis Awan (Live Cloud Backup)</h4>
              <p className="text-[10px] text-slate-500 leading-relaxed font-semibold">
                Fitur ini mengompresi dan menyalin seluruh tabel aktif di database Anda meliputi daftar **Siswa/Pasien, Stok Obat, Log Riwayat Kunjungan/Kesehatan, Guru, Diagnosa, Log Apotek, dan Data Obat Bulanan** ke Google Drive pribadi Anda.
              </p>
            </div>
            <button
              onClick={handleBackup}
              disabled={backupLoading || restoreLoading}
              className="whitespace-nowrap bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-[10px] font-black uppercase tracking-widest px-6 py-4 rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-3 cursor-pointer border-none"
            >
              {backupLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sedang Mencadangkan...
                </>
              ) : (
                <>
                  <Server className="w-4 h-4" />
                  Buat Cadangan Baru
                </>
              )}
            </button>
          </div>
        </div>

        {/* Automatic Backup Configuration & Status Card */}
        <div className="p-6 bg-emerald-50/50 rounded-2xl border border-emerald-100 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1 max-w-xl">
              <h4 className="text-[11px] font-black uppercase text-emerald-950 tracking-wider flex items-center gap-2">
                 <span className="relative flex h-2 w-2">
                   <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                   <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                 </span>
                 Mekanisme Pencadangan Otomatis (Background Auto-Backup)
              </h4>
              <p className="text-[10px] text-emerald-800 leading-relaxed font-semibold">
                Bila opsi ini diaktifkan, sistem akan otomatis melakukan pencadangan database secara mandiri di latar belakang Google Drive Anda setiap kali Anda menambahkan data kunjungan atau melakukan verifikasi riwayat kesehatan.
              </p>
            </div>
            
            <div className="flex items-center gap-3 bg-white px-4 py-2.5 rounded-xl border border-emerald-100 shadow-sm">
              <label className="relative inline-flex items-center cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={autoBackupEnabled} 
                  onChange={(e) => {
                    const val = e.target.checked;
                    setAutoBackupEnabled(val);
                    localStorage.setItem('uks_auto_backup', val ? 'true' : 'false');
                  }}
                  className="sr-only peer" 
                />
                <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                <span className="ml-2.5 text-[10px] font-black uppercase text-slate-700">{autoBackupEnabled ? 'Aktif' : 'Mati'}</span>
              </label>
            </div>
          </div>

          {lastAutoBackup && (
            <div className="pt-3.5 border-t border-emerald-100/50 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase text-emerald-900 tracking-wide">
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>Sistem Berhasil Dicadangkan Otomatis:</span>
                <span className="font-semibold text-emerald-950 px-2 py-0.5 bg-emerald-100 rounded-md text-[9px]">{new Date(lastAutoBackup).toLocaleString('id-ID')}</span>
              </div>
              {lastAutoBackupName && (
                <span className="text-[9px] font-mono bg-emerald-100/50 text-emerald-800 px-2.5 py-1 rounded-md max-w-sm truncate" title={lastAutoBackupName}>
                  {lastAutoBackupName}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Google Sheets Live Database Sync Block */}
        <div className="p-6 bg-blue-50/40 rounded-2xl border border-blue-100 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1 max-w-xl">
              <h4 className="text-[11px] font-black uppercase text-blue-950 tracking-wider flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                Integrasi Database Google Sheets (Kunjungan Harian)
              </h4>
              <p className="text-[10px] text-blue-800 leading-relaxed font-semibold">
                Formulir Pemeriksaan Baru dikonfigurasi untuk menyinkronkan seluruh keluar-masuk data kunjungan secara real-time ke spreadsheet target di bawah ini. Anda dapat membuka lembar dokumen ini secara langsung atau memicu sinkronisasi massal data riwayat klinis yang ada.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a 
                href="https://docs.google.com/spreadsheets/d/1ucDQBJmJwcWnawmWIuQXTZXBlm4sMA0XKxWzBlA5Fv8/edit?gid=0#gid=0"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white hover:bg-slate-50 border border-blue-200 text-blue-700 text-[10px] font-black uppercase tracking-wider px-4 py-2.5 rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer decoration-none font-bold"
              >
                Buka Google Sheet ➜
              </a>
              
              <button
                onClick={handleSyncAllVisitsToSheets}
                disabled={sheetsSyncLoading || !driveConnected}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[10px] font-black uppercase tracking-wider px-4 py-2.5 rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-2 cursor-pointer border-none"
              >
                {sheetsSyncLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Menyinkronkan...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-none" />
                    Sinkronisasi Massal Data
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-blue-100/50 flex flex-col md:flex-row md:items-center justify-between gap-3 text-[10px]">
            <div className="flex items-center gap-2 font-black uppercase text-blue-900 tracking-wide">
              <span>ID Spreadsheet Target:</span>
              <span className="font-mono bg-blue-100 text-blue-950 px-2 py-0.5 rounded text-[9px] select-all">1ucDQBJmJwcWnawmWIuQXTZXBlm4sMA0XKxWzBlA5Fv8</span>
            </div>
            
            {sheetsSyncStatus && (
              <span className={cn(
                "text-[9px] font-black uppercase px-2.5 py-1 rounded-md",
                sheetsSyncStatus.type === 'success' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-red-100 text-red-800 border border-red-200'
              )}>
                {sheetsSyncStatus.message}
              </span>
            )}
          </div>
        </div>

        {/* Google Sheets Master Database Sync Block */}
        <div className="p-6 bg-violet-50/40 rounded-2xl border border-violet-100 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1 max-w-xl">
              <h4 className="text-[11px] font-black uppercase text-violet-950 tracking-wider flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
                </span>
                Sinkronisasi Master Database ke Google Sheets
              </h4>
              <p className="text-[10px] text-violet-800 leading-relaxed font-semibold">
                Anda dapat memicu pengunggahan massal seluruh data master Pasien, Obat, dan Diagnosa lokal Anda ke lembar kerja bersangkutan di Google Spreadsheet target secara manual.
              </p>
            </div>

            <button
              onClick={handleSyncAllMasterToSheets}
              disabled={masterSheetsSyncLoading || !driveConnected}
              className="bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[10px] font-black uppercase tracking-wider px-5 py-3 rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-2 cursor-pointer border-none font-bold"
            >
              {masterSheetsSyncLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Mengunggah...
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-none" />
                  Unggah Massal ke Google Sheets
                </>
              )}
            </button>
          </div>

          <div className="pt-3 border-t border-violet-100/50 flex flex-col md:flex-row md:items-center justify-between gap-3 text-[10px]">
            <div className="flex items-center gap-2 font-black uppercase text-violet-900 tracking-wide">
              <span>Status Koneksi Master:</span>
              <span className={cn(
                "px-2 py-0.5 rounded text-[9px] font-bold",
                driveConnected ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
              )}>
                {driveConnected ? "Terkoneksi (Membaca langsung dari Sprei/Spreadsheet)" : "Terputus (Menggunakan Database Lokal/Firestore)"}
              </span>
            </div>
            
            {masterSheetsSyncStatus && (
              <span className={cn(
                "text-[9px] font-black uppercase px-2.5 py-1 rounded-md",
                masterSheetsSyncStatus.type === 'success' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-red-100 text-red-800 border border-red-200'
              )}>
                {masterSheetsSyncStatus.message}
              </span>
            )}
          </div>
        </div>

        {/* Integrasi WhatsApp Fonnte Block */}
        <div className="p-6 bg-cyan-50/40 rounded-2xl border border-cyan-100 space-y-4">
          <div className="space-y-1">
            <h4 className="text-[11px] font-black uppercase text-cyan-950 tracking-wider flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-700"></span>
              </span>
              Pengaturan API WhatsApp Fonnte (Kirim Otomatis)
            </h4>
            <p className="text-[10px] text-cyan-800 leading-relaxed font-semibold">
              Masukkan token API Fonnte Anda di bawah ini agar sistem dapat mengirimkan notifikasi pemeriksaan kesehatan secara otomatis ke Wali Kelas dan Pembina. Gunakan tombol tes di sebelah kanan untuk memverifikasi device Anda siap mengirim pesan.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2">
            <div className="lg:col-span-6 space-y-2">
              <label className="text-[9px] font-black uppercase tracking-wider text-cyan-900 block font-bold">Token API Fonnte</label>
              <div className="relative">
                <input
                  type={showFonnteToken ? "text" : "password"}
                  value={fonnteToken}
                  onChange={(e) => setFonnteToken(e.target.value)}
                  placeholder="Masukkan token Fonnte Anda..."
                  className="w-full bg-white border border-cyan-200 rounded-xl px-4 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-cyan-500 font-mono transition-colors pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowFonnteToken(!showFonnteToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer border-none bg-transparent"
                >
                  {showFonnteToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[9px] text-cyan-700/80 font-semibold uppercase">Kosongkan untuk menggunakan fallback server</span>
                <button
                  onClick={handleSaveFonnteToken}
                  className="bg-cyan-600 hover:bg-cyan-700 border-none text-white font-black uppercase tracking-wider text-[9px] px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                  Simpan Token
                </button>
              </div>
            </div>

            <div className="lg:col-span-6 p-4 bg-white/60 rounded-xl border border-cyan-100/60 space-y-3">
              <span className="text-[9px] font-black uppercase tracking-wider text-cyan-950 block font-bold">Pengujian Koneksi Device Fonnte</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={fonnteTestNumber}
                  onChange={(e) => setFonnteTestNumber(e.target.value)}
                  placeholder="Contoh: 08123456789 atau 628123..."
                  className="flex-1 bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-cyan-500 transition-colors font-bold"
                />
                <button
                  onClick={handleTestFonnteMessage}
                  disabled={fonnteTestLoading}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 border-none text-white font-black uppercase tracking-wider text-[9px] px-4 py-2.5 rounded-xl shadow-sm hover:shadow transition-all inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {fonnteTestLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Menguji...
                    </>
                  ) : (
                    <>
                      <MessageSquare className="w-3.5 h-3.5" />
                      Kirim Pesan Tes
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {fonnteTestStatus && (
            <div className={cn(
              "p-3 rounded-lg border text-[9px] font-black uppercase tracking-wide flex items-center gap-2",
              fonnteTestStatus.type === 'success' 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                : 'bg-rose-50 border-rose-200 text-rose-800'
            )}>
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{fonnteTestStatus.message}</span>
            </div>
          )}
        </div>

        {/* History of restores */}
        <div className="space-y-4 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Riwayat Titik Cadangan (Cloud Restore Points)
            </h3>
            {driveConnected && (
              <button
                onClick={() => loadBackupHistory()}
                className="p-1 px-3 text-[9px] font-black uppercase text-blue-600 border border-blue-100 rounded-lg hover:bg-blue-50 cursor-pointer"
              >
                Segarkan
              </button>
            )}
          </div>

          {!driveConnected ? (
            <div className="border border-slate-100 rounded-2xl p-12 text-center bg-slate-50/50">
              <Cloud className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Google Drive Belum Terhubung</p>
              <p className="text-[9px] text-slate-400 mt-1 max-w-sm mx-auto font-semibold">
                Silakan hubungkan akun Google Anda terlebih dahulu untuk memproses atau menarik titik pemulihan database dari awan.
              </p>
            </div>
          ) : historyLoading ? (
            <div className="py-12 text-center">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-2" />
              <p className="text-[10px] font-black uppercase text-slate-400">Memuat berkas file dari Google Drive...</p>
            </div>
          ) : backupHistory.length > 0 ? (
            <div className="overflow-x-auto border border-slate-100 rounded-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400">File Cadangan</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400">Ukuran</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400">Tanggal Dibuat</th>
                    <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400 text-right">Tindakan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {backupHistory.map((file) => (
                    <tr key={file.id} className="hover:bg-slate-50/50 group transition-colors">
                      <td className="px-4 py-4 text-[11px] font-black text-slate-900 flex items-center gap-2">
                        <FileJson className="w-4 h-4 text-emerald-500" />
                        {file.name}
                      </td>
                      <td className="px-4 py-4 text-[10px] font-bold text-slate-500">
                        {file.size ? `${(file.size / 1024).toFixed(1)} KB` : 'N/A'}
                      </td>
                      <td className="px-4 py-4 text-[10px] font-bold text-slate-500">
                        {new Date(file.createdTime).toLocaleString('id-ID')}
                      </td>
                      <td className="px-4 py-4 text-right space-x-2">
                        <button
                          onClick={() => handleRestore(file.id, file.name)}
                          disabled={restoreLoading || backupLoading}
                          className="px-3 py-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white rounded-lg text-[9px] font-black uppercase tracking-wider transition-all inline-flex items-center gap-1 cursor-pointer border-none"
                        >
                          <Download className="w-3 h-3" />
                          Pulihkan
                        </button>
                        <button
                          onClick={() => handleDeleteBackup(file.id, file.name)}
                          disabled={restoreLoading || backupLoading}
                          className="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-lg text-[9px] font-black uppercase tracking-wider transition-all inline-block align-middle cursor-pointer border-none"
                        >
                          Hapus
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="border border-slate-100 rounded-2xl p-12 text-center bg-slate-50/50">
              <FileJson className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Belum Ada File Cadangan</p>
              <p className="text-[9px] text-slate-400 mt-1 font-semibold">
                Sistem tidak mendeteksi file cadangan di folder Google Drive Anda. Silakan klik tombol 'Buat Cadangan Baru' di atas.
              </p>
            </div>
          )}
        </div>

        {/* Restoration process overlay block */}
        {restoreStatus && (
          <div className="absolute inset-0 bg-slate-900/95 backdrop-blur-md z-50 flex flex-col items-center justify-center p-8 text-center text-white">
            <Loader2 className="w-12 h-12 text-emerald-400 animate-spin mb-6" />
            <h3 className="text-base font-black uppercase tracking-wider mb-2">PULIHKAN DATABASE SEDANG BERLANGSUNG</h3>
            <p className="text-[11px] text-zinc-400 max-w-md uppercase font-bold tracking-widest animate-pulse mb-8">
              {restoreStatus.message}
            </p>
            <div className="w-80 bg-zinc-800 h-3 rounded-full overflow-hidden border border-zinc-700 p-0.5">
              <div 
                className="bg-emerald-400 h-full rounded-full transition-all duration-300"
                style={{ width: `${restoreStatus.progress}%` }}
              />
            </div>
            <span className="text-[10px] text-zinc-400 mt-2 font-mono">{restoreStatus.progress}% Selesai</span>
            <p className="text-[9px] text-zinc-500 mt-6 max-w-xs font-bold leading-relaxed uppercase">
              Jangan tutup tab ini atau menyegarkan halaman browser Anda selama pemulihan sedang berjalan!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
