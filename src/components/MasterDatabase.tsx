import React, { useState, useRef } from 'react';
import { 
  collection, 
  writeBatch,
  setDoc,
  doc, 
  getDocs,
  query,
  serverTimestamp,
  onSnapshot,
  orderBy,
  deleteDoc
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType, runWithRetry } from '../lib/firebase';
import { 
  Upload, 
  Trash2, 
  AlertCircle, 
  CheckCircle2, 
  Loader2,
  FileText,
  Users,
  Pill,
  Search,
  Plus,
  X,
  PlusCircle,
  Cloud,
  FileJson,
  Download,
  Check,
  RefreshCw,
  Server,
  DownloadCloud,
  Eye,
  EyeOff,
  MessageSquare,
  Key
} from 'lucide-react';
import { cn } from '../lib/utils';

type DatabaseType = 'students' | 'medicines' | 'diagnoses' | 'drive-backup';

export default function MasterDatabase() {
  const [activeDb, setActiveDb] = useState<DatabaseType>(() => {
    return (localStorage.getItem('uks_active_db') as DatabaseType) || 'students';
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({ students: 0, medicines: 0, diagnoses: 0 });
  const [uploadProgress, setUploadProgress] = useState<{ current: number, total: number } | null>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  // Google Drive Integration States & Logic
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
      const token = localStorage.getItem('drive_access_token');
      if (token) {
        loadBackupHistory(token);
      }
    };

    window.addEventListener('uks_auto_backup_completed', handleAutoBackupCompleted);
    return () => {
      window.removeEventListener('uks_auto_backup_completed', handleAutoBackupCompleted);
    };
  }, []);

  const checkDriveConnection = async () => {
    try {
      const { getCachedDriveToken } = await import('../lib/drive');
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
  }, [activeDb]);

  const handleConnectDrive = async () => {
    setLoading(true);
    setBackupError(null);
    setBackupSuccess(null);
    try {
      const { connectGoogleDrive } = await import('../lib/drive');
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
      const { getCachedDriveToken, listBackupsFromDrive } = await import('../lib/drive');
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
      const { getCachedDriveToken, connectGoogleDrive, uploadBackupToDrive } = await import('../lib/drive');
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
      const { getCachedDriveToken, downloadBackupFromDrive } = await import('../lib/drive');
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
      const { getCachedDriveToken, deleteBackupFromDrive } = await import('../lib/drive');
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
  const [items, setItems] = useState<any[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [previewData, setPreviewData] = useState<{ headers: string[], rows: any[], totalRows: number } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItem, setNewItem] = useState<any>({
    name: '',
    birthDate: '',
    gender: 'Laki-laki',
    unit: 'Pcs',
    stock: 0
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setNewItem({
      name: '',
      birthDate: '',
      gender: 'Laki-laki',
      unit: 'Pcs',
      stock: 0,
      bermasalah: false
    });
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.name?.trim()) return;
    
    setLoading(true);
    try {
      const colRef = collection(db, activeDb);
      const data: any = {
        name: newItem.name.trim(),
        ...newItem
      };

      if (activeDb === 'students') {
        // Validation/Formatting if needed
        data.bermasalah = !!newItem.bermasalah;
      }

      if (activeDb === 'medicines') {
        data.updatedAt = serverTimestamp();
        data.stock = parseInt(data.stock, 10) || 0;
        data.obat = data.name; // For legacy support
      }

      if (activeDb === 'diagnoses') {
        data.diagnosa = data.name; // For legacy support
      }

      const docRef = doc(colRef);
      await runWithRetry(() => setDoc(docRef, data));
      
      setStatus({ type: 'success', message: 'Data berhasil ditambahkan.' });
      setShowAddForm(false);
      resetForm();

      // Trigger automatic background backup to Google Drive silently
      import('../lib/drive').then(({ triggerAutoBackup }) => {
        triggerAutoBackup().catch(err => console.error("Error in automatic background backup:", err));
      });
    } catch (err) {
      console.error("Error adding item:", err);
      handleFirestoreError(err, OperationType.WRITE, activeDb);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    // We expect user to be logged in since App.tsx handles it
    // but auth.currentUser might be null initially
    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
      if (!user) return;
      
      localStorage.setItem('uks_active_db', activeDb);
      setError(null);
      setItemsLoading(true);
      
      const q = query(collection(db, activeDb), orderBy('name', 'asc'));
      const unsubscribeSnap = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setItems(data);
        setCounts(prev => ({ ...prev, [activeDb]: data.length }));
        setItemsLoading(false);
      }, (err) => {
        console.error(`Snapshot error for ${activeDb}:`, err);
        setError(`${activeDb === 'students' ? 'Pasien' : activeDb === 'medicines' ? 'Obat' : 'Diagnosa'} gagal dimuat. Cek izin akses.`);
        setItemsLoading(false);
      });
      
      return () => unsubscribeSnap();
    });
    
    return () => unsubscribeAuth();
  }, [activeDb]);

  // Fetch all counts initially
  React.useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      if (!user) return;
      ['students', 'medicines', 'diagnoses'].forEach(async (type) => {
        try {
          const snap = await getDocs(collection(db, type));
          setCounts(prev => ({ ...prev, [type as DatabaseType]: snap.size }));
        } catch (err) {
          console.error(`Initial count fetch error for ${type}:`, err);
        }
      });
    });
    return () => unsub();
  }, []);

  const filteredItems = items.filter(item => {
    const searchLow = searchTerm.toLowerCase();
    return (
      (item.name?.toLowerCase() || '').includes(searchLow) ||
      (item.obat?.toLowerCase() || '').includes(searchLow) ||
      (item.diagnosa?.toLowerCase() || '').includes(searchLow) ||
      (item.grade?.toLowerCase() || '').includes(searchLow)
    );
  });

  const parseCSVLine = (line: string, delimiter: string) => {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const handleFileSelect = (file: File) => {
    if (!file) return;
    setLoading(true);
    setStatus(null);
    setPreviewData(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text || text.trim() === "") throw new Error("File kosong");
        const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
        if (lines.length < 2) throw new Error("Format CSV salah");
        const firstLine = lines[0];
        const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
        const headers = parseCSVLine(lines[0], delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
        const rows = lines.slice(1, 11).map(line => parseCSVLine(line, delimiter));
        setPreviewData({ headers, rows, totalRows: lines.length - 1 });
        (window as any)._lastCsvText = text;
      } catch (err: any) {
        setStatus({ type: 'error', message: err.message });
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  };

  const executeUpload = async () => {
    const text = (window as any)._lastCsvText;
    if (!text) return;
    setLoading(true);
    setStatus(null);
    try {
      const lines = text.split(/\r?\n/).filter((l: string) => l.trim() !== "");
      const firstLine = lines[0];
      const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
      const headers = parseCSVLine(lines[0], delimiter).map((h: string) => h.trim().replace(/^"|"$/g, ''));
      const rows = lines.slice(1).map((line: string) => parseCSVLine(line, delimiter));
      const colRef = collection(db, activeDb);
      
      const headerMap: Record<number, string> = {};
      const keyDictionary: Record<string, string> = {
        'nama': 'name', 'name': 'name', 'nama lengkap': 'name',
        'obat': 'obat', 'nama obat': 'obat', 'alkes': 'obat',
        'diagnosa': 'diagnosa', 'nama diagnosa': 'diagnosa',
        'pilihan obat': 'obat', 'gejala': 'diagnosa', 'keluhan': 'diagnosa',
        'pasiien': 'name', 'peserta didik': 'name', 'siswa': 'name',
        'skelas': 'grade', 'kelas': 'grade', 'grade': 'grade', 'kls': 'grade',
        'jenis kelamin': 'gender', 'gender': 'gender', 'jk': 'gender', 'sex': 'gender',
        'tanggal lahir': 'birthDate', 'birthdate': 'birthDate', 'tgl lahir': 'birthDate',
        'stok': 'stock', 'stock': 'stock', 'jumlah': 'stock',
        'satuan': 'unit', 'unit': 'unit'
      };
      headers.forEach((header, index) => {
        const hLow = header.toLowerCase();
        headerMap[index] = keyDictionary[hLow] || header;
      });

      // Prepare all items first in memory
      const allItems: any[] = [];
      for (const row of rows) {
        if (row.length === 0 || row.every(cell => cell === "")) continue;
        const item: any = {};
        Object.entries(headerMap).forEach(([idx, key]) => {
          const index = parseInt(idx);
          if (index < row.length) {
            let value: any = row[index].replace(/^"|"$/g, '');
            if (key === 'stock' || key === 'age') value = parseInt(value, 10) || 0;
            item[key] = value;
          }
        });

        // Ensure 'name' is always populated
        if (!item.name && item.obat) item.name = item.obat;
        if (!item.name && item.diagnosa) item.name = item.diagnosa;
        if (!item.name && (keyDictionary[headers[0]?.toLowerCase()] === 'name' || true)) {
           item.name = row[0];
        }
        
        if (!item.name || item.name.trim() === "") continue;

        // Default values for required rules fields
        if (activeDb === 'students') {
          if (!item.gender) {
            const val = row.find(c => ['L', 'P', 'Laki', 'Perem'].some(p => c.toLowerCase().includes(p.toLowerCase())));
            item.gender = val || "Laki-laki";
          }
        }

        if (activeDb === 'medicines') {
          item.updatedAt = serverTimestamp();
          if (item.stock === undefined) item.stock = 0;
          if (!item.unit) item.unit = "Pcs";
        }
        allItems.push(item);
      }

      if (allItems.length === 0) {
        throw new Error("Tidak ada data valid yang bisa diimport.");
      }

      setUploadProgress({ current: 0, total: allItems.length });

      // Chunk items into collections of size 400 (limit is 500, 400 is safer)
      const BATCH_SIZE = 400;
      const chunks: any[][] = [];
      for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
        chunks.push(allItems.slice(i, i + BATCH_SIZE));
      }

      // Execute batches sequentially to avoid throttling, browser freeze, and to ensure reliable offline-to-online persistence.
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        for (const item of chunk) {
          const newDocRef = doc(colRef);
          batch.set(newDocRef, item);
        }
        await batch.commit();
        setUploadProgress(prev => {
          const current = Math.min((prev?.current || 0) + chunk.length, allItems.length);
          return { current, total: allItems.length };
        });
      }

      setStatus({ type: 'success', message: `${allItems.length} data berhasil disimpan secara permanen di database dengan sukses!` });
      setPreviewData(null);

      // Trigger automatic background backup to Google Drive silently
      import('../lib/drive').then(({ triggerAutoBackup }) => {
        triggerAutoBackup().catch(err => console.error("Error in automatic background backup:", err));
      });
    } catch (err: any) {
      console.error("Upload error:", err);
      setStatus({ type: 'error', message: err.message || "Gagal menyimpan data ke database." });
    } finally {
      setLoading(false);
      setUploadProgress(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]);
  };

  const downloadTemplate = () => {
    const templates = { students: "Nama,Tanggal Lahir,Jenis Kelamin\nBudi,2010-01-01,Laki-laki", medicines: "Nama Obat\nParacetamol", diagnoses: "Nama Diagnosa\nDemam" };
    const blob = new Blob([templates[activeDb]], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template_${activeDb}.csv`;
    a.click();
  };

  const clearDatabase = async () => {
    if (!confirm(`Apakah Anda yakin ingin mengosongkan seluruh data pada database "${activeDb}"?`)) return;
    setLoading(true);
    setStatus(null);
    try {
      const snap = await getDocs(collection(db, activeDb));
      const chunks: any[][] = [];
      const docsList = snap.docs;
      const CHUNK_SIZE = 400;
      
      for (let i = 0; i < docsList.length; i += CHUNK_SIZE) {
        chunks.push(docsList.slice(i, i + CHUNK_SIZE));
      }

      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }

      setStatus({ type: 'success', message: `Seluruh data (${docsList.length} baris) berhasil dihapus bersih dari cloud!` });

      // Trigger automatic background backup to Google Drive silently
      import('../lib/drive').then(({ triggerAutoBackup }) => {
        triggerAutoBackup().catch(err => console.error("Error in automatic background backup:", err));
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, activeDb);
    } finally {
      setLoading(false);
    }
  };

  const removeDuplicates = async () => {
    if (items.length === 0) {
      alert("Tidak ada data untuk diperiksa.");
      return;
    }
    
    setLoading(true);
    setStatus(null);
    try {
      // Group items by normalized name (lowercased & trimmed)
      const seen = new Map<string, any>(); // key -> original item
      const duplicatesToDelete: any[] = [];
      
      items.forEach(item => {
        const rawName = item.name || item.obat || item.diagnosa || '';
        const name = rawName.toString().trim().toLowerCase();
        if (!name) return; // skip empty/invalid records
        
        if (seen.has(name)) {
          duplicatesToDelete.push(item);
        } else {
          seen.set(name, item);
        }
      });
      
      if (duplicatesToDelete.length === 0) {
        setStatus({ type: 'success', message: `Tidak ada identitas ganda yang ditemukan pada database "${activeDb}".` });
        setLoading(false);
        return;
      }
      
      const isConfirmed = window.confirm(
        `Ditemukan ${duplicatesToDelete.length} data dengan nama identitas yang sama/ganda.\n\nApakah Anda yakin ingin menghapus dan merapikan ${duplicatesToDelete.length} baris data ganda tersebut secara otomatis dari cloud?`
      );
      if (!isConfirmed) {
        setLoading(false);
        return;
      }
      
      // Batch handle the deletes
      const chunks: any[][] = [];
      const CHUNK_SIZE = 400;
      for (let i = 0; i < duplicatesToDelete.length; i += CHUNK_SIZE) {
        chunks.push(duplicatesToDelete.slice(i, i + CHUNK_SIZE));
      }
      
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach(item => {
          batch.delete(doc(db, activeDb, item.id));
        });
        await batch.commit();
      }
      
      setStatus({ 
        type: 'success', 
        message: `Pembersihan berhasil! Berhasil menghapus ${duplicatesToDelete.length} identitas ganda dari database "${activeDb}".` 
      });

      // Trigger automatic background backup to Google Drive silently
      import('../lib/drive').then(({ triggerAutoBackup }) => {
        triggerAutoBackup().catch(err => console.error("Error in automatic background backup:", err));
      });
    } catch (err) {
      console.error("Error removing duplicates:", err);
      handleFirestoreError(err, OperationType.DELETE, activeDb);
    } finally {
      setLoading(false);
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="space-y-2">
          {(['students', 'medicines', 'diagnoses'] as const).map(dbType => (
            <button
              key={dbType}
              onClick={() => setActiveDb(dbType)}
              className={cn(
                "w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-black uppercase transition-all",
                activeDb === dbType ? "bg-blue-600 text-white shadow-lg" : "bg-white text-slate-500 hover:bg-slate-50"
              )}
            >
               <div className="flex items-center gap-3">
                 {dbType === 'students' ? <Users className="w-4 h-4" /> : dbType === 'medicines' ? <Pill className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                 {dbType === 'students' ? 'Pasien' : dbType.replace(/^\w/, c => c.toUpperCase())}
               </div>
               <span className={cn(
                 "text-[9px] px-1.5 py-0.5 rounded-md",
                 activeDb === dbType ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-400"
               )}>
                 {counts[dbType]}
               </span>
            </button>
          ))}

          <div className="pt-4 border-t border-slate-100 mt-4">
            <button
              onClick={() => setActiveDb('drive-backup')}
              className={cn(
                "w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-black uppercase transition-all",
                activeDb === 'drive-backup' ? "bg-emerald-600 text-white shadow-lg" : "bg-white text-slate-500 hover:bg-slate-50"
              )}
            >
               <div className="flex items-center gap-3">
                 <Cloud className="w-4 h-4" />
                 Cadangan Cloud
               </div>
               {driveConnected && (
                 <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
               )}
            </button>
          </div>
        </div>

        <div className="md:col-span-3 space-y-6">
          {activeDb === 'drive-backup' ? (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
              {/* Header with connection status */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 pb-6 border-b border-slate-100">
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
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase tracking-wider px-5 py-2.5 rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Hubungkan Google Drive'}
                  </button>
                )}
              </div>

              {/* Status messages indicator */}
              {backupError && (
                <div className="mb-6 p-4 bg-red-50 text-red-700 border border-red-100 rounded-xl flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                  <span className="text-[10px] font-black uppercase">{backupError}</span>
                </div>
              )}
              {backupSuccess && (
                <div className="mb-6 p-4 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  <span className="text-[10px] font-black uppercase">{backupSuccess}</span>
                </div>
              )}

              {/* Main control action block */}
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100 mb-6">
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
                    className="whitespace-nowrap bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-[10px] font-black uppercase tracking-widest px-6 py-4 rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-3 cursor-pointer"
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
              <div className="p-6 bg-emerald-50/50 rounded-2xl border border-emerald-100 mb-8 space-y-4">
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
                      Bila opsi ini diaktifkan, sistem akan otomatis melakukan pencadangan databse secara mandiri di latar belakang Google Drive Anda setiap kali Anda menambahkan data pasien baru, mengimpor CSV, atau membereskan identitas ganda.
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
              <div className="p-6 bg-blue-50/40 rounded-2xl border border-blue-100 mb-8 space-y-4">
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
                      Formulir Pemeriksaan Baru dikonfigurasi untuk menyinkronkan seluruh keluar-masuk data kunjungan secara real-time ke spreadsheet target di bawah ini. Anda dapat membuka lembar dokumen ini secara langsung atau memicu sinkronisasi masal data riwayat klinis yang ada.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <a 
                      href="https://docs.google.com/spreadsheets/d/17EEP1c0klbntmLxVsjYGElkEqLejLncqvnDNoqsfZsc/edit?gid=0#gid=0"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-white hover:bg-slate-50 border border-blue-200 text-blue-700 text-[10px] font-black uppercase tracking-wider px-4 py-2.5 rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer decoration-none"
                    >
                      Buka Google Sheet ➜
                    </a>
                    
                    <button
                      onClick={handleSyncAllVisitsToSheets}
                      disabled={sheetsSyncLoading || !driveConnected}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[10px] font-black uppercase tracking-wider px-4 py-2.5 rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-2 cursor-pointer"
                    >
                      {sheetsSyncLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Menyinkronkan...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-none" />
                          Sinkronisasi Masal Data
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="pt-3 border-t border-blue-100/50 flex flex-col md:flex-row md:items-center justify-between gap-3 text-[10px]">
                  <div className="flex items-center gap-2 font-black uppercase text-blue-900 tracking-wide">
                    <span>ID Spreadsheet Target:</span>
                    <span className="font-mono bg-blue-100 text-blue-950 px-2 py-0.5 rounded text-[9px] select-all">17EEP1c0klbntmLxVsjYGElkEqLejLncqvnDNoqsfZsc</span>
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

              {/* Integrasi WhatsApp Fonnte Block */}
              <div className="p-6 bg-cyan-50/40 rounded-2xl border border-cyan-100 mb-8 space-y-4">
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
                    <label className="text-[9px] font-black uppercase tracking-wider text-cyan-900 block">Token API Fonnte</label>
                    <div className="relative">
                      <input
                        type={showFonnteToken ? "text" : "password"}
                        value={fonnteToken}
                        onChange={(e) => setFonnteToken(e.target.value)}
                        placeholder="Masukkan token Fonnte Anda..."
                        className="w-full bg-white border border-cyan-200 rounded-xl px-4 py-2.5 text-xs text-slate-805 focus:outline-none focus:border-cyan-500 font-mono transition-colors pr-10"
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
                      <span className="text-[9px] text-cyan-700/80 font-medium">Kosongkan untuk menggunakan fallback server</span>
                      <button
                        onClick={handleSaveFonnteToken}
                        className="bg-cyan-600 hover:bg-cyan-700 border-none text-white font-black uppercase tracking-wider text-[9px] px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                      >
                        Simpan Token
                      </button>
                    </div>
                  </div>

                  <div className="lg:col-span-6 p-4 bg-white/60 rounded-xl border border-cyan-100/60 space-y-3">
                    <span className="text-[9px] font-black uppercase tracking-wider text-cyan-950 block">Pengujian Koneksi Device Fonnte</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={fonnteTestNumber}
                        onChange={(e) => setFonnteTestNumber(e.target.value)}
                        placeholder="Contoh: 08123456789 atau 628123..."
                        className="flex-1 bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-cyan-500 transition-colors"
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
              <div className="space-y-4">
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
                                className="px-3 py-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white rounded-lg text-[9px] font-black uppercase tracking-wider transition-all inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Download className="w-3 h-3" />
                                Pulihkan
                              </button>
                              <button
                                onClick={() => handleDeleteBackup(file.id, file.name)}
                                disabled={restoreLoading || backupLoading}
                                className="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-lg text-[9px] font-black uppercase tracking-wider transition-all inline-block align-middle cursor-pointer"
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
          ) : (
            <>
              <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
                   <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                     <PlusCircle className="w-4 h-4 text-blue-500" /> Operasi Management: {activeDb}
                   </h3>
                   <div className="flex gap-2">
                     <button 
                      onClick={() => {
                        setShowAddForm(!showAddForm);
                        resetForm();
                      }}
                      className={cn(
                        "px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2",
                        showAddForm ? "bg-slate-100 text-slate-600" : "bg-blue-600 text-white shadow-lg hover:bg-blue-700"
                      )}
                     >
                       {showAddForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                       {showAddForm ? 'Tutup' : 'Tambah Data'}
                     </button>
                   </div>
                </div>

                {showAddForm ? (
                   <div className="animate-in slide-in-from-top-4 duration-300">
                     <form onSubmit={handleAddItem} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5 md:col-span-2">
                          <label className="text-[10px] font-black uppercase text-slate-400">Nama</label>
                          <input 
                            type="text" required
                            value={newItem.name}
                            onChange={e => setNewItem({...newItem, name: e.target.value})}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                            placeholder={`Masukkan Nama ${activeDb === 'students' ? 'Pasien' : activeDb === 'medicines' ? 'Obat' : 'Diagnosa'}`}
                          />
                        </div>
                        
                        {activeDb === 'students' && (
                          <>
                            <div className="space-y-1.5 md:col-span-2">
                              <label className="text-[10px] font-black uppercase text-slate-400">Tanggal Lahir</label>
                              <input 
                                type="date"
                                value={newItem.birthDate}
                                onChange={e => setNewItem({...newItem, birthDate: e.target.value})}
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                              />
                            </div>
                            <div className="space-y-1.5 md:col-span-2">
                              <label className="text-[10px] font-black uppercase text-slate-400">Jenis Kelamin</label>
                              <div className="flex gap-2">
                                {['Laki-laki', 'Perempuan'].map(g => (
                                  <button
                                    key={g} type="button"
                                    onClick={() => setNewItem({...newItem, gender: g})}
                                    className={cn(
                                      "flex-1 py-3 rounded-xl text-[10px] font-black uppercase border-2 transition-all",
                                      newItem.gender === g ? "border-blue-600 bg-blue-50 text-blue-600" : "border-slate-100 text-slate-400"
                                    )}
                                  >
                                    {g}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-1.5 md:col-span-2">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input 
                                  type="checkbox"
                                  checked={!!newItem.bermasalah}
                                  onChange={e => setNewItem({...newItem, bermasalah: e.target.checked})}
                                  className="form-checkbox text-blue-600 rounded"
                                />
                                <span className="text-[10px] font-black uppercase text-slate-500">Tandai Sebagai Siswa Bermasalah</span>
                              </label>
                            </div>
                          </>
                        )}

                        {activeDb === 'medicines' && (
                          <>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-black uppercase text-slate-400">Stok Awal</label>
                              <input 
                                type="number"
                                value={newItem.stock}
                                onChange={e => setNewItem({...newItem, stock: e.target.value})}
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-black uppercase text-slate-400">Satuan</label>
                              <select
                                value={newItem.unit}
                                onChange={e => setNewItem({...newItem, unit: e.target.value})}
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                              >
                                <option value="Pcs">Pcs</option>
                                <option value="Botol">Botol</option>
                                <option value="Tablet">Tablet</option>
                                <option value="Sachet">Sachet</option>
                              </select>
                            </div>
                          </>
                        )}

                        <div className="md:col-span-2 pt-4">
                          <button 
                            type="submit" disabled={loading}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg flex items-center justify-center gap-2"
                          >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4" /> Simpan Data ke Database</>}
                          </button>
                        </div>
                     </form>
                   </div>
                ) : !previewData ? (
                  <div 
                    onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "border-2 border-dashed rounded-2xl p-20 text-center cursor-pointer transition-all",
                      isDragOver ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-blue-400 hover:bg-slate-50"
                    )}
                  >
                    <div className="bg-slate-900 w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl">
                      <Upload className="w-6 h-6 text-white" />
                    </div>
                    <p className="text-xs font-black uppercase tracking-[0.3em] text-slate-900">Upload File CSV</p>
                    <input type="file" ref={fileInputRef} onChange={e => e.target.files?.[0] && handleFileSelect(e.target.files[0])} accept=".csv" className="hidden" />
                  </div>
                ) : (
                  <div className="space-y-6 animate-in fade-in zoom-in-95">
                    <div className="flex justify-between items-center">
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pratinjau Data ({previewData.totalRows} Baris)</h3>
                      <button onClick={() => setPreviewData(null)} className="text-[10px] font-black text-red-500 uppercase">Batalkan</button>
                    </div>
                    <div className="overflow-x-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100">
                            {previewData.headers.map((h, i) => <th key={i} className="px-4 py-3 text-[10px] font-black uppercase text-slate-400">{h}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.rows.map((row, i) => (
                            <tr key={i} className="border-b border-slate-50">
                              {row.map((cell: string, ci: number) => <td key={ci} className="px-4 py-3 text-[11px] font-bold text-slate-600">{cell}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      onClick={executeUpload} disabled={loading}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-5 rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl transition-all"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Mulai Upload Sekarang"}
                    </button>
                  </div>
                )}

                <div className="mt-8 pt-8 border-t border-slate-100 flex gap-4 flex-wrap">
                  <button onClick={downloadTemplate} className="text-[10px] font-black uppercase text-slate-400 hover:text-slate-900 flex items-center gap-2 cursor-pointer">
                    <FileText className="w-3 h-3" /> Unduh Template
                  </button>
                  <button onClick={removeDuplicates} disabled={loading || itemsLoading} className="text-[10px] font-black uppercase text-amber-600 hover:text-amber-800 flex items-center gap-2 disabled:opacity-50 cursor-pointer">
                    <RefreshCw className="w-3 h-3 animate-spin duration-1000" style={{ animationPlayState: loading ? 'running' : 'paused' }} /> Bersihkan Identitas Ganda
                  </button>
                  <button onClick={clearDatabase} className="text-[10px] font-black uppercase text-red-400 hover:text-red-600 flex items-center gap-2 cursor-pointer">
                    <Trash2 className="w-3 h-3" /> Kosongkan Data
                  </button>
                </div>

                {uploadProgress && (
                  <div className="mt-6 space-y-2">
                    <div className="flex justify-between text-[10px] font-black text-blue-600 uppercase">
                      <span>Mengirim ke Cloud...</span>
                      <span>{Math.round((uploadProgress.current / uploadProgress.total) * 100)}%</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div className="bg-blue-600 h-full transition-all" style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }} />
                    </div>
                  </div>
                )}

                {status && (
                  <div className={cn(
                    "mt-6 p-4 rounded-xl flex items-center gap-3",
                    status.type === 'success' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"
                  )}>
                    {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    <p className="text-[10px] font-black uppercase">{status.message}</p>
                  </div>
                )}
              </div>

              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                      <Search className="w-4 h-4" /> Database Storage: {activeDb}
                    </h3>
                    <div className="flex items-center gap-2">
                      <div className="bg-emerald-500 w-1.5 h-1.5 rounded-full animate-pulse" />
                      <span className="text-[9px] font-black uppercase text-emerald-600 tracking-tighter">Live Sync Active (Persistent)</span>
                    </div>
                  </div>
                  <div className="relative w-full md:w-64">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder={`Cari ${activeDb === 'students' ? 'Nama Pasien/Kelas' : activeDb === 'medicines' ? 'Nama Obat' : 'Diagnosa'}...`}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto border border-slate-100 rounded-xl max-h-[500px] overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-white z-10">
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400 w-12">#</th>
                        <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400">
                          {activeDb === 'students' ? 'Nama Pasien' : activeDb === 'medicines' ? 'Obat / Alkes' : 'Diagnosa / Gejala'}
                        </th>
                        {activeDb === 'students' && (
                          <>
                            <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400">Kelas</th>
                            <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400">JK</th>
                            <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400">Tgl Lahir</th>
                          </>
                        )}
                        {activeDb === 'medicines' && (
                          <>
                            <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400 text-center">Stok</th>
                            <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400">Satuan</th>
                          </>
                        )}
                        <th className="px-4 py-3 text-[10px] font-black uppercase text-slate-400 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {itemsLoading ? (
                        <tr>
                          <td colSpan={10} className="px-4 py-12 text-center">
                            <div className="flex flex-col items-center gap-2">
                              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                              <p className="text-[10px] font-black uppercase text-blue-500">Sinkronisasi Database...</p>
                            </div>
                          </td>
                        </tr>
                      ) : filteredItems.length > 0 ? (
                        filteredItems.map((item, idx) => (
                          <tr key={item.id} className="hover:bg-slate-50/50 transition-colors group">
                            <td className="px-4 py-3 text-[10px] font-bold text-slate-400">{idx + 1}</td>
                            <td className="px-4 py-3 text-[11px] font-black text-slate-900 group-hover:text-blue-600 transition-colors">
                              {item.obat || item.diagnosa || item.name}
                            </td>
                            {activeDb === 'students' && (
                              <>
                                <td className="px-4 py-3 text-[10px] font-bold text-slate-600 uppercase">{item.grade || '-'}</td>
                                <td className="px-4 py-3 text-[10px] font-bold text-slate-600">
                                  <span className={cn(
                                    "px-2 py-0.5 rounded-full text-[9px] font-black uppercase",
                                    item.gender?.toLowerCase()?.includes('p') ? "bg-pink-50 text-pink-600" : "bg-blue-50 text-blue-600"
                                  )}>
                                    {item.gender || '-'}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-[10px] font-bold text-slate-500 font-mono">{item.birthDate || '-'}</td>
                              </>
                            )}
                            {activeDb === 'medicines' && (
                              <>
                                <td className="px-4 py-3 text-center">
                                  <span className={cn(
                                    "text-[10px] font-black px-2 py-1 rounded-lg",
                                    (item.stock || 0) < 10 ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"
                                  )}>
                                    {item.stock || 0}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase">{item.unit || 'Pcs'}</td>
                              </>
                            )}
                            <td className="px-4 py-3 text-right">
                              <button 
                                onClick={async () => {
                                  if (!confirm('Hapus item ini?')) return;
                                  try {
                                    await deleteDoc(doc(db, activeDb, item.id));
                                  } catch(err) {
                                    handleFirestoreError(err, OperationType.DELETE, activeDb);
                                  }
                                }}
                                className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={10} className="px-4 py-12 text-center">
                            <div className="flex flex-col items-center gap-3">
                              <AlertCircle className="w-8 h-8 text-slate-200" />
                              <p className="text-[10px] font-black uppercase text-slate-400">Tidak ada data ditemukan</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
