import React, { useState, useRef } from 'react';
import { 
  collection, 
  addDoc, 
  writeBatch, 
  doc, 
  getDocs,
  query,
  limit,
  deleteDoc,
  serverTimestamp
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { 
  Upload, 
  Database, 
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
    if (!file.name.endsWith('.csv')) {
      setStatus({ type: 'error', message: "Hanya file .CSV yang diperbolehkan." });
      return;
    }

    setLoading(true);
    setStatus(null);
    setUploadProgress(null);
    setPreviewData(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text || text.trim() === "") throw new Error("File kosong");

        const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
        if (lines.length < 2) throw new Error("File CSV minimal harus berisi header dan satu baris data");

        const firstLine = lines[0];
        const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
        
        const headers = parseCSVLine(lines[0], delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
        const rows = lines.slice(1, 6).map(line => parseCSVLine(line, delimiter));

        setPreviewData({
          headers,
          rows,
          totalRows: lines.length - 1
        });

        // Store full text in a ref or just use raw data for upload
        (window as any)._lastCsvText = text;
      } catch (err: any) {
        setStatus({ type: 'error', message: err.message || "Gagal membaca file" });
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
    setUploadProgress(null);

    try {
      const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
      const firstLine = lines[0];
      const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
      
      const headers = parseCSVLine(lines[0], delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
      const rows = lines.slice(1).map(line => parseCSVLine(line, delimiter));

      const colRef = collection(db, activeDb);
      const CHUNK_SIZE = 100;
      let totalCount = 0;
      
      setUploadProgress({ current: 0, total: rows.length });

      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);

        for (const row of chunk) {
          if (row.length === 0 || row.every(cell => cell === "")) continue;

          const item: any = {};
          const expectedKeys = {
            students: ['name', 'grade', 'gender', 'birthDate', 'age'],
            medicines: ['name', 'stock', 'unit'],
            diagnoses: ['name']
          }[activeDb];

          headers.forEach((header, index) => {
            if (index >= row.length) return;
            let value: any = row[index].replace(/^"|"$/g, '');
            const hLow = header.toLowerCase();
            
            let key = header;
            if (expectedKeys.includes(hLow)) {
              key = hLow;
            } else if (hLow.includes('nama')) {
              key = 'name';
            } else if (hLow.includes('lahir') || hLow.includes('tgl') || hLow.includes('birth')) {
              key = 'birthDate';
            } else if (hLow.includes('kelamin') || hLow.includes('gender') || hLow.includes('sex') || hLow === 'jk') {
              key = 'gender';
            } else if (hLow.includes('stok') || hLow.includes('stock') || hLow.includes('jumlah')) {
              key = 'stock';
            } else if (hLow.includes('satuan') || hLow.includes('unit')) {
              key = 'unit';
            } else if (hLow.includes('kelas') || hLow.includes('grade') || hLow === 'kls') {
              key = 'grade';
            }

            if (key === 'stock' || key === 'age') {
              const num = parseInt(value, 10);
              value = isNaN(num) ? 0 : num;
            }
            
            if (key === 'gender') {
              if (value.toLowerCase().startsWith('l')) value = 'Laki-laki';
              else if (value.toLowerCase().startsWith('p')) value = 'Perempuan';
              else if (value.toLowerCase() === 'laki') value = 'Laki-laki';
              else if (value.toLowerCase() === 'wanita' || value.toLowerCase() === 'cewek') value = 'Perempuan';
            }

            item[key] = value;
          });

          if (!item.name || item.name.trim() === "") continue; 

          if (activeDb === 'medicines') {
            if (item.stock === undefined) item.stock = 0;
            if (!item.unit) item.unit = 'Pcs';
            item.updatedAt = serverTimestamp();
          }

          const newDocRef = doc(colRef);
          batch.set(newDocRef, item);
          totalCount++;
        }

        await batch.commit();
        setUploadProgress({ current: Math.min(i + CHUNK_SIZE, rows.length), total: rows.length });
      }

      setStatus({ type: 'success', message: `Berhasil mengunggah ${totalCount} data ke ${activeDb}` });
      setPreviewData(null);
      (window as any)._lastCsvText = null;
    } catch (err: any) {
      console.error("Upload error:", err);
      let errorMsg = err.message || "Kesalahan format file";
      if (err.message?.includes("insufficient permissions")) {
        errorMsg = "Izin ditolak. Silakan login ulang.";
      }
      setStatus({ type: 'error', message: errorMsg });
    } finally {
      setLoading(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const clearDatabase = async () => {
    if (!confirm(`Apakah Anda yakin ingin menghapus SEMUA data di database ${activeDb}?`)) return;

    setLoading(true);
    try {
      const q = query(collection(db, activeDb));
      const snap = await getDocs(q);
      
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();

      setStatus({ type: 'success', message: `Database ${activeDb} telah dikosongkan.` });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, activeDb);
      setStatus({ type: 'error', message: "Gagal mengosongkan database." });
    } finally {
      setLoading(false);
    }
  };

  const templates = {
    students: "Nama,Tanggal Lahir,Jenis Kelamin\nBudi Santoso,2010-05-15,Laki-laki\nSiti Aminah,2011-10-20,Perempuan",
    medicines: "Nama Obat\nParacetamol\nAmoxicillin",
    diagnoses: "Nama Diagnosa\nDemam\nBatuk Pilek\nSakit Gigi"
  };

  const downloadTemplate = () => {
    const blob = new Blob([templates[activeDb]], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template_${activeDb}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tighter uppercase italic">
            Master_Database <span className="text-blue-600">Manager</span>
          </h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
            Konfigurasi Data Referensi Sistem
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Navigation Sidebar */}
        <div className="space-y-2">
          <button
            onClick={() => setActiveDb('students')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
              activeDb === 'students' ? "bg-blue-600 text-white shadow-lg shadow-blue-200" : "bg-white text-slate-500 hover:bg-slate-50"
            )}
          >
            <Users className="w-4 h-4" />
            Siswa & Tendik
          </button>
          <button
            onClick={() => setActiveDb('medicines')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
              activeDb === 'medicines' ? "bg-blue-600 text-white shadow-lg shadow-blue-200" : "bg-white text-slate-500 hover:bg-slate-50"
            )}
          >
            <Pill className="w-4 h-4" />
            Daftar Obat
          </button>
          <button
            onClick={() => setActiveDb('diagnoses')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
              activeDb === 'diagnoses' ? "bg-blue-600 text-white shadow-lg shadow-blue-200" : "bg-white text-slate-500 hover:bg-slate-50"
            )}
          >
            <FileText className="w-4 h-4" />
            Daftar Diagnosa
          </button>
        </div>

        {/* Content Area */}
        <div className="md:col-span-3 space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex flex-col md:flex-row justify-between gap-6">
              <div className="space-y-6 flex-1">
                <div>
                  <h2 className="text-sm font-black text-slate-900 uppercase">Input Data Master: {activeDb}</h2>
                  <p className="text-[10px] text-slate-500 font-medium leading-relaxed mt-1">
                    Pilih file CSV atau drag & drop langsung ke area di bawah ini. Pastikan file berisi header yang sesuai.
                  </p>
                </div>

                {!previewData ? (
                  <div 
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "relative border-2 border-dashed rounded-xl p-12 transition-all cursor-pointer flex flex-col items-center justify-center text-center",
                      isDragOver ? "border-blue-500 bg-blue-50/50" : "border-slate-200 hover:border-blue-400 hover:bg-slate-50/50"
                    )}
                  >
                    <div className="bg-blue-600 p-3 rounded-full shadow-lg shadow-blue-100 mb-4 animate-bounce">
                      <Upload className="w-5 h-5 text-white" />
                    </div>
                    <p className="text-xs font-black text-slate-900 uppercase tracking-widest">Klik atau Tarik File CSV ke Sini</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase mt-2">Maksimal 500 baris per upload untuk performa terbaik</p>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelect(file);
                      }}
                      accept=".csv"
                      className="hidden"
                    />
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in zoom-in-95">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                         <div className="bg-emerald-500 w-2 h-2 rounded-full animate-pulse" />
                         <h3 className="text-[10px] font-black text-slate-900 uppercase tracking-widest">Preview: {previewData.totalRows} Baris Ditemukan</h3>
                      </div>
                      <button 
                        onClick={() => setPreviewData(null)}
                        className="text-[9px] font-black text-red-500 uppercase hover:underline"
                      >
                        Batalkan & Ganti File
                      </button>
                    </div>

                    <div className="overflow-x-auto border border-slate-100 rounded-lg">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50">
                            {previewData.headers.map((h, i) => (
                              <th key={i} className="px-3 py-2 text-[9px] font-black text-slate-400 border-b border-slate-100 uppercase tracking-tighter">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.rows.map((row, i) => (
                            <tr key={i} className="hover:bg-slate-50/50">
                              {row.map((cell: string, ci: number) => (
                                <td key={ci} className="px-3 py-2 text-[10px] font-medium text-slate-600 border-b border-slate-50 truncate max-w-[150px]">{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="bg-blue-50 p-4 rounded-lg flex items-center justify-between border border-blue-100">
                      <div className="flex items-center gap-3">
                        <div className="bg-white p-2 rounded-lg border border-blue-100">
                          <CheckCircle2 className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <p className="text-[10px] font-black text-blue-900 uppercase">Siap Memproses Database</p>
                          <p className="text-[9px] text-blue-600 font-bold uppercase italic tracking-tighter">Sistem akan memetakan kolom secara otomatis</p>
                        </div>
                      </div>
                      <button
                        onClick={executeUpload}
                        disabled={loading}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-xl shadow-blue-200 transition-all active:scale-95 disabled:opacity-50"
                      >
                        Mulai Upload Sekarang
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-100">
                  <button
                    onClick={downloadTemplate}
                    className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 px-4 py-2 rounded text-[10px] font-black uppercase tracking-tighter transition-all"
                  >
                    <FileText className="w-3 h-3" />
                    Unduh Template
                  </button>
                  <button
                    onClick={clearDatabase}
                    disabled={loading}
                    className="flex items-center gap-2 text-red-500 hover:bg-red-50 px-4 py-2 rounded text-[10px] font-black uppercase tracking-tighter transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                    Kosongkan Data
                  </button>
                </div>

                {uploadProgress && (
                  <div className="space-y-2 animate-in slide-in-from-bottom-4">
                    <div className="flex justify-between text-[10px] font-black text-blue-600 uppercase">
                      <span className="flex items-center gap-2">
                         <Loader2 className="w-3 h-3 animate-spin" />
                         Memproses Ke Cloud...
                      </span>
                      <span>{uploadProgress.current} / {uploadProgress.total}</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-blue-600 h-full transition-all duration-300 shadow-[0_0_10px_rgba(37,99,235,0.5)]"
                        style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {status && (
                  <div className={cn(
                    "p-4 rounded-lg flex items-center gap-3 animate-in fade-in slide-in-from-top-2",
                    status.type === 'success' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"
                  )}>
                    {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    <p className="text-[11px] font-bold uppercase">{status.message}</p>
                  </div>
                )}
              </div>

              <div className="md:w-64 bg-slate-50 p-4 rounded-lg border border-slate-100 self-start">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Format Kolom</p>
                <div className="font-mono text-[10px] space-y-1">
                  {activeDb === 'students' && (
                    <>
                      <div className="flex justify-between"><span className="text-blue-600">Nama</span> <span>String</span></div>
                      <div className="flex justify-between"><span className="text-blue-600">Tanggal Lahir</span> <span>YYYY-MM-DD</span></div>
                      <div className="flex justify-between"><span className="text-blue-600">Jenis Kelamin</span> <span>String</span></div>
                    </>
                  )}
                  {activeDb === 'medicines' && (
                    <>
                      <div className="flex justify-between"><span className="text-blue-600">Nama Obat</span> <span>String</span></div>
                    </>
                  )}
                  {activeDb === 'diagnoses' && (
                    <>
                      <div className="flex justify-between"><span className="text-blue-600">Nama Diagnosa</span> <span>String</span></div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-[10px] font-black text-slate-900 uppercase flex items-center gap-2">
                <Search className="w-3 h-3 text-slate-400" />
                Data Preview (Recent)
              </h3>
            </div>
            <div className="overflow-x-auto p-4 italic text-slate-400 text-[11px]">
              Silakan periksa data melalui menu input pemeriksaan harian untuk melihat data yang sudah masuk.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
