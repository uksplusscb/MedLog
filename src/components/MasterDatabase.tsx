import React, { useState, useRef } from 'react';
import { 
  collection, 
  writeBatch, 
  doc, 
  getDocs,
  query,
  serverTimestamp,
  onSnapshot,
  orderBy,
  deleteDoc
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  Upload, 
  Trash2, 
  AlertCircle, 
  CheckCircle2, 
  Loader2,
  FileText,
  Users,
  Pill,
  Search
} from 'lucide-react';
import { cn } from '../lib/utils';

type DatabaseType = 'students' | 'medicines' | 'diagnoses';

export default function MasterDatabase() {
  const [activeDb, setActiveDb] = useState<DatabaseType>(() => {
    return (localStorage.getItem('uks_active_db') as DatabaseType) || 'students';
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<DatabaseType, number>>({ students: 0, medicines: 0, diagnoses: 0 });
  const [uploadProgress, setUploadProgress] = useState<{ current: number, total: number } | null>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [previewData, setPreviewData] = useState<{ headers: string[], rows: any[], totalRows: number } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        setError(`${activeDb === 'students' ? 'Siswa' : activeDb === 'medicines' ? 'Obat' : 'Diagnosa'} gagal dimuat. Cek izin akses.`);
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
    try {
      const lines = text.split(/\r?\n/).filter((l: string) => l.trim() !== "");
      const firstLine = lines[0];
      const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
      const headers = parseCSVLine(lines[0], delimiter).map((h: string) => h.trim().replace(/^"|"$/g, ''));
      const rows = lines.slice(1).map((line: string) => parseCSVLine(line, delimiter));
      const colRef = collection(db, activeDb);
      const CHUNK_SIZE = 100;
      let totalCount = 0;
      
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

      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        for (const row of chunk) {
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
             // If still no name, try the first column as a fallback if it looks reasonable
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
          const newDocRef = doc(colRef);
          batch.set(newDocRef, item);
          totalCount++;
        }
        try {
          await batch.commit();
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, activeDb);
        }
        setUploadProgress({ current: Math.min(i + CHUNK_SIZE, rows.length), total: rows.length });
      }
      setStatus({ type: 'success', message: `${totalCount} data berhasil disimpan secara permanen di database cloud.` });
      setPreviewData(null);
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
    if (!confirm("Kosongkan database?")) return;
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, activeDb)));
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      setStatus({ type: 'success', message: "Data berhasil dihapus." });
    } catch (err) {
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
                 {dbType.replace(/^\w/, c => c.toUpperCase())}
               </div>
               <span className={cn(
                 "text-[9px] px-1.5 py-0.5 rounded-md",
                 activeDb === dbType ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-400"
               )}>
                 {counts[dbType]}
               </span>
            </button>
          ))}
        </div>

        <div className="md:col-span-3 space-y-6">
          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-700">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <p className="text-[11px] font-bold uppercase">{error}</p>
              </div>
            )}
            {!previewData ? (
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

            <div className="mt-8 pt-8 border-t border-slate-100 flex gap-4">
              <button onClick={downloadTemplate} className="text-[10px] font-black uppercase text-slate-400 hover:text-slate-900 flex items-center gap-2">
                <FileText className="w-3 h-3" /> Unduh Template
              </button>
              <button onClick={clearDatabase} className="text-[10px] font-black uppercase text-red-400 hover:text-red-600 flex items-center gap-2">
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
                  placeholder={`Cari ${activeDb === 'students' ? 'Nama/Kelas' : activeDb === 'medicines' ? 'Nama Obat' : 'Diagnosa'}...`}
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
                      {activeDb === 'students' ? 'Nama Siswa' : activeDb === 'medicines' ? 'Obat / Alkes' : 'Diagnosa / Gejala'}
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
                        <div className="flex flex-col items-center gap-2">
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
        </div>
      </div>
    </div>
  );
}
