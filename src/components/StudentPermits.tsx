import React, { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  setDoc,
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
  Printer
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
  companionType: 'Orang Tua' | 'Guru' | 'Mandiri/Pribadi' | 'Lainnya';
  companionName: string;
  parentWhatsApp: string;
  status: 'Menunggu Penjemputan' | 'Dalam Perjalanan' | 'Sampai di Rumah';
  additionalNotes: string;
  whatsappSent: boolean;
  whatsappStatus: 'idle' | 'sending' | 'success' | 'failed';
  createdAt: any;
  returnDate?: string; // yyyy-MM-dd
}

interface StudentMaster {
  id: string;
  name: string;
  grade?: string;
  gender?: string;
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
  defaultParentWhatsApp?: string;
}

export default function StudentPermits({
  defaultStudentName = '',
  defaultGrade = '',
  defaultGender = 'Laki-laki',
  defaultComplaint = '',
  defaultParentWhatsApp = ''
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
    companionType: 'Orang Tua' as any,
    companionName: '',
    parentWhatsApp: '',
    status: 'Menunggu Penjemputan' as any,
    additionalNotes: '',
    returnDate: format(new Date(), 'yyyy-MM-dd')
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingWaId, setSendingWaId] = useState<string | null>(null);

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

    // Load Master students for autocomplete
    const fetchStudents = async () => {
      try {
        const snap = await getDocs(collection(db, 'students'));
        const list: StudentMaster[] = [];
        snap.forEach((doc) => {
          const data = doc.data();
          list.push({
            id: doc.id,
            name: data.name || data.nama || 'Tanpa Nama',
            grade: data.grade || '',
            gender: data.gender || 'Laki-laki'
          });
        });
        setStudents(list.sort((a, b) => a.name.localeCompare(b.name)));
      } catch (err) {
        console.warn("Failed to load students for auto-complete:", err);
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
      gender: student.gender || 'Laki-laki'
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
      companionType: 'Orang Tua',
      companionName: '',
      parentWhatsApp: defaultParentWhatsApp || '',
      status: 'Menunggu Penjemputan',
      additionalNotes: '',
      returnDate: format(new Date(), 'yyyy-MM-dd')
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
      companionType: permit.companionType,
      companionName: permit.companionName,
      parentWhatsApp: permit.parentWhatsApp || '',
      status: permit.status,
      additionalNotes: permit.additionalNotes || '',
      returnDate: permit.returnDate || permit.date
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
      if (editingPermit && editingPermit.id) {
        const docRef = doc(db, 'studentPermits', editingPermit.id);
        await updateDoc(docRef, {
          ...formData,
          createdAt: editingPermit.createdAt || serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'studentPermits'), {
          ...formData,
          whatsappSent: false,
          whatsappStatus: 'idle',
          createdAt: serverTimestamp()
        });
      }
      setFormOpen(false);
      setEditingPermit(null);
    } catch (err: any) {
      console.error("Error saving permit:", err);
      setError(err.message || 'Gagal menyimpan data perizinan');
    } finally {
      setSubmitting(false);
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

  // Send WhatsApp notification using Fonnte API
  const handleSendWhatsApp = async (permit: StudentPermit) => {
    if (!permit.id) return;
    if (!permit.parentWhatsApp) {
      alert("Nomor WhatsApp Orang Tua belum ditentukan untuk diperingatkan.");
      return;
    }

    // Clean number formatting
    let formattedNumber = permit.parentWhatsApp.replace(/\D/g, '');
    if (formattedNumber.startsWith('0')) {
      formattedNumber = '62' + formattedNumber.substring(1);
    } else if (formattedNumber.startsWith('8')) {
      formattedNumber = '62' + formattedNumber;
    }

    setSendingWaId(permit.id);
    
    // Update state first
    await updateDoc(doc(db, 'studentPermits', permit.id), {
      whatsappStatus: 'sending'
    });

    const signature = `Layanan Kesehatan UKS\nMedReport-UKS Plus`;
    const messageContent = `*[UKS - SURAT IZIN PULANG SAKIT]*\n\nYth. Orang Tua/Wali dari *${permit.studentName}* (${permit.grade}).\n\nKami menginformasikan bahwa putra/putri Anda saat ini sedang sakit di sekolah dengan keluhan: *${permit.complaint}*.\n\nPetugas UKS telah memberikan pertolongan pertama. Dikarenakan kondisi kesehatan tersebut, siswa bersangkutan diberikan *Izin Pulang Cepat* agar dapat beristirahat atau diperiksa medis lebih lanjut.\n\nDetail Perizinan Pulang:\n- Jam Izin Pulang: ${permit.checkoutTime} WIB\n- Pendamping / Penjemput: *${permit.companionType}* ${permit.companionName ? `(${permit.companionName})` : ''}\n- Catatan UKS: ${permit.additionalNotes || '-'}\n\nMohon segera kabari petugas UKS apabila putra/putri Anda sudah sampai di rumah dengan aman.\n\nSemoga lekas sembuh.\n\n---\n_${signature}_`;

    try {
      const customToken = localStorage.getItem('uks_fonnte_token') || 'GVsuHmPXyqYQ6TkY3GMK';
      
      const response = await fetch('/api/send-wa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          target: formattedNumber,
          message: messageContent,
          token: customToken
        })
      });

      const result = await response.json();
      
      if (result.status === true || result.success === true) {
        await updateDoc(doc(db, 'studentPermits', permit.id), {
          whatsappSent: true,
          whatsappStatus: 'success'
        });
        alert('Notifikasi WhatsApp Fonnte berhasil terkirim ke Orang Tua!');
      } else {
        throw new Error(result.reason || result.message || 'Fonnte Server rejected');
      }
    } catch (err: any) {
      console.warn("Fonnte connection failed. Using fallback simulation.", err);
      // Update as failed
      await updateDoc(doc(db, 'studentPermits', permit.id), {
        whatsappStatus: 'failed'
      });
      alert(`Gagal mengirim WA otomatis: ${err.message || err}. (Petunjuk: Hubungkan WA di Fonnte atau cek kembali nomor tujuan)`);
    } finally {
      setSendingWaId(null);
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

              {/* Companion / Picker Type */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Pendamping / Penjemput</label>
                <select
                  value={formData.companionType}
                  onChange={(e) => setFormData({ ...formData, companionType: e.target.value as any })}
                  className="w-full text-xs p-2 border border-slate-200 rounded focus:border-cyan-500 focus:outline-none"
                >
                  <option value="Orang Tua">Orang Tua / Wali Siswa</option>
                  <option value="Guru">Guru / Staf Sekolah</option>
                  <option value="Mandiri/Pribadi">Pulang Mandiri (Atas Izin)</option>
                  <option value="Lainnya">Lainnya / Ojol</option>
                </select>
              </div>

              {/* Companion Name */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Nama Penjemput / Pendamping</label>
                <input
                  type="text"
                  placeholder="Contoh: Bpk. Bambang, Ibu Sri"
                  value={formData.companionName}
                  onChange={(e) => setFormData({ ...formData, companionName: e.target.value })}
                  className="w-full text-xs p-2 border border-slate-200 rounded focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {/* WhatsApp Orang Tua */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase">No. WhatsApp Orang Tua / Wali</label>
                <input
                  type="tel"
                  placeholder="Contoh: 081234567890"
                  value={formData.parentWhatsApp}
                  onChange={(e) => setFormData({ ...formData, parentWhatsApp: e.target.value })}
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
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[10px]">Pendamping:</span>
                    <span className="font-semibold text-slate-700">{permit.companionType} {permit.companionName ? `(${permit.companionName})` : ''}</span>
                  </div>
                  {permit.parentWhatsApp && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-[10px]">WA Orang Tua:</span>
                      <span className="font-mono text-[10px] font-bold text-slate-600">{permit.parentWhatsApp}</span>
                    </div>
                  )}
                  {permit.additionalNotes && (
                    <div className="pt-2">
                      <span className="text-slate-400 text-[10px] block mb-0.5">Catatan UKS:</span>
                      <p className="text-[11px] text-slate-500 leading-normal italic bg-slate-50 p-2 rounded border border-slate-100">{permit.additionalNotes}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer Actions */}
              <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                {/* Delete / Edit / Cetak */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleOpenEdit(permit)}
                    className="p-1 px-2 border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded text-[9px] font-bold uppercase transition-all"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setActivePrintPermit(permit)}
                    className="p-1 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded text-[9px] font-bold uppercase transition-all flex items-center gap-1"
                    title="Cetak Surat Izin Sakit"
                  >
                    <Printer className="w-3 h-3" />
                    Cetak
                  </button>
                  <button
                    onClick={() => handleDelete(permit.id!)}
                    className="p-1 text-rose-500 hover:text-white hover:bg-rose-500 rounded transition-all border border-transparent"
                    title="Hapus"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Status Switcher & WhatsApp sender */}
                <div className="flex items-center gap-1.5">
                  {/* Status update option */}
                  <div className="relative group">
                    <button className="p-1 px-2 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded text-[9px] font-extrabold uppercase transition-all flex items-center gap-1">
                      Status ▾
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

                  {/* Fonnte WhatsApp Broadcaster */}
                  {permit.parentWhatsApp && (
                    <button
                      onClick={() => handleSendWhatsApp(permit)}
                      disabled={sendingWaId === permit.id || permit.whatsappStatus === 'sending'}
                      className={`p-1 px-2.5 rounded text-[9px] font-extrabold uppercase tracking-tight flex items-center gap-1.5 transition-colors ${
                        permit.whatsappSent 
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200' 
                          : 'bg-cyan-600 hover:bg-cyan-700 text-white shadow-xs'
                      }`}
                      title="Kirim Notifikasi via Fonnte WA"
                    >
                      {sendingWaId === permit.id || permit.whatsappStatus === 'sending' ? (
                        <span className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Send className="w-3 h-3" />
                      )}
                      <span>{permit.whatsappSent ? 'WA TERKIRIM' : 'NOTIF WA'}</span>
                    </button>
                  )}
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

          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-slate-50 p-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-emerald-650" />
                <h3 className="text-xs font-black uppercase text-slate-700 tracking-wider">Cetak Surat Izin Pulang Sakit</h3>
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
                    <p className="mt-1 font-bold text-slate-800">Petugas Jaga UKS,</p>
                    <div className="h-12"></div>
                    <p className="font-bold border-b border-slate-800 inline-block px-4 pb-0.5 text-slate-800">
                      {activePrintPermit.companionName || 'Petugas Jaga'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Action Buttons */}
            <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-end gap-3 z-50">
              <button
                type="button"
                onClick={() => setActivePrintPermit(null)}
                className="px-4 py-2 border border-slate-200 rounded text-xs text-slate-500 hover:bg-slate-100 transition-colors font-bold uppercase"
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs transition-colors font-bold uppercase flex items-center gap-2"
              >
                <Printer className="w-4 h-4" />
                Cetak Surat (Print / PDF)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
