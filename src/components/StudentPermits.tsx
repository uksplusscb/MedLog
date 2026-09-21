import React, { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  doc, 
  deleteDoc, 
  updateDoc,
  serverTimestamp,
  getDocs
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { 
  FileText, 
  Plus, 
  Search, 
  Clock, 
  User, 
  Trash2, 
  AlertTriangle, 
  Send, 
  Check, 
  Calendar, 
  Activity, 
  Phone, 
  UserCheck, 
  Home, 
  X,
  PlusCircle,
  ArrowRight,
  Filter,
  CheckCircle,
  HelpCircle,
  RefreshCw,
  Printer,
  Download,
  MessageSquare,
  Share2,
  ExternalLink
} from 'lucide-react';
import { format } from 'date-fns';

interface StudentPermit {
  id?: string;
  studentName: string;
  grade: string;
  gender: string;
  date: string; // yyyy-MM-dd
  checkoutTime: string; // HH:mm
  complaint: string;
  status: 'Menunggu Penjemputan' | 'Dalam Perjalanan' | 'Sampai di Rumah';
  additionalNotes: string;
  createdAt: any;
  returnDate?: string; // yyyy-MM-dd
  
  waliKelas?: string;
  waWaliKelas?: string;
  pembina?: string;
  waPembina?: string;
  
  deliveryStatus?: 'Belum Dikirim' | 'Sedang Mengirim' | 'Berhasil' | 'Gagal';
  deliveryTime?: string;
  deliveryTarget?: string;
  deliveryError?: string;
}

interface StudentMaster {
  id: string;
  name: string;
  grade?: string;
  gender?: string;
  waliKelas?: string;
  waWaliKelas?: string;
  pembina?: string;
  waPembina?: string;
}

const formatDateIndo = (dateStr?: string) => {
  if (!dateStr) return '_________________';
  try {
    const months = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parts[0];
      const monthIndex = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      if (monthIndex >= 0 && monthIndex < 12) {
        return `${day} ${months[monthIndex]} ${year}`;
      }
    }
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch (e) {
    return dateStr;
  }
};

interface StudentPermitsProps {
  defaultStudentName?: string;
  defaultGrade?: string;
  defaultGender?: string;
  defaultComplaint?: string;
}

export default function StudentPermits({
  defaultStudentName = '',
  defaultGrade = '',
  defaultGender = 'Laki-laki',
  defaultComplaint = ''
}: StudentPermitsProps) {
  const [permits, setPermits] = useState<StudentPermit[]>([]);
  const [students, setStudents] = useState<StudentMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingPermit, setEditingPermit] = useState<StudentPermit | null>(null);
  const [activePrintPermit, setActivePrintPermit] = useState<StudentPermit | null>(null);
  
  // Search and filter states
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [showAllDates, setShowAllDates] = useState(false);

  // Form states
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [studentSearchInput, setStudentSearchInput] = useState('');
  const [showStudentDropdown, setShowStudentDropdown] = useState(false);

  const [formData, setFormData] = useState({
    studentName: '',
    grade: '',
    gender: 'Laki-laki',
    date: format(new Date(), 'yyyy-MM-dd'),
    checkoutTime: format(new Date(), 'HH:mm'),
    complaint: '',
    status: 'Menunggu Penjemputan' as any,
    additionalNotes: '',
    returnDate: format(new Date(), 'yyyy-MM-dd'),
    waliKelas: '',
    waWaliKelas: '',
    pembina: '',
    waPembina: ''
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [sendingWaId, setSendingWaId] = useState<string | null>(null);
  const [waTargetMode, setWaTargetMode] = useState<'wali' | 'pembina' | 'keduanya'>('keduanya');
  const [modalWaTarget, setModalWaTarget] = useState<'keduanya' | 'wali' | 'pembina' | 'custom'>('keduanya');
  const [modalCustomWaNumber, setModalCustomWaNumber] = useState<string>('');
  const [modalWaStatus, setModalWaStatus] = useState<{ type: 'idle' | 'loading' | 'success' | 'error'; message?: string }>({ type: 'idle' });
  const printRef = useRef<HTMLDivElement>(null);

  // Load permits and student master data
  useEffect(() => {
    // Listen to studentPermits
    const q = query(collection(db, 'studentPermits'), orderBy('createdAt', 'desc'));
    const unsubPermits = onSnapshot(q, (snapshot) => {
      const permitList: StudentPermit[] = [];
      snapshot.forEach((doc) => {
        permitList.push({ id: doc.id, ...doc.data() } as StudentPermit);
      });
      setPermits(permitList);
      setLoading(false);
    }, (err) => {
      console.error("Error loading student permits:", err);
      // Fallback
      setPermits([]);
      setLoading(false);
    });

    // Load Master students for autocomplete using Google Spreadsheet
    const fetchStudents = async () => {
      try {
        const CACHE_KEY = 'uks_students_master_cache';
        const CACHE_TIME_KEY = 'uks_students_master_cache_time';
        const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
        const cachedData = localStorage.getItem(CACHE_KEY);
        
        // 5 minutes cache
        if (cachedData && cachedTime && (Date.now() - parseInt(cachedTime)) < 5 * 60 * 1000) {
          setStudents(JSON.parse(cachedData));
          return;
        }

        const SHEET_URL = (import.meta as any).env?.VITE_MASTER_DATA_URL || "https://docs.google.com/spreadsheets/d/e/2PACX-1vTE2k1q2L/pub?output=csv"; 
        
        const res = await fetch(SHEET_URL);
        const csvText = await res.text();
        
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            const list: StudentMaster[] = [];
            results.data.forEach((row: any, index: number) => {
              // Convert object keys to lower case for case-insensitive matching
              const normalizedRow: any = {};
              Object.keys(row).forEach(key => {
                normalizedRow[key.trim().toLowerCase()] = row[key];
              });

              // Looking for specific columns based on user instruction
              const name = normalizedRow['nama siswa'] || normalizedRow['nama'] || normalizedRow['name'];
              if (name) {
                list.push({
                  id: `csv_${index}`,
                  name: name.trim(),
                  grade: (normalizedRow['kelas'] || normalizedRow['grade'] || '').trim(),
                  gender: (normalizedRow['jenis kelamin'] || normalizedRow['gender'] || 'Laki-laki').trim(),
                  waliKelas: (normalizedRow['nama wali kelas'] || normalizedRow['wali kelas'] || '').trim(),
                  waWaliKelas: (normalizedRow['nomor whatsapp wali kelas'] || normalizedRow['wa wali kelas'] || normalizedRow['no wa wali kelas'] || '').trim(),
                  pembina: (normalizedRow['nama pembina'] || normalizedRow['pembina'] || '').trim(),
                  waPembina: (normalizedRow['nomor whatsapp pembina'] || normalizedRow['wa pembina'] || normalizedRow['no wa pembina'] || '').trim(),
                });
              }
            });
            
            const sortedList = list.sort((a, b) => a.name.localeCompare(b.name));
            setStudents(sortedList);
            localStorage.setItem(CACHE_KEY, JSON.stringify(sortedList));
            localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
          },
          error: (err: any) => {
             console.warn("PapaParse error:", err);
             setStudents([]);
          }
        });

      } catch (err) {
        console.warn("Failed to load students for auto-complete from spreadsheet:", err);
      }
    };

    fetchStudents();

    return () => {
      unsubPermits();
    };
  }, []);

  // Filtered permits
  const filteredPermits = permits.filter(p => {
    const matchesSearch = p.studentName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          p.grade.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          p.complaint.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    const matchesDate = showAllDates || p.date === dateFilter;

    return matchesSearch && matchesStatus && matchesDate;
  });

  // Calculate statistics for the summary cards
  const stats = {
    total: filteredPermits.length,
    waiting: filteredPermits.filter(p => p.status === 'Menunggu Penjemputan').length,
    transit: filteredPermits.filter(p => p.status === 'Dalam Perjalanan').length,
    arrived: filteredPermits.filter(p => p.status === 'Sampai di Rumah').length,
  };

  // Autocomplete handle select student
  const handleSelectStudent = (student: StudentMaster) => {
    setFormData(prev => ({
      ...prev,
      studentName: student.name,
      grade: student.grade || '',
      gender: student.gender || 'Laki-laki',
      waliKelas: student.waliKelas || '',
      waWaliKelas: student.waWaliKelas || '',
      pembina: student.pembina || '',
      waPembina: student.waPembina || ''
    }));
    setStudentSearchInput(student.name);
    setShowStudentDropdown(false);
  };

  // Open form to add
  const handleOpenAdd = () => {
    setEditingPermit(null);
    setFormData({
      studentName: defaultStudentName || '',
      grade: defaultGrade || '',
      gender: defaultGender || 'Laki-laki',
      date: format(new Date(), 'yyyy-MM-dd'),
      checkoutTime: format(new Date(), 'HH:mm'),
      complaint: defaultComplaint || '',
      status: 'Menunggu Penjemputan',
      additionalNotes: '',
      returnDate: format(new Date(), 'yyyy-MM-dd'),
      waliKelas: '',
      waWaliKelas: '',
      pembina: '',
      waPembina: ''
    });
    setStudentSearchInput(defaultStudentName || '');
    setError(null);
    setFormOpen(true);
  };

  // Open form to edit
  const handleOpenEdit = (permit: StudentPermit) => {
    setEditingPermit(permit);
    setFormData({
      studentName: permit.studentName,
      grade: permit.grade,
      gender: permit.gender || 'Laki-laki',
      date: permit.date,
      checkoutTime: permit.checkoutTime || format(new Date(), 'HH:mm'),
      complaint: permit.complaint,
      status: permit.status,
      additionalNotes: permit.additionalNotes || '',
      returnDate: permit.returnDate || permit.date,
      waliKelas: permit.waliKelas || '',
      waWaliKelas: permit.waWaliKelas || '',
      pembina: permit.pembina || '',
      waPembina: permit.waPembina || ''
    });
    setStudentSearchInput(permit.studentName);
    setError(null);
    setFormOpen(true);
  };

  // Submit permit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.studentName.trim()) {
      setError('Nama siswa wajib diisi');
      return;
    }
    if (!formData.grade.trim()) {
      setError('Kelas wajib diisi');
      return;
    }
    if (!formData.complaint.trim()) {
      setError('Gejala / Keluhan wajib diisi');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let savedPermit: StudentPermit;
      if (editingPermit && editingPermit.id) {
        const docRef = doc(db, 'studentPermits', editingPermit.id);
        await updateDoc(docRef, {
          ...formData,
          createdAt: editingPermit.createdAt || serverTimestamp()
        });
        savedPermit = { ...formData, id: editingPermit.id, createdAt: editingPermit.createdAt } as StudentPermit;
      } else {
        const docRef = await addDoc(collection(db, 'studentPermits'), {
          ...formData,
          deliveryStatus: 'Belum Dikirim',
          createdAt: serverTimestamp()
        });
        savedPermit = { ...formData, id: docRef.id, deliveryStatus: 'Belum Dikirim' } as StudentPermit;
      }
      setFormOpen(false);
      setEditingPermit(null);
      
      // Auto trigger send WA
      handleSendWhatsApp(savedPermit);
      
    } catch (err: any) {
      console.error("Error saving permit:", err);
      setError(err.message || 'Gagal menyimpan data perizinan');
    } finally {
      setSubmitting(false);
    }
  };

  // Open modal print / surat izin with refreshed WA status
  const handleOpenModalPrint = (permit: StudentPermit) => {
    setActivePrintPermit(permit);
    setModalWaStatus({ type: 'idle' });
    setModalCustomWaNumber('');
    setModalWaTarget('keduanya');
  };

  // Direct WhatsApp Chat Link Fallback
  const handleOpenDirectWhatsApp = (targetNumber: string, targetName: string, permit: StudentPermit) => {
    if (!targetNumber || !targetNumber.trim()) {
      alert("Nomor WhatsApp belum tersedia untuk kontak ini.");
      return;
    }
    let rawNum = targetNumber.replace(/\D/g, '');
    if (rawNum.startsWith('0')) rawNum = '62' + rawNum.substring(1);
    else if (rawNum.startsWith('8')) rawNum = '62' + rawNum;

    const messageContent = `Assalamu'alaikum Wr. Wb.\n\nYth. ${targetName}\n\nKami menginformasikan bahwa siswa berikut telah mendapatkan *Surat Izin Sakit* dari UKS Sekolah Cendekia BAZNAS:\n\n👤 *Nama* : ${permit.studentName}\n🏫 *Kelas* : ${permit.grade}\n📅 *Tanggal* : ${formatDateIndo(permit.date)}\n⏰ *Jam* : ${permit.checkoutTime} WIB\n🩺 *Diagnosis* : ${permit.complaint}\n📋 *Instruksi/Anjuran* : ${permit.additionalNotes || 'Beristirahat di rumah / berobat'}\n⏳ *Lama Istirahat* : ${permit.date === (permit.returnDate || permit.date) ? '1 Hari' : `${formatDateIndo(permit.date)} s.d ${formatDateIndo(permit.returnDate)}`}\n\nMohon izin agar siswa dapat beristirahat sesuai rekomendasi dari UKS.\n\nTerima kasih.\n\nHormat kami,\n*UKS Sekolah Cendekia Baznas*`;

    const waUrl = `https://api.whatsapp.com/send?phone=${rawNum}&text=${encodeURIComponent(messageContent)}`;
    window.open(waUrl, '_blank');
  };

  // Generate PDF and Send WA
  const handleSendWhatsApp = async (
    permit: StudentPermit,
    targetOverride?: 'wali' | 'pembina' | 'keduanya' | 'custom',
    customNumber?: string,
    keepModalOpen: boolean = false
  ) => {
    if (!permit.id) return;
    
    const activeMode = targetOverride || waTargetMode;
    let targets: string[] = [];
    let targetNames: string[] = [];

    if (activeMode === 'wali' || activeMode === 'keduanya') {
      if (!permit.waWaliKelas) {
        const msg = "Nomor WhatsApp Wali Kelas belum tercatat.";
        if (keepModalOpen) {
          setModalWaStatus({ type: 'error', message: msg });
          return;
        }
        alert(msg);
        return;
      }
      targets.push(permit.waWaliKelas);
      targetNames.push(`Bapak/Ibu Wali Kelas (${permit.waliKelas || 'Kelas ' + permit.grade})`);
    }

    if (activeMode === 'pembina' || activeMode === 'keduanya') {
      if (!permit.waPembina) {
        const msg = "Nomor WhatsApp Pembina belum tercatat.";
        if (keepModalOpen) {
          setModalWaStatus({ type: 'error', message: msg });
          return;
        }
        alert(msg);
        return;
      }
      targets.push(permit.waPembina);
      targetNames.push(`Bapak/Ibu Pembina (${permit.pembina || 'Asrama'})`);
    }

    if (activeMode === 'custom') {
      if (!customNumber || !customNumber.trim()) {
        const msg = "Silakan masukkan nomor WhatsApp tujuan.";
        if (keepModalOpen) {
          setModalWaStatus({ type: 'error', message: msg });
          return;
        }
        alert(msg);
        return;
      }
      targets.push(customNumber.trim());
      targetNames.push(`Orang Tua / Wali Santri (${permit.studentName})`);
    }

    if (!permit.complaint) {
      const msg = "Diagnosis / keluhan belum diisi.";
      if (keepModalOpen) {
        setModalWaStatus({ type: 'error', message: msg });
        return;
      }
      alert(msg);
      return;
    }

    if (targets.length === 0) {
      const msg = "Tidak ada target penerima WhatsApp yang valid.";
      if (keepModalOpen) {
        setModalWaStatus({ type: 'error', message: msg });
        return;
      }
      alert(msg);
      return;
    }

    // Set active print permit so it renders, we can capture it
    setActivePrintPermit(permit);
    setSendingWaId(permit.id);
    if (keepModalOpen) {
      setModalWaStatus({ type: 'loading', message: `Sedang membuat PDF dan mengirim pesan ke ${targets.length} nomor WhatsApp...` });
    }
    
    try {
      // Update DB to Sedang Mengirim
      await updateDoc(doc(db, 'studentPermits', permit.id), {
        deliveryStatus: 'Sedang Mengirim',
        deliveryTarget: activeMode
      });

      // Wait a moment for DOM to render the printable area
      await new Promise(resolve => setTimeout(resolve, 500));

      const printElement = document.getElementById('printable-surat-izin');
      if (!printElement) {
        throw new Error("Gagal menemukan elemen surat untuk dibuat PDF");
      }

      const canvas = await html2canvas(printElement, { scale: 2 });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      
      const pdfBase64 = pdf.output('datauristring').split(',')[1]; // get base64 portion
      
      const customToken = localStorage.getItem('uks_fonnte_token') || 'GVsuHmPXyqYQ6TkY3GMK';
      
      let allSuccess = true;
      let errorMsg = '';

      for (let i = 0; i < targets.length; i++) {
        let rawNum = targets[i].replace(/\D/g, '');
        if (rawNum.startsWith('0')) rawNum = '62' + rawNum.substring(1);
        else if (rawNum.startsWith('8')) rawNum = '62' + rawNum;

        const messageContent = `Assalamu'alaikum Wr. Wb.\n\nYth. ${targetNames[i]}\n\nKami menginformasikan bahwa siswa berikut telah mendapatkan *Surat Izin Sakit* dari UKS Sekolah Cendekia BAZNAS.\n\n👤 *Nama* : ${permit.studentName}\n🏫 *Kelas* : ${permit.grade}\n📅 *Tanggal* : ${formatDateIndo(permit.date)}\n⏰ *Jam* : ${permit.checkoutTime} WIB\n🩺 *Diagnosis* : ${permit.complaint}\n📋 *Instruksi/Anjuran* : ${permit.additionalNotes || 'Beristirahat di rumah / berobat'}\n⏳ *Lama Istirahat* : ${permit.date === (permit.returnDate || permit.date) ? '1 Hari' : `${formatDateIndo(permit.date)} s.d ${formatDateIndo(permit.returnDate)}`}\n\nMohon izin agar siswa dapat beristirahat sesuai rekomendasi dari UKS.\n\nTerima kasih.\n\nHormat kami,\n*UKS Sekolah Cendekia Baznas*\n\nLampiran:\n📄 *Surat Izin Sakit Resmi (PDF)*`;

        const response = await fetch('/api/send-wa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target: rawNum,
            message: messageContent,
            token: customToken,
            fileBase64: pdfBase64,
            fileName: `Surat_Izin_Sakit_${permit.studentName.replace(/\s+/g, '_')}.pdf`
          })
        });

        const result = await response.json();
        if (result.status !== true && result.success !== true) {
           allSuccess = false;
           errorMsg = result.reason || result.message || 'Gagal dari server WhatsApp Fonnte';
           break;
        }
      }

      const nowIso = new Date().toISOString();
      if (allSuccess) {
        await updateDoc(doc(db, 'studentPermits', permit.id), {
          deliveryStatus: 'Berhasil',
          deliveryTime: nowIso,
          deliveryError: null
        });

        if (keepModalOpen) {
          setModalWaStatus({ type: 'success', message: 'Surat izin beserta PDF berhasil dikirim ke WhatsApp!' });
          setActivePrintPermit(prev => prev && prev.id === permit.id ? {
            ...prev,
            deliveryStatus: 'Berhasil',
            deliveryTime: nowIso,
            deliveryError: undefined
          } : prev);
        } else {
          alert('Notifikasi WhatsApp beserta file PDF berhasil terkirim!');
        }
      } else {
        throw new Error(errorMsg);
      }
    } catch (err: any) {
      console.error("Failed sending WA with PDF:", err);
      const nowIso = new Date().toISOString();
      await updateDoc(doc(db, 'studentPermits', permit.id), {
        deliveryStatus: 'Gagal',
        deliveryTime: nowIso,
        deliveryError: err.message || 'Terjadi kesalahan sistem'
      });

      if (keepModalOpen) {
        setModalWaStatus({ type: 'error', message: `Gagal mengirim: ${err.message}` });
        setActivePrintPermit(prev => prev && prev.id === permit.id ? {
          ...prev,
          deliveryStatus: 'Gagal',
          deliveryTime: nowIso,
          deliveryError: err.message
        } : prev);
      } else {
        alert(`Gagal mengirim pesan WA: ${err.message}`);
      }
    } finally {
      setSendingWaId(null);
      if (!keepModalOpen) {
        setActivePrintPermit(null);
      }
    }
  };

  // Download PDF
  const handleDownloadPDF = async (permit: StudentPermit) => {
    setActivePrintPermit(permit);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    try {
      const printElement = document.getElementById('printable-surat-izin');
      if (!printElement) throw new Error("Gagal menemukan elemen surat untuk dibuat PDF");

      const canvas = await html2canvas(printElement, { scale: 2 });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      
      pdf.save(`Surat_Izin_Sakit_${permit.studentName.replace(/\s+/g, '_')}.pdf`);
    } catch (err: any) {
      alert(`Gagal download PDF: ${err.message}`);
    } finally {
      setActivePrintPermit(null);
    }
  };

  // Delete permit
  const handleDelete = async (id: string) => {
    if (confirm('Apakah Anda yakin ingin menghapus arsip perizinan siswa ini?')) {
      try {
        await deleteDoc(doc(db, 'studentPermits', id));
      } catch (err) {
        console.error("Error deleting permit:", err);
        alert('Gagal menghapus data');
      }
    }
  };

  // Set Permit Status directly
  const handleUpdateStatus = async (id: string, newStatus: StudentPermit['status']) => {
    try {
      await updateDoc(doc(db, 'studentPermits', id), {
        status: newStatus
      });
    } catch (err) {
      console.error("Error updating status:", err);
      alert('Gagal merubah status');
    }
  };

  // Filter students by input
  const filteredStudentsAutoComplete = students.filter(s => 
    s.name.toLowerCase().includes(studentSearchInput.toLowerCase())
  ).slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-white rounded-lg border border-slate-200 shadow-sm mt-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-5 h-5 text-red-500 animate-pulse" />
            <span className="text-[10px] bg-red-50 text-red-600 font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider">Layanan Darurat</span>
          </div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">Perizinan Pulang Siswa Sakit</h1>
          <p className="text-xs text-slate-500 mt-1">Mencatat, memverifikasi, dan mengumumkan siswa yang diizinkan meninggalkan sekolah lebih cepat karena sakit jasmani.</p>
        </div>
        
        <button
          onClick={handleOpenAdd}
          className="flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 px-4 rounded text-xs transition-colors shadow-sm self-start md:self-auto"
        >
          <Plus className="w-4 h-4" />
          BUAT SURAT IZIN BARU
        </button>
      </div>

      {/* Stats Board */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-between">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Total Izin Hari Ini</p>
          <p className="text-2xl font-black text-slate-800 mt-2">{stats.total}</p>
          <p className="text-[10px] text-slate-500 mt-1">Siswa dipulangkan</p>
        </div>
        
        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-between">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider text-amber-600">Menunggu Penjemputan</p>
          <p className="text-2xl font-black text-amber-600 mt-2">{stats.waiting}</p>
          <p className="text-[10px] text-slate-500 mt-1">Di ruang UKS sekolah</p>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-between">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider text-blue-600">Dalam Perjalanan</p>
          <p className="text-2xl font-black text-blue-600 mt-2">{stats.transit}</p>
          <p className="text-[10px] text-slate-500 mt-1">Didampingi penjemput</p>
        </div>

        <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col justify-between">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider text-emerald-600">Sampai di Rumah</p>
          <p className="text-2xl font-black text-emerald-600 mt-2">{stats.arrived}</p>
          <p className="text-[10px] text-slate-500 mt-1">Dikonfirmasi Orang Tua</p>
        </div>
      </div>

      {/* Control Filter Bar */}
      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          {/* Search bar */}
          <div className="relative w-full lg:w-96">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-300" />
            <input 
              type="text" 
              placeholder="Cari siswa, kelas, keluhan..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded text-xs focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Quick Controls */}
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-end">
            {/* Status Select Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="py-1.5 px-3 border border-slate-200 bg-white rounded text-xs text-slate-600 focus:outline-none focus:border-cyan-500"
              >
                <option value="all">Semua Status</option>
                <option value="Menunggu Penjemputan">⏳ Menunggu Penjemputan</option>
                <option value="Dalam Perjalanan">🚗 Dalam Perjalanan</option>
                <option value="Sampai di Rumah">🏠 Sampai di Rumah</option>
              </select>
            </div>

            {/* Date Target Selector */}
            <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
              <input
                type="date"
                value={dateFilter}
                disabled={showAllDates}
                onChange={(e) => setDateFilter(e.target.value)}
                className="py-1.5 px-2 border border-slate-200 rounded text-xs text-slate-600 focus:outline-none disabled:bg-slate-50"
              />
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-600">
                <input 
                  type="checkbox"
                  checked={showAllDates}
                  onChange={(e) => setShowAllDates(e.target.checked)}
                  className="rounded dark:bg-slate-900 border-slate-300 text-cyan-600"
                />
                Tampilkan Semua Hari
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Active Form Modal / Expandable Panel */}
      {formOpen && (
        <div className="bg-white rounded-lg border border-slate-200 shadow-md p-6 relative">
          <button 
            type="button" 
            onClick={() => setFormOpen(false)}
            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors bg-transparent border-none cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4 pb-2 border-b border-slate-100 flex items-center gap-2">
            <PlusCircle className="w-4 h-4 text-rose-500" />
            <span>{editingPermit ? 'Edit Surat Izin Pulang' : 'Formulir Surat Izin Pulang Sakit'}</span>
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 rounded text-xs font-medium">
              ⚠️ {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              {/* Student Name Auto-complete / Free Text */}
              <div className="space-y-1 relative">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Nama Siswa *</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Mulai ketik nama siswa..."
                    value={studentSearchInput}
                    onChange={(e) => {
                      setStudentSearchInput(e.target.value);
                      handleSelectStudent({ id: 'guest', name: e.target.value });
                      setShowStudentDropdown(true);
                    }}
                    onFocus={() => setShowStudentDropdown(true)}
                    className="w-full text-xs p-2 border border-slate-200 rounded focus:border-cyan-500 focus:outline-none"
                  />
                  {showStudentDropdown && studentSearchInput.trim() && (
                    <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto z-50">
                      {filteredStudentsAutoComplete.length > 0 ? (
                        filteredStudentsAutoComplete.map(student => (
                          <button
                            key={student.id}
                            type="button"
                            onClick={() => handleSelectStudent(student)}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50 text-xs border-b border-slate-50 last:border-none flex items-center justify-between"
                          >
                            <span className="font-semibold text-slate-700">{student.name}</span>
                            <span className="text-[10px] bg-slate-100 text-slate-500 py-0.5 px-2 rounded-full uppercase font-bold">{student.grade || 'No-class'}</span>
                          </button>
                        ))
                      ) : (
                        <div className="p-3 text-center text-[10px] text-slate-400 font-mono">
                          Tidak ada siswa terdaftar. Klik luar untuk menyimpan nama manual.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Grade */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Kelas *</label>
                <input
                  type="text"
                  placeholder="Contoh: 10 IPA 1, 11 IPS 2"
                  value={formData.grade}
                  onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
                  className="w-full text-xs p-2 border border-slate-200 rounded focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {/* Gender */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Jenis Kelamin</label>
                <select
                  value={formData.gender}
                  onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                  className="w-full text-xs p-2 border border-slate-200 rounded focus:border-cyan-500 focus:outline-none"
                >
                  <option value="Laki-laki">Laki-laki</option>
                  <option value="Perempuan">Perempuan</option>
                </select>
              </div>

              {/* Wali Kelas */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Wali Kelas</label>
                <input
                  type="text"
                  value={formData.waliKelas}
                  readOnly
                  placeholder="Auto-fill"
                  className="w-full text-xs p-2 border border-slate-100 bg-slate-50 rounded text-slate-500 focus:outline-none"
                />
              </div>

              {/* Pembina */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Pembina</label>
                <input
                  type="text"
                  value={formData.pembina}
                  readOnly
                  placeholder="Auto-fill"
                  className="w-full text-xs p-2 border border-slate-100 bg-slate-50 rounded text-slate-500 focus:outline-none"
                />
              </div>

              {/* Kosong (Spacer to keep 3 columns align) */}
              <div className="hidden md:block"></div>

              {/* Diagnosis / Symptom */}
              <div className="space-y-1 md:col-span-2">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Keluhan / Gejala Utama (Diagnosis) *</label>
                <input
                  type="text"
                  placeholder="Contoh: Demam tinggi, pusing mual berlebih, cedera pergelangan kaki"
                  value={formData.complaint}
                  onChange={(e) => setFormData({ ...formData, complaint: e.target.value })}
                  className="w-full text-xs p-2 border border-slate-200 rounded focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {/* Time of Permission */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Jam Izin Pulang</label>
                <input
                  type="time"
                  value={formData.checkoutTime}
                  onChange={(e) => setFormData({ ...formData, checkoutTime: e.target.value })}
                  className="w-full text-xs p-2 border border-slate-200 rounded focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {/* Date */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Tanggal Perizinan (Pulang)</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="w-full text-xs p-2 border border-slate-200 rounded focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {/* Return Date */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-rose-600 uppercase font-extrabold">Tanggal Kembali ke Asrama/Sekolah</label>
                <input
                  type="date"
                  value={formData.returnDate}
                  onChange={(e) => setFormData({ ...formData, returnDate: e.target.value })}
                  className="w-full text-xs p-2 border border-rose-200 rounded focus:border-rose-500 focus:outline-none"
                />
              </div>

              {/* Status */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Status Awal</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full text-xs p-2 border border-slate-200 rounded focus:border-cyan-500 focus:outline-none"
                >
                  <option value="Menunggu Penjemputan">⏳ Menunggu Penjemputan</option>
                  <option value="Dalam Perjalanan">🚗 Dalam Perjalanan (Otw)</option>
                  <option value="Sampai di Rumah">🏠 Sampai di Rumah (Selesai)</option>
                </select>
              </div>

              {/* Additional Notes */}
              <div className="space-y-1 md:col-span-3">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Catatan Tambahan / Instruksi UKS</label>
                <textarea
                  placeholder="Contoh: Sudah diminumkan Paracetamol 1 tablet pada jam 09:12. Diminta kontrol ke dokter bila demam bertahan 3 hari."
                  value={formData.additionalNotes}
                  onChange={(e) => setFormData({ ...formData, additionalNotes: e.target.value })}
                  rows={2}
                  className="w-full text-xs p-2 border border-slate-200 rounded focus:border-cyan-500 focus:outline-none resize-none font-sans"
                />
              </div>

            </div>

            {/* WA Sending Options */}
            <div className="pt-2 mt-4 border-t border-slate-100">
              <label className="text-[10px] font-bold text-slate-600 uppercase mb-2 block">Pilihan Pengiriman WhatsApp (Otomatis dikirim setelah klik Terbitkan/Update)</label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="waTarget" value="keduanya" checked={waTargetMode === 'keduanya'} onChange={() => setWaTargetMode('keduanya')} className="accent-rose-600" />
                  <span className="text-xs font-semibold text-slate-700">Wali & Pembina</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="waTarget" value="wali" checked={waTargetMode === 'wali'} onChange={() => setWaTargetMode('wali')} className="accent-rose-600" />
                  <span className="text-xs font-semibold text-slate-700">Hanya Wali Kelas</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="waTarget" value="pembina" checked={waTargetMode === 'pembina'} onChange={() => setWaTargetMode('pembina')} className="accent-rose-600" />
                  <span className="text-xs font-semibold text-slate-700">Hanya Pembina</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="px-4 py-2 border border-slate-200 rounded text-xs text-slate-500 hover:bg-slate-50 transition-colors uppercase font-bold"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded text-xs transition-colors uppercase font-bold"
              >
                {submitting ? 'Menyimpan...' : (editingPermit ? 'Update Surat Izin' : 'Terbitkan Surat Izin')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Permits Records Grid / List */}
      {loading ? (
        <div className="p-12 text-center bg-white rounded-lg border border-slate-200">
          <RefreshCw className="w-8 h-8 text-rose-500 animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-500">Memuat arsitektur perizinan siswa...</p>
        </div>
      ) : filteredPermits.length === 0 ? (
        <div className="p-16 text-center bg-white rounded-lg border border-slate-200">
          <FileText className="w-12 h-12 text-slate-200 mx-auto mb-4" />
          <h3 className="text-slate-800 font-bold uppercase tracking-wide text-xs">Arsip Perizinan Kosong</h3>
          <p className="text-slate-500 text-xs mt-1">Tidak ditemukan siswa yang izin atau dipulangkan sesuai kriteria filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPermits.map((permit) => (
            <div 
              key={permit.id}
              className="bg-white rounded-lg border border-slate-200 hover:border-slate-300 transition-all shadow-xs flex flex-col justify-between overflow-hidden"
            >
              {/* Header */}
              <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono text-slate-400 font-bold tracking-tight">UUID-IZIN-{permit.id?.substring(0, 5).toUpperCase()}</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Calendar className="w-3 h-3 text-slate-400" />
                    <span className="text-[10px] text-slate-500 font-bold">{permit.date} @ {permit.checkoutTime || '--:--'}</span>
                  </div>
                </div>

                {/* Status Indicator Badge */}
                <div className="text-right">
                  {permit.status === 'Menunggu Penjemputan' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">⏳ UKS</span>
                  )}
                  {permit.status === 'Dalam Perjalanan' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">🚗 JALAN</span>
                  )}
                  {permit.status === 'Sampai di Rumah' && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">🏠 TIBA</span>
                  )}
                </div>
              </div>

              {/* Main Info */}
              <div className="p-4 flex-1 space-y-4">
                {/* Student Identity */}
                <div>
                  <p className="text-xs font-black uppercase tracking-tight text-slate-800 leading-none">{permit.studentName}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">Kelas {permit.grade} • {permit.gender}</p>
                </div>

                {/* Symtoms / Sickness info */}
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-100">
                  <span className="text-[8px] font-extrabold uppercase text-rose-500 tracking-wider">Diagnosis Utama</span>
                  <p className="text-xs font-semibold text-rose-800 mt-0.5">{permit.complaint}</p>
                </div>

                {/* Pickup details */}
                <div className="text-xs space-y-1 pt-1 text-slate-600 font-medium border-t border-slate-50">
                  {permit.additionalNotes && (
                    <div className="pt-2">
                      <span className="text-slate-400 text-[10px] block mb-0.5">Catatan UKS:</span>
                      <p className="text-[11px] text-slate-500 leading-normal italic bg-slate-50 p-2 rounded border border-slate-100">{permit.additionalNotes}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer Actions */}
              <div className="p-3 bg-slate-50 border-t border-slate-100 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  {/* Action Buttons */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => handleOpenEdit(permit)}
                      className="p-1 px-2 border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded text-[9px] font-bold uppercase transition-all"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleOpenModalPrint(permit)}
                      className="p-1 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded text-[9px] font-bold uppercase transition-all flex items-center gap-1"
                      title="Lihat, Cetak & Kirim Surat ke WhatsApp"
                    >
                      <Printer className="w-3 h-3" />
                      Surat & WA
                    </button>
                    <button
                      onClick={() => handleDownloadPDF(permit)}
                      className="p-1 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded text-[9px] font-bold uppercase transition-all flex items-center gap-1"
                      title="Unduh PDF"
                    >
                      <Download className="w-3 h-3" />
                      Unduh PDF
                    </button>
                    <button
                      onClick={() => handleDelete(permit.id!)}
                      className="p-1 px-2 text-rose-500 hover:text-white hover:bg-rose-500 rounded transition-all border border-transparent flex items-center gap-1 text-[9px] uppercase font-bold"
                      title="Hapus"
                    >
                      <Trash2 className="w-3 h-3" /> Hapus
                    </button>
                  </div>

                  {/* Status update option */}
                  <div className="relative group shrink-0">
                    <button className="p-1 px-2 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded text-[9px] font-extrabold uppercase transition-all flex items-center gap-1">
                      Status Kepulangan ▾
                    </button>
                    <div className="absolute right-0 bottom-full mb-1 bg-white border border-slate-200 rounded-lg shadow-lg hidden group-hover:block z-10 w-44">
                      <button
                        onClick={() => handleUpdateStatus(permit.id!, 'Menunggu Penjemputan')}
                        className="w-full text-left px-3 py-1.5 hover:bg-amber-50 text-[10px] text-amber-700 font-bold border-b border-slate-50"
                      >
                        ⏳ Menunggu Penjemputan
                      </button>
                      <button
                        onClick={() => handleUpdateStatus(permit.id!, 'Dalam Perjalanan')}
                        className="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-[10px] text-blue-700 font-bold border-b border-slate-50"
                      >
                        🚗 Dalam Perjalanan (Otw)
                      </button>
                      <button
                        onClick={() => handleUpdateStatus(permit.id!, 'Sampai di Rumah')}
                        className="w-full text-left px-3 py-1.5 hover:bg-emerald-50 text-[10px] text-emerald-700 font-bold"
                      >
                        🏠 Sampai di Rumah (Selesai)
                      </button>
                    </div>
                  </div>
                </div>

                {/* WA Sending Status & Resend */}
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold text-slate-500 uppercase">Status Pengiriman WA:</span>
                      {permit.deliveryStatus === 'Sedang Mengirim' ? (
                        <span className="text-[9px] font-bold text-blue-600 flex items-center gap-1"><span className="w-2 h-2 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"></span> Sedang...</span>
                      ) : permit.deliveryStatus === 'Berhasil' ? (
                        <span className="text-[9px] font-bold text-emerald-600 flex items-center gap-1"><CheckCircle className="w-2.5 h-2.5" /> Berhasil</span>
                      ) : permit.deliveryStatus === 'Gagal' ? (
                        <span className="text-[9px] font-bold text-rose-600 flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" /> Gagal</span>
                      ) : (
                        <span className="text-[9px] font-bold text-slate-400">Belum Dikirim</span>
                      )}
                    </div>
                    {(permit.deliveryTime || permit.deliveryTarget) && (
                      <span className="text-[8px] text-slate-400 font-mono mt-0.5 leading-tight">
                        {permit.deliveryTime ? format(new Date(permit.deliveryTime), 'dd/MM/yy HH:mm') : ''} • {permit.deliveryTarget === 'keduanya' ? 'Wali & Pembina' : permit.deliveryTarget}
                        {permit.deliveryError && <span className="text-rose-500 block truncate max-w-[200px]" title={permit.deliveryError}>Error: {permit.deliveryError}</span>}
                      </span>
                    )}
                  </div>
                  
                  <button
                    onClick={() => handleSendWhatsApp(permit)}
                    disabled={sendingWaId === permit.id || permit.deliveryStatus === 'Sedang Mengirim'}
                    className={`shrink-0 p-1.5 px-2.5 rounded text-[9px] font-extrabold uppercase tracking-tight flex items-center gap-1.5 transition-colors ${
                      permit.deliveryStatus === 'Berhasil'
                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200' 
                        : 'bg-cyan-600 hover:bg-cyan-700 text-white shadow-xs'
                    }`}
                  >
                    {sendingWaId === permit.id || permit.deliveryStatus === 'Sedang Mengirim' ? (
                      <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Send className="w-3 h-3" />
                    )}
                    <span>{permit.deliveryStatus === 'Berhasil' ? 'Kirim Ulang WA' : 'Kirim WA & PDF'}</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Cetak Surat Izin Sakit */}
      {activePrintPermit && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <style>{`
            @media print {
              body * {
                visibility: hidden !important;
              }
              #printable-surat-izin, #printable-surat-izin * {
                visibility: visible !important;
              }
              #printable-surat-izin {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                padding: 1.5rem !important;
                border: none !important;
                box-shadow: none !important;
                background: white !important;
              }
            }
          `}</style>

          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-slate-50 p-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-emerald-600" />
                <h3 className="text-xs font-black uppercase text-slate-700 tracking-wider">Cetak & Kirim Surat Izin Pulang Sakit</h3>
              </div>
              <button 
                onClick={() => setActivePrintPermit(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors bg-transparent border-none cursor-pointer p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content - Preview Box */}
            <div className="p-6 overflow-y-auto max-h-[70vh] bg-slate-100 flex justify-center">
              {/* Paper Document Layout */}
              <div 
                id="printable-surat-izin"
                className="w-full bg-white border border-slate-300 p-8 text-slate-900 font-serif leading-relaxed shadow-sm relative rounded-sm"
                style={{ minHeight: '440px', maxWidth: '600px' }}
              >
                {/* Header with two logos */}
                <div className="flex items-center justify-between border-b-2 border-black pb-3 mb-5">
                  {/* Left Logo - UKS */}
                  <div className="w-16 h-16 flex-shrink-0 flex items-center justify-center">
                    <svg viewBox="0 0 100 100" className="w-14 h-14 text-emerald-800">
                      <polygon points="50,90 10,10 90,10" fill="none" stroke="currentColor" strokeWidth="6" />
                      <circle cx="50" cy="46" r="26" fill="none" stroke="currentColor" strokeWidth="3" />
                      <text x="50" y="37" fontFamily="sans-serif" fontWeight="bold" fontSize="18" textAnchor="middle" fill="currentColor">U</text>
                      <text x="36" y="58" fontFamily="sans-serif" fontWeight="bold" fontSize="16" textAnchor="middle" fill="currentColor">K</text>
                      <text x="64" y="58" fontFamily="sans-serif" fontWeight="bold" fontSize="16" textAnchor="middle" fill="currentColor">S</text>
                    </svg>
                  </div>

                  {/* Header Title */}
                  <div className="text-center flex-1 mx-2">
                    <h2 className="text-sm tracking-widest font-extrabold uppercase font-sans text-slate-800">Surat Izin Sakit</h2>
                    <h1 className="text-base font-black uppercase font-sans tracking-wide text-emerald-800 mt-0.5">Sekolah Cendekia BAZNAS</h1>
                    <p className="text-[9px] font-sans text-slate-500 font-semibold leading-tight">Jl KH Umar Kp Cirangkong No. 14, Cemplang, Kec. Cibungbulang, Bogor</p>
                    <p className="text-[10px] font-sans mt-1 font-bold text-slate-600">
                      No: {activePrintPermit.id ? `${activePrintPermit.id.substring(0, 4).toUpperCase()}/UKS-SCB/${new Date(activePrintPermit.date).getFullYear()}` : '____/UKS-SCB/20__'}
                    </p>
                  </div>

                  {/* Right Logo - BAZNAS */}
                  <div className="w-16 h-16 flex-shrink-0 flex items-center justify-center">
                    <svg viewBox="0 0 100 100" className="w-14 h-14 text-emerald-800">
                      <path d="M50,15 C68,15 82,19 82,45 C82,68 68,82 50,88 C32,82 18,68 18,45 C18,19 32,15 50,15 Z" fill="none" stroke="currentColor" strokeWidth="5" />
                      <polygon points="50,26 53,34 61,34 55,39 57,47 50,42 43,47 45,39 39,34 47,34" fill="currentColor" />
                      <path d="M 32,58 C 42,54 47,56 50,60 C 53,56 58,54 68,58 C 62,68 50,71 50,71 C 50,71 38,68 32,58 Z" fill="currentColor" opacity="0.9" />
                      <circle cx="50" cy="50" r="3.5" fill="currentColor" />
                    </svg>
                  </div>
                </div>

                {/* Form Fields with Underline matching picture */}
                <div className="space-y-3 mb-5 text-xs text-slate-800">
                  <div className="grid grid-cols-[80px_10px_1fr] items-center">
                    <span className="font-bold">Nama</span>
                    <span>:</span>
                    <span className="border-b border-slate-400 pb-0.5 font-sans font-bold text-slate-800 uppercase tracking-wide">
                      {activePrintPermit.studentName}
                    </span>
                  </div>

                  <div className="grid grid-cols-[80px_10px_1fr] items-center">
                    <span className="font-bold">Kelas</span>
                    <span>:</span>
                    <span className="border-b border-slate-400 pb-0.5 font-sans font-bold text-slate-800">
                      {activePrintPermit.grade}
                    </span>
                  </div>

                  <div className="grid grid-cols-[80px_10px_1fr] items-center">
                    <span className="font-bold">Diagnosa</span>
                    <span>:</span>
                    <span className="border-b border-slate-400 pb-0.5 font-sans font-semibold text-slate-700">
                      {activePrintPermit.complaint}
                    </span>
                  </div>

                  <div className="grid grid-cols-[80px_10px_1fr] items-center">
                    <span className="font-bold">Sementara</span>
                    <span>:</span>
                    <span className="border-b border-slate-400 pb-0.5 font-sans text-slate-600">
                      Beristirahat di rumah / berobat
                    </span>
                  </div>

                  <div className="grid grid-cols-[80px_10px_1fr] items-center">
                    <span className="font-bold">Terhitung</span>
                    <span>:</span>
                    <span className="border-b border-slate-400 pb-0.5 font-sans font-bold text-rose-700">
                      {formatDateIndo(activePrintPermit.date)} s.d {formatDateIndo(activePrintPermit.returnDate || activePrintPermit.date)}
                    </span>
                  </div>

                  {activePrintPermit.additionalNotes && (
                    <div className="grid grid-cols-[80px_10px_1fr] items-start mt-2">
                      <span className="font-bold pt-1">Instruksi UKS</span>
                      <span className="pt-1">:</span>
                      <span className="border-b border-slate-400 pb-0.5 font-sans font-semibold text-rose-700">
                        {activePrintPermit.additionalNotes}
                      </span>
                    </div>
                  )}
                </div>

                {/* Warning / Notes Block */}
                <div className="text-[11px] leading-relaxed mb-6 font-medium text-slate-700">
                  <p>Memberikan izin kepada siswa/i yang di maksud untuk beristirahat di rumah dan atau berobat demi kesehatan putra/i Bapak/Ibu.</p>
                  <p className="mt-3 font-bold text-slate-900 border-l-2 border-rose-500 pl-2 bg-rose-50/50 py-1">
                    Catatan : Jika sakit berlanjut harap memberikan keterangan kepada Wali Kelas dan Wali Kamar
                  </p>
                </div>

                {/* Footer Signature */}
                <div className="flex justify-between items-end pt-2">
                  <div className="text-[9px] text-slate-400 font-sans italic w-1/2">
                    * Surat Izin ini diterbitkan digital secara resmi oleh Unit Kesehatan Sekolah SCB.
                  </div>
                  <div className="text-center w-48 text-xs">
                    <p className="text-slate-700 leading-tight">Bogor, {formatDateIndo(activePrintPermit.date)}</p>
                    <div className="h-16"></div>
                    <p className="font-bold border-b border-slate-800 inline-block px-4 pb-0.5 text-slate-800">
                      Petugas Jaga UKS
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* WhatsApp Dispatch Control Panel */}
            <div className="bg-emerald-50/70 border-t border-emerald-100 p-4 space-y-3 z-50">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                    <Send className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase text-slate-800 tracking-wide">
                      Kirim Surat Izin ke WhatsApp
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Kirim otomatis notifikasi resmi dan dokumen PDF langsung ke kontak tujuan
                    </p>
                  </div>
                </div>

                {/* Status Pengiriman Badge */}
                <div className="flex items-center gap-1.5 bg-white px-3 py-1 rounded-full border border-slate-200 shadow-2xs">
                  <span className="text-[9px] font-bold text-slate-500 uppercase">Status:</span>
                  {activePrintPermit.deliveryStatus === 'Sedang Mengirim' || modalWaStatus.type === 'loading' ? (
                    <span className="text-[10px] font-bold text-blue-600 flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin"></span>
                      Sedang Mengirim...
                    </span>
                  ) : activePrintPermit.deliveryStatus === 'Berhasil' ? (
                    <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3 text-emerald-600" />
                      Terkirim {activePrintPermit.deliveryTime ? `(${format(new Date(activePrintPermit.deliveryTime), 'dd/MM HH:mm')})` : ''}
                    </span>
                  ) : activePrintPermit.deliveryStatus === 'Gagal' ? (
                    <span className="text-[10px] font-bold text-rose-600 flex items-center gap-1" title={activePrintPermit.deliveryError}>
                      <AlertTriangle className="w-3 h-3 text-rose-600" />
                      Gagal Kirim
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-400">Belum Dikirim</span>
                  )}
                </div>
              </div>

              {/* Recipient Target Options */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Pilih Penerima Surat:</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setModalWaTarget('keduanya')}
                    className={`text-left p-2.5 rounded-lg border text-xs transition-all ${
                      modalWaTarget === 'keduanya'
                        ? 'bg-white border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                        : 'bg-white/70 border-slate-200 hover:bg-white text-slate-600'
                    }`}
                  >
                    <div className="font-bold text-slate-800 flex items-center justify-between">
                      <span>👥 Keduanya</span>
                      {modalWaTarget === 'keduanya' && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                      Wali Kelas & Pembina
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalWaTarget('wali')}
                    className={`text-left p-2.5 rounded-lg border text-xs transition-all ${
                      modalWaTarget === 'wali'
                        ? 'bg-white border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                        : 'bg-white/70 border-slate-200 hover:bg-white text-slate-600'
                    }`}
                  >
                    <div className="font-bold text-slate-800 flex items-center justify-between">
                      <span>👨‍🏫 Wali Kelas</span>
                      {modalWaTarget === 'wali' && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 truncate" title={activePrintPermit.waWaliKelas || 'Belum ada nomor'}>
                      {activePrintPermit.waliKelas ? `${activePrintPermit.waliKelas}` : 'Wali Kelas'}
                      <span className="block text-[9px] text-emerald-700 font-mono">{activePrintPermit.waWaliKelas || '(Nomor WA kosong)'}</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalWaTarget('pembina')}
                    className={`text-left p-2.5 rounded-lg border text-xs transition-all ${
                      modalWaTarget === 'pembina'
                        ? 'bg-white border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                        : 'bg-white/70 border-slate-200 hover:bg-white text-slate-600'
                    }`}
                  >
                    <div className="font-bold text-slate-800 flex items-center justify-between">
                      <span>🏠 Pembina</span>
                      {modalWaTarget === 'pembina' && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 truncate" title={activePrintPermit.waPembina || 'Belum ada nomor'}>
                      {activePrintPermit.pembina ? `${activePrintPermit.pembina}` : 'Pembina'}
                      <span className="block text-[9px] text-emerald-700 font-mono">{activePrintPermit.waPembina || '(Nomor WA kosong)'}</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Custom Number Toggle */}
              <div className="pt-0.5 flex items-center justify-between text-[11px]">
                <button
                  type="button"
                  onClick={() => setModalWaTarget(modalWaTarget === 'custom' ? 'keduanya' : 'custom')}
                  className="font-bold text-emerald-700 hover:text-emerald-800 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <PlusCircle className="w-3 h-3" />
                  <span>{modalWaTarget === 'custom' ? '← Gunakan Kontak Wali / Pembina' : '+ Kirim ke Nomor Lain / Orang Tua'}</span>
                </button>
              </div>

              {modalWaTarget === 'custom' && (
                <div className="p-3 bg-white rounded-lg border border-emerald-200 space-y-1.5 animate-in fade-in">
                  <label className="text-[10px] font-bold text-slate-700 uppercase">Nomor WhatsApp Tujuan (Orang Tua / Santri / Lainnya):</label>
                  <input
                    type="tel"
                    placeholder="Contoh: 08123456789 atau 628123456789"
                    value={modalCustomWaNumber}
                    onChange={(e) => setModalCustomWaNumber(e.target.value)}
                    className="w-full text-xs p-2 border border-slate-200 rounded focus:border-emerald-500 focus:outline-none font-mono"
                  />
                  <p className="text-[10px] text-slate-400">Nomor dapat diawali dengan 08 atau 628</p>
                </div>
              )}

              {/* Status Message / Banner */}
              {modalWaStatus.type !== 'idle' && (
                <div className={`p-3 rounded-lg text-xs flex items-center gap-2.5 transition-all ${
                  modalWaStatus.type === 'loading' ? 'bg-blue-50 text-blue-900 border border-blue-200' :
                  modalWaStatus.type === 'success' ? 'bg-emerald-100 text-emerald-900 border border-emerald-300' :
                  'bg-rose-50 text-rose-900 border border-rose-200'
                }`}>
                  {modalWaStatus.type === 'loading' && <span className="w-3.5 h-3.5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin shrink-0" />}
                  {modalWaStatus.type === 'success' && <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />}
                  {modalWaStatus.type === 'error' && <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />}
                  <span className="font-medium">{modalWaStatus.message}</span>
                </div>
              )}
            </div>

            {/* Modal Action Buttons */}
            <div className="bg-slate-50 p-4 border-t border-slate-200 flex items-center justify-between gap-2 flex-wrap z-50">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActivePrintPermit(null)}
                  className="px-3.5 py-2 border border-slate-200 rounded text-xs text-slate-600 hover:bg-slate-100 transition-colors font-bold uppercase cursor-pointer"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadPDF(activePrintPermit)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded text-xs transition-colors font-bold uppercase flex items-center gap-1.5 cursor-pointer"
                  title="Unduh file PDF ke komputer / HP"
                >
                  <Download className="w-3.5 h-3.5" />
                  Unduh PDF
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Fallback Direct WA Web Link */}
                {(() => {
                  let targetNum = '';
                  let targetLabel = '';
                  if (modalWaTarget === 'wali') {
                    targetNum = activePrintPermit.waWaliKelas || '';
                    targetLabel = activePrintPermit.waliKelas ? `Wali Kelas (${activePrintPermit.waliKelas})` : 'Wali Kelas';
                  } else if (modalWaTarget === 'pembina') {
                    targetNum = activePrintPermit.waPembina || '';
                    targetLabel = activePrintPermit.pembina ? `Pembina (${activePrintPermit.pembina})` : 'Pembina';
                  } else if (modalWaTarget === 'custom') {
                    targetNum = modalCustomWaNumber || '';
                    targetLabel = `Orang Tua (${activePrintPermit.studentName})`;
                  } else {
                    targetNum = activePrintPermit.waWaliKelas || activePrintPermit.waPembina || '';
                    targetLabel = activePrintPermit.waWaliKelas ? 'Wali Kelas' : 'Pembina';
                  }
                  if (!targetNum) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => handleOpenDirectWhatsApp(targetNum, targetLabel, activePrintPermit)}
                      className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded text-xs transition-colors font-bold uppercase flex items-center gap-1.5 cursor-pointer"
                      title="Buka percakapan langsung via WhatsApp Web / App"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-emerald-600" />
                      WA Web
                    </button>
                  );
                })()}

                {/* Print Button */}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3.5 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 rounded text-xs transition-colors font-bold uppercase flex items-center gap-1.5 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print
                </button>

                {/* Primary Button: Kirim ke WhatsApp */}
                <button
                  type="button"
                  onClick={() => handleSendWhatsApp(activePrintPermit, modalWaTarget, modalCustomWaNumber, true)}
                  disabled={sendingWaId === activePrintPermit.id || modalWaStatus.type === 'loading'}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded text-xs transition-colors font-bold uppercase flex items-center gap-2 shadow-xs cursor-pointer"
                  title="Kirimkan surat izin beserta lampiran PDF otomatis via WhatsApp"
                >
                  {sendingWaId === activePrintPermit.id || modalWaStatus.type === 'loading' ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Mengirim...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>{activePrintPermit.deliveryStatus === 'Berhasil' ? 'Kirim Ulang WA' : 'Kirim ke WhatsApp'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
