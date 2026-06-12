import React, { useState, useEffect, useMemo } from 'react';
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
import { db, auth, handleFirestoreError, OperationType, runWithRetry } from '../lib/firebase';
import { Visit } from '../types';
import { Save, AlertCircle, Loader2, Search, Share2, MessageCircle, History, Clock, Paperclip, Upload, X, FileText, Pencil, Check, RefreshCw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { id } from 'date-fns/locale/id';
import { cn, normalizeMedicineName, sanitizeMedicines } from '../lib/utils';
import { getCachedDriveToken, connectGoogleDrive, triggerAutoBackup } from '../lib/drive';
import { syncVisitToGoogleSheets, fetchMasterDataFromSheets, syncMedicineUsageToGoogleSheets } from '../lib/sheets';

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
    name = normalizeMedicineName(name);
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
    parentNum: string;
    parentStatus: 'idle' | 'sending' | 'success' | 'failed';
  } | null>(null);
  const [labPhotos, setLabPhotos] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'warn' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'warn' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

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
  
  const [driveConnected, setDriveConnected] = useState(false);

  useEffect(() => {
    const checkDriveConnection = () => {
      try {
        const token = getCachedDriveToken();
        setDriveConnected(!!token);
      } catch (err) {
        console.error("Error checking drive token inside VisitForm:", err);
      }
    };
    checkDriveConnection();
    
    // Listen to custom event for drive connectivity state changes
    const onSyncCompleted = () => {
      checkDriveConnection();
    };
    window.addEventListener('uks_sheet_sync_completed', onSyncCompleted);
    window.addEventListener('uks_auto_backup_completed', onSyncCompleted);
    window.addEventListener('uks_drive_connection_changed', onSyncCompleted);
    return () => {
      window.removeEventListener('uks_sheet_sync_completed', onSyncCompleted);
      window.removeEventListener('uks_auto_backup_completed', onSyncCompleted);
      window.removeEventListener('uks_drive_connection_changed', onSyncCompleted);
    };
  }, []);

  const handleConnectGoogle = async () => {
    try {
      setLoading(true);
      const token = await connectGoogleDrive();
      if (token) {
        setDriveConnected(true);
        showNotification('Berhasil menghubungkan Google Drive/Sheets!', 'success');
      }
    } catch (err: any) {
      console.error(err);
      showNotification(err.message || 'Gagal menghubungkan Google Drive/Sheets', 'error');
    } finally {
      setLoading(false);
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
  const [activeSuggestField, setActiveSuggestField] = useState<string | null>(null);

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
    parentName: '',
    parentWhatsApp: '',
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
      parentName: '',
      parentWhatsApp: '',
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
        const name = normalizeMedicineName(m.name.trim());
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
        parentName: currentEditVisit.parentName || '',
        parentWhatsApp: currentEditVisit.parentWhatsApp || '',
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
        parentName: '',
        parentWhatsApp: '',
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

  // Load master data from localStorage first dynamically for first-paint acceleration
  useEffect(() => {
    try {
      const cachedStudents = localStorage.getItem('uks_cache_students');
      if (cachedStudents) setMasterStudents(JSON.parse(cachedStudents));
      
      const cachedMedicines = localStorage.getItem('uks_cache_medicines');
      if (cachedMedicines) {
        try {
          const parsedMeds = JSON.parse(cachedMedicines);
          setMasterMedicines(sanitizeMedicines(parsedMeds));
        } catch (e) {
          console.error("Gagal parse cache obat di VisitForm:", e);
        }
      }
      
      const cachedDiagnoses = localStorage.getItem('uks_cache_diagnoses');
      if (cachedDiagnoses) setMasterDiagnoses(JSON.parse(cachedDiagnoses));
      
      const cachedTeachers = localStorage.getItem('uks_cache_teachers');
      if (cachedTeachers) setMasterTeachers(JSON.parse(cachedTeachers));
    } catch (e) {
      console.warn("Failed to read master data cache:", e);
    }
  }, []);

  // Fetch master data on mount or manual reload
  const fetchMasterData = async (forceSheetRefresh = false) => {
    setIsFetchingMaster(true);
    try {
      console.log("Membaca database master dari Firestore (Baseline) dahulu...");
      // 1. Fetch from Firestore first as reliable baseline/fallback database
      const studentSnap = await runWithRetry(() => getDocs(collection(db, 'students')));
      const firestoreStudents = studentSnap.docs.map(d => {
        const data = d.data();
        return { 
          id: d.id, 
          ...data,
          name: data.name || data.nama || 'Tanpa Nama'
        } as StudentMaster;
      }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id'));

      const medSnap = await runWithRetry(() => getDocs(collection(db, 'medicines')));
      const firestoreMedicines = medSnap.docs.map(d => {
        const data = d.data();
        return { 
          id: d.id, 
          name: data.name || data.obat || data.nama || 'Tanpa Nama',
          stock: data.stock !== undefined ? data.stock : (data.stok !== undefined ? data.stok : 100),
          unit: data.unit || 'Pcs'
        } as MasterData;
      }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id'));

      const diagSnap = await runWithRetry(() => getDocs(collection(db, 'diagnoses')));
      const firestoreDiagnoses = diagSnap.docs.map(d => {
        const data = d.data();
        return { 
          id: d.id, 
          name: data.name || data.diagnosa || data.nama || 'Tanpa Nama' 
        } as MasterData;
      }).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id'));

      const teacherSnap = await runWithRetry(() => getDocs(collection(db, 'teachers')));
      const firestoreTeachers = teacherSnap.docs.map(d => ({
        id: d.id,
        name: d.data().name || 'Tanpa Nama',
        whatsapp: d.data().whatsapp || ''
      })).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'id'));

      // Initializing state with firestore baseline
      let mergedStudents = firestoreStudents;
      let mergedMedicines = firestoreMedicines;
      let mergedDiagnoses = firestoreDiagnoses;
      let mergedTeachers = firestoreTeachers;

      // 2. Fetch from Google Sheets (uses authenticated API if token exists, public fallback otherwise)
      const token = getCachedDriveToken();
      console.log("Membaca database master dari Google Sheets (dengan token atau pembaca publik)...");
      try {
        const [sheetStudents, sheetMedicines, sheetDiagnoses, sheetTeachers] = await Promise.all([
          fetchMasterDataFromSheets(token, 'students'),
          fetchMasterDataFromSheets(token, 'medicines'),
          fetchMasterDataFromSheets(token, 'diagnoses'),
          fetchMasterDataFromSheets(token, 'teachers')
        ]);

        // Helper to merge lists, prioritizing Google Sheets but retaining unique records from Firestore
        const mergeLists = (sheetList: any[], firestoreList: any[]) => {
          const seenNames = new Set<string>();
          const merged: any[] = [];
          
          if (sheetList && sheetList.length > 0) {
            sheetList.forEach(item => {
              if (item && item.name) {
                const key = item.name.trim().toLowerCase();
                if (!seenNames.has(key)) {
                  seenNames.add(key);
                  merged.push(item);
                }
              }
            });
          }
          
          if (firestoreList && firestoreList.length > 0) {
            firestoreList.forEach(item => {
              if (item && item.name) {
                const key = item.name.trim().toLowerCase();
                if (!seenNames.has(key)) {
                  seenNames.add(key);
                  merged.push(item);
                }
              }
            });
          }
          
          return merged;
        };

        if (sheetStudents && sheetStudents.length > 0) {
          mergedStudents = mergeLists(sheetStudents, firestoreStudents);
        }
        if (sheetMedicines && sheetMedicines.length > 0) {
          mergedMedicines = mergeLists(sheetMedicines, firestoreMedicines);
        }
        if (sheetDiagnoses && sheetDiagnoses.length > 0) {
          mergedDiagnoses = mergeLists(sheetDiagnoses, firestoreDiagnoses);
        }
        if (sheetTeachers && sheetTeachers.length > 0) {
          mergedTeachers = mergeLists(sheetTeachers, firestoreTeachers);
        }

        if (forceSheetRefresh) {
          showNotification('Berhasil memperbarui database master Pasien, Obat, Diagnosa, dan Kontak Guru langsung dari Google Sheets!', 'success');
        }
      } catch (sheetErr: any) {
        console.error("Gagal membaca Google Sheets, menggunakan data local Firestore:", sheetErr);
        if (forceSheetRefresh) {
          showNotification('Gagal memuat langsung dari Google Sheets, menggunakan cache local Firestore: ' + (sheetErr.message || ''), 'warn');
        }
      }

      // 3. Save to memory and cache
      setMasterStudents(mergedStudents);
      localStorage.setItem('uks_cache_students', JSON.stringify(mergedStudents));

      const cleanMergedMedicines = sanitizeMedicines(mergedMedicines);
      setMasterMedicines(cleanMergedMedicines);
      localStorage.setItem('uks_cache_medicines', JSON.stringify(cleanMergedMedicines));

      setMasterDiagnoses(mergedDiagnoses);
      localStorage.setItem('uks_cache_diagnoses', JSON.stringify(mergedDiagnoses));

      setMasterTeachers(mergedTeachers);
      localStorage.setItem('uks_cache_teachers', JSON.stringify(mergedTeachers));

    } catch (err: any) {
      console.error("Error fetching master data:", err);
      if (forceSheetRefresh) {
        showNotification('Gagal memuat database master UKS: ' + (err.message || ''), 'error');
      }
    } finally {
      setIsFetchingMaster(false);
    }
  };

  // Fetch master data on mount or when connection status changes
  useEffect(() => {
    fetchMasterData();
  }, [driveConnected]);

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
          const newStudentRef = doc(collection(db, 'students'));
          studentId = newStudentRef.id;
          
          const studentData = {
            name: formData.studentName.trim(),
            grade: formData.grade.trim(),
            gender: formData.gender,
            age: ageNum,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };

          await Promise.race([
            setDoc(newStudentRef, studentData),
            new Promise(r => setTimeout(r, 1000))
          ]).catch(e => console.error("Slow student creation:", e));
        }
      }

      // 1b. Get or create diagnosis automatically to ensure replication across devices
      const cleanDiagnosis = formData.diagnosis.trim();
      if (cleanDiagnosis) {
        const diagFound = (masterDiagnoses || []).find(d => 
          d && d.name && d.name.toLowerCase() === cleanDiagnosis.toLowerCase()
        );
        if (!diagFound) {
          const newDiagRef = doc(collection(db, 'diagnoses'));
          await setDoc(newDiagRef, {
            name: cleanDiagnosis,
            diagnosa: cleanDiagnosis,
            createdAt: serverTimestamp()
          }).catch(e => console.error("Slow diagnosis creation:", e));
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
        parentName: formData.parentName?.trim() || '',
        parentWhatsApp: formData.parentWhatsApp?.trim() || '',
        whatsapp_status: 'pending',
        whatsapp_sent: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        authorId: auth.currentUser.uid,
        labPhoto: labPhotos[0] || '',
        labPhotos: labPhotos
      };

      // 4. Save or update document
      let visitId = '';
      if (currentEditVisit) {
        visitId = currentEditVisit.id;
        const visitRef = doc(db, currentEditVisit.path);
        const updatedVisitData: any = {
          ...visitData,
          updatedAt: serverTimestamp()
        };
        delete updatedVisitData.createdAt; // preserve original createdAt

        await Promise.race([
          updateDoc(visitRef, updatedVisitData),
          new Promise(r => setTimeout(r, 1000))
        ]).catch(e => console.error("Slow visit update:", e));
        
        console.log("Visit record updated successfully in Firestore:", currentEditVisit.path);
        showNotification('Data berhasil disimpan!', 'success');
      } else {
        const docRef = doc(collection(db, 'visits'));
        visitId = docRef.id;
        
        await Promise.race([
          setDoc(docRef, visitData),
          new Promise(r => setTimeout(r, 1000))
        ]).catch(e => console.error("Slow visit save:", e));
        
        console.log("Visit record saved successfully to root visits. Visit ID:", visitId);
        showNotification('Data berhasil disimpan!', 'success');
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
        supervisorStatus: supervisor?.whatsapp ? 'sending' : 'idle',
        parentNum: formData.parentWhatsApp || '',
        parentStatus: formData.parentWhatsApp ? 'sending' : 'idle'
      });
      
      setLoading(false);
      console.log("UI updated to success view.");

      // Automatically log medicine usage concurrently in the BACKGROUND (non-blocking for extreme raw speed)
      setTimeout(async () => {
        try {
          const activeMeds = medications.filter(m => m && m.name && m.name.trim());
          const logPromises = activeMeds.map(async (med) => {
            const nameClean = med.name.trim();
            const matchedMed = masterMedicines.find(m => m.name.toLowerCase() === nameClean.toLowerCase());
            
            let currentMedId = matchedMed ? matchedMed.id : '';
            let currentMedName = matchedMed ? matchedMed.name : nameClean;

            if (!matchedMed) {
              // Automatically register new medicine in our master database (Firestore)
              const newMedRef = doc(collection(db, 'medicines'));
              currentMedId = newMedRef.id;
              currentMedName = nameClean;
              await setDoc(newMedRef, {
                name: nameClean,
                obat: nameClean,
                stock: 100, // default initial stock
                unit: 'Pcs',
                createdAt: serverTimestamp()
              }).catch(e => console.error("Auto medicine creation failed:", e));
            }

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

            const logId = `${currentMedId}_${visitId}_OUT`;
            await setDoc(doc(db, 'medicineLogs', logId), {
              medicineId: currentMedId,
              medicineName: currentMedName,
              quantity: parsedQty,
              visitId: visitId,
              date: selectedDate.toISOString().split('T')[0], // yyyy-MM-dd
              type: 'OUT',
              createdAt: serverTimestamp()
            });
          });
          await Promise.all(logPromises);
        } catch (logErr) {
          console.error("Failed to automatically log medicine usage (background):", logErr);
        }
      }, 0);
      
      // Sistem otomatis kirim pesan WhatsApp di background secara berurutan dengan jeda waktu agar tidak bentrok di Fonnte
      (async () => {
        if (formData.parentWhatsApp) {
          console.log("Attempting background WhatsApp report to Orang Tua...");
          const success = await sendWhatsAppAsyncWithRetry(formData.parentWhatsApp, { ...formData, labUrl }, 'orang_tua', visitId, currentEditVisit?.path || `visits/${visitId}`);
          console.log("Background WhatsApp report to Orang Tua result:", success);
          setSavedData(prev => prev ? { ...prev, parentStatus: success ? 'success' : 'failed' } : null);
          if (success) showNotification('WhatsApp berhasil dikirim ke Orang Tua', 'success');
          else showNotification('Data tersimpan tetapi WhatsApp gagal dikirim ke Orang Tua', 'error');
          
          // Jeda agar tidak terjadi overload transmisi bersamaan
          await new Promise(r => setTimeout(r, 2500));
        }

        if (teacher?.whatsapp) {
          console.log("Attempting background WhatsApp report to Wali Kelas...");
          const success = await sendWhatsAppAsyncWithRetry(teacher.whatsapp, { ...formData, labUrl }, 'guru', visitId, currentEditVisit?.path || `visits/${visitId}`);
          console.log("Background WhatsApp report to Wali Kelas result:", success);
          setSavedData(prev => prev ? { ...prev, teacherStatus: success ? 'success' : 'failed' } : null);
          if (success) showNotification('WhatsApp berhasil dikirim ke Wali Kelas', 'success');
          else showNotification('Data tersimpan tetapi WhatsApp gagal dikirim ke Wali Kelas', 'error');
          
          // Jeda agar tidak terjadi overload transmisi bersamaan
          await new Promise(r => setTimeout(r, 2500));
        }

        if (supervisor?.whatsapp) {
          console.log("Attempting background WhatsApp report to Pembina...");
          const success = await sendWhatsAppAsyncWithRetry(supervisor.whatsapp, { ...formData, labUrl }, 'guru', visitId, currentEditVisit?.path || `visits/${visitId}`);
          console.log("Background WhatsApp report to Pembina result:", success);
          setSavedData(prev => prev ? { ...prev, supervisorStatus: success ? 'success' : 'failed' } : null);
          if (success) showNotification('WhatsApp berhasil dikirim ke Pembina', 'success');
          else showNotification('Data tersimpan tetapi WhatsApp gagal dikirim ke Pembina', 'error');
        }
      })();

      // Trigger automatic background backup to Google Drive silently
      triggerAutoBackup().catch(err => console.error("Error in automatic background backup:", err));

      // Trigger automatic background medicine usage synchronization to monthly Google Sheets
      (async () => {
        try {
          // Normalize and extract therapies with numerical quantities
          const activeMeds = medications
            .filter(m => m && m.name && m.name.trim())
            .map(med => {
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
              return {
                name: med.name.trim(),
                quantity: parsedQty
              };
            });

          if (activeMeds.length > 0) {
            console.log("Menjalankan syncMedicineUsageToGoogleSheets di latar belakang...", activeMeds);
            const medSuccess = await syncMedicineUsageToGoogleSheets(
              visitId,
              selectedDate.toISOString(),
              formData.studentName.trim(),
              activeMeds,
              false
            );
            if (medSuccess) {
              showNotification('Pemakaian obat harian berhasil disinkronkan ke Google Spreadsheet bulanan!', 'success');
            } else {
              console.log("Sinkronisasi harian pemakaian obat dilewati karena tautan belum dikonfigurasi.");
            }
          }
        } catch (mErr) {
          console.error("Gagal melakukan sinkronisasi pemakaian obat bulanan harian:", mErr);
        }
      })();

      // Trigger automatic background sync to Google Sheets silently with user notification
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
        parentName: formData.parentName?.trim() || '',
        parentWhatsApp: formData.parentWhatsApp?.trim() || '',
        labUrl: labUrl
      }, !!currentEditVisit)
      .then((success) => {
        if (success) {
          showNotification('Data kunjungan berhasil disinkronkan ke Google Sheets!', 'success');
        } else {
          const t = getCachedDriveToken();
          if (!t) {
            showNotification('Google Sheets tidak tersinkronisasi: Google akun belum terhubung.', 'warn');
          } else {
            showNotification('Sinkronisasi Google Sheets gagal. Pastikan izin spreadsheet harian valid atau coba sambungkan ulang Google Drive.', 'error');
          }
        }
      })
      .catch((err) => {
        console.error("Error in automatic background sheets synchronization:", err);
        showNotification('Sistem gagal memproses sinkronisasi Google Sheets.', 'error');
      });
    } catch (err: any) {
      console.error("Critical error in handleSubmit:", err);
      setError('Gagal memproses data: ' + (err.message || 'Error tidak dikenal'));
      handleFirestoreError(err, OperationType.WRITE, 'visits_subcollection');
      setLoading(false);
    }
  };

  const sendWhatsAppAsyncWithRetry = async (number: any, data: any, type: 'orang_tua' | 'guru', visitId: string, currentPath: string) => {
    try {
      if (!number) return false;
      const numStr = String(number);
      const cleanNumber = numStr.replace(/\D/g, '');
      const formattedNumber = cleanNumber.startsWith('0') ? '62' + cleanNumber.slice(1) : (cleanNumber.startsWith('62') ? cleanNumber : '62' + cleanNumber);
      
      const reportDate = safeFormatDate(data.date, 'dd MMMM yyyy');
      const authorName = auth.currentUser?.displayName || auth.currentUser?.email || 'Admin';
      
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

      let success = false;
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[WA] Mengirim ke ${formattedNumber} (${type}) - Percobaan ${attempt}/3`);
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
            throw new Error(`HTTP Error: ${response.status}`);
          }
          
          const result = await response.json();
          if (result && result.status !== false) {
            success = true;
            console.log(`[WA] Berhasil terkirim ke ${formattedNumber}`);
            break;
          } else {
            console.warn(`[WA] Gagal (API Fonnte): ${result?.detail || result?.reason || 'Unknown'}`);
          }
        } catch (err: any) {
           console.error(`[WA] Error fetch: ${err.message}`);
        }
        
        if (!success && attempt < 3) {
           // delay 3 seconds instead of 30 seconds to prevent huge stalls!
           await new Promise(r => setTimeout(r, 3000));
        }
      }

      // Update Firestore independently in background
      if (visitId) {
        try {
          const visitRef = doc(db, currentPath);
          await updateDoc(visitRef, {
            whatsapp_sent: success,
            whatsapp_status: success ? 'success' : 'failed',
            whatsapp_sent_at: serverTimestamp()
          });
        } catch (dbErr) {
          console.error("Gagal update status WA di Firestore", dbErr);
        }
      }

      return success;
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
          {masterTeachers.map((t, idx) => <option key={`t-${idx}`} value={t.name} />)}
        </datalist>
      </div>

      <div className="max-w-6xl mx-auto py-6 px-4">
        {notification && (
          <div className={cn(
            "mb-4 px-4 py-3 rounded-xl border flex items-center gap-3 text-sm font-bold shadow-md animate-in fade-in slide-in-from-top-4",
            notification.type === 'success' ? "bg-emerald-50 border-emerald-200 text-emerald-800" :
            notification.type === 'warn' ? "bg-amber-50 border-amber-200 text-amber-800" :
            "bg-rose-50 border-rose-200 text-rose-800"
          )}>
            {notification.type === 'success' ? <Check className="w-5 h-5 text-emerald-500" /> : <AlertCircle className="w-5 h-5 flex-shrink-0" />}
            {notification.message}
          </div>
        )}

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
            
            {savedData.parentNum && savedData.parentStatus !== 'idle' && (
              <div className={cn(
                "px-6 py-3.5 text-xs flex flex-col md:flex-row md:items-center justify-between gap-3 border-t border-cyan-500/20 text-white font-medium",
                savedData.parentStatus === 'success' ? "bg-cyan-800/80" : 
                savedData.parentStatus === 'failed' ? "bg-rose-950/70" : "bg-cyan-900/60"
              )}>
                <div className="flex items-start md:items-center gap-2.5">
                  {savedData.parentStatus === 'sending' ? (
                    <Loader2 className="w-4 h-4 animate-spin text-cyan-200 shrink-0 mt-0.5" />
                  ) : savedData.parentStatus === 'success' ? (
                    <Check className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
                  )}
                  <span className="leading-relaxed text-[11px] font-black uppercase tracking-wider">
                    {savedData.parentStatus === 'sending' && `Sedang mengirim laporan WhatsApp otomatis ke Orang Tua (${savedData.parentNum})...`}
                    {savedData.parentStatus === 'success' && `Laporan WhatsApp Terkirim Otomatis ke Orang Tua (${savedData.parentNum})!`}
                    {savedData.parentStatus === 'failed' && `Gagal mengirim WhatsApp otomatis ke Orang Tua (${savedData.parentNum})`}
                  </span>
                </div>
                {savedData.parentStatus === 'failed' && (
                  <a
                    href={getWhatsAppManualUrl(savedData.parentNum, savedData.data)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all hover:scale-[1.02] active:scale-95 shadow-md flex items-center gap-1.5 cursor-pointer decoration-none self-start md:self-center"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Kirim Manual (WA Web)
                  </a>
                )}
              </div>
            )}

            {savedData.teacherNum && savedData.teacherStatus !== 'idle' && (
              <div className={cn(
                "px-6 py-3.5 text-xs flex flex-col md:flex-row md:items-center justify-between gap-3 border-t border-cyan-500/20 text-white font-medium",
                savedData.teacherStatus === 'success' ? "bg-cyan-800/80" : 
                savedData.teacherStatus === 'failed' ? "bg-rose-950/70" : "bg-cyan-900/60"
              )}>
                <div className="flex items-start md:items-center gap-2.5">
                  {savedData.teacherStatus === 'sending' ? (
                    <Loader2 className="w-4 h-4 animate-spin text-cyan-200 shrink-0 mt-0.5" />
                  ) : savedData.teacherStatus === 'success' ? (
                    <Check className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
                  )}
                  <span className="leading-relaxed text-[11px] font-black uppercase tracking-wider">
                    {savedData.teacherStatus === 'sending' && `Sedang mengirim laporan WhatsApp otomatis ke Wali Kelas (${savedData.teacherNum})...`}
                    {savedData.teacherStatus === 'success' && `Laporan WhatsApp Terkirim Otomatis ke Wali Kelas (${savedData.teacherNum})!`}
                    {savedData.teacherStatus === 'failed' && `Gagal mengirim WhatsApp otomatis ke Wali Kelas (${savedData.teacherNum})`}
                  </span>
                </div>
                {savedData.teacherStatus === 'failed' && (
                  <a
                    href={getWhatsAppManualUrl(savedData.teacherNum, savedData.data)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all hover:scale-[1.02] active:scale-95 shadow-md flex items-center gap-1.5 cursor-pointer decoration-none self-start md:self-center"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Kirim Manual (WA Web)
                  </a>
                )}
              </div>
            )}

            {savedData.supervisorNum && savedData.supervisorStatus !== 'idle' && (
              <div className={cn(
                "px-6 py-3.5 text-xs flex flex-col md:flex-row md:items-center justify-between gap-3 border-t border-cyan-500/20 text-white font-medium",
                savedData.supervisorStatus === 'success' ? "bg-cyan-800/80" : 
                savedData.supervisorStatus === 'failed' ? "bg-rose-950/70" : "bg-cyan-900/60"
              )}>
                <div className="flex items-start md:items-center gap-2.5">
                  {savedData.supervisorStatus === 'sending' ? (
                    <Loader2 className="w-4 h-4 animate-spin text-cyan-200 shrink-0 mt-0.5" />
                  ) : savedData.supervisorStatus === 'success' ? (
                    <Check className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
                  )}
                  <span className="leading-relaxed text-[11px] font-black uppercase tracking-wider">
                    {savedData.supervisorStatus === 'sending' && `Sedang mengirim laporan WhatsApp otomatis ke Pembina (${savedData.supervisorNum})...`}
                    {savedData.supervisorStatus === 'success' && `Laporan WhatsApp Terkirim Otomatis ke Pembina (${savedData.supervisorNum})!`}
                    {savedData.supervisorStatus === 'failed' && `Gagal mengirim WhatsApp otomatis ke Pembina (${savedData.supervisorNum})`}
                  </span>
                </div>
                {savedData.supervisorStatus === 'failed' && (
                  <a
                    href={getWhatsAppManualUrl(savedData.supervisorNum, savedData.data)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all hover:scale-[1.02] active:scale-95 shadow-md flex items-center gap-1.5 cursor-pointer decoration-none self-start md:self-center"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Kirim Manual (WA Web)
                  </a>
                )}
              </div>
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

              {/* Google Sheets Sync Integration Status Banner */}
              <div className={cn(
                "p-4 rounded-xl border text-[10px] font-semibold uppercase flex flex-col gap-3.5 shadow-sm transition-all text-slate-800",
                driveConnected 
                  ? "bg-slate-50 border-slate-200" 
                  : "bg-amber-50/50 border-amber-100/80"
              )}>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-dashed border-slate-200 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className={cn(
                        "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                        driveConnected ? "bg-emerald-400" : "bg-amber-400"
                      )}></span>
                      <span className={cn(
                        "relative inline-flex rounded-full h-2 w-2",
                        driveConnected ? "bg-emerald-600" : "bg-amber-600"
                      )}></span>
                    </span>
                    <div>
                      <span className="font-extrabold text-slate-900">INTEGRASI GOOGLE SPREADSHEET: </span>  
                      {driveConnected ? (
                        <span className="text-emerald-700 font-bold">TERKONEKSI AKTIF</span>
                      ) : (
                        <div className="inline-block">
                          <span className="text-amber-700 font-bold">BELUM TERHUBUNG</span>
                          <span className="block text-[8px] text-slate-505 normal-case font-semibold text-amber-600 mt-1">
                            *Untuk keamanan, otorisasi Google tersimpan lokal per browser. Silakan hubungkan Google Drive sekali saja di laptop baru ini agar sinkronisasi dan manajemen data berjalan mulus.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  {!driveConnected ? (
                    <button
                      type="button"
                      onClick={handleConnectGoogle}
                      className="bg-amber-600 hover:bg-amber-700 text-white text-[9px] font-black tracking-wide uppercase px-3 py-1.5 rounded-lg hover:shadow-xs transition-all self-start md:self-center cursor-pointer whitespace-nowrap border-none"
                    >
                      Hubungkan Akun Google UKS
                    </button>
                  ) : (
                    <span className="text-[9px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-black">Google API Aktif</span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Target 1 - Laporan harian */}
                  <div className="space-y-1 bg-white p-2.5 rounded-lg border border-slate-200/50">
                    <p className="font-black text-slate-900 tracking-wider text-[9px] flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                      Hasil Pemeriksaan Baru
                    </p>
                    <p className="text-[9px] text-slate-500 normal-case">
                      Otomatis diunggah & disinkronkan ke spreadsheet harian:
                    </p>
                    <a 
                      href="https://docs.google.com/spreadsheets/d/17EEP1c0klbntmLxVsjYGElkEqLejLncqvnDNoqsfZsc/edit" 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-cyan-600 font-bold hover:underline break-all uppercase text-[8px] inline-block mt-1"
                    >
                      Buka Sheet Laporan Pemeriksaan ➜
                    </a>
                  </div>

                  {/* Target 2 - Database Master */}
                  <div className="space-y-1 bg-white p-2.5 rounded-lg border border-slate-200/50 flex flex-col justify-between">
                    <div>
                      <p className="font-black text-slate-900 tracking-wider text-[9px] flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-violet-500 rounded-full"></span>
                        Data Master (Siswa, Obat, Diagnosa)
                      </p>
                      <p className="text-[9px] text-slate-500 normal-case mb-1">
                        Dibaca otomatis dari spreadsheet master harian ({masterStudents.length} siswa, {masterMedicines.length} obat, {masterDiagnoses.length} diagnosa):
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-1 pt-1.5 border-t border-slate-100">
                      <a 
                        href="https://docs.google.com/spreadsheets/d/1ucDQBJmJwcWnawmWIuQXTZXBlm4sMA0XKxWzBlA5Fv8/edit" 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-violet-600 font-bold hover:underline uppercase text-[8px]"
                      >
                        Buka Sheet Master ➜
                      </a>
                      {driveConnected && (
                        <button
                          type="button"
                          disabled={isFetchingMaster}
                          onClick={() => fetchMasterData(true)}
                          className="bg-slate-100 hover:bg-slate-200 disabled:bg-slate-100 text-slate-700 text-[8px] font-black uppercase px-2 py-1 rounded transition-all flex items-center gap-1 cursor-pointer border-none"
                        >
                          {isFetchingMaster ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-2.5 h-2.5 text-slate-500" />
                          )}
                          Muat Ulang
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

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
                      value={formData.studentName}
                      onChange={(e) => handleStudentNameChange(e.target.value)}
                      onFocus={() => setActiveSuggestField('studentName')}
                      onBlur={() => setTimeout(() => setActiveSuggestField(null), 350)}
                      className="input-dense pl-9"
                      placeholder="Cari Nama Pasien..."
                    />
                    {activeSuggestField === 'studentName' && (
                      <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto z-50 divide-y divide-slate-100">
                        {masterStudents
                          .filter(s => s && s.name && s.name.toLowerCase().includes((formData.studentName || '').trim().toLowerCase()))
                          .slice(0, 10).length > 0 ? (
                            masterStudents
                              .filter(s => s && s.name && s.name.toLowerCase().includes((formData.studentName || '').trim().toLowerCase()))
                              .slice(0, 10)
                              .map((s, idx) => (
                                <div
                                  key={`student-suggest-${idx}`}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    handleStudentNameChange(s.name);
                                    setActiveSuggestField(null);
                                  }}
                                  onTouchStart={(e) => {
                                    e.preventDefault();
                                    handleStudentNameChange(s.name);
                                    setActiveSuggestField(null);
                                  }}
                                  className="px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-cyan-50 cursor-pointer active:bg-cyan-100 flex justify-between items-center"
                                >
                                  <div>
                                    <p className="font-bold text-slate-950">{s.name}</p>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase">{s.grade || 'Tidak ada kelas'} • {s.gender}</p>
                                  </div>
                                  <span className="text-[9px] bg-cyan-100 text-cyan-800 px-2 py-1 rounded font-black uppercase tracking-wider shrink-0 select-none">PILIH</span>
                                </div>
                              ))
                          ) : (
                            <div className="px-4 py-3 text-[10px] text-slate-500 italic bg-slate-50">Nama "{formData.studentName}" baru (bebas diinput manual)</div>
                          )}
                      </div>
                    )}
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
                    placeholder="Masukkan Kelas"
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
                      autoComplete="off"
                      value={formData.diagnosis}
                      onChange={(e) => setFormData({ ...formData, diagnosis: e.target.value })}
                      onFocus={() => setActiveSuggestField('diagnosis')}
                      onBlur={() => setTimeout(() => setActiveSuggestField(null), 350)}
                      className="input-dense pl-9"
                      placeholder="Cari Diagnosa dari Database..."
                    />
                    {activeSuggestField === 'diagnosis' && (
                      <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto z-50 divide-y divide-slate-100">
                        {masterDiagnoses
                          .filter(d => d && d.name && d.name.toLowerCase().includes((formData.diagnosis || '').trim().toLowerCase()))
                          .slice(0, 10).length > 0 ? (
                            masterDiagnoses
                              .filter(d => d && d.name && d.name.toLowerCase().includes((formData.diagnosis || '').trim().toLowerCase()))
                              .slice(0, 10)
                              .map((d, idx) => (
                                <div
                                  key={`diagnosis-suggest-${idx}`}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    setFormData(prev => ({ ...prev, diagnosis: d.name }));
                                    setActiveSuggestField(null);
                                  }}
                                  onTouchStart={(e) => {
                                    e.preventDefault();
                                    setFormData(prev => ({ ...prev, diagnosis: d.name }));
                                    setActiveSuggestField(null);
                                  }}
                                  className="px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-cyan-50 cursor-pointer active:bg-cyan-100 flex justify-between items-center"
                                >
                                  <span className="font-bold text-slate-900">{d.name}</span>
                                  <span className="text-[9px] bg-cyan-100 text-cyan-800 px-2 py-1 rounded font-black uppercase tracking-wider shrink-0 select-none">PILIH</span>
                                </div>
                              ))
                          ) : (
                            <div className="px-4 py-3 text-[10px] text-slate-500 italic bg-slate-50">Diagnosa "{formData.diagnosis}" baru (bebas diinput manual)</div>
                          )}
                      </div>
                    )}
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
                            autoComplete="off"
                            value={med.name}
                            onChange={(e) => {
                              const val = e.target.value;
                              const updated = [...medications];
                              updated[index].name = val;
                              setMedications(updated);
                            }}
                            onFocus={() => {
                              setFocusedMedIndex(index);
                              setActiveSuggestField(`medication-${index}`);
                            }}
                            onClick={() => {
                              setFocusedMedIndex(index);
                              setActiveSuggestField(`medication-${index}`);
                            }}
                            onBlur={() => setTimeout(() => setActiveSuggestField(null), 350)}
                            className="input-dense pl-3 bg-white"
                            placeholder={`Pilih atau ketik nama obat ke-${index + 1}...`}
                          />
                          {activeSuggestField === `medication-${index}` && (
                            <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto z-50 divide-y divide-slate-100">
                              {(masterMedicines || [])
                                .filter(m => {
                                  if (!m || !m.name) return false;
                                  const search = (med.name || '').trim().toLowerCase();
                                  if (!search) return true;
                                  return m.name.toLowerCase().includes(search);
                                })
                                .slice(0, 15).length > 0 ? (
                                  (masterMedicines || [])
                                    .filter(m => {
                                      if (!m || !m.name) return false;
                                      const search = (med.name || '').trim().toLowerCase();
                                      if (!search) return true;
                                      return m.name.toLowerCase().includes(search);
                                    })
                                    .slice(0, 15)
                                    .map((m, idx) => (
                                      <div
                                        key={`med-suggest-${idx}`}
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          const updated = [...medications];
                                          updated[index].name = m.name;
                                          setMedications(updated);
                                          setActiveSuggestField(null);
                                        }}
                                        onTouchStart={(e) => {
                                          e.preventDefault();
                                          const updated = [...medications];
                                          updated[index].name = m.name;
                                          setMedications(updated);
                                          setActiveSuggestField(null);
                                        }}
                                        className="px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer active:bg-slate-100 flex justify-between items-center"
                                      >
                                        <div>
                                          <p className="font-bold text-slate-950">{m.name}</p>
                                          <p className="text-[10px] text-slate-500 font-bold uppercase">Stok: {m.stock} {m.unit || 'Pcs'}</p>
                                        </div>
                                        <span className="text-[9px] bg-indigo-100 text-indigo-850 px-2 py-1 rounded font-black uppercase tracking-wider shrink-0 select-none">PILIH</span>
                                      </div>
                                    ))
                                ) : (
                                  <div className="px-4 py-3 text-[10px] text-slate-500 italic bg-slate-50">Obat "{med.name || ''}" baru (bebas diinput manual)</div>
                                )}
                            </div>
                          )}
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
                    <div className="space-y-1 relative">
                      <label htmlFor="supervisorName" className="text-[10px] font-bold text-slate-600 uppercase flex justify-between">
                        <span>Pembina</span>
                      </label>
                      <input
                        id="supervisorName"
                        type="text"
                        autoComplete="off"
                        value={formData.supervisorName || ''}
                        onChange={(e) => setFormData({ ...formData, supervisorName: e.target.value })}
                        onFocus={() => setActiveSuggestField('supervisorName')}
                        onBlur={() => setTimeout(() => setActiveSuggestField(null), 350)}
                        className="input-dense"
                        placeholder="Nama Pembina..."
                      />
                      {activeSuggestField === 'supervisorName' && (
                        <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto z-50 divide-y divide-slate-100 animate-in fade-in slide-in-from-top-1 duration-150">
                          {masterTeachers
                            .filter(t => t && t.name && t.name.toLowerCase().includes((formData.supervisorName || '').trim().toLowerCase()))
                            .slice(0, 100).length > 0 ? (
                              masterTeachers
                                .filter(t => t && t.name && t.name.toLowerCase().includes((formData.supervisorName || '').trim().toLowerCase()))
                                .slice(0, 100)
                                .map((t, idx) => (
                                  <div
                                    key={`supervisor-suggest-${idx}`}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      setFormData(prev => ({ ...prev, supervisorName: t.name }));
                                      setActiveSuggestField(null);
                                    }}
                                    onTouchStart={(e) => {
                                      e.preventDefault();
                                      setFormData(prev => ({ ...prev, supervisorName: t.name }));
                                      setActiveSuggestField(null);
                                    }}
                                    className="px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-cyan-50 cursor-pointer active:bg-cyan-100 flex justify-between items-center"
                                  >
                                    <div>
                                      <p className="font-bold text-slate-950">{t.name}</p>
                                      <p className="text-[10px] text-slate-500 font-bold uppercase">{t.role || 'Guru/Staf'} • {t.whatsapp}</p>
                                    </div>
                                    <span className="text-[9px] bg-cyan-100 text-cyan-800 px-2 py-1 rounded font-black uppercase tracking-wider shrink-0 select-none">PILIH</span>
                                  </div>
                                ))
                            ) : (
                              <div className="px-4 py-3 text-[10px] text-slate-500 italic bg-slate-50">Nama Pembina "{formData.supervisorName}" baru</div>
                            )}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1 relative">
                      <label htmlFor="teacherName" className="text-[10px] font-bold text-slate-600 uppercase flex justify-between">
                        <span>Wali Kelas</span>
                      </label>
                      <input
                        id="teacherName"
                        type="text"
                        autoComplete="off"
                        value={formData.teacherName}
                        onChange={(e) => setFormData({ ...formData, teacherName: e.target.value })}
                        onFocus={() => setActiveSuggestField('teacherName')}
                        onBlur={() => setTimeout(() => setActiveSuggestField(null), 350)}
                        className="input-dense"
                        placeholder="Nama Wali Kelas..."
                      />
                      {activeSuggestField === 'teacherName' && (
                        <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto z-50 divide-y divide-slate-100 animate-in fade-in slide-in-from-top-1 duration-150">
                          {masterTeachers
                            .filter(t => t && t.name && t.name.toLowerCase().includes((formData.teacherName || '').trim().toLowerCase()))
                            .slice(0, 100).length > 0 ? (
                              masterTeachers
                                .filter(t => t && t.name && t.name.toLowerCase().includes((formData.teacherName || '').trim().toLowerCase()))
                                .slice(0, 100)
                                .map((t, idx) => (
                                  <div
                                    key={`teacher-suggest-${idx}`}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      setFormData(prev => ({ ...prev, teacherName: t.name }));
                                      setActiveSuggestField(null);
                                    }}
                                    onTouchStart={(e) => {
                                      e.preventDefault();
                                      setFormData(prev => ({ ...prev, teacherName: t.name }));
                                      setActiveSuggestField(null);
                                    }}
                                    className="px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-cyan-50 cursor-pointer active:bg-cyan-100 flex justify-between items-center"
                                  >
                                    <div>
                                      <p className="font-bold text-slate-950">{t.name}</p>
                                      <p className="text-[10px] text-slate-500 font-bold uppercase">{t.role || 'Guru/Staf'} • {t.whatsapp}</p>
                                    </div>
                                    <span className="text-[9px] bg-cyan-100 text-cyan-800 px-2 py-1 rounded font-black uppercase tracking-wider shrink-0 select-none">PILIH</span>
                                  </div>
                                ))
                            ) : (
                              <div className="px-4 py-3 text-[10px] text-slate-500 italic bg-slate-50">Nama Wali Kelas "{formData.teacherName}" baru</div>
                            )}
                        </div>
                      )}
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
                            sendWhatsAppAsyncWithRetry(supervisor.whatsapp, formData, 'guru', '', '').then(success => {
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
                            sendWhatsAppAsyncWithRetry(teacher.whatsapp, formData, 'guru', '', '').then(success => {
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

