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
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setStatus(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const rows = text.split('\n').map(row => row.split(',').map(cell => cell.trim()));
        
        if (rows.length < 2) throw new Error("File CSV kosong atau tidak valid");

        const headers = rows[0];
        const data = rows.slice(1).filter(row => row.length === headers.length && row.some(cell => cell !== ""));

        const colRef = collection(db, activeDb);
        const CHUNK_SIZE = 400; // Safe limit (max 500)
        let totalCount = 0;

        for (let i = 0; i < data.length; i += CHUNK_SIZE) {
          const chunk = data.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(db);

          for (const row of chunk) {
            const item: any = {};
            headers.forEach((header, index) => {
              let value: any = row[index];
              const h = header.trim();
              
              // Mapping Indonesian headers to internal keys
              let key = h;
              if (h === 'Nama' || h === 'Nama Obat' || h === 'Nama Diagnosa') key = 'name';
              if (h === 'Tanggal Lahir') key = 'birthDate';
              if (h === 'Jenis Kelamin') key = 'gender';
              if (h === 'Stok') key = 'stock';
              if (h === 'Satuan') key = 'unit';

              if (key === 'age' || key === 'stock') {
                const num = Number(value);
                value = isNaN(num) ? 0 : num;
              }
              item[key] = value;
            });

            const newDocRef = doc(colRef);
            
            // Add defaults for medicines if missing
            if (activeDb === 'medicines') {
              if (item.stock === undefined) item.stock = 0;
              if (!item.unit) item.unit = 'Tablet';
              item.updatedAt = serverTimestamp();
            }

            batch.set(newDocRef, item);
            totalCount++;
          }

          await batch.commit();
        }

        setStatus({ type: 'success', message: `Berhasil mengunggah ${totalCount} data ke ${activeDb}` });
      } catch (err) {
        console.error(err);
        setStatus({ type: 'error', message: `Gagal memproses file: ${err instanceof Error ? err.message : 'Format CSV salah'}` });
      } finally {
        setLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      setStatus({ type: 'error', message: "Gagal membaca file." });
      setLoading(false);
    };

    reader.readAsText(file);
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
              <div className="space-y-4 flex-1">
                <div>
                  <h2 className="text-sm font-black text-slate-900 uppercase">Upload {activeDb}</h2>
                  <p className="text-[10px] text-slate-500 font-medium leading-relaxed mt-1">
                    Gunakan file CSV untuk mengunggah data sekaligus. Pastikan header sesuai dengan template yang disediakan.
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                    className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded text-[10px] font-black uppercase tracking-tighter transition-all disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                    Pilih File CSV
                  </button>
                  <button
                    onClick={downloadTemplate}
                    className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded text-[10px] font-black uppercase tracking-tighter transition-all"
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
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept=".csv"
                    className="hidden"
                  />
                </div>

                {status && (
                  <div className={cn(
                    "p-3 rounded flex items-center gap-3 animate-in fade-in slide-in-from-top-2",
                    status.type === 'success' ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                  )}>
                    {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    <p className="text-[11px] font-bold uppercase">{status.message}</p>
                  </div>
                )}
              </div>

              <div className="md:w-64 bg-slate-50 p-4 rounded-lg border border-slate-100">
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
