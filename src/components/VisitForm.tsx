import React, { useState, useEffect } from 'react';
import { 
  collection, 
  collectionGroup,
  addDoc, 
  serverTimestamp, 
  Timestamp,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { Visit } from '../types';
import { Save, AlertCircle, Loader2, Search, Share2, MessageCircle, History, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { id } from 'date-fns/locale';

interface VisitFormProps {
  onSuccess: () => void;
}

interface StudentMaster {
  id: string;
  name: string;
  grade?: string;
  gender: string;
  birthDate?: string;
  age?: number;
}

interface MasterData {
  id: string;
  name: string;
}

export default function VisitForm({ onSuccess }: VisitFormProps) {
  const [loading, setLoading] = useState(false);
  const [isFetchingMaster, setIsFetchingMaster] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Master data state
  const [masterStudents, setMasterStudents] = useState<StudentMaster[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [visitHistory, setVisitHistory] = useState<Visit[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [masterMedicines, setMasterMedicines] = useState<MasterData[]>([]);
  const [masterDiagnoses, setMasterDiagnoses] = useState<MasterData[]>([]);

  const [formData, setFormData] = useState({
    studentName: '',
    age: '',
    grade: '',
    gender: 'Laki-laki',
    complaint: '',
    bloodPressure: '',
    weight: '',
    temperature: '',
    diagnosis: '',
    therapy: '',
    action: '',
    teacherName: '',
    supervisorName: '',
    date: format(new Date(), 'yyyy-MM-dd')
  });

  // Fetch master data on mount
  useEffect(() => {
    const fetchMasterData = async () => {
      setIsFetchingMaster(true);
      try {
        const studentSnap = await getDocs(query(collection(db, 'students'), orderBy('name', 'asc')));
        setMasterStudents(studentSnap.docs.map(d => {
          const data = d.data();
          return { 
            id: d.id, 
            ...data,
            name: data.name || data.nama || 'Tanpa Nama'
          } as StudentMaster;
        }));

        const medSnap = await getDocs(query(collection(db, 'medicines'), orderBy('name', 'asc')));
        setMasterMedicines(medSnap.docs.map(d => {
          const data = d.data();
          return { 
            id: d.id, 
            name: data.name || data.obat || data.nama || 'Tanpa Nama' 
          } as MasterData;
        }));

        const diagSnap = await getDocs(query(collection(db, 'diagnoses'), orderBy('name', 'asc')));
        setMasterDiagnoses(diagSnap.docs.map(d => {
          const data = d.data();
          return { 
            id: d.id, 
            name: data.name || data.diagnosa || data.nama || 'Tanpa Nama' 
          } as MasterData;
        }));
      } catch (err) {
        console.error("Error fetching master data:", err);
      } finally {
        setIsFetchingMaster(false);
      }
    };
    fetchMasterData();
  }, []);

  // Fetch visit history when student is selected or name is typed
  useEffect(() => {
    const fetchHistory = async () => {
      const nameToSearch = formData.studentName.trim();
      if (!nameToSearch) {
        setVisitHistory([]);
        return;
      }
      
      setLoadingHistory(true);
      try {
        // Use collectionGroup to find history in both legacy root and new subcollections
        // Filter by studentName to bridge the transition
        const q = query(
          collectionGroup(db, 'visits'),
          where('studentName', '==', nameToSearch),
          orderBy('date', 'desc'),
          limit(10)
        );
        const snap = await getDocs(q);
        const historyData = snap.docs.map(docSnap => ({ 
          id: docSnap.id, 
          ...docSnap.data() 
        } as Visit));
        
        setVisitHistory(historyData);
      } catch (err: any) {
        console.error("Error fetching visit history:", err);
        // If index is missing for name+date, try name only and sort in memory
        if (err.code === 'failed-precondition' || err.message?.includes('index')) {
          try {
             const qSimple = query(
                collectionGroup(db, 'visits'),
                where('studentName', '==', nameToSearch),
                limit(50)
             );
             const snapSimple = await getDocs(qSimple);
             const sorted = snapSimple.docs
                .map(d => ({ id: d.id, ...d.data() } as Visit))
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 10);
             setVisitHistory(sorted);
          } catch (innerErr) {
             console.error("Fallback history fetch failed:", innerErr);
          }
        }
      } finally {
        setLoadingHistory(false);
      }
    };

    const timer = setTimeout(() => {
      fetchHistory();
    }, 500); // Debounce typing

    return () => clearTimeout(timer);
  }, [formData.studentName]);

  // Auto-fill logic when student is selected
  const calculateAge = (birthDateString: string) => {
    const today = new Date();
    const birthDate = new Date(birthDateString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const handleStudentNameChange = (name: string) => {
    setFormData(prev => ({ ...prev, studentName: name }));
    
    // Check if the name matches a student in our master list (case-insensitive and trimmed)
    const found = masterStudents.find(s => s.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (found) {
      setSelectedStudentId(found.id);
      let ageToSet = found.age?.toString() || formData.age;
      
      if (found.birthDate) {
        const calculated = calculateAge(found.birthDate);
        if (!isNaN(calculated)) ageToSet = calculated.toString();
      }

      setFormData(prev => ({
        ...prev,
        grade: found.grade || prev.grade,
        gender: found.gender,
        age: ageToSet
      }));
    } else {
      setSelectedStudentId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!auth.currentUser) throw new Error('Anda harus masuk terlebih dahulu');

      // Client-side validation
      const validationErrors: string[] = [];
      if (!formData.studentName.trim()) validationErrors.push("Nama Lengkap");
      if (!formData.grade.trim()) validationErrors.push("Kelas");
      if (!formData.age) validationErrors.push("Usia");
      if (!formData.complaint.trim()) validationErrors.push("Keluhan Utama");
      if (!formData.diagnosis.trim()) validationErrors.push("Diagnosa");
      if (!formData.therapy.trim()) validationErrors.push("Tindakan & Terapi");

      if (validationErrors.length > 0) {
        setError(`Wajib diisi: ${validationErrors.join(", ")}`);
        setLoading(false);
        return;
      }

      // Numeric validation for safety
      const ageNum = Number(formData.age);
      if (isNaN(ageNum) || ageNum <= 0) {
        setError("Usia harus berupa angka yang valid (>0)");
        setLoading(false);
        return;
      }

      // 1. Get or create student ID
      let studentId = selectedStudentId;
      if (!studentId) {
        // Optimistic check again in case state is stale
        const found = masterStudents.find(s => s.name.toLowerCase() === formData.studentName.trim().toLowerCase());
        if (found) {
          studentId = found.id;
        } else {
          // Create new student record if not exists
          const studentDoc = await addDoc(collection(db, 'students'), {
            name: formData.studentName.trim(),
            grade: formData.grade.trim(),
            gender: formData.gender,
            age: ageNum,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          studentId = studentDoc.id;
        }
      }

      // Create selected date timestamp
      const selectedDate = new Date(formData.date);
      const now = new Date();
      // Keep current time for the record even if date is chosen
      selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
      
      const timestampToUse = Timestamp.fromDate(selectedDate);

      const visitData: Partial<Visit> = {
        date: selectedDate.toISOString(),
        studentName: formData.studentName.trim(),
        age: ageNum,
        grade: formData.grade.trim(),
        gender: formData.gender as any,
        complaint: formData.complaint.trim(),
        bloodPressure: formData.bloodPressure.trim(),
        weight: formData.weight ? Number(formData.weight) : 0,
        temperature: formData.temperature ? Number(formData.temperature) : 36.5,
        diagnosis: formData.diagnosis.trim(),
        therapy: formData.therapy.trim(),
        action: formData.action.trim(),
        teacherName: formData.teacherName.trim(),
        supervisorName: formData.supervisorName.trim(),
        createdAt: timestampToUse,
        updatedAt: timestampToUse,
        authorId: auth.currentUser.uid
      };

      // 2. Add as subcollection document
      const subPath = `students/${studentId}/visits`;
      addDoc(collection(db, subPath), visitData).catch(err => {
        handleFirestoreError(err, OperationType.WRITE, subPath);
      });
      
      // Transition immediately for "instant" feel
      onSuccess();
    } catch (err) {
      setError('Gagal memproses data. Silakan cek koneksi Anda.');
      handleFirestoreError(err, OperationType.WRITE, 'visits_subcollection');
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-6">
      <div className="flex-1 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden h-fit">
        <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Formulir Pemeriksaan Baru</h2>
          <span className="text-[10px] text-slate-400 font-mono">UKS-SYSTEM-AUTO</span>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-6">
        {isFetchingMaster && (
          <div className="flex items-center gap-2 mb-4">
            <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
            <span className="text-[9px] font-black uppercase text-blue-500 tracking-tighter">Sync database master...</span>
          </div>
        )}
        {error && (
          <div className="p-3 bg-red-50 text-red-600 border border-red-100 rounded text-[10px] font-bold uppercase flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Suggestion Lists */}
        <datalist id="list-students">
          {masterStudents.map(s => <option key={s.id} value={s.name} />)}
        </datalist>
        <datalist id="list-medicines">
          {masterMedicines.map(m => <option key={m.id} value={m.name} />)}
        </datalist>
        <datalist id="list-diagnoses">
          {masterDiagnoses.map(d => <option key={d.id} value={d.name} />)}
        </datalist>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <div className="md:col-span-2 space-y-1">
            <label htmlFor="studentName" className="text-[10px] font-bold text-slate-600 uppercase flex justify-between">
              <span>Nama Lengkap</span>
              {masterStudents.length > 0 && <span className="text-blue-500 font-black text-[8px]">{masterStudents.length} Data Tersedia</span>}
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                id="studentName"
                required
                type="text"
                autoComplete="off"
                list="list-students"
                value={formData.studentName}
                onChange={(e) => handleStudentNameChange(e.target.value)}
                className="input-dense pl-9"
                placeholder="Cari Nama Pasien/Tendik..."
              />
            </div>
          </div>
          
          <div className="md:col-span-1 space-y-1">
            <label htmlFor="grade" className="text-[10px] font-bold text-slate-600 uppercase">Kelas</label>
            <input
              id="grade"
              required
              type="text"
              value={formData.grade}
              onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
              className="input-dense"
              placeholder="10A"
            />
          </div>

          <div className="md:col-span-1 space-y-1">
            <label htmlFor="age" className="text-[10px] font-bold text-slate-600 uppercase">Usia (Thn)</label>
            <input
              id="age"
              required
              type="number"
              value={formData.age}
              onChange={(e) => setFormData({ ...formData, age: e.target.value })}
              className="input-dense"
              placeholder="15"
            />
          </div>

          <div className="md:col-span-1 space-y-1">
            <label htmlFor="gender" className="text-[10px] font-bold text-slate-600 uppercase">Gender</label>
            <select
              id="gender"
              value={formData.gender}
              onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
              className="input-dense"
            >
              <option value="Laki-laki">Laki-laki</option>
              <option value="Perempuan">Perempuan</option>
            </select>
          </div>

          <div className="md:col-span-1 space-y-1">
            <label htmlFor="date" className="text-[10px] font-bold text-slate-600 uppercase">Tanggal</label>
            <input
              id="date"
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              className="input-dense"
            />
          </div>

          {/* Vitals Row */}
          <div className="col-span-1 md:col-span-6 grid grid-cols-2 md:grid-cols-6 gap-4 pt-2 border-t border-slate-50">
            <div className="space-y-1">
              <label htmlFor="bloodPressure" className="text-[10px] font-bold text-slate-600 uppercase">T. Darah</label>
              <input
                id="bloodPressure"
                type="text"
                value={formData.bloodPressure}
                onChange={(e) => setFormData({ ...formData, bloodPressure: e.target.value })}
                className="input-dense bg-blue-50/30"
                placeholder="120/80"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="weight" className="text-[10px] font-bold text-slate-600 uppercase">BB (KG)</label>
              <input
                id="weight"
                type="number"
                step="0.1"
                value={formData.weight}
                onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                className="input-dense"
                placeholder="55.0"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="temperature" className="text-[10px] font-bold text-slate-600 uppercase">Suhu (&deg;C)</label>
              <input
                id="temperature"
                type="number"
                step="0.1"
                value={formData.temperature}
                onChange={(e) => setFormData({ ...formData, temperature: e.target.value })}
                className="input-dense bg-red-50/30 font-bold text-red-700"
                placeholder="36.5"
              />
            </div>
            <div className="col-span-1 md:col-span-3 space-y-1">
              <label htmlFor="complaint" className="text-[10px] font-bold text-slate-600 uppercase">Keluhan Utama</label>
              <input
                id="complaint"
                required
                type="text"
                value={formData.complaint}
                onChange={(e) => setFormData({ ...formData, complaint: e.target.value })}
                className="input-dense"
                placeholder="Pusing, mual sejak pagi..."
              />
            </div>
          </div>

          {/* Clinical */}
          <div className="col-span-1 md:col-span-3 space-y-1">
            <label htmlFor="diagnosis" className="text-[10px] font-bold text-slate-600 uppercase flex justify-between">
              <span>Diagnosa / Gejala</span>
              {masterDiagnoses.length > 0 && <span className="text-blue-500 font-black text-[8px]">{masterDiagnoses.length} Filter Aktif</span>}
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                id="diagnosis"
                required
                type="text"
                list="list-diagnoses"
                autoComplete="off"
                value={formData.diagnosis}
                onChange={(e) => setFormData({ ...formData, diagnosis: e.target.value })}
                className="input-dense pl-9"
                placeholder="Cari Diagnosa dari Database..."
              />
            </div>
          </div>
          <div className="col-span-1 md:col-span-3 space-y-1">
            <label htmlFor="therapy" className="text-[10px] font-bold text-slate-600 uppercase flex justify-between">
              <span>Obat / Terapi</span>
              {masterMedicines.length > 0 && <span className="text-blue-500 font-black text-[8px]">{masterMedicines.length} Jenis Obat</span>}
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                id="therapy"
                required
                type="text"
                list="list-medicines"
                autoComplete="off"
                value={formData.therapy}
                onChange={(e) => setFormData({ ...formData, therapy: e.target.value })}
                className="input-dense bg-green-50/20 pl-9"
                placeholder="Cari Obat dari Stock..."
              />
            </div>
          </div>

          <div className="col-span-1 md:col-span-6 space-y-1">
            <label htmlFor="action" className="text-[10px] font-bold text-slate-600 uppercase">Tindak Lanjut (Action)</label>
            <div className="space-y-2">
              <input
                id="action"
                type="text"
                value={formData.action}
                onChange={(e) => setFormData({ ...formData, action: e.target.value })}
                className="input-dense"
                placeholder="Rujukan, monitoring, atau instruksi tambahan..."
              />
              <div className="flex flex-wrap gap-2">
                {['Referral', 'Follow-up', 'Medication Given'].map((act) => (
                  <button
                    key={act}
                    type="button"
                    onClick={() => {
                      const current = formData.action.trim();
                      const newValue = current ? `${current}, ${act}` : act;
                      setFormData({ ...formData, action: newValue });
                    }}
                    className="text-[9px] font-black uppercase px-2 py-1 rounded bg-slate-100 text-slate-500 hover:bg-blue-100 hover:text-blue-700 transition-colors border border-slate-200 border-dashed"
                  >
                    + {act}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="col-span-1 md:col-span-6 space-y-4 pt-4 border-t border-slate-50">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="teacherName" className="text-[10px] font-bold text-slate-600 uppercase">Nama Guru (Wali Kelas/Pelajaran)</label>
                <input
                  id="teacherName"
                  type="text"
                  value={formData.teacherName}
                  onChange={(e) => setFormData({ ...formData, teacherName: e.target.value })}
                  className="input-dense"
                  placeholder="Nama Guru..."
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="supervisorName" className="text-[10px] font-bold text-slate-600 uppercase">Pembina / Pendamping</label>
                <input
                  id="supervisorName"
                  type="text"
                  value={formData.supervisorName}
                  onChange={(e) => setFormData({ ...formData, supervisorName: e.target.value })}
                  className="input-dense"
                  placeholder="Nama Pembina..."
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-bold text-slate-600 uppercase">Kirim Laporan Kondisi (Opsi)</label>
              <button
                type="button"
                onClick={() => {
                  const text = `LAPORAN UKS:
Nama: ${formData.studentName}
Kelas: ${formData.grade}
Keluhan: ${formData.complaint}
Diagnosa: ${formData.diagnosis}
Tindakan: ${formData.therapy}
Tindak Lanjut: ${formData.action}
Guru: ${formData.teacherName || '-'}
Pembina: ${formData.supervisorName || '-'}
Waktu: ${new Date().toLocaleString('id-ID')}`;
                  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                }}
                className="w-full md:w-auto self-start flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded text-[10px] font-black uppercase hover:bg-emerald-100 transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                Kirim via WhatsApp (Guru/Wali)
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded text-xs font-bold transition-all disabled:opacity-50 shadow-sm shadow-blue-600/20 flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            SIMPAN DATA PEMERIKSAAN
          </button>
        </div>
      </form>
    </div>
    <div className="lg:w-80 space-y-4">
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full min-h-[400px]">
          <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            <History className="w-3.5 h-3.5 text-slate-500" />
            <h3 className="text-[10px] font-black uppercase text-slate-600 tracking-widest">Riwayat Medis Pasien</h3>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar lg:max-h-[800px]">
            {!formData.studentName.trim() ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2 opacity-40">
                <Search className="w-8 h-8 text-slate-300" />
                <p className="text-[10px] font-bold uppercase tracking-tight text-slate-400">Pilih pasien untuk melihat riwayat</p>
              </div>
            ) : loadingHistory ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                <p className="text-[9px] font-black uppercase text-slate-400">Loading_History...</p>
              </div>
            ) : visitHistory.length === 0 ? (
              <div className="text-center py-12 space-y-2">
                <div className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                  <Clock className="w-5 h-5 text-slate-300" />
                </div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Kunjungan Pertama</p>
              </div>
            ) : (
              visitHistory.map((visit, index) => (
                <div key={visit.id || index} className="p-3 bg-slate-50 rounded border border-slate-100 hover:border-blue-200 transition-colors relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                     <span className="text-[8px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">
                       View
                     </span>
                  </div>
                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-200/50">
                    <span className="text-[9px] font-black text-slate-400 uppercase font-mono">
                      {format(parseISO(visit.date), 'dd MMM yyyy', { locale: id })}
                    </span>
                    <span className="text-[9px] font-black text-blue-600 uppercase tracking-tighter">
                      {visit.diagnosis}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Keluhan</p>
                      <p className="text-[10px] text-slate-700 leading-tight line-clamp-2">{visit.complaint}</p>
                    </div>
                    <div>
                      <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Tindakan/Terapi</p>
                      <p className="text-[10px] font-bold text-slate-900 leading-tight">{visit.therapy}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          
          {visitHistory.length > 0 && (
            <div className="p-3 bg-slate-50 border-t border-slate-100">
               <p className="text-[8px] text-center font-bold text-slate-400 uppercase tracking-widest">
                 Menampilkan {visitHistory.length} kunjungan terakhir
               </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

