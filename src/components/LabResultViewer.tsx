import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Stethoscope, Loader2, Download, AlertCircle, Calendar, User, Layers, ShieldCheck, Heart, ArrowLeft, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';

interface LabResultViewerProps {
  labId: string;
  onClose: () => void;
}

export default function LabResultViewer({ labId, onClose }: LabResultViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visit, setVisit] = useState<any | null>(null);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  useEffect(() => {
    const fetchDoc = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!labId) {
          throw new Error("ID Hasil Pemeriksaan tidak valid.");
        }

        const parts = labId.split('_');
        if (parts.length < 2) {
          throw new Error("Format ID Hasil Pemeriksaan tidak valid.");
        }

        const [studentId, visitId] = parts;
        
        // 1. Try root 'visits' collection first
        const rootRef = doc(db, 'visits', visitId);
        let docSnap = await getDoc(rootRef);
        
        // 2. Fallback to subcollection path
        if (!docSnap.exists()) {
          const subRef = doc(db, 'students', studentId, 'visits', visitId);
          docSnap = await getDoc(subRef);
        }
        
        // 3. Fallback to direct match by labId in visits (in case it didn't use underscore format)
        if (!docSnap.exists()) {
          const directRef = doc(db, 'visits', labId);
          docSnap = await getDoc(directRef);
        }

        if (docSnap.exists()) {
          setVisit(docSnap.data());
        } else {
          throw new Error("Kunjungan medis tidak ditemukan di server (Data rekam medis atau foto lab mungkin belum tersinkronisasi).");
        }
      } catch (err: any) {
        console.error("Error fetching lab result:", err);
        setError(err.message || "Gagal memproses data.");
      } finally {
        setLoading(false);
      }
    };

    fetchDoc();
  }, [labId]);

  // Extract all photos from new format or backwards compatible field
  const photos: string[] = visit?.labPhotos && Array.isArray(visit.labPhotos) && visit.labPhotos.length > 0 
    ? visit.labPhotos 
    : (visit?.labPhoto ? [visit.labPhoto] : []);

  const activePhoto = photos[activePhotoIndex] || '';

  const handleDownload = () => {
    if (!activePhoto) return;
    const link = document.createElement('a');
    link.href = activePhoto;
    link.download = `Suket_HasilLab_${visit.studentName?.replace(/\s+/g, '_') || 'Pasien'}_${activePhotoIndex + 1}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const safeFormatDate = (dateStr: any) => {
    try {
      if (!dateStr) return '-';
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return '-';
      return format(date, 'EEEE, dd MMMM yyyy', { locale: id });
    } catch {
      return '-';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 p-4">
        <Loader2 className="w-8 h-8 text-cyan-600 animate-spin mb-3" />
        <p className="text-xs font-black uppercase tracking-widest text-slate-400">MEMUAT HASIL PEMERIKSAAN...</p>
      </div>
    );
  }

  if (error || !visit) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full text-center space-y-6 bg-white p-8 rounded-2xl border border-slate-200 shadow-xl">
          <AlertCircle className="w-16 h-16 text-rose-500 mx-auto" />
          <div>
            <h1 className="text-xl font-bold uppercase text-slate-800 tracking-tight">Terjadi Kesalahan</h1>
            <p className="text-slate-500 text-sm mt-2">{error || "Data pemeriksaan tidak tersedia."}</p>
          </div>
          <button 
            onClick={onClose}
            className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-black uppercase text-xs rounded-lg tracking-widest transition-colors"
          >
            Masuk ke Dashboard MedReport
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100" translate="no">
      {/* Branding Header Area */}
      <header className="bg-cyan-600 text-white py-4 px-6 sticky top-0 z-10 shadow-md">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/10 p-2 rounded-xl">
              <Stethoscope className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-black text-leading tracking-tighter uppercase text-sm">MedReport Documents</h1>
              <p className="text-[10px] text-cyan-100 font-bold uppercase tracking-wider">Laporan Medis Resmi UKS PLUS SCB</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-xs font-black uppercase tracking-wider bg-white/10 hover:bg-white/20 transition-colors px-3 py-1.5 rounded-lg text-white"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>KEMBALI</span>
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto py-8 px-4 grid grid-cols-1 md:grid-cols-12 gap-6 pb-24">
        {/* Medical Info Detail Block */}
        <div className="md:col-span-5 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-md divide-y divide-slate-100 overflow-hidden">
            <div className="p-4 bg-slate-50 flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Ringkasan Medis</span>
              <span className="flex items-center gap-1 text-[9px] font-bold uppercase text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                <ShieldCheck className="w-3 h-3" /> Verifikasi UKS
              </span>
            </div>

            {/* Student Info Box */}
            <div className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-cyan-100 text-cyan-700 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 block tracking-wider">Pasien</label>
                  <p className="text-sm font-black text-slate-800">{visit.studentName || '-'}</p>
                  <span className="inline-block mt-1 text-[10px] font-bold text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded uppercase">
                    Kelas {visit.grade || '-'}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-cyan-100 text-cyan-700 flex items-center justify-center shrink-0">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-400 block tracking-wider">Tanggal Periksa</label>
                  <p className="text-xs font-bold text-slate-700">{safeFormatDate(visit.date)}</p>
                </div>
              </div>
            </div>

            {/* Vitals Box */}
            <div className="p-4 bg-slate-50/50">
              <label className="text-[9px] font-black uppercase text-slate-400 block tracking-wider mb-2">Tanda Vital</label>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-white p-2 rounded border border-slate-200/60">
                  <span className="text-[8px] font-bold text-slate-400 block">Tensi</span>
                  <span className="text-[10px] font-black text-slate-700 font-mono">{visit.bloodPressure || '-'}</span>
                </div>
                <div className="bg-white p-2 rounded border border-slate-200/60">
                  <span className="text-[8px] font-bold text-slate-400 block">B. Badan</span>
                  <span className="text-[10px] font-black text-slate-700 font-mono">{visit.weight ? `${visit.weight} kg` : '-'}</span>
                </div>
                <div className="bg-white p-2 rounded border border-slate-200/60">
                  <span className="text-[8px] font-bold text-slate-400 block">Suhu</span>
                  <span className="text-[10px] font-black text-slate-700 font-mono">{visit.temperature ? `${visit.temperature}°C` : '-'}</span>
                </div>
              </div>
            </div>

            {/* Examination details */}
            <div className="p-4 space-y-3 text-sm">
              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Keluhan Utama</span>
                <p className="text-xs text-slate-700 leading-relaxed font-semibold italic">"{visit.complaint || '-'}"</p>
              </div>

              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Diagnosa & Gejala</span>
                <p className="text-xs text-slate-900 font-extrabold">{visit.diagnosis || '-'}</p>
              </div>

              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Terapi / Obat</span>
                <p className="text-xs text-slate-800 font-bold">{visit.therapy || '-'}</p>
              </div>

              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Tindakan</span>
                <p className="text-xs text-slate-700 font-medium">{visit.action || '-'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Lab / Prescription / Letters Photo Box */}
        <div className="md:col-span-7 flex flex-col h-full bg-white rounded-xl border border-slate-200/80 shadow-md overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block">Berkas Pendukung / Lampiran</span>
              {photos.length > 1 && (
                <span className="text-[9px] font-bold text-cyan-600 bg-cyan-50 px-1.5 py-0.5 rounded border border-cyan-100 mt-0.5 inline-block">
                  Foto {activePhotoIndex + 1} dari {photos.length}
                </span>
              )}
            </div>
            {activePhoto && (
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 bg-cyan-600 hover:bg-cyan-700 text-white rounded px-2.5 py-1 text-[9px] font-black uppercase transition-colors shrink-0"
              >
                <Download className="w-3 h-3" />
                Download / Unduh #{activePhotoIndex + 1}
              </button>
            )}
          </div>

          <div className="flex-1 bg-slate-950 flex items-center justify-center p-4 min-h-[350px] relative">
            {activePhoto ? (
              <div className="relative group max-w-full">
                <img 
                  src={activePhoto} 
                  alt={`Hasil Lab / Suket ${activePhotoIndex + 1}`} 
                  referrerPolicy="no-referrer"
                  className="max-h-[480px] rounded border border-white/10 shadow-2xl object-contain mx-auto transition-all duration-300"
                />
              </div>
            ) : (
              <div className="text-center p-8 space-y-2">
                <p className="text-white/40 text-sm">Tidak ada berkas/surat hasil lab yang diunggah.</p>
              </div>
            )}
          </div>

          {/* Thumbnails Navigator Segment */}
          {photos.length > 1 && (
            <div className="p-3 bg-slate-50 border-t border-slate-100">
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-1.5 text-center">PILIH FOTO UNTUK MELIHAT ({photos.length} FOTO)</p>
              <div className="flex justify-center gap-3">
                {photos.map((photo, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActivePhotoIndex(i)}
                    className={`relative rounded-lg overflow-hidden border-2 w-16 h-16 transition-all duration-200 hover:scale-105 shrink-0 ${
                      activePhotoIndex === i 
                        ? 'border-cyan-500 scale-105 shadow-md' 
                        : 'border-slate-300 opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img 
                      src={photo} 
                      alt={`Miniatur ${i + 1}`} 
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute bottom-1 right-1 bg-slate-900/80 text-[8px] text-white font-black px-1.5 rounded-md">
                      #{i + 1}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
