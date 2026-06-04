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
  limit,
  doc,
  updateDoc,
  setDoc
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { Visit } from '../types';
import { Save, AlertCircle, Loader2, Search, Share2, MessageCircle, History, Clock, Paperclip, Upload, X, FileText, Pencil } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { id } from 'date-fns/locale/id';

interface VisitFormProps {
  onSuccess: () => void;
  editVisit?: (Visit & { path: string }) | null;
  onCancel?: () => void;
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

const compressAndGetBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        
        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);
          resolve(compressedBase64);
        } else {
          resolve(event.target?.result as string);
        }
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

// No separate component needed for stability
const parseTherapy = (therapyStr: string) => {
  if (!therapyStr) {
    return Array(5).fill(null).map(() => ({ name: '', qty: '' }));
  }
  
  // Split by comma outside of parentheses
  const parts = therapyStr.split(/,(?![^(]*\))/);
  const result = parts.map(part => {
    let name = part.trim();
    let qty = '';
    
    // Check if it matches 'Name (Qty)'
    const matches = name.match(/^(.*?)\((.*?)\)$/);
    if (matches) {
      name = matches[1].trim();
      qty = matches[2].trim();
    }
    return { name, qty };
  });
  
  while (result.length < 5) {
    result.push({ name: '', qty: '' });
  }
  return result.slice(0, 5);
};

export default function VisitForm({ onSuccess, editVisit, onCancel }: VisitFormProps) {
  const [localEditVisit, setLocalEditVisit] = useState<(Visit & { path: string }) | null>(null);
  const currentEditVisit = localEditVisit || editVisit || null;

  const [loading, setLoading] = useState(false);
  const [isFetchingMaster, setIsFetchingMaster] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedData, setSavedData] = useState<{
    data: any;
    teacherNum: string;
    teacherStatus: 'idle' | 'sending' | 'success' | 'failed';
    supervisorNum: string;
    supervisorStatus: 'idle' | 'sending' | 'success' | 'failed';
  } | null>(null);
  const [labPhotos, setLabPhotos] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [compressing, setCompressing] = useState(false);

  const handleFileChange = async (file: File) => {
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      alert("Hanya berkas gambar (Foto Hasil Lab/Rontgen/Suket) yang dapat diunggah.");
      return;
    }

    if (labPhotos.length >= 3) {
      alert("Maksimal 3 foto hasil lab/rontgen/suket yang dapat diunggah.");
      return;
    }

    setCompressing(true);
    try {
      const base64 = await compressAndGetBase64(file);
      setLabPhotos(prev => [...prev, base64].slice(0, 3));
    } catch (err) {
      console.error("Compression error:", err);
      alert("Gagal memproses gambar. Silakan coba berkas lain.");
    } finally {
      setCompressing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files) {
      const filesArray = (Array.from(e.dataTransfer.files) as File[]).filter(f => f.type.startsWith('image/'));
      if (filesArray.length === 0) return;

      const remainingSlots = 3 - labPhotos.length;
      if (remainingSlots <= 0) {
        alert("Maksimal 3 foto hasil lab/rontgen/suket yang dapat diunggah.");
        return;
      }

      const filesToProcess = filesArray.slice(0, remainingSlots);
      
      setCompressing(true);
      Promise.all(filesToProcess.map(file => compressAndGetBase64(file)))
        .then(base64s => {
          setLabPhotos(prev => [...prev, ...base64s].slice(0, 3));
        })
        .catch(err => {
          console.error("Multi compression error:", err);
          alert("Gagal memproses beberapa berkas gambar.");
        })
        .finally(() => {
          setCompressing(false);
        });
    }
  };
  
  // Auto-scroll to top on save
  useEffect(() => {
    if (savedData) {
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) {
        window.scrollTo(0, 0);
      }
    }
  }, [savedData]);

  // Master data state
  const [masterStudents, setMasterStudents] = useState<StudentMaster[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [visitHistory, setVisitHistory] = useState<Visit[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [masterMedicines, setMasterMedicines] = useState<MasterData[]>([]);
  const [masterDiagnoses, setMasterDiagnoses] = useState<MasterData[]>([]);
  const [masterTeachers, setMasterTeachers] = useState<any[]>([]);
  const [focusedMedIndex, setFocusedMedIndex] = useState<number | null>(null);

  const [medications, setMedications] = useState<{ name: string; qty: string }[]>([
    { name: '', qty: '' },
    { name: '', qty: '' },
    { name: '', qty: '' },
    { name: '', qty: '' },
    { name: '', qty: '' },
  ]);

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

  const resetForm = () => {
    setSavedData(null);
    setLocalEditVisit(null);
    setFormData({
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
    setMedications([
      { name: '', qty: '' },
      { name: '', qty: '' },
      { name: '', qty: '' },
      { name: '', qty: '' },
      { name: '', qty: '' },
    ]);
    setSelectedStudentId(null);
    setError(null);
    setLabPhotos([]);
  };

  useEffect(() => {
    const activeMeds = medications.filter(m => m && m.name && m.name.trim());
    if (activeMeds.length > 0) {
      const generatedTherapy = activeMeds.map(m => {
        const name = m.name.trim();
        const qty = m.qty.trim();
        return qty ? `${name} (${qty})` : name;
      }).join(', ');
      setFormData(prev => ({ ...prev, therapy: generatedTherapy }));
    } else {
      setFormData(prev => ({ ...prev, therapy: '' }));
    }
  }, [medications]);

  useEffect(() => {
    if (currentEditVisit) {
      let visitDateString = format(new Date(), 'yyyy-MM-dd');
      if (currentEditVisit.date) {
        try {
          const d = new Date(currentEditVisit.date);
          if (!isNaN(d.getTime())) {
            visitDateString = format(d, 'yyyy-MM-dd');
          }
        } catch (e) {
          console.error(e);
        }
      }
      
      setFormData({
        studentName: currentEditVisit.studentName || '',
        age: currentEditVisit.age ? String(currentEditVisit.age) : '',
        grade: currentEditVisit.grade || '',
        gender: currentEditVisit.gender || 'Laki-laki',
        complaint: currentEditVisit.complaint || '',
        bloodPressure: currentEditVisit.bloodPressure || '',
        weight: currentEditVisit.weight ? String(currentEditVisit.weight) : '',
        temperature: currentEditVisit.temperature ? String(currentEditVisit.temperature) : '',
        diagnosis: currentEditVisit.diagnosis || '',
        therapy: currentEditVisit.therapy || '',
        action: currentEditVisit.action || '',
        teacherName: currentEditVisit.teacherName || '',
        supervisorName: currentEditVisit.supervisorName || '',
        date: visitDateString
      });

      setMedications(parseTherapy(currentEditVisit.therapy || ''));

      const segments = currentEditVisit.path.split('/');
      const studentId = segments[1] || null;
      setSelectedStudentId(studentId);

      const photosArray = currentEditVisit.labPhotos && Array.isArray(currentEditVisit.labPhotos) && currentEditVisit.labPhotos.length > 0 
        ? currentEditVisit.labPhotos 
        : (currentEditVisit.labPhoto ? [currentEditVisit.labPhoto] : []);
      setLabPhotos(photosArray);
    } else {
      // Clear form when transitioning away from edit
      setFormData({
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
      setMedications([
        { name: '', qty: '' },
        { name: '', qty: '' },
        { name: '', qty: '' },
        { name: '', qty: '' },
        { name: '', qty: '' },
      ]);
      setSelectedStudentId(null);
      setLabPhotos([]);
    }
  }, [currentEditVisit]);

  const safeFormatDate = (dateVal: any, formatStr: string) => {
    try {
      if (!dateVal) return '-';
      let dateObj: Date;
      if (typeof dateVal === 'string') {
        dateObj = parseISO(dateVal);
      } else if (dateVal instanceof Date) {
        dateObj = dateVal;
      } else if (dateVal && typeof dateVal.toDate === 'function') {
        dateObj = dateVal.toDate();
      } else {
        dateObj = new Date(dateVal);
      }
      
      if (isNaN(dateObj.getTime())) return '-';
      return format(dateObj, formatStr, { locale: id });
    } catch (err) {
      console.error("Date formatting error:", err);
      return '-';
    }
  };

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

        const teacherSnap = await getDocs(query(collection(db, 'teachers'), orderBy('name', 'asc')));
        setMasterTeachers(teacherSnap.docs.map(d => ({
          id: d.id,
          name: d.data().name,
          whatsapp: d.data().whatsapp
        })));
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
        // Try flat root collection first (no-index safe query)
        const q = query(
          collection(db, 'visits'),
          where('studentName', '==', nameToSearch),
          limit(100)
        );
        const snap = await getDocs(q);
        const historyData = snap.docs.map(docSnap => ({ 
          id: docSnap.id, 
          studentId: docSnap.data().studentId || docSnap.ref.parent?.parent?.id || '',
          path: docSnap.ref.path,
          ...docSnap.data() 
        } as any));

        // Sort in-memory to avoid requiring composite index
        historyData.sort((a, b) => {
          const dateA = a.date ? new Date(a.date).getTime() : 0;
          const dateB = b.date ? new Date(b.date).getTime() : 0;
          return dateB - dateA;
        });
        
        setVisitHistory(historyData.slice(0, 10));
      } catch (err: any) {
        console.error("Error fetching visit history from root:", err);
        // Fallback to collectionGroup if some visits are still in subcollections
        try {
          const qSimple = query(
            collectionGroup(db, 'visits'),
            where('studentName', '==', nameToSearch),
            limit(100)
          );
          const snapSimple = await getDocs(qSimple);
          const sorted = snapSimple.docs
            .map(d => ({ 
              id: d.id, 
              studentId: d.ref.parent?.parent?.id || '',
              path: d.ref.path,
              ...d.data() 
            } as any))
            .sort((a, b) => {
              const dateA = a.date ? new Date(a.date).getTime() : 0;
              const dateB = b.date ? new Date(b.date).getTime() : 0;
              return dateB - dateA;
            })
            .slice(0, 10);
          setVisitHistory(sorted);
        } catch (innerErr) {
          console.error("Fallback history fetch failed:", innerErr);
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
    const found = (masterStudents || []).find(s => 
      s && s.name && typeof s.name === 'string' && 
      s.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
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
        const found = (masterStudents || []).find(s => 
          s && s.name && typeof s.name === 'string' &&
          s.name.toLowerCase() === formData.studentName.trim().toLowerCase()
        );
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

      // 2. Validate Authentication
      if (!auth.currentUser) {
        throw new Error('Sesi anda telah berakhir. Silakan login kembali.');
      }

      // 3. Create Timestamp Safely
      let selectedDate: Date;
      try {
        selectedDate = formData.date ? parseISO(formData.date) : new Date();
        if (isNaN(selectedDate.getTime())) {
          selectedDate = new Date();
        }
      } catch (e) {
        selectedDate = new Date();
      }
      
      const now = new Date();
      selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
      const timestampToUse = Timestamp.fromDate(selectedDate);

      const visitData: Partial<Visit> & { studentId?: string } = {
        date: selectedDate.toISOString(),
        studentName: formData.studentName.trim(),
        studentId: studentId || '',
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
        teacherName: formData.teacherName?.trim() || '',
        supervisorName: formData.supervisorName?.trim() || '',
        createdAt: timestampToUse,
        updatedAt: timestampToUse,
        authorId: auth.currentUser.uid,
        labPhoto: labPhotos[0] || '',
        labPhotos: labPhotos
      };

      // 4. Save or update document
      let visitId = '';
      if (currentEditVisit) {
        const visitRef = doc(db, currentEditVisit.path);
        const updatedVisitData: any = {
          ...visitData,
          updatedAt: serverTimestamp()
        };
        delete updatedVisitData.createdAt; // preserve original createdAt

        await updateDoc(visitRef, updatedVisitData);
        visitId = currentEditVisit.id;
        console.log("Visit record updated successfully in Firestore:", currentEditVisit.path);
      } else {
        const docRef = await addDoc(collection(db, 'visits'), visitData);
        visitId = docRef.id;
        console.log("Visit record saved successfully to root visits. Visit ID:", visitId);
      }

      // 6. Set success state IMMEDIATELY to show the success notification
      const cleanTeacherName = (formData.teacherName || '').trim().toLowerCase();
      const teacher = cleanTeacherName ? (masterTeachers || []).find(t => {
        if (!t || !t.name) return false;
        const n = t.name.trim().toLowerCase();
        return n === cleanTeacherName || n.includes(cleanTeacherName) || cleanTeacherName.includes(n);
      }) : null;

      const cleanSupervisorName = (formData.supervisorName || '').trim().toLowerCase();
      const supervisor = cleanSupervisorName ? (masterTeachers || []).find(t => {
        if (!t || !t.name) return false;
        const n = t.name.trim().toLowerCase();
        return n === cleanSupervisorName || n.includes(cleanSupervisorName) || cleanSupervisorName.includes(n);
      }) : null;

      const labUrl = labPhotos.length > 0 ? `${window.location.origin}/?view-lab=${studentId}_${visitId}` : '';

      setSavedData({
        data: { ...formData, labUrl },
        teacherNum: teacher?.whatsapp || '',
        teacherStatus: teacher?.whatsapp ? 'sending' : 'idle',
        supervisorNum: supervisor?.whatsapp || '',
        supervisorStatus: supervisor?.whatsapp ? 'sending' : 'idle'
      });
      
      setLoading(false);
      console.log("UI updated to success view.");

      // Automatically log medicine usage concurrently as per user specifications
      try {
        const activeMeds = medications.filter(m => m && m.name && m.name.trim());
        const logPromises = activeMeds.map(async (med) => {
          const nameClean = med.name.trim();
          const matchedMed = masterMedicines.find(m => m.name.toLowerCase() === nameClean.toLowerCase());
          if (matchedMed) {
            let parsedQty = 1;
            const matchFirstNum = med.qty.match(/^\d+/);
            if (matchFirstNum) {
              parsedQty = parseInt(matchFirstNum[0]);
            } else {
              const anyNum = med.qty.match(/\d+/);
              if (anyNum) {
                parsedQty = parseInt(anyNum[0]);
              }
            }
            if (isNaN(parsedQty) || parsedQty <= 0) {
              parsedQty = 1;
            }

            const logId = `${matchedMed.id}_${visitId}_OUT`;
            await setDoc(doc(db, 'medicineLogs', logId), {
              medicineId: matchedMed.id,
              medicineName: matchedMed.name,
              quantity: parsedQty,
              visitId: visitId,
              date: selectedDate.toISOString().split('T')[0], // yyyy-MM-dd
              type: 'OUT',
              createdAt: serverTimestamp()
            });
          }
        });
        await Promise.all(logPromises);
      } catch (logErr) {
        console.error("Failed to automatically log medicine usage (background):", logErr);
      }
      
      // 7. Attempt automatic send in background
      if (teacher?.whatsapp) {
        console.log("Attempting background WhatsApp report to Wali Kelas...");
        sendWhatsApp(teacher.whatsapp, { ...formData, labUrl }).then(success => {
          console.log("Background WhatsApp report to Wali Kelas result:", success);
          setSavedData(prev => prev ? { ...prev, teacherStatus: success ? 'success' : 'failed' } : null);
        }).catch(err => {
          console.error("Background WhatsApp error (Wali Kelas):", err);
          setSavedData(prev => prev ? { ...prev, teacherStatus: 'failed' } : null);
        });
      }

      if (supervisor?.whatsapp) {
        console.log("Attempting background WhatsApp report to Pembina...");
        sendWhatsApp(supervisor.whatsapp, { ...formData, labUrl }).then(success => {
          console.log("Background WhatsApp report to Pembina result:", success);
          setSavedData(prev => prev ? { ...prev, supervisorStatus: success ? 'success' : 'failed' } : null);
        }).catch(err => {
          console.error("Background WhatsApp error (Pembina):", err);
          setSavedData(prev => prev ? { ...prev, supervisorStatus: 'failed' } : null);
        });
      }

      // Trigger automatic background backup to Google Drive silently
      import('../lib/drive').then(({ triggerAutoBackup }) => {
        triggerAutoBackup().catch(err => console.error("Error in automatic background backup:", err));
      });

      // Trigger automatic background sync to Google Sheets silently
      import('../lib/sheets').then(({ syncVisitToGoogleSheets }) => {
        syncVisitToGoogleSheets({
          id: visitId,
          date: selectedDate.toISOString(),
          studentName: formData.studentName.trim(),
          gender: formData.gender,
          age: ageNum,
          grade: formData.grade.trim(),
          complaint: formData.complaint.trim(),
          bloodPressure: formData.bloodPressure.trim(),
          weight: formData.weight ? Number(formData.weight) : '',
          temperature: formData.temperature ? Number(formData.temperature) : '',
          diagnosis: formData.diagnosis.trim(),
          therapy: formData.therapy.trim(),
          action: formData.action.trim(),
          teacherName: formData.teacherName?.trim() || '',
          supervisorName: formData.supervisorName?.trim() || '',
          labUrl: labUrl
        }).catch(err => console.error("Error in automatic background sheets synchronization:", err));
      });
    } catch (err: any) {
      console.error("Critical error in handleSubmit:", err);
      setError('Gagal memproses data: ' + (err.message || 'Error tidak dikenal'));
      handleFirestoreError(err, OperationType.WRITE, 'visits_subcollection');
      setLoading(false);
    }
  };

  const sendWhatsApp = async (number: any, data: any): Promise<boolean> => {
    try {
      if (!number) return false;
      const numStr = String(number);
      const cleanNumber = numStr.replace(/\D/g, '');
      const formattedNumber = cleanNumber.startsWith('0') ? '62' + cleanNumber.slice(1) : (cleanNumber.startsWith('62') ? cleanNumber : '62' + cleanNumber);
      
      const reportDate = safeFormatDate(data.date, 'dd MMMM yyyy');
      
      let text = `Assalamualaikum wr.wb.

Laporan Kondisi Kesehatan
(${reportDate})

Nama : ${data.studentName || '-'}
Kelas : ${data.grade || '-'}
Keluhan : ${data.complaint || '-'}
Diagnosa : ${data.diagnosis || '-'}
Terapi : ${data.therapy || '-'}
Tindakan : ${data.action || '-'}`;

      if (data.labUrl) {
        text += `\n\nFoto Hasil Lab/Rontgen/Suket :\n${data.labUrl}`;
      }

      text += `\n\nUKS PLUS SCB`;

      const customToken = localStorage.getItem('uks_fonnte_token') || '';
      const response = await fetch('/api/send-wa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          target: formattedNumber, 
          message: text,
          token: customToken
        })
      });

      if (!response.ok) {
        console.warn("WA Proxy returned non-OK status:", response.status);
        return false;
      }

      const result = await response.json();
      return !!(result && result.status);
    } catch (error) {
      console.error("Fetch error for WA:", error);
      return false;
    }
  };

  const getWhatsAppManualUrl = (number: string, data: any) => {
    if (!number) return '#';
    const cleanNumber = String(number).replace(/\D/g, '');
    const formattedNumber = cleanNumber.startsWith('0') 
      ? '62' + cleanNumber.slice(1) 
      : (cleanNumber.startsWith('62') ? cleanNumber : '62' + cleanNumber);
    
    const reportDate = data.date ? safeFormatDate(data.date, 'dd MMMM yyyy') : safeFormatDate(new Date().toISOString(), 'dd MMMM yyyy');
    let text = `Assalamualaikum wr.wb.

Laporan Kondisi Kesehatan
(${reportDate})

Nama : ${data.studentName || '-'}
Kelas : ${data.grade || '-'}
Keluhan : ${data.complaint || '-'}
Diagnosa : ${data.diagnosis || '-'}
Terapi : ${data.therapy || '-'}
Tindakan : ${data.action || '-'}`;

    if (data.labUrl) {
      text += `\n\nFoto Hasil Lab/Rontgen/Suket :\n${data.labUrl}`;
    }

    text += `\n\nUKS PLUS SCB`;
    return `https://wa.me/${formattedNumber}?text=${encodeURIComponent(text)}`;
  };

  return (
    <div key="stable-visit-form-root" translate="no" className="w-full min-h-screen bg-slate-50/50 pb-20">
      {/* Global stable datalists - Sliced and dynamically matched to ensure 0ms render times */}
      <div key="datalists-static" className="hidden" aria-hidden="true">
        <datalist id="list-students">
          {masterStudents
            .filter(s => s && s.name && s.name.toLowerCase().includes((formData.studentName || '').toLowerCase()))
            .slice(0, 15)
            .map((s, idx) => <option key={`s-${idx}`} value={s.name} />)}
        </datalist>
        <datalist id="list-medicines">
          {masterMedicines
            .filter(m => {
              const currentText = focusedMedIndex !== null && medications[focusedMedIndex] ? medications[focusedMedIndex].name : '';
              return !currentText || m.name.toLowerCase().includes(currentText.toLowerCase());
            })
            .slice(0, 15)
            .map((m, idx) => <option key={`m-${idx}`} value={m.name} />)}
        </datalist>
        <datalist id="list-diagnoses">
          {masterDiagnoses
            .filter(d => d && d.name && d.name.toLowerCase().includes((formData.diagnosis || '').toLowerCase()))
            .slice(0, 15)
            .map((d, idx) => <option key={`d-${idx}`} value={d.name} />)}
        </datalist>
        <datalist id="list-teachers">
          {masterTeachers.slice(0, 20).map((t, idx) => <option key={`t-${idx}`} value={t.name} />)}
        </datalist>
      </div>

      <div className="max-w-6xl mx-auto py-6 px-4">
        {/* Simple Notification Banner - THE SAFE WAY */}
        {savedData && (
          <div id="notif-success" className="mb-6 bg-cyan-600 text-white rounded-xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="p-6 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center shrink-0">
                  <Save className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-black uppercase tracking-tight">
                    {currentEditVisit ? 'DATA BERHASIL DIPERBARUI' : 'DATA BERHASIL DISIMPAN'}
                  </h2>
                  <p className="text-white/80 text-sm">
                    Pemeriksaan untuk <span className="font-bold underline">{savedData.data.studentName}</span> telah {currentEditVisit ? 'diperbarui' : 'tercatat'}.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={resetForm}
                  className="px-6 py-2.5 bg-white text-cyan-700 rounded-lg text-xs font-black uppercase tracking-widest hover:bg-cyan-50 transition-colors shadow-lg"
                >
                  INPUT DATA BARU
                </button>
                <button
                  onClick={onSuccess}
                  className="px-6 py-2.5 bg-cyan-800 text-white rounded-lg text-xs font-black uppercase tracking-widest hover:bg-cyan-900 transition-colors"
                >
                  RIWAYAT
                </button>
              </div>
            </div>
            
            {savedData.teacherNum && savedData.teacherStatus !== 'idle' && (
              <>
                {savedData.teacherStatus === 'sending' && (
                  <div className="bg-cyan-700/40 px-6 py-3 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2.5 border-t border-cyan-500/20">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                    <span>Sedang mengirim laporan WhatsApp otomatis ke Wali Kelas ({savedData.teacherNum})...</span>
                  </div>
                )}
                {savedData.teacherStatus === 'success' && (
                  <div className="bg-cyan-700/70 px-6 py-3 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border-t border-cyan-500/20 text-emerald-200">
                    <MessageCircle className="w-3.5 h-3.5 text-emerald-300" />
                    <span>Laporan WhatsApp Terkirim Otomatis ke Wali Kelas ({savedData.teacherNum})!</span>
                  </div>
                )}
                {savedData.teacherStatus === 'failed' && (
                  <div className="bg-rose-950/40 px-6 py-3 text-[10px] font-bold uppercase tracking-widest flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-cyan-500/20">
                    <div className="flex items-center gap-2 text-rose-200">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-300" />
                      <span>WhatsApp Otomatis Gagal Terkirim ke Wali Kelas ({savedData.teacherNum})</span>
                    </div>
                    <a
                      href={getWhatsAppManualUrl(savedData.teacherNum, savedData.data)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded font-black text-[9px] uppercase tracking-wider transition-colors inline-flex items-center gap-1.5 cursor-pointer decoration-none self-start sm:self-center"
                    >
                      <MessageCircle className="w-3 h-3" />
                      Kirim Manual (WA Web)
                    </a>
                  </div>
                )}
              </>
            )}

            {savedData.supervisorNum && savedData.supervisorStatus !== 'idle' && (
              <>
                {savedData.supervisorStatus === 'sending' && (
                  <div className="bg-cyan-700/40 px-6 py-3 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2.5 border-t border-cyan-500/20 w-full">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                    <span>Sedang mengirim laporan WhatsApp otomatis ke Pembina ({savedData.supervisorNum})...</span>
                  </div>
                )}
                {savedData.supervisorStatus === 'success' && (
                  <div className="bg-cyan-700/70 px-6 py-3 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 border-t border-cyan-500/20 text-emerald-200">
                    <MessageCircle className="w-3.5 h-3.5 text-emerald-300" />
                    <span>Laporan WhatsApp Terkirim Otomatis ke Pembina ({savedData.supervisorNum})!</span>
                  </div>
                )}
                {savedData.supervisorStatus === 'failed' && (
                  <div className="bg-rose-950/40 px-6 py-3 text-[10px] font-bold uppercase tracking-widest flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-cyan-500/20 w-full">
                    <div className="flex items-center gap-2 text-rose-200">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-300" />
                      <span>WhatsApp Otomatis Gagal Terkirim ke Pembina ({savedData.supervisorNum})</span>
                    </div>
                    <a
                      href={getWhatsAppManualUrl(savedData.supervisorNum, savedData.data)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded font-black text-[9px] uppercase tracking-wider transition-colors inline-flex items-center gap-1.5 cursor-pointer decoration-none self-start sm:self-center"
                    >
                      <MessageCircle className="w-3 h-3" />
                      Kirim Manual (WA Web)
                    </a>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden h-fit">
            <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase text-slate-500 tracking-wider">
                {currentEditVisit ? 'Edit Riwayat Pemeriksaan Pasien' : 'Formulir Pemeriksaan Baru'}
              </h2>
              <span className="text-[10px] text-slate-400 font-mono">MED_REPORT_STABLE</span>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-6">
              {isFetchingMaster && (
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 className="w-3 h-3 text-cyan-500 animate-spin" />
                  <span className="text-[9px] font-black uppercase text-cyan-500 tracking-tighter">Sync database master...</span>
                </div>
              )}
              
              {error && (
                <div className="p-3 bg-red-50 text-red-600 border border-red-100 rounded text-[10px] font-bold uppercase flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                <div className="md:col-span-2 space-y-1">
                  <label htmlFor="studentName" className="text-[10px] font-bold text-slate-600 uppercase">
                    Nama Lengkap
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
                      placeholder="Cari Nama Pasien..."
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
                <div className="col-span-1 md:col-span-6 space-y-1">
                  <label htmlFor="diagnosis" className="text-[10px] font-bold text-slate-600 uppercase flex justify-between">
                    <span>Diagnosa / Gejala</span>
                    {masterDiagnoses.length > 0 && <span className="text-cyan-500 font-black text-[8px]">{masterDiagnoses.length} Filter Aktif</span>}
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

                <div className="col-span-1 md:col-span-6 space-y-2.5 mt-2 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="flex justify-between items-center pb-2 border-b border-indigo-100 mb-2">
                    <label className="text-[11px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                      Pemberian Terapi / Obat (Maksimal 5 Jenis Obat)
                    </label>
                    {masterMedicines.length > 0 && (
                      <span className="text-[9px] bg-indigo-100 font-black px-2 py-0.5 rounded text-indigo-700 font-mono">
                        {masterMedicines.length} Obat Tersedia
                      </span>
                    )}
                  </div>
                  
                  <div className="space-y-2.5">
                    {medications.map((med, index) => (
                      <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                        <div className="md:col-span-1 text-center font-mono font-bold text-slate-400 text-xs flex items-center justify-center bg-slate-200/50 rounded-lg h-8 w-8">
                          #{index + 1}
                        </div>
                        
                        <div className="md:col-span-7 relative">
                          <input
                            type="text"
                            list="list-medicines"
                            autoComplete="off"
                            value={med.name}
                            onChange={(e) => {
                              const val = e.target.value;
                              const updated = [...medications];
                              updated[index].name = val;
                              setMedications(updated);
                            }}
                            onFocus={() => setFocusedMedIndex(index)}
                            className="input-dense pl-3 bg-white"
                            placeholder={`Pilih atau ketik nama obat ke-${index + 1}...`}
                          />
                        </div>
                        
                        <div className="md:col-span-4 flex gap-1">
                          <input
                            type="text"
                            value={med.qty}
                            onChange={(e) => {
                              const val = e.target.value;
                              const updated = [...medications];
                              updated[index].qty = val;
                              setMedications(updated);
                            }}
                            className="input-dense text-center font-mono font-bold bg-white"
                            placeholder="Jumlah / Aturan pakai (cth: 3x1)"
                          />
                          {med.name && (
                            <button
                              type="button"
                              onClick={() => {
                                const updated = [...medications];
                                updated[index] = { name: '', qty: '' };
                                setMedications(updated);
                              }}
                              className="px-2 bg-slate-200 hover:bg-rose-100 text-slate-500 hover:text-rose-600 rounded transition-colors text-xs font-bold"
                              title="Hapus"
                            >
                              &times;
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
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
                          className="text-[9px] font-black uppercase px-2 py-1 rounded bg-slate-100 text-slate-500 hover:bg-cyan-100 hover:text-cyan-700 transition-colors border border-slate-200 border-dashed"
                        >
                          + {act}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Upload Foto Hasil Lab / Rontgen / Suket Block */}
                <div className="col-span-1 md:col-span-6 space-y-1">
                  <label className="text-[10px] font-black text-slate-600 uppercase flex items-center gap-1">
                    <Paperclip className="w-3.5 h-3.5 text-cyan-600" />
                    <span>Upload Foto Hasil Lab / Rontgen / Surat Keterangan Lain (Opsi, Maks 3)</span>
                  </label>
                  
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-lg p-4 transition-colors relative cursor-pointer flex flex-col items-center justify-center text-center ${
                      isDragging 
                        ? 'border-cyan-500 bg-cyan-50/50' 
                        : labPhotos.length > 0 
                          ? 'border-cyan-200 bg-cyan-50/10' 
                          : 'border-slate-300 hover:border-cyan-400 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="file"
                      id="lab-photo-upload"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        if (e.target.files) {
                          const filesArray = (Array.from(e.target.files) as File[]).filter(f => f.type.startsWith('image/'));
                          const remainingSlots = 3 - labPhotos.length;
                          if (filesArray.length > remainingSlots) {
                            alert(`Maksimal 3 foto. Anda hanya bisa mengunggah ${remainingSlots} foto lagi.`);
                          }
                          const toProcess = filesArray.slice(0, remainingSlots);
                          if (toProcess.length > 0) {
                            setCompressing(true);
                            Promise.all(toProcess.map(file => compressAndGetBase64(file)))
                              .then(base64s => {
                                setLabPhotos(prev => [...prev, ...base64s].slice(0, 3));
                              })
                              .catch(err => {
                                console.error(err);
                                alert("Gagal memproses gambar.");
                              })
                              .finally(() => {
                                setCompressing(false);
                              });
                          }
                        }
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer h-full w-full"
                    />
                    
                    {compressing ? (
                      <div className="space-y-2 py-4">
                        <Loader2 className="w-8 h-8 text-cyan-600 animate-spin mx-auto" />
                        <p className="text-[10px] font-black uppercase text-cyan-600 tracking-wider">Sedang Memproses & Mengompres Gambar...</p>
                      </div>
                    ) : labPhotos.length > 0 ? (
                      <div className="space-y-3 w-full flex flex-col items-center relative z-10 font-sans">
                        <div className="flex flex-wrap gap-4 justify-center">
                          {labPhotos.map((photo, i) => (
                            <div key={i} className="relative group">
                              <img 
                                src={photo} 
                                alt={`Pratinjau Lampiran ${i + 1}`} 
                                className="max-h-24 w-24 object-cover rounded border border-slate-200 shadow-sm"
                              />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setLabPhotos(prev => prev.filter((_, idx) => idx !== i));
                                }}
                                className="absolute -top-2 -right-2 p-1 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors shadow-md hover:scale-110"
                              >
                                <X className="w-3 h-3" />
                              </button>
                              <span className="absolute bottom-1 right-1 bg-slate-900/80 text-[8px] text-white font-black px-1.5 rounded-md">
                                #{i + 1}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] font-bold text-cyan-700 uppercase tracking-widest bg-cyan-100 hover:bg-cyan-200 px-3 py-1 rounded inline-block">
                            {labPhotos.length} Foto Terlampir {labPhotos.length < 3 ? `(Klik/Seret untuk tambah sisa ${3 - labPhotos.length} slot)` : '(Penuh)'}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 py-2">
                        <Upload className="w-6 h-6 text-slate-400 mx-auto" />
                        <div className="text-[10px] font-medium text-slate-500">
                          <span className="font-bold text-cyan-600">Klik untuk pilih gambar</span> atau drag & drop ke sini
                        </div>
                        <p className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Hasil Lab, Rontgen atau Surat Keterangan Dokter (Maks 3 Gambar)</p>
                      </div>
                    )}
                  </div>
                </div>

                 <div className="col-span-1 md:col-span-6 space-y-4 pt-4 border-t border-slate-50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label htmlFor="supervisorName" className="text-[10px] font-bold text-slate-600 uppercase flex justify-between">
                        <span>Pembina</span>
                      </label>
                      <input
                        id="supervisorName"
                        type="text"
                        list="list-teachers"
                        autoComplete="off"
                        value={formData.supervisorName || ''}
                        onChange={(e) => setFormData({ ...formData, supervisorName: e.target.value })}
                        className="input-dense"
                        placeholder="Nama Pembina..."
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="teacherName" className="text-[10px] font-bold text-slate-600 uppercase flex justify-between">
                        <span>Wali Kelas</span>
                      </label>
                      <input
                        id="teacherName"
                        type="text"
                        list="list-teachers"
                        autoComplete="off"
                        value={formData.teacherName}
                        onChange={(e) => setFormData({ ...formData, teacherName: e.target.value })}
                        className="input-dense"
                        placeholder="Nama Wali Kelas..."
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-bold text-slate-600 uppercase">Kirim Laporan Kondisi via Fonnte (Opsi)</label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const cleanSupervisorName = (formData.supervisorName || '').trim().toLowerCase();
                          const supervisor = cleanSupervisorName ? (masterTeachers || []).find(t => {
                            if (!t || !t.name) return false;
                            const n = t.name.trim().toLowerCase();
                            return n === cleanSupervisorName || n.includes(cleanSupervisorName) || cleanSupervisorName.includes(n);
                          }) : null;

                          if (supervisor?.whatsapp) {
                            sendWhatsApp(supervisor.whatsapp, formData).then(success => {
                              if (success) {
                                alert('Pesan WhatsApp berhasil dikirim ke Pembina!');
                              } else {
                                alert('Gagal mengirim WhatsApp otomatis ke Pembina. Periksa token Fonnte Anda.');
                              }
                            });
                          } else {
                            alert('Nomor WhatsApp Pembina tidak ditemukan.');
                          }
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded text-[10px] font-black uppercase hover:bg-emerald-100 transition-colors cursor-pointer"
                      >
                        <MessageCircle className="w-4 h-4" />
                        Kirim ke Pembina
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const cleanTeacherName = (formData.teacherName || '').trim().toLowerCase();
                          const teacher = cleanTeacherName ? (masterTeachers || []).find(t => {
                            if (!t || !t.name) return false;
                            const n = t.name.trim().toLowerCase();
                            return n === cleanTeacherName || n.includes(cleanTeacherName) || cleanTeacherName.includes(n);
                          }) : null;

                          if (teacher?.whatsapp) {
                            sendWhatsApp(teacher.whatsapp, formData).then(success => {
                              if (success) {
                                alert('Pesan WhatsApp berhasil dikirim ke Wali Kelas!');
                              } else {
                                alert('Gagal mengirim WhatsApp otomatis ke Wali Kelas. Periksa token Fonnte Anda.');
                              }
                            });
                          } else {
                            alert('Nomor WhatsApp Wali Kelas tidak ditemukan.');
                          }
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded text-[10px] font-black uppercase hover:bg-indigo-100 transition-colors cursor-pointer"
                      >
                        <MessageCircle className="w-4 h-4" />
                        Kirim ke Wali Kelas
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                {currentEditVisit && (
                  <button
                    type="button"
                    onClick={() => {
                      if (localEditVisit) {
                        setLocalEditVisit(null);
                      } else if (onCancel) {
                        onCancel();
                      }
                    }}
                    className="border border-slate-300 hover:bg-slate-100 text-slate-700 px-5 py-2 rounded text-xs font-bold transition-colors uppercase"
                  >
                    Batal
                  </button>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-cyan-600 hover:bg-cyan-700 text-white px-6 py-2 rounded text-xs font-bold transition-all disabled:opacity-50 shadow-sm shadow-cyan-600/20 flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      LOADING & KIRIM WA...
                    </>
                  ) : currentEditVisit ? (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      PERBARUI DATA
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      SIMPAN & KIRIM LAPORAN
                    </>
                  )}
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
                      <Loader2 className="w-5 h-5 text-cyan-500 animate-spin" />
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
                    visitHistory.map((visit, index) => {
                      if (!visit) return null;
                      const isBeingEdited = currentEditVisit?.id === visit.id;
                      return (
                        <div 
                          key={visit.id || index} 
                          className={`p-3 rounded border transition-all relative overflow-hidden group ${
                            isBeingEdited
                              ? 'border-cyan-500 bg-cyan-50/40 ring-2 ring-cyan-500/10'
                              : 'bg-slate-50 border-slate-100 hover:border-cyan-200 shadow-sm'
                          }`}
                        >
                          <div className="absolute top-0 right-0 p-1 bg-white border-l border-b border-slate-200/50 rounded-bl opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 z-10 shadow-sm">
                             {isBeingEdited ? (
                               <span className="text-[8px] bg-cyan-600 text-white px-2 py-0.5 rounded font-black uppercase tracking-tighter">
                                 Aktif Edit
                               </span>
                             ) : (
                               <button
                                 type="button"
                                 onClick={(e) => {
                                   e.preventDefault();
                                   e.stopPropagation();
                                   setLocalEditVisit({
                                     ...visit,
                                     path: visit.path || `students/${visit.studentId || selectedStudentId}/visits/${visit.id}`
                                   });
                                 }}
                                 className="text-[8px] bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-700 hover:to-teal-700 text-white px-2 py-0.5 rounded font-black uppercase tracking-tighter flex items-center gap-0.5 border border-cyan-500/10 shadow-sm"
                               >
                                 <Pencil className="w-1.5 h-1.5" />
                                 <span>Edit</span>
                               </button>
                             )}
                          </div>
                          <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-200/50">
                            <span className="text-[9px] font-black text-slate-400 uppercase font-mono">
                              {safeFormatDate(visit.date, 'dd MMM yyyy')}
                            </span>
                            <span className="text-[9px] font-black text-cyan-600 uppercase tracking-tighter line-clamp-1">
                              {visit.diagnosis || 'Tanpa Diagnosa'}
                            </span>
                          </div>
                          <div className="space-y-2">
                            <div>
                               <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200/50 pb-0.5 mb-1.5">Hasil Pemeriksaan</p>
                            </div>
                            
                            {/* Keluhan */}
                            <div>
                              <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider block">Keluhan</span>
                              <p className="text-[10px] text-slate-700 leading-tight">{visit.complaint || '-'}</p>
                            </div>

                            {/* Tanda Vital Grid */}
                            <div className="grid grid-cols-3 gap-1 bg-white p-1.5 rounded border border-slate-200/40">
                              <div className="text-center">
                                <span className="text-[7px] font-black text-slate-400 uppercase tracking-wider block">TD (Tensi)</span>
                                <span className="text-[9px] font-bold text-slate-700 font-mono">{visit.bloodPressure || '-'}</span>
                              </div>
                              <div className="text-center border-l border-r border-slate-200/50">
                                <span className="text-[7px] font-black text-slate-400 uppercase tracking-wider block">B. Badan</span>
                                <span className="text-[9px] font-bold text-slate-700 font-mono">{visit.weight ? `${visit.weight} kg` : '-'}</span>
                              </div>
                              <div className="text-center">
                                <span className="text-[7px] font-black text-slate-400 uppercase tracking-wider block">Suhu</span>
                                <span className="text-[9px] font-bold text-slate-700 font-mono">{visit.temperature ? `${visit.temperature}°C` : '-'}</span>
                              </div>
                            </div>

                            {/* Diagnosa */}
                            <div>
                              <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider block">Diagnosa</span>
                              <p className="text-[10px] text-slate-800 font-black leading-tight">{visit.diagnosis || '-'}</p>
                            </div>

                            {/* Terapi */}
                            <div>
                              <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider block">Terapi / Obat</span>
                              <p className="text-[10px] font-bold text-slate-900 leading-tight">{visit.therapy || '-'}</p>
                            </div>

                            {/* Tindakan */}
                            <div>
                              <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider block">Tindakan</span>
                              <p className="text-[10px] text-slate-700 leading-tight">{visit.action || '-'}</p>
                            </div>

                            {/* Foto Berkas Lampiran */}
                            {visit.labPhoto && (
                              <div className="pt-2 border-t border-slate-200/50">
                                <a
                                  href={`/?view-lab=${visit.studentId}_${visit.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-1 bg-cyan-100 hover:bg-cyan-200 text-cyan-800 font-extrabold uppercase px-2 py-1 rounded text-[8px] tracking-widest transition-colors w-fit border border-cyan-200/50"
                                >
                                  <FileText className="w-3 h-3 text-cyan-600" />
                                  <span>LIHAT HASIL LAB</span>
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
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
      </div>
    </div>
  );
}

