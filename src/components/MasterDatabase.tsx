import React, { useState } from 'react';
import { 
  collection, 
  writeBatch,
  doc, 
  getDocs,
  setDoc,
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
import { cn, sanitizeMedicines } from '../lib/utils';
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

  const [dailySheetLink, setDailySheetLink] = useState(() => {
    return localStorage.getItem('uks_daily_visit_spreadsheet_link') || 'https://docs.google.com/spreadsheets/d/17EEP1c0klbntmLxVsjYGElkEqLejLncqvnDNoqsfZsc/edit?gid=0#gid=0';
  });
  const [masterSheetLink, setMasterSheetLink] = useState(() => {
    return localStorage.getItem('uks_master_spreadsheet_link') || 'https://docs.google.com/spreadsheets/d/1ucDQBJmJwcWnawmWIuQXTZXBlm4sMA0XKxWzBlA5Fv8/edit?gid=0#gid=0';
  });
  const [savingDailyLink, setSavingDailyLink] = useState(false);
  const [savingMasterLink, setSavingMasterLink] = useState(false);

  const handleSaveDailyLink = async () => {
    setSavingDailyLink(true);
    try {
      const link = dailySheetLink.trim();
      const match = link.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const id = match ? match[1] : link;

      const { db } = await import('../lib/firebase');
      const { doc, setDoc } = await import('firebase/firestore');

      await setDoc(doc(db, 'settings', 'global_config'), {
        daily_visit_spreadsheet_link: link,
        daily_visit_spreadsheet_id: id
      }, { merge: true });

      localStorage.setItem('uks_daily_visit_spreadsheet_link', link);
      localStorage.setItem('uks_daily_visit_spreadsheet_id', id);
      alert('Berhasil menyimpan tautan Spreadsheet Laporan Pemeriksaan Otomatis!');
    } catch (err: any) {
      console.error(err);
      alert('Gagal menyimpan tautan spreadsheet: ' + (err.message || String(err)));
    } finally {
      setSavingDailyLink(false);
    }
  };

  const handleSaveMasterLink = async () => {
    setSavingMasterLink(true);
    try {
      const link = masterSheetLink.trim();
      const match = link.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const id = match ? match[1] : link;

      const { db } = await import('../lib/firebase');
      const { doc, setDoc } = await import('firebase/firestore');

      await setDoc(doc(db, 'settings', 'global_config'), {
        master_spreadsheet_link: link,
        master_spreadsheet_id: id
      }, { merge: true });

      localStorage.setItem('uks_master_spreadsheet_link', link);
      localStorage.setItem('uks_master_spreadsheet_id', id);
      alert('Berhasil menyimpan tautan Spreadsheet Master Database!');
    } catch (err: any) {
      console.error(err);
      alert('Gagal menyimpan tautan spreadsheet: ' + (err.message || String(err)));
    } finally {
      setSavingMasterLink(false);
    }
  };

  const [savingAllDailyVisits, setSavingAllDailyVisits] = useState(false);
  const [dailyVisitsSyncStatus, setDailyVisitsSyncStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const handleSyncAllDailyVisits = async () => {
    const token = getCachedDriveToken();
    if (!token) {
      alert('Hubungkan Google Drive/Sheets terlebih dahulu.');
      return;
    }
    setSavingAllDailyVisits(true);
    setDailyVisitsSyncStatus(null);
    try {
      const { syncAllVisitsToGoogleSheets } = await import('../lib/sheets');
      const res = await syncAllVisitsToGoogleSheets();
      if (res && res.success) {
        alert(`Berhasil melakukan sinkronisasi massal! ${res.count} data kunjungan disinkronkan ke Google Sheets harian.`);
        setDailyVisitsSyncStatus({
          type: 'success',
          message: `Berhasil mensinkronkan massal ${res.count} data kunjungan.`
        });
      } else {
        throw new Error(res.error || 'Terjadi kesalahan tidak diketahui.');
      }
    } catch (err: any) {
      console.error(err);
      alert('Gagal mensinkronkan seluruh kunjungan harian: ' + (err.message || String(err)));
      setDailyVisitsSyncStatus({
        type: 'error',
        message: 'Gagal sinkronisasi data: ' + (err.message || String(err))
      });
    } finally {
      setSavingAllDailyVisits(false);
    }
  };

  const [masterSheetsSyncLoading, setMasterSheetsSyncLoading] = useState(false);
  const [masterSheetsSyncStatus, setMasterSheetsSyncStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const [masterSheetsImportLoading, setMasterSheetsImportLoading] = useState(false);
  const [masterSheetsImportStatus, setMasterSheetsImportStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const handleSyncAllMasterFromSheets = async () => {
    const token = getCachedDriveToken();
    if (!token) return;
    setMasterSheetsImportLoading(true);
    setMasterSheetsImportStatus(null);
    try {
      const { db } = await import('../lib/firebase');
      const { doc, setDoc } = await import('firebase/firestore');
      const { fetchMasterDataFromSheets } = await import('../lib/sheets');

      const [sheetStudents, rawMedicines, sheetDiagnoses, sheetTeachers] = await Promise.all([
        fetchMasterDataFromSheets(token, 'students'),
        fetchMasterDataFromSheets(token, 'medicines'),
        fetchMasterDataFromSheets(token, 'diagnoses'),
        fetchMasterDataFromSheets(token, 'teachers')
      ]);

      const sheetMedicines = sanitizeMedicines(rawMedicines);

      const writePromises: Promise<any>[] = [];

      if (sheetStudents && sheetStudents.length > 0) {
        sheetStudents.forEach((student) => {
          if (student.id && student.name) {
            writePromises.push(setDoc(doc(db, 'students', student.id), {
              name: student.name,
              gender: student.gender || 'Laki-laki',
              grade: student.grade || '',
              birthDate: student.birthDate || '',
              bermasalah: !!student.bermasalah
            }, { merge: true }));
          }
        });
      }

      if (sheetMedicines && sheetMedicines.length > 0) {
        sheetMedicines.forEach((med) => {
          if (med.id && med.name) {
            writePromises.push(setDoc(doc(db, 'medicines', med.id), {
              name: med.name,
              obat: med.name,
              stock: med.stock || 0,
              unit: med.unit || 'Pcs'
            }, { merge: true }));
          }
        });
      }

      if (sheetDiagnoses && sheetDiagnoses.length > 0) {
        sheetDiagnoses.forEach((diag) => {
          if (diag.id && diag.name) {
            writePromises.push(setDoc(doc(db, 'diagnoses', diag.id), {
              name: diag.name,
              diagnosa: diag.name
            }, { merge: true }));
          }
        });
      }

      if (sheetTeachers && sheetTeachers.length > 0) {
        sheetTeachers.forEach((teacher) => {
          if (teacher.id && teacher.name) {
            writePromises.push(setDoc(doc(db, 'teachers', teacher.id), {
              name: teacher.name,
              whatsapp: teacher.whatsapp || '',
              role: teacher.role || '',
              grade: teacher.grade || '',
              gender: teacher.gender || ''
            }, { merge: true }));
          }
        });
      }

      if (writePromises.length > 0) {
        await Promise.all(writePromises);
        
        // Force refresh local cache
        localStorage.setItem('uks_cache_students', JSON.stringify(sheetStudents));
        localStorage.setItem('uks_cache_medicines', JSON.stringify(sheetMedicines));
        localStorage.setItem('uks_cache_diagnoses', JSON.stringify(sheetDiagnoses));
        localStorage.setItem('uks_cache_teachers', JSON.stringify(sheetTeachers));

        setMasterSheetsImportStatus({
          type: 'success',
          message: `Berhasil mengimpor & menyinkronkan ${sheetStudents.length} Pasien, ${sheetMedicines.length} Obat, ${sheetDiagnoses.length} Diagnosa, dan ${sheetTeachers.length} Wali Kelas / Pembina dari Google Sheets ke database aplikasi (Firestore)!`
        });
      } else {
        setMasterSheetsImportStatus({
          type: 'error',
          message: 'Gagal mengimpor: Tidak ada data master yang valid ditemukan dari Google Sheets Anda.'
        });
      }
    } catch (err: any) {
      console.error(err);
      setMasterSheetsImportStatus({
        type: 'error',
        message: 'Gagal sinkronisasi data dari Google Sheets: ' + (err.message || String(err))
      });
    } finally {
      setMasterSheetsImportLoading(false);
    }
  };

  const handleSyncAllMasterToSheets = async () => {
    const token = getCachedDriveToken();
    if (!token) return;
    setMasterSheetsSyncLoading(true);
    setMasterSheetsSyncStatus(null);
    try {
      const { db } = await import('../lib/firebase');
      const { getDocs, collection } = await import('firebase/firestore');

      const [studentsSnap, medicinesSnap, diagnosesSnap, teachersSnap] = await Promise.all([
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'medicines')),
        getDocs(collection(db, 'diagnoses')),
        getDocs(collection(db, 'teachers'))
      ]);

      const students = studentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const medicines = medicinesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const diagnoses = diagnosesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const teachers = teachersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      const [resStudents, resMedicines, resDiagnoses, resTeachers] = await Promise.all([
        syncMasterDataToSheets(token, 'students', students),
        syncMasterDataToSheets(token, 'medicines', medicines),
        syncMasterDataToSheets(token, 'diagnoses', diagnoses),
        syncMasterDataToSheets(token, 'teachers', teachers)
      ]);

      if (resStudents && resMedicines && resDiagnoses && resTeachers) {
        setMasterSheetsSyncStatus({
          type: 'success',
          message: 'Berhasil menyinkronkan seluruh database master Pasien (Siswa), Obat, Diagnosa, dan Wali Kelas / Pembina dari cloud ke Google Sheets!'
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

  const handleSaveFonnteToken = async () => {
    localStorage.setItem('uks_fonnte_token', fonnteToken);
    try {
      await setDoc(doc(db, 'settings', 'global_config'), { fonnte_token: fonnteToken }, { merge: true });
      setFonnteTestStatus({
        type: 'success',
        message: 'Token Fonnte berhasil disimpan secara permanen di Cloud & Lokal!'
      });
    } catch (err: any) {
      console.warn("Gagal menyimpan token ke cloud, disimpan secara lokal saja:", err);
      setFonnteTestStatus({
        type: 'success',
        message: 'Token Fonnte berhasil disimpan secara lokal!'
      });
    }
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
        let customMessage = `Gagal mengirim pesan tes: ${detail}.`;
        
        if (detail.toLowerCase().includes("disconnected") || detail.toLowerCase().includes("disconnected device")) {
          customMessage = "Status Gagal: Perangkat WhatsApp Anda di Fonnte dalam keadaan Terputus (Disconnected). Silakan masuk ke dashboard Fonnte Anda di https://fonnte.com dan scan ulang QR Code untuk menghubungkannya. (Catatan: Sistem otomatis akan mengalihkan laporan pasien Anda via Jalur Cadangan UKS agar selalu sukses terkirim).";
        } else if (detail.toLowerCase().includes("invalid token") || detail.toLowerCase().includes("credential") || detail.toLowerCase().includes("unauthorized")) {
          customMessage = "Status Gagal: Token Fonnte yang Anda masukkan tidak valid atau salah ketik. Harap periksa kembali token Anda di tab Settings akun Fonnte Anda. (Catatan: Laporan pasien Anda dialihkan otomatis via Jalur Cadangan UKS sementara waktu).";
        }
        
        setFonnteTestStatus({
          type: 'error',
          message: customMessage
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
    const loadCustomConfigsFromDb = async () => {
      try {
        const { db } = await import('../lib/firebase');
        const { doc, getDoc } = await import('firebase/firestore');
        const snap = await getDoc(doc(db, 'settings', 'global_config'));
        if (snap.exists()) {
          const data = snap.data();
          if (data.daily_visit_spreadsheet_link) {
            setDailySheetLink(data.daily_visit_spreadsheet_link);
          }
          if (data.master_spreadsheet_link) {
            setMasterSheetLink(data.master_spreadsheet_link);
          }
        }
      } catch (err) {
        console.warn("Gagal memuat konfigurasi tautan spreadsheet dari Firestore:", err);
      }
    };
    loadCustomConfigsFromDb();

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

    const handleSettingsUpdated = (e: any) => {
      const data = e.detail;
      if (data) {
        if (data.daily_visit_spreadsheet_link !== undefined) {
          setDailySheetLink(data.daily_visit_spreadsheet_link || '');
        }
        if (data.master_spreadsheet_link !== undefined) {
          setMasterSheetLink(data.master_spreadsheet_link || '');
        }
        if (data.fonnte_token !== undefined) {
          setFonnteToken(data.fonnte_token || '');
        }
        if (data.auto_backup !== undefined) {
          setAutoBackupEnabled(data.auto_backup);
        }
      }
    };

    window.addEventListener('uks_auto_backup_completed', handleAutoBackupCompleted);
    window.addEventListener('uks_drive_connection_changed', handleConnectionChanged);
    window.addEventListener('uks_settings_updated', handleSettingsUpdated);
    return () => {
      window.removeEventListener('uks_auto_backup_completed', handleAutoBackupCompleted);
      window.removeEventListener('uks_drive_connection_changed', handleConnectionChanged);
      window.removeEventListener('uks_settings_updated', handleSettingsUpdated);
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
                    setDoc(doc(db, 'settings', 'global_config'), { auto_backup: val }, { merge: true })
                      .catch(err => console.error("Gagal sinkronisasi setelan cadangan otomatis ke cloud:", err));
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

        {/* Google Sheets Integration Blocks (Satu untuk Hasil Pemeriksaan, Satu untuk Master Database) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* SPREADSHEET 1 - HASIL PEMERIKSAAN BLOCK */}
          <div className="p-6 bg-blue-50/50 rounded-2xl border border-blue-100 flex flex-col justify-between space-y-4">
            <div className="space-y-1.5 border-none bg-transparent">
              <h4 className="text-[11px] font-black uppercase text-blue-950 tracking-wider flex items-center gap-2 m-0">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                Google Sheets Hasil Pemeriksaan (Kunjungan Harian)
              </h4>
              <p className="text-[10px] text-blue-800 leading-relaxed font-semibold m-0">
                Setiap data kunjungan harian / hasil pemeriksaan pasien yang baru disimpan secara otomatis diunggah dan disinkronkan secara real-time ke spreadsheet target ini.
              </p>
              <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider m-0">
                ➜ Menyimpan dan merekam seluruh riwayat aktivitas pemeriksaan klinik UKS secara otomatis di cloud.
              </p>
            </div>

            <div className="space-y-3 bg-transparent border-none">
              <div className="space-y-1 border-none bg-transparent">
                <label className="text-[9px] font-black uppercase tracking-wider text-blue-900 block font-bold border-none">Tautan Google Spreadsheet Laporan Kunjungan</label>
                <div className="flex gap-2 border-none">
                  <input
                    type="text"
                    value={dailySheetLink}
                    onChange={(e) => setDailySheetLink(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/your-spreadsheet-id/edit..."
                    className="flex-1 bg-white border border-blue-200 rounded-xl px-3.5 py-2 text-xs text-slate-850 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <button
                    onClick={handleSaveDailyLink}
                    disabled={savingDailyLink}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 border-none text-white font-black uppercase tracking-wider text-[9px] px-3.5 py-2 rounded-xl h-[34px] shadow-sm cursor-pointer transition-colors"
                  >
                    {savingDailyLink ? 'Simpan...' : 'Simpan'}
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-blue-100/50 flex flex-col gap-2.5 bg-transparent">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <a 
                    href={dailySheetLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-white hover:bg-slate-50 border border-blue-200 text-blue-700 text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer decoration-none font-bold"
                  >
                    Buka Sheet Laporan Pemeriksaan ➜
                  </a>
                  {driveConnected && (
                    <button
                      type="button"
                      onClick={handleSyncAllDailyVisits}
                      disabled={savingAllDailyVisits}
                      className="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {savingAllDailyVisits ? 'Sinkronisasi Massal...' : 'Sinkronkan Semua Kunjungan Massal ➜'}
                    </button>
                  )}
                </div>
                <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-[9px] font-bold uppercase">
                  Aktif Sinkronisasi Otomatis
                </span>
              </div>
              {dailyVisitsSyncStatus && (
                <div className={cn(
                  "p-3 rounded-xl border text-[10px] font-bold",
                  dailyVisitsSyncStatus.type === 'success' 
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
                    : "bg-rose-50 border-rose-200 text-rose-800"
                )}>
                  {dailyVisitsSyncStatus.message}
                </div>
              )}
            </div>
          </div>

          {/* SPREADSHEET 2 - MASTER DATABASE BLOCK */}
          <div className="p-6 bg-violet-50/50 rounded-2xl border border-violet-100 flex flex-col justify-between space-y-4">
            <div className="space-y-1.5 border-none bg-transparent">
              <h4 className="text-[11px] font-black uppercase text-violet-950 tracking-wider flex items-center gap-2 m-0">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
                </span>
                Google Sheets Master Database (Siswa, Obat, Diagnosa, Wali Kelas / Pembina)
              </h4>
              <p className="text-[10px] text-violet-850 leading-relaxed font-semibold m-0">
                Fitur Google Sheets ini **berfungsi sebagai gudang data master** (Daftar Siswa, Obat, Diagnosa, dan Nomor WA Wali Kelas / Pembina Guru) untuk disimpan, disinkronkan dan dibaca oleh aplikasi UKS.
              </p>
              <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider m-0">
                ➜ Sistem memuat data master dan nomor kontak guru pembina langsung dari spreadsheet ini secara dinamis.
              </p>
            </div>

            <div className="space-y-3 bg-transparent border-none">
              <div className="space-y-1 border-none bg-transparent">
                <label className="text-[9px] font-black uppercase tracking-wider text-violet-900 block font-bold border-none">Tautan Google Spreadsheet Master Database</label>
                <div className="flex gap-2 border-none">
                  <input
                    type="text"
                    value={masterSheetLink}
                    onChange={(e) => setMasterSheetLink(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/your-spreadsheet-id/edit..."
                    className="flex-1 bg-white border border-violet-200 rounded-xl px-3.5 py-2 text-xs text-slate-850 focus:outline-none focus:border-violet-500 transition-colors"
                  />
                  <button
                    onClick={handleSaveMasterLink}
                    disabled={savingMasterLink}
                    className="bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400 border-none text-white font-black uppercase tracking-wider text-[9px] px-3.5 py-2 rounded-xl h-[34px] shadow-sm cursor-pointer transition-colors"
                  >
                    {savingMasterLink ? 'Simpan...' : 'Simpan'}
                  </button>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-violet-100/50 space-y-3 bg-transparent">
              <div className="flex flex-wrap items-center justify-between gap-3 border-none bg-transparent m-0 p-0">
                <div className="flex items-center gap-2 border-none">
                  <a 
                    href={masterSheetLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-white hover:bg-slate-50 border border-violet-200 text-violet-700 text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer decoration-none font-bold"
                  >
                    Buka Sheet Master ➜
                  </a>
                  <button
                    onClick={handleSyncAllMasterToSheets}
                    disabled={masterSheetsSyncLoading || !driveConnected}
                    className="bg-violet-650 hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-2 cursor-pointer border-none font-bold"
                  >
                    {masterSheetsSyncLoading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Mengunggah...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-none" />
                        Unggah Massal Master (App ➔ Sheet)
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleSyncAllMasterFromSheets}
                    disabled={masterSheetsImportLoading || !driveConnected}
                    className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-2 cursor-pointer border-none font-bold"
                  >
                    {masterSheetsImportLoading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Mengimpor...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-none" />
                        Impor Massal Dari Sheets (Sheet ➔ App)
                      </>
                    )}
                  </button>
                </div>
                <span className={cn(
                  "px-2 py-1 rounded text-[9px] font-bold uppercase",
                  driveConnected ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                )}>
                  {driveConnected ? "Terkoneksi" : "Terputus"}
                </span>
              </div>

              {masterSheetsSyncStatus && (
                <div className={cn(
                  "text-[9px] font-black uppercase px-2.5 py-1 rounded-md text-center",
                  masterSheetsSyncStatus.type === 'success' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-red-100 text-red-800 border border-red-200'
                )}>
                  {masterSheetsSyncStatus.message}
                </div>
              )}

              {masterSheetsImportStatus && (
                <div className={cn(
                  "text-[9px] font-black uppercase px-2.5 py-1 rounded-md text-center",
                  masterSheetsImportStatus.type === 'success' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-red-100 text-red-800 border border-red-200'
                )}>
                  {masterSheetsImportStatus.message}
                </div>
              )}
            </div>
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
