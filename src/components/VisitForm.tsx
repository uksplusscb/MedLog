import React, { useState, useEffect } from 'react';
import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  getDocs,
  query,
  orderBy
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { Visit } from '../types';
import { Save, AlertCircle, Loader2, Search } from 'lucide-react';

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
  const [error, setError] = useState<string | null>(null);
  
  // Master data state
  const [masterStudents, setMasterStudents] = useState<StudentMaster[]>([]);
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
    action: ''
  });

  // Fetch master data on mount
  useEffect(() => {
    const fetchMasterData = async () => {
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
      }
    };
    fetchMasterData();
  }, []);

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
    
    // Check if the name matches a student in our master list
    const found = masterStudents.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (found) {
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

      const path = 'visits';
      const visitData: Partial<Visit> = {
        date: new Date().toISOString(),
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        authorId: auth.currentUser.uid
      };

      // Execute write in background (optimistic)
      addDoc(collection(db, path), visitData).catch(err => {
        handleFirestoreError(err, OperationType.WRITE, 'visits');
      });
      
      // Transition immediately for "instant" feel
      onSuccess();
    } catch (err) {
      setError('Gagal memproses data. Silakan cek koneksi Anda.');
      handleFirestoreError(err, OperationType.WRITE, 'visits');
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase text-slate-500 tracking-wider">Formulir Pemeriksaan Baru</h2>
        <span className="text-[10px] text-slate-400 font-mono">UKS-SYSTEM-AUTO</span>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-6">
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
                placeholder="Cari Nama Siswa/Tendik..."
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
              disabled
              type="text"
              value={new Date().toLocaleDateString('id-ID')}
              className="input-dense bg-slate-50 text-slate-400 cursor-not-allowed"
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
  );
}

