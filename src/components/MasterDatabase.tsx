import React, { useState, useRef } from 'react';
import { 
  collection, 
  writeBatch, 
  doc, 
  getDocs,
  query,
  serverTimestamp
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
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
  const [activeDb, setActiveDb] = useState<DatabaseType>('students');
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number, total: number } | null>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [previewData, setPreviewData] = useState<{ headers: string[], rows: any[], totalRows: number } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        'nama': 'name', 'name': 'name', 'kelas': 'grade', 'grade': 'grade',
        'jenis kelamin': 'gender', 'gender': 'gender', 'jk': 'gender',
        'tanggal lahir': 'birthDate', 'birthdate': 'birthDate',
        'stok': 'stock', 'stock': 'stock', 'satuan': 'unit', 'unit': 'unit'
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
          if (!item.name) continue;
          if (activeDb === 'medicines') {
            item.updatedAt = serverTimestamp();
            if (item.stock === undefined) item.stock = 0;
          }
          const newDocRef = doc(colRef);
          batch.set(newDocRef, item);
          totalCount++;
        }
        await batch.commit();
        setUploadProgress({ current: Math.min(i + CHUNK_SIZE, rows.length), total: rows.length });
      }
      setStatus({ type: 'success', message: `Berhasil upload ${totalCount} data.` });
      setPreviewData(null);
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message });
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
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase transition-all",
                activeDb === dbType ? "bg-blue-600 text-white shadow-lg" : "bg-white text-slate-500 hover:bg-slate-50"
              )}
            >
               {dbType === 'students' ? <Users className="w-4 h-4" /> : dbType === 'medicines' ? <Pill className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
               {dbType.replace(/^\w/, c => c.toUpperCase())}
            </button>
          ))}
        </div>

        <div className="md:col-span-3 space-y-6">
          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
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

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
              <Search className="w-4 h-4" /> Histori Terbaru
            </h3>
            <p className="text-[11px] font-medium text-slate-500 italic">
              Data yang diupload akan muncul secara langsung di aplikasi. Gunakan menu pemeriksaan harian untuk melihat perubahannya.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
