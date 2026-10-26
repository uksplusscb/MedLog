import React, { useState, useEffect } from 'react';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { 
  Stethoscope, 
  Loader2, 
  Download, 
  AlertCircle, 
  Calendar, 
  User, 
  ShieldCheck, 
  ArrowLeft, 
  RefreshCw, 
  FileText, 
  ExternalLink,
  Lock,
  LogIn
} from 'lucide-react';
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

  const isLocalSession = typeof window !== 'undefined' && localStorage.getItem('uks_session_local') === 'true';
  const currentUser = auth.currentUser || (isLocalSession ? { uid: 'super-admin-local-uid', email: 'uksplus.scb@gmail.com' } : null);

  const fetchDoc = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!labId) {
        throw new Error("ID Hasil Pemeriksaan tidak valid.");
      }

      const parts = labId.split('_');
      let docSnap: any = null;

      if (parts.length >= 2) {
        const [studentId, visitId] = parts;
        
        // 1. Try root 'visits' collection first
        if (visitId) {
          const rootRef = doc(db, 'visits', visitId);
          docSnap = await getDoc(rootRef).catch(() => null);
        }
        
        // 2. Fallback to subcollection path
        if ((!docSnap || !docSnap.exists()) && studentId && visitId) {
          const subRef = doc(db, 'students', studentId, 'visits', visitId);
          docSnap = await getDoc(subRef).catch(() => null);
        }
      }

      // 3. Fallback to direct doc by labId in visits
      if (!docSnap || !docSnap.exists()) {
        const directRef = doc(db, 'visits', labId);
        docSnap = await getDoc(directRef).catch(() => null);
      }

      // 4. Fallback: Search by query in visits collection
      if (!docSnap || !docSnap.exists()) {
        const q = query(collection(db, 'visits'), where('id', '==', labId));
        const qSnap = await getDocs(q).catch(() => null);
        if (qSnap && !qSnap.empty) {
          docSnap = qSnap.docs[0];
        }
      }

      if (docSnap && docSnap.exists()) {
        setVisit(docSnap.data());
      } else {
        throw new Error("Kunjungan medis tidak ditemukan di database server (Data rekam medis atau file lab belum tersinkronisasi).");
      }
    } catch (err: any) {
      console.error("Error fetching lab result:", err);
      setError(err.message || "Gagal memuat dokumen laboratorium.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchDoc();
    } else {
      setLoading(false);
    }
  }, [labId, currentUser]);

  // Extract all photos / files
  const photos: string[] = [];
  if (visit?.labPhotos && Array.isArray(visit.labPhotos)) {
    visit.labPhotos.forEach((p: string) => {
      if (p && typeof p === 'string' && !photos.includes(p)) photos.push(p);
    });
  }
  if (visit?.labPhoto && typeof visit.labPhoto === 'string' && !photos.includes(visit.labPhoto)) {
    photos.push(visit.labPhoto);
  }
  if (visit?.labUrl && typeof visit.labUrl === 'string' && visit.labUrl.startsWith('data:') && !photos.includes(visit.labUrl)) {
    photos.push(visit.labUrl);
  }

  const activePhoto = photos[activePhotoIndex] || '';
  const isPdf = activePhoto.startsWith('data:application/pdf') || activePhoto.includes('.pdf') || activePhoto.includes('application/pdf');

  const handleDownload = () => {
    if (!activePhoto) return;
    const isPdfFile = activePhoto.startsWith('data:application/pdf') || activePhoto.includes('.pdf');
    const ext = isPdfFile ? 'pdf' : 'jpg';
    const link = document.createElement('a');
    link.href = activePhoto;
    link.download = `Suket_HasilLab_${visit?.studentName?.replace(/\s+/g, '_') || 'Pasien'}_${activePhotoIndex + 1}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenNewTab = () => {
    if (!activePhoto) return;
    const win = window.open();
    if (win) {
      if (isPdf) {
        win.document.write(`
          <html>
            <head><title>Dokumen Hasil Lab PDF - ${visit?.studentName || 'Pasien'}</title></head>
            <body style="margin:0;background:#1e293b;">
              <iframe src="${activePhoto}" style="width:100vw;height:100vh;border:none;"></iframe>
            </body>
          </html>
        `);
      } else {
        win.document.write(`
          <html>
            <head><title>Hasil Lab - ${visit?.studentName || 'Pasien'}</title></head>
            <body style="margin:0;background:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;">
              <img src="${activePhoto}" style="max-width:100%;max-height:100vh;margin:auto;" />
            </body>
          </html>
        `);
      }
    }
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

  if (!currentUser) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-900 p-4 font-sans">
        <div className="max-w-md w-full bg-slate-800 text-white p-8 rounded-2xl border border-slate-700 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 bg-cyan-600/20 text-cyan-400 rounded-full flex items-center justify-center mx-auto border border-cyan-500/30">
            <Lock className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight text-white">Akses Terbatas</h1>
            <p className="text-slate-400 text-xs mt-2 leading-relaxed">
              Dokumen hasil laboratorium pasien bersifat terbatas dan hanya dapat dibuka oleh petugas medis terautentikasi UKS SCB.
            </p>
          </div>
          <div className="pt-2 space-y-3">
            <button
              onClick={onClose}
              className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-black uppercase text-xs rounded-xl tracking-widest transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-600/30"
            >
              <LogIn className="w-4 h-4" />
              <span>Masuk Sesi Petugas UKS</span>
            </button>
            <button
              onClick={onClose}
              className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold uppercase text-xs rounded-xl tracking-wider transition-colors cursor-pointer"
            >
              Kembali ke Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-900 p-4 text-white">
        <Loader2 className="w-8 h-8 text-cyan-500 animate-spin mb-3" />
        <p className="text-xs font-black uppercase tracking-widest text-slate-400">MEMUAT DOKUMEN LABORATORIUM...</p>
      </div>
    );
  }

  if (error || !visit) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-900 p-4 font-sans">
        <div className="max-w-md w-full text-center space-y-6 bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-2xl text-white">
          <AlertCircle className="w-16 h-16 text-rose-500 mx-auto" />
          <div>
            <h1 className="text-xl font-bold uppercase text-white tracking-tight">Gagal Memuat Berkas</h1>
            <p className="text-slate-400 text-xs mt-2 leading-relaxed">{error || "Data pemeriksaan laboratorium tidak ditemukan."}</p>
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <button 
              onClick={fetchDoc}
              className="w-full py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-black uppercase text-xs rounded-xl tracking-widest transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Coba Lagi</span>
            </button>
            <button 
              onClick={onClose}
              className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold uppercase text-xs rounded-xl tracking-wider transition-colors cursor-pointer"
            >
              Kembali
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans" translate="no">
      {/* Branding Header Area */}
      <header className="bg-slate-900/95 backdrop-blur-md border-b border-slate-800 text-white py-4 px-6 sticky top-0 z-20 shadow-xl">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-cyan-600 p-2.5 rounded-xl text-white shadow-lg shadow-cyan-600/30">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-black text-leading tracking-tighter uppercase text-base">MedReport Lab Results</h1>
              <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider">Dokumen Resmi UKS PLUS SCB</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider bg-slate-800 hover:bg-slate-700 transition-colors px-3.5 py-2 rounded-xl text-white border border-slate-700 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>KEMBALI</span>
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto py-8 px-4 grid grid-cols-1 md:grid-cols-12 gap-6 pb-24">
        {/* Medical Info Detail Block */}
        <div className="md:col-span-5 space-y-4">
          <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xl divide-y divide-slate-800 overflow-hidden">
            <div className="p-4 bg-slate-800/60 flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ringkasan Rekam Medis</span>
              <span className="flex items-center gap-1 text-[9px] font-bold uppercase text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-800/60">
                <ShieldCheck className="w-3 h-3 text-emerald-400" /> Terverifikasi UKS
              </span>
            </div>

            {/* Student Info Box */}
            <div className="p-4 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-cyan-950 text-cyan-400 flex items-center justify-center shrink-0 border border-cyan-800/40">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-500 block tracking-wider">Pasien</label>
                  <p className="text-base font-black text-white">{visit.studentName || '-'}</p>
                  <span className="inline-block mt-1 text-[10px] font-bold text-cyan-300 bg-cyan-950/80 border border-cyan-800/50 px-2 py-0.5 rounded uppercase">
                    Kelas {visit.grade || '-'}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-cyan-950 text-cyan-400 flex items-center justify-center shrink-0 border border-cyan-800/40">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase text-slate-500 block tracking-wider">Tanggal Periksa</label>
                  <p className="text-xs font-bold text-slate-200">{safeFormatDate(visit.date)}</p>
                </div>
              </div>
            </div>

            {/* Vitals Box */}
            <div className="p-4 bg-slate-950/40">
              <label className="text-[9px] font-black uppercase text-slate-500 block tracking-wider mb-2">Tanda Vital</label>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                  <span className="text-[8px] font-bold text-slate-400 block">Tensi</span>
                  <span className="text-[11px] font-black text-white font-mono">{visit.bloodPressure || '-'}</span>
                </div>
                <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                  <span className="text-[8px] font-bold text-slate-400 block">B. Badan</span>
                  <span className="text-[11px] font-black text-white font-mono">{visit.weight ? `${visit.weight} kg` : '-'}</span>
                </div>
                <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                  <span className="text-[8px] font-bold text-slate-400 block">Suhu</span>
                  <span className="text-[11px] font-black text-white font-mono">{visit.temperature ? `${visit.temperature}°C` : '-'}</span>
                </div>
              </div>
            </div>

            {/* Examination details */}
            <div className="p-4 space-y-3.5 text-sm">
              <div>
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Keluhan Utama</span>
                <p className="text-xs text-slate-300 leading-relaxed font-semibold italic">"{visit.complaint || '-'}"</p>
              </div>

              <div>
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Diagnosa & Gejala</span>
                <p className="text-xs text-cyan-300 font-extrabold">{visit.diagnosis || '-'}</p>
              </div>

              <div>
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Terapi / Obat</span>
                <p className="text-xs text-slate-200 font-bold">{visit.therapy || '-'}</p>
              </div>

              <div>
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-0.5">Tindakan</span>
                <p className="text-xs text-slate-300 font-medium">{visit.action || '-'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Lab / Prescription / Letters Photo Box */}
        <div className="md:col-span-7 flex flex-col h-full bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden min-h-[500px]">
          <div className="p-4 bg-slate-800/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Lampiran Hasil Laboratorium / Rontgen</span>
              {photos.length > 1 && (
                <span className="text-[9px] font-bold text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800 mt-0.5 inline-block">
                  Berkas {activePhotoIndex + 1} dari {photos.length}
                </span>
              )}
            </div>
            {activePhoto && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleOpenNewTab}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg px-3 py-1.5 text-[10px] font-black uppercase transition-colors cursor-pointer"
                  title="Buka di Tab Baru"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Tab Baru</span>
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg px-3 py-1.5 text-[10px] font-black uppercase transition-colors cursor-pointer shadow-md shadow-cyan-600/30"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh {isPdf ? 'PDF' : 'Gambar'}</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 bg-slate-950 flex flex-col items-center justify-center p-4 min-h-[450px] relative">
            {activePhoto ? (
              isPdf ? (
                <div className="w-full h-full min-h-[480px] flex flex-col items-center justify-center">
                  <iframe 
                    src={activePhoto} 
                    title={`Hasil Lab PDF ${activePhotoIndex + 1}`}
                    className="w-full h-[520px] rounded-xl border border-slate-800 shadow-2xl bg-white"
                  />
                </div>
              ) : (
                <div className="relative group max-w-full flex items-center justify-center">
                  <img 
                    src={activePhoto} 
                    alt={`Hasil Lab ${activePhotoIndex + 1}`} 
                    className="max-h-[500px] rounded-xl border border-slate-800 shadow-2xl object-contain mx-auto transition-all duration-300"
                  />
                </div>
              )
            ) : (
              <div className="text-center p-12 space-y-3">
                <FileText className="w-12 h-12 text-slate-600 mx-auto" />
                <p className="text-slate-400 text-xs font-semibold">Tidak ada berkas/surat hasil lab yang diunggah untuk kunjungan ini.</p>
              </div>
            )}
          </div>

          {/* Thumbnails Navigator Segment */}
          {photos.length > 1 && (
            <div className="p-4 bg-slate-900 border-t border-slate-800">
              <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-2 text-center">PILIH BERKAS DOKUMEN ({photos.length} BERKAS)</p>
              <div className="flex justify-center gap-3">
                {photos.map((photo, i) => {
                  const itemIsPdf = photo.startsWith('data:application/pdf') || photo.includes('.pdf');
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setActivePhotoIndex(i)}
                      className={`relative rounded-xl overflow-hidden border-2 w-16 h-16 transition-all duration-200 hover:scale-105 shrink-0 flex items-center justify-center cursor-pointer ${
                        activePhotoIndex === i 
                          ? 'border-cyan-500 scale-105 shadow-lg shadow-cyan-500/20 bg-cyan-950' 
                          : 'border-slate-800 bg-slate-950 opacity-60 hover:opacity-100'
                      }`}
                    >
                      {itemIsPdf ? (
                        <div className="flex flex-col items-center justify-center p-1 text-center">
                          <FileText className="w-6 h-6 text-cyan-400 mb-0.5" />
                          <span className="text-[7px] font-black text-cyan-300 uppercase">PDF</span>
                        </div>
                      ) : (
                        <img 
                          src={photo} 
                          alt={`Miniatur ${i + 1}`} 
                          className="w-full h-full object-cover"
                        />
                      )}
                      <span className="absolute bottom-1 right-1 bg-slate-900/90 text-[8px] text-white font-black px-1.5 py-0.5 rounded-md border border-slate-700">
                        #{i + 1}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
