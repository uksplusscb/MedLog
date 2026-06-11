import React, { useEffect, useState } from 'react';
import { 
  collection, 
  getDocs, 
  setDoc,
  doc, 
  deleteDoc,
  serverTimestamp,
  onSnapshot,
  collectionGroup,
  query,
  where,
  orderBy
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Medicine, MedicineMonthlyData, MedicineLog, Visit } from '../types';
import { cn, normalizeMedicineName } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  Minus, 
  Search, 
  Package, 
  Save, 
  Loader2, 
  FileSpreadsheet, 
  Download, 
  Printer, 
  Calendar, 
  Coins, 
  Inbox, 
  Layers, 
  HelpCircle,
  FileCheck2,
  Trash2,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  ClipboardList,
  Edit,
  Database,
  RefreshCw
} from 'lucide-react';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as ExcelJS from 'exceljs';
import { getCachedDriveToken } from '../lib/drive';
import { fetchMasterDataFromSheets } from '../lib/sheets';

// Helper to determine medicine type (jenis)
const getJenisObat = (name?: string, unit?: string) => {
  const n = (name || '').toLowerCase();
  const u = (unit || '').toLowerCase();
  if (n.includes('paracetamol') || n.includes('bodrex') || n.includes('pct') || n.includes('panadol') || n.includes('biogesic') || n.includes('sakit kepala')) {
    return 'Analgesik / Antipiretik';
  }
  if (n.includes('amoxicillin') || n.includes('ampicillin') || n.includes('antibiotik')) {
    return 'Antibiotik';
  }
  if (n.includes('promag') || n.includes('antasida') || n.includes('maag') || n.includes('mylanta')) {
    return 'Antasid / Lambung';
  }
  if (n.includes('ctm') || n.includes('alerg') || n.includes('antihistamin')) {
    return 'Antihistamin';
  }
  if (n.includes('salep') || n.includes('betadine') || n.includes('bioplacenton') || n.includes('cream')) {
    return 'Obat Luar / Salep';
  }
  if (n.includes('alkohol') || n.includes('kasa') || n.includes('plester') || n.includes('kapas') || n.includes('perban') || n.includes('masker')) {
    return 'Alat Kesehatan (Alkes)';
  }
  if (u === 'tablet') return 'Tablet / Pil';
  if (u === 'kapsul') return 'Kapsul';
  if (u === 'botol') return 'Sirup / Cairan';
  if (u === 'salep') return 'Salep kulit';
  if (u === 'sachet') return 'Puyer / Sachet';
  if (u === 'plester') return 'Plester luka';
  return 'Obat / Logistik';
};

export default function MedicineReports() {
  const [activeSubmenu, setActiveSubmenu] = useState<'data-obat' | 'pemakaian-harian' | 'laporan-bulanan'>('data-obat');
  const [firestoreMedicines, setFirestoreMedicines] = useState<Medicine[]>([]);
  const [sheetMedicines, setSheetMedicines] = useState<Medicine[]>(() => {
    try {
      const cached = localStorage.getItem('uks_cache_medicines');
      if (cached) {
        const parsed = JSON.parse(cached) as Medicine[];
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  const medicines = React.useMemo(() => {
    const seenNames = new Set<string>();
    const merged: Medicine[] = [];
    
    if (sheetMedicines && sheetMedicines.length > 0) {
      sheetMedicines.forEach(item => {
        if (item && item.name) {
          const normName = normalizeMedicineName(item.name);
          const key = normName.toLowerCase();
          if (!seenNames.has(key)) {
            seenNames.add(key);
            merged.push({ ...item, name: normName });
          }
        }
      });
    }
    
    if (firestoreMedicines && firestoreMedicines.length > 0) {
      firestoreMedicines.forEach(item => {
        if (item && item.name) {
          const normName = normalizeMedicineName(item.name);
          const key = normName.toLowerCase();
          if (!seenNames.has(key)) {
            seenNames.add(key);
            merged.push({ ...item, name: normName });
          }
        }
      });
    }
    
    merged.sort((a, b) => a.name.localeCompare(b.name));
    return merged;
  }, [sheetMedicines, firestoreMedicines]);

  const [loadingMedsSync, setLoadingMedsSync] = useState(false);

  const fetchMedsFromSheets = async () => {
    const token = getCachedDriveToken();
    if (!token) {
      alert("Integrasi Google Spreadsheet belum terhubung. Silakan hubungkan terlebih dahulu di modul Formulir Utama atau Database Master.");
      return;
    }
    setLoadingMedsSync(true);
    try {
      const sheetMeds = await fetchMasterDataFromSheets(token, 'medicines');
      if (sheetMeds && sheetMeds.length > 0) {
        setSheetMedicines(sheetMeds);
        localStorage.setItem('uks_cache_medicines', JSON.stringify(sheetMeds));
        alert(`Berhasil menarik ${sheetMeds.length} data obat dari Google Sheets (Sheet 2 obat)!`);
      } else {
        alert("Tidak ada data obat yang ditemukan di Google Sheets Anda. Pastikan sheet bernama 'obat' (Sheet 2).");
      }
    } catch (err: any) {
      console.error(err);
      alert("Gagal menyinkronkan data obat dari Google Sheets: " + (err.message || String(err)));
    } finally {
      setLoadingMedsSync(false);
    }
  };

  // Fetch medicines from sheets unconditionally (authenticated if token exists, public fallback otherwise)
  useEffect(() => {
    const token = getCachedDriveToken();
    fetchMasterDataFromSheets(token, 'medicines')
      .then((sheetMeds) => {
        if (sheetMeds && sheetMeds.length > 0) {
          setSheetMedicines(sheetMeds);
          localStorage.setItem('uks_cache_medicines', JSON.stringify(sheetMeds));
        }
      })
      .catch(err => {
        console.error("Gagal mendapatkan master data obat langsung dari Google Sheets:", err);
      });
  }, []);

  const [monthlyData, setMonthlyData] = useState<MedicineMonthlyData[]>([]);
  const [logs, setLogs] = useState<MedicineLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter & selections
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    return `${today.getFullYear()}-${mm}`;
  });

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [monthVisits, setMonthVisits] = useState<Visit[]>([]);

  // Fetch all historical and current visits for the selected month to extract medicine usage
  useEffect(() => {
    if (!selectedMonth) return;
    
    let active = true;
    const fetchVisitsForMonth = async () => {
      try {
        const year = Number(selectedMonth.split('-')[0]);
        const month = Number(selectedMonth.split('-')[1]);
        
        // Get the first and last day of the month precisely
        const lastDayOfPrevMonth = new Date(year, month, 0);
        const lastDayNum = lastDayOfPrevMonth.getDate();

        const startStr = `${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`;
        const endStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}T23:59:59.999Z`;

        const q = query(
          collection(db, 'visits'),
          where('date', '>=', startStr),
          where('date', '<=', endStr),
          orderBy('date', 'asc')
        );

        const snap = await getDocs(q);
        if (active) {
          const fetchedVisits = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Visit));
          setMonthVisits(fetchedVisits);
        }
      } catch (err) {
        console.error("Error fetching monthly visits for therapy calculation:", err);
      }
    };

    fetchVisitsForMonth();
    return () => {
      active = false;
    };
  }, [selectedMonth]);

  // Therapy string parser helper
  const parseTherapy = (therapyStr: string) => {
    if (!therapyStr) {
      return [];
    }
    const parts = therapyStr.split(/,(?![^(]*\))/);
    return parts.map(part => {
      let name = part.trim();
      let qty = '';
      const matches = name.match(/^(.*?)\((.*?)\)$/);
      if (matches) {
        name = matches[1].trim();
        qty = matches[2].trim();
      }
      name = normalizeMedicineName(name);
      return { name, qty };
    }).filter(item => item.name && item.name.trim() !== '');
  };

  // Extract amount from medicine log quantity
  const getParsedQty = (qtyStr: string): number => {
    let parsedQty = 1;
    const matchFirstNum = qtyStr.match(/^\d+/);
    if (matchFirstNum) {
      parsedQty = parseInt(matchFirstNum[0]);
    } else {
      const anyNum = qtyStr.match(/\d+/);
      if (anyNum) {
        parsedQty = parseInt(anyNum[0]);
      }
    }
    if (isNaN(parsedQty) || parsedQty <= 0) {
      parsedQty = 1;
    }
    return parsedQty;
  };

  // Helper to calculate total dispensed in examinations for a given medicine on a given date
  const getPemeriksaanQtyForDate = (medName: string, dateStr: string) => {
    const dayVisits = monthVisits.filter(v => {
      if (!v.date) return false;
      const vDateOnly = v.date.split('T')[0];
      return vDateOnly === dateStr;
    });

    let sum = 0;
    dayVisits.forEach(v => {
      const parsedMeds = parseTherapy(v.therapy || '');
      parsedMeds.forEach(pm => {
        if (pm.name.toLowerCase() === medName.toLowerCase()) {
          const qtyNum = getParsedQty(pm.qty);
          sum += qtyNum;
        }
      });
    });
    return sum;
  };

  // Year & Month parsing helper
  const parsedYear = Number(selectedMonth.split('-')[0]);
  const parsedMonth = Number(selectedMonth.split('-')[1]);

  // Loading all source data from Firestore
  useEffect(() => {
    setLoading(true);
    
    // Subscribe to medicines
    const unsubMedicines = onSnapshot(collection(db, 'medicines'), (snapshot) => {
      const meds = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name || data.obat || data.nama || 'Tanpa Nama',
          stock: data.stock !== undefined ? data.stock : (data.stok !== undefined ? data.stok : 0),
          unit: data.unit || 'Pcs',
          price: data.price || 0
        } as Medicine;
      });
      setFirestoreMedicines(meds);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'medicines');
      setLoading(false);
    });

    // Subscribe to monthly data
    const unsubMonthly = onSnapshot(collection(db, 'medicineMonthlyData'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MedicineMonthlyData));
      setMonthlyData(data);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'medicineMonthlyData');
      setLoading(false);
    });

    // Subscribe to medicine usage/received logs
    const unsubLogs = onSnapshot(collection(db, 'medicineLogs'), (snapshot) => {
      const logItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MedicineLog));
      setLogs(logItems);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'medicineLogs');
      setLoading(false);
    });

    return () => {
      unsubMedicines();
      unsubMonthly();
      unsubLogs();
    };
  }, []);

  // --- SUBMENU 1: DATA OBAT CONTROLLER ---
  const daysInMonth = 31; // static 1 to 31 columns as specified
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const [editForms, setEditForms] = useState<Record<string, { price: string; initialStock: string; received: string }>>({});
  const [incomingInputs, setIncomingInputs] = useState<Record<string, Record<number, string>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  // Initialize editing state when medicines or month changes
  useEffect(() => {
    const initialForms: typeof editForms = {};
    medicines.forEach(med => {
      const matchingFirestoreMed = firestoreMedicines.find(fm => fm.name && med.name && fm.name.trim().toLowerCase() === med.name.trim().toLowerCase());
      const lookUpId = matchingFirestoreMed?.id || med.id;
      const mData = monthlyData.find(d => (d.medicineId === lookUpId || d.medicineId === med.id) && d.year === parsedYear && d.month === parsedMonth);
      initialForms[med.id!] = {
        price: String(mData?.price ?? med.price ?? 0),
        initialStock: String(mData?.initialStock ?? 0),
        received: String(mData?.received ?? 0)
      };
    });
    setEditForms(initialForms);
  }, [medicines, firestoreMedicines, monthlyData, selectedMonth]);

  // Synchronize incoming inputs (IN logs) when medicines, logs, or selectedMonth changes
  useEffect(() => {
    const inputs: Record<string, Record<number, string>> = {};
    medicines.forEach(med => {
      const matchingFirestoreMed = firestoreMedicines.find(fm => fm.name && med.name && fm.name.trim().toLowerCase() === med.name.trim().toLowerCase());
      const lookUpId = matchingFirestoreMed?.id || med.id;
      inputs[med.id!] = {};
      daysArray.forEach(day => {
        const dayStr = `${selectedMonth}-${String(day).padStart(2, '0')}`;
        const match = logs.find(l => 
          (l.medicineId === lookUpId || l.medicineId === med.id || (l.medicineName && l.medicineName.trim().toLowerCase() === med.name.trim().toLowerCase())) && 
          l.date === dayStr && 
          l.type === 'IN'
        );
        inputs[med.id!][day] = match ? String(match.quantity) : '';
      });
    });
    setIncomingInputs(inputs);
  }, [medicines, firestoreMedicines, logs, selectedMonth]);

  const handleIncomingInputChange = (medId: string, day: number, val: string) => {
    setIncomingInputs(prev => ({
      ...prev,
      [medId]: {
        ...prev[medId],
        [day]: val
      }
    }));
  };

  const handleFieldChange = (medicineId: string, field: 'price' | 'initialStock' | 'received', value: string) => {
    setEditForms(prev => ({
      ...prev,
      [medicineId]: {
        ...prev[medicineId],
        [field]: value
      }
    }));
  };

  const handleSaveMonthlyData = async (med: Medicine) => {
    const fields = editForms[med.id!];
    if (!fields) return;

    setSavingId(med.id!);
    try {
      const matchingFirestoreMed = firestoreMedicines.find(fm => fm.name && med.name && fm.name.trim().toLowerCase() === med.name.trim().toLowerCase());
      const targetMedId = matchingFirestoreMed?.id || med.id!;

      // Calculate total incoming from daily inputs and save each non-empty day to medicineLogs
      let totalIncoming = 0;
      const medIncoming = incomingInputs[med.id!] || {};

      for (const day of daysArray) {
        const valueStr = medIncoming[day] || '';
        const qty = parseInt(valueStr) || 0;
        totalIncoming += qty;

        const dayStr = `${selectedMonth}-${String(day).padStart(2, '0')}`;
        const logId = `${targetMedId}_${dayStr}_IN`;

        if (qty > 0) {
          await setDoc(doc(db, 'medicineLogs', logId), {
            medicineId: targetMedId,
            medicineName: med.name,
            quantity: qty,
            date: dayStr,
            type: 'IN',
            createdAt: serverTimestamp()
          });
        } else {
          await deleteDoc(doc(db, 'medicineLogs', logId));
        }
      }

      const docId = `${targetMedId}_${parsedYear}_${parsedMonth}`;
      await setDoc(doc(db, 'medicineMonthlyData', docId), {
        medicineId: targetMedId,
        year: parsedYear,
        month: parsedMonth,
        price: Number(fields.price) || 0,
        initialStock: Number(fields.initialStock) || 0,
        received: totalIncoming, // set dynamically from the sum of day-to-day IN inputs
        updatedAt: serverTimestamp()
      });

      // Also update standard price in standard medicines collection
      await setDoc(doc(db, 'medicines', targetMedId), {
        name: med.name,
        stock: med.stock !== undefined ? med.stock : 0,
        unit: med.unit || 'Pcs',
        price: Number(fields.price) || 0
      }, { merge: true });

      alert(`Data bulanan untuk ${med.name} berhasil disimpan.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'medicineMonthlyData');
    } finally {
      setSavingId(null);
    }
  };

  // --- SUBMENU 2: PEMAKAIAN HARIAN CONTROLLER ---
  const [dailyInputs, setDailyInputs] = useState<Record<string, string>>({});
  const [savingDailyDate, setSavingDailyDate] = useState(false);

  // Initialize input state when date or logs change
  useEffect(() => {
    const inputs: typeof dailyInputs = {};
    medicines.forEach(med => {
      const matchingFirestoreMed = firestoreMedicines.find(fm => fm.name && med.name && fm.name.trim().toLowerCase() === med.name.trim().toLowerCase());
      const lookUpId = matchingFirestoreMed?.id || med.id;
      const log = logs.find(l => (l.medicineId === lookUpId || l.medicineId === med.id) && l.date === selectedDate && l.type === 'OUT' && !l.visitId);
      inputs[med.id!] = log ? String(log.quantity) : '0';
    });
    setDailyInputs(inputs);
  }, [medicines, firestoreMedicines, logs, selectedDate]);

  const handleDailyInputChange = (medicineId: string, val: string) => {
    setDailyInputs(prev => ({
      ...prev,
      [medicineId]: val
    }));
  };

  const handleSaveDailyUsage = async () => {
    setSavingDailyDate(true);
    try {
      for (const med of medicines) {
        const valueStr = dailyInputs[med.id!];
        const val = parseInt(valueStr) || 0;

        const matchingFirestoreMed = firestoreMedicines.find(fm => fm.name && med.name && fm.name.trim().toLowerCase() === med.name.trim().toLowerCase());
        const targetMedId = matchingFirestoreMed?.id || med.id!;

        const logId = `${targetMedId}_${selectedDate}_OUT`;

        if (val > 0) {
          // Store/update log
          await setDoc(doc(db, 'medicineLogs', logId), {
            medicineId: targetMedId,
            medicineName: med.name,
            quantity: val,
            date: selectedDate,
            type: 'OUT',
            createdAt: serverTimestamp()
          });
        } else {
          // If value is 0 or less, delete usage log for that date
          await deleteDoc(doc(db, 'medicineLogs', logId));
        }
      }
      alert(`Data pemakaian obat tanggal ${selectedDate} berhasil disimpan.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'medicineLogs');
    } finally {
      setSavingDailyDate(false);
    }
  };

  // --- SUBMENU 3: LAPORAN BULANAN OBAT CALCULATIONS & EXPORTS ---
  
  // Format numeric values to Rupiah currency
  const formatRupiah = (num: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(num);
  };

  // Generate matrix data
  const reportRows = medicines.map((med) => {
    const matchingFirestoreMed = firestoreMedicines.find(fm => fm.name && med.name && fm.name.trim().toLowerCase() === med.name.trim().toLowerCase());
    const lookUpId = matchingFirestoreMed?.id || med.id;

    const mData = monthlyData.find(d => (d.medicineId === lookUpId || d.medicineId === med.id) && d.year === parsedYear && d.month === parsedMonth);
    const price = mData?.price ?? med.price ?? 0;
    const initialStock = mData?.initialStock ?? 0;
    const received = mData?.received ?? 0;

    // Daily pemakaian list integrating both explicit medicineLogs and automatic therapy text from monthly visits
    const usageByDay: Record<number, number> = {};
    daysArray.forEach(day => {
      const dayStr = `${selectedMonth}-${String(day).padStart(2, '0')}`;
      
      // 1. Explicit logs from medicineLogs
      const matchedLogs = logs.filter(l => 
        (l.medicineId === lookUpId || l.medicineId === med.id || (l.medicineName && l.medicineName.trim().toLowerCase() === med.name.trim().toLowerCase())) && 
        l.date === dayStr && 
        l.type === 'OUT'
      );
      let dailySum = matchedLogs.reduce((acc, l) => acc + (l.quantity || 0), 0);
      
      // Explicitly track covered visit IDs to prevent duplication
      const coveredVisitIds = new Set(
        matchedLogs.map(l => l.visitId).filter(Boolean) as string[]
      );

      // 2. Aggregate visits occurring on this day that aren't already explicitly logged above
      const dayVisits = monthVisits.filter(v => {
        if (!v.date) return false;
        const vDateOnly = v.date.split('T')[0];
        return vDateOnly === dayStr;
      });

      dayVisits.forEach(v => {
        if (v.id && coveredVisitIds.has(v.id)) return;
        
        const parsedMeds = parseTherapy(v.therapy || '');
        parsedMeds.forEach(pm => {
          if (pm.name.toLowerCase() === med.name.toLowerCase()) {
            const qtyNum = getParsedQty(pm.qty);
            dailySum += qtyNum;
          }
        });
      });

      usageByDay[day] = dailySum;
    });

    const totalUsage = Object.values(usageByDay).reduce((a, b) => a + b, 0);
    const totalStock = initialStock + received;
    const finalStock = totalStock - totalUsage;
    const finalValue = finalStock * price;

    return {
      medicine: med,
      price,
      initialStock,
      received,
      totalStock,
      usageByDay,
      totalUsage,
      finalStock,
      finalValue
    };
  }).filter(row => row.medicine.name.toLowerCase().includes(searchTerm.toLowerCase()));

  // Totals calculations
  const totalInitialStockAll = reportRows.reduce((sum, r) => sum + r.initialStock, 0);
  const totalReceivedAll = reportRows.reduce((sum, r) => sum + r.received, 0);
  const totalUsageAll = reportRows.reduce((sum, r) => sum + r.totalUsage, 0);
  const totalFinalStockAll = reportRows.reduce((sum, r) => sum + r.finalStock, 0);
  const totalValueAll = reportRows.reduce((sum, r) => sum + r.finalValue, 0);

  // Export to Excel handler
  const exportToExcel = async () => {
    try {
      const wb = new ExcelJS.Workbook();
      
      // Helper to convert column index (1-based) to Excel letter
      const getExcelColumnLetter = (colIdx: number) => {
        let temp = colIdx;
        let letter = '';
        while (temp > 0) {
          let modulo = (temp - 1) % 26;
          letter = String.fromCharCode(65 + modulo) + letter;
          temp = Math.floor((temp - modulo) / 26);
        }
        return letter;
      };

      // Helper
      const parsedYear = Number(selectedMonth.split('-')[0]);
      const parsedMonth = Number(selectedMonth.split('-')[1]);

      const applyStyling = (ws: any, headerRowNumber: number, numCols: number) => {
        // Set split viewpoint to freeze rows above header (inclusive of header itself)
        ws.views = [
          { state: 'frozen', xSplit: 0, ySplit: headerRowNumber, activePane: 'bottomRight', showGridLines: true }
        ];

        // Enable Autofilters across the header range to make it an active, filterable table
        ws.autoFilter = `A${headerRowNumber}:${getExcelColumnLetter(numCols)}${headerRowNumber}`;

        // Apply cell styling, borders, and typography
        ws.eachRow({ includeEmpty: true }, (row: any, rIdx: number) => {
          const isHeader = rIdx === headerRowNumber;
          
          row.eachCell({ includeEmpty: true }, (cell: any, cIdx: number) => {
            if (rIdx < headerRowNumber) {
              // Title/Meta text formatting
              if (rIdx === 1) {
                cell.font = { name: 'Times New Roman', size: 14, bold: true, color: { argb: 'FF1E3A8A' } };
              } else {
                cell.font = { name: 'Times New Roman', size: 11, italic: true };
              }
              return;
            }

            // Define borders for all table data & header cells
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
              left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
              bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
              right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
            };

            if (isHeader) {
              // High-fidelity active professional blue header
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF2563EB' }
              };
              cell.font = { name: 'Times New Roman', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
              cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            } else {
              cell.font = { name: 'Times New Roman', size: 11 };
              
              // Alignments
              if (cIdx === 1) {
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
              } else if (cIdx === 2) {
                cell.alignment = { vertical: 'middle', horizontal: 'left' };
              } else if (typeof cell.value === 'number') {
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
              } else {
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
              }

              // Light neat zebra-striping style
              if (rIdx % 2 === 1) {
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFF8FAFC' }
                };
              }
            }
          });
        });
      };

      // 1. PEMASUKAN SPREADSHEET
      const wsPemasukan = wb.addWorksheet('PEMASUKAN');
      wsPemasukan.addRow(['DATA OBAT DAN STOK AWAL (PEMASUKAN)']);
      wsPemasukan.addRow([`Periode: Bulan ${parsedMonth} Tahun ${parsedYear}`]);
      wsPemasukan.addRow([]);
      
      const pemasukanHeaders = [
        'NO', 'NAMA OBAT', 'HARGA SATUAN', 'JENIS', 'SATUAN', 'STOK AWAL OBAT',
        ...daysArray.map(d => d.toString()),
        'JUMLAH OBAT MASUK', 'TOTAL STOK'
      ];
      wsPemasukan.addRow(pemasukanHeaders);
      
      reportRows.forEach((row, idx) => {
        const matchingFirestoreMed = firestoreMedicines.find(fm => fm.name && row.medicine.name && fm.name.trim().toLowerCase() === row.medicine.name.trim().toLowerCase());
        const lookUpId = matchingFirestoreMed?.id || row.medicine.id;

        const inByDay = daysArray.map(day => {
          const dayStr = `${selectedMonth}-${String(day).padStart(2, '0')}`;
          const match = logs.filter(l => 
            (l.medicineId === lookUpId || l.medicineId === row.medicine.id || (l.medicineName && l.medicineName.trim().toLowerCase() === row.medicine.name.trim().toLowerCase())) && 
            l.date === dayStr && 
            l.type === 'IN'
          );
          const sumIn = match.reduce((a, b) => a + (b.quantity || 0), 0);
          return sumIn > 0 ? sumIn : '';
        });

        wsPemasukan.addRow([
          idx + 1,
          row.medicine.name,
          row.price,
          getJenisObat(row.medicine.name, row.medicine.unit),
          row.medicine.unit,
          row.initialStock,
          ...inByDay,
          row.received,
          row.totalStock
        ]);
      });

      // Calculate total columns
      const totalPemasukanCols = pemasukanHeaders.length;
      applyStyling(wsPemasukan, 4, totalPemasukanCols);

      // Adjust widths explicitly for polished alignment
      wsPemasukan.getColumn(1).width = 6;  // NO
      wsPemasukan.getColumn(2).width = 32; // NAMA OBAT
      wsPemasukan.getColumn(3).width = 15; // HARGA SATUAN
      wsPemasukan.getColumn(4).width = 22; // JENIS
      wsPemasukan.getColumn(5).width = 11; // SATUAN
      wsPemasukan.getColumn(6).width = 15; // STOK AWAL
      daysArray.forEach((_, dIdx) => {
        wsPemasukan.getColumn(7 + dIdx).width = 5; // Date columns
      });
      wsPemasukan.getColumn(7 + daysArray.length).width = 18; // TOTAL MASUK
      wsPemasukan.getColumn(8 + daysArray.length).width = 14; // TOTAL STOK

      // 2. PEMAKAIAN OBAT HARIAN (Sheets for dates 1 to 31)
      daysArray.forEach(day => {
        const dayStr = `${selectedMonth}-${String(day).padStart(2, '0')}`;
        
        const dayVisits = monthVisits.filter(v => {
          if (!v.date) return false;
          const vDateOnly = v.date.split('T')[0];
          return vDateOnly === dayStr;
        });

        const wsDay = wb.addWorksheet(`Tgl ${day}`);
        wsDay.addRow([`PEMAKAIAN OBAT HARIAN - TANGGAL ${day}`]);
        wsDay.addRow([`Periode: Bulan ${parsedMonth} Tahun ${parsedYear}`]);
        wsDay.addRow([]);
        
        const headerRow = ['NO', 'NAMA OBAT'];
        const maxPatients = 100;
        for (let i = 1; i <= maxPatients; i++) {
          headerRow.push(i.toString());
        }
        headerRow.push('JUMLAH OBAT KELUAR');
        wsDay.addRow(headerRow);

        reportRows.forEach((row, idx) => {
          const matchingFirestoreMed = firestoreMedicines.find(fm => fm.name && row.medicine.name && fm.name.trim().toLowerCase() === row.medicine.name.trim().toLowerCase());
          const lookUpId = matchingFirestoreMed?.id || row.medicine.id;

          const cells: any[] = [idx + 1, row.medicine.name];
          const qtyPerPatient = Array(maxPatients).fill('');
          let explicitLogsSum = 0;
          let visitUsageTotal = 0;

          const matchedLogs = logs.filter(l => 
            (l.medicineId === lookUpId || l.medicineId === row.medicine.id || (l.medicineName && l.medicineName.trim().toLowerCase() === row.medicine.name.trim().toLowerCase())) && 
            l.date === dayStr && 
            l.type === 'OUT'
          );
          explicitLogsSum = matchedLogs.reduce((acc, l) => acc + (l.quantity || 0), 0);
          
          const coveredVisitIds = new Set(matchedLogs.map(l => l.visitId).filter(Boolean) as string[]);

          dayVisits.slice(0, maxPatients).forEach((visit, vIdx) => {
            if (visit.id && coveredVisitIds.has(visit.id)) return;

            const parsedMeds = parseTherapy(visit.therapy || '');
            let sumQty = 0;
            parsedMeds.forEach(pm => {
              if (pm.name.toLowerCase() === row.medicine.name.toLowerCase()) {
                sumQty += getParsedQty(pm.qty);
              }
            });
            
            if (sumQty > 0) {
              qtyPerPatient[vIdx] = sumQty;
              visitUsageTotal += sumQty;
            }
          });

          const totalQtyForDay = visitUsageTotal + explicitLogsSum;
          
          if (explicitLogsSum > 0 && dayVisits.length < maxPatients) {
            qtyPerPatient[dayVisits.length] = explicitLogsSum;
          }

          qtyPerPatient.forEach(val => cells.push(val));
          cells.push(totalQtyForDay);
          wsDay.addRow(cells);
        });

        const totalDayCols = headerRow.length;
        applyStyling(wsDay, 4, totalDayCols);

        wsDay.getColumn(1).width = 6;  // NO
        wsDay.getColumn(2).width = 32; // NAMA OBAT
        for (let i = 1; i <= maxPatients; i++) {
          wsDay.getColumn(2 + i).width = 5; // Patients
        }
        wsDay.getColumn(2 + maxPatients + 1).width = 18; // TOTAL OUT
      });

      // 3. STOK AKHIR
      const wsStokAkhir = wb.addWorksheet('STOK AKHIR');
      wsStokAkhir.addRow(['LAPORAN BULANAN PEMAKAIAN OBAT UKS (STOK AKHIR)']);
      wsStokAkhir.addRow([`Periode: Bulan ${parsedMonth} Tahun ${parsedYear}`]);
      wsStokAkhir.addRow([]);
      
      const stokAkhirHeaders = [
        'NO',
        'NAMA OBAT',
        'TOTAL STOK (AWAL+MASUK)',
        ...daysArray.map(d => `Tgl ${d}`),
        'JUMLAH OBAT KELUAR',
        'SISA STOK AKHIR'
      ];
      wsStokAkhir.addRow(stokAkhirHeaders);

      reportRows.forEach((row, idx) => {
        wsStokAkhir.addRow([
          idx + 1,
          row.medicine.name,
          row.totalStock,
          ...daysArray.map(d => row.usageByDay[d]),
          row.totalUsage,
          row.finalStock
        ]);
      });

      // Append Total row
      const totalRow = wsStokAkhir.addRow([
        'TOTAL',
        '',
        totalInitialStockAll + totalReceivedAll,
        ...daysArray.map(d => reportRows.reduce((sum, r) => sum + (r.usageByDay[d] ?? 0), 0)),
        totalUsageAll,
        totalFinalStockAll
      ]);
      totalRow.font = { name: 'Times New Roman', size: 11, bold: true };

      const totalStokAkhirCols = stokAkhirHeaders.length;
      applyStyling(wsStokAkhir, 4, totalStokAkhirCols);

      wsStokAkhir.getColumn(1).width = 6;  // NO
      wsStokAkhir.getColumn(2).width = 32; // NAMA OBAT
      wsStokAkhir.getColumn(3).width = 16; // TOTAL STOK (AWAL+MASUK)
      daysArray.forEach((_, dIdx) => {
        wsStokAkhir.getColumn(4 + dIdx).width = 5; // Date columns
      });
      wsStokAkhir.getColumn(4 + daysArray.length).width = 18; // OUT
      wsStokAkhir.getColumn(5 + daysArray.length).width = 16; // FINAL STOCK

      const buffer = await wb.xlsx.writeBuffer();
      saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Laporan_Pemakaian_Obat_${selectedMonth}.xlsx`);
    } catch (error: any) {
      alert("Error Export Excel: " + (error?.message || String(error)));
      console.error(error);
    }
  };

  // Export to PDF handler
  const exportToPDF = () => {
    try {
      const doc = new jsPDF('l', 'mm', 'a3'); // A3 landscape for generous wide columns layout
    
    // Set text style info wrapper to helper function
    const applyTimesFont = () => {
      doc.setFont('times', 'normal');
    };
    
    // 1. DATA OBAT DAN STOK AWAL -> PEMASUKAN
    applyTimesFont();
    doc.setFontSize(14);
    doc.text('DATA OBAT DAN STOK AWAL (PEMASUKAN)', 210, 15, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`Periode: Bulan ${parsedMonth} / Tahun ${parsedYear}`, 210, 22, { align: 'center' });

    const dataObatHeaders = ['No', 'Nama Obat', 'Harga Satuan', 'Jenis', 'Satuan', 'Stok Awal Obat', ...daysArray.map(d => String(d)), 'Jumlah Obat Masuk', 'Total Stok'];
    
    const dataObatBody = reportRows.map((row, idx) => {
      const matchingFirestoreMed = firestoreMedicines.find(fm => fm.name && row.medicine.name && fm.name.trim().toLowerCase() === row.medicine.name.trim().toLowerCase());
      const lookUpId = matchingFirestoreMed?.id || row.medicine.id;

      const inByDay = daysArray.map(day => {
        const dayStr = `${selectedMonth}-${String(day).padStart(2, '0')}`;
        const match = logs.filter(l => 
          (l.medicineId === lookUpId || l.medicineId === row.medicine.id || (l.medicineName && l.medicineName.trim().toLowerCase() === row.medicine.name.trim().toLowerCase())) && 
          l.date === dayStr && 
          l.type === 'IN'
        );
        const sumIn = match.reduce((a, b) => a + (b.quantity || 0), 0);
        return sumIn > 0 ? sumIn : '';
      });
      return [
        idx + 1,
        row.medicine.name,
        row.price,
        getJenisObat(row.medicine.name, row.medicine.unit),
        row.medicine.unit,
        row.initialStock,
        ...inByDay,
        row.received,
        row.totalStock
      ];
    });

    (doc as any).autoTable({
      startY: 28,
      head: [dataObatHeaders],
      body: dataObatBody,
      theme: 'grid',
      styles: { font: 'times', fontSize: 7, cellPadding: 1 },
      headStyles: { fillColor: [240, 240, 255], textColor: [0, 0, 255], fontStyle: 'bold', halign: 'center' },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 35 },
        2: { cellWidth: 15 },
        3: { cellWidth: 15 },
        4: { cellWidth: 12 },
        5: { cellWidth: 12, halign: 'center' },
      }
    });

    // 2. PEMAKAIAN OBAT HARIAN (Sheets for dates 1 to 31)
    const maxPatients = 100;
    daysArray.forEach(day => {
      doc.addPage();
      applyTimesFont();
      doc.setFontSize(14);
      doc.text(`PEMAKAIAN OBAT HARIAN - TANGGAL ${day}`, 210, 15, { align: 'center' });
      
      const dayStr = `${selectedMonth}-${String(day).padStart(2, '0')}`;
      const dayVisits = monthVisits.filter(v => {
        if (!v.date) return false;
        const vDateOnly = v.date.split('T')[0];
        return vDateOnly === dayStr;
      });

      const dayHeaders = ['No', 'Nama Obat'];
      for (let i = 1; i <= maxPatients; i++) {
        dayHeaders.push(i.toString());
      }
      dayHeaders.push('Total\nKeluar');

      const dayBody = reportRows.map((row, idx) => {
        const matchingFirestoreMed = firestoreMedicines.find(fm => fm.name && row.medicine.name && fm.name.trim().toLowerCase() === row.medicine.name.trim().toLowerCase());
        const lookUpId = matchingFirestoreMed?.id || row.medicine.id;

        const cells: any[] = [idx + 1, row.medicine.name];
        const qtyPerPatient = Array(maxPatients).fill('');
        let explicitLogsSum = 0;
        let visitUsageTotal = 0;

        const matchedLogs = logs.filter(l => 
          (l.medicineId === lookUpId || l.medicineId === row.medicine.id || (l.medicineName && l.medicineName.trim().toLowerCase() === row.medicine.name.trim().toLowerCase())) && 
          l.date === dayStr && 
          l.type === 'OUT'
        );
        explicitLogsSum = matchedLogs.reduce((acc, l) => acc + (l.quantity || 0), 0);
        const coveredVisitIds = new Set(matchedLogs.map(l => l.visitId).filter(Boolean) as string[]);

        dayVisits.slice(0, maxPatients).forEach((visit, vIdx) => {
          if (visit.id && coveredVisitIds.has(visit.id)) return;
          const parsedMeds = parseTherapy(visit.therapy || '');
          let sumQty = 0;
          parsedMeds.forEach(pm => {
            if (pm.name.toLowerCase() === row.medicine.name.toLowerCase()) {
              sumQty += getParsedQty(pm.qty);
            }
          });
          if (sumQty > 0) {
            qtyPerPatient[vIdx] = sumQty;
            visitUsageTotal += sumQty;
          }
        });

        const totalQtyForDay = visitUsageTotal + explicitLogsSum;
        if (explicitLogsSum > 0 && dayVisits.length < maxPatients) {
          qtyPerPatient[dayVisits.length] = explicitLogsSum;
        }

        qtyPerPatient.forEach(val => cells.push(val));
        cells.push(totalQtyForDay);
        return cells;
      });

      (doc as any).autoTable({
        startY: 25,
        head: [dayHeaders],
        body: dayBody,
        theme: 'grid',
        styles: { font: 'times', fontSize: 4.5, cellPadding: 0.5 },
        headStyles: { fillColor: [240, 240, 255], textColor: [0, 0, 255], fontSize: 4.5, fontStyle: 'bold', halign: 'center' },
        columnStyles: {
          0: { cellWidth: 6, halign: 'center' },
          1: { cellWidth: 35 },
          102: { cellWidth: 10, halign: 'center' } // Total Keluar column
        }
      });
    });

    // 3. LAPORAN BULANAN OBAT -> STOK AKHIR
    doc.addPage();
    applyTimesFont();
    doc.setFontSize(14);
    doc.text('LAPORAN BULANAN PEMAKAIAN OBAT UKS (STOK AKHIR)', 210, 15, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`Periode: Bulan ${parsedMonth} / Tahun ${parsedYear}`, 210, 22, { align: 'center' });

    const headers = [
      'No',
      'Nama Obat',
      'Total Stok (Awal+Masuk)',
      ...daysArray.map(d => String(d)),
      'Jumlah Obat Keluar',
      'Sisa Stok Akhir'
    ];

    const bodyCells = reportRows.map((row, idx) => [
      idx + 1,
      row.medicine.name,
      row.totalStock,
      ...daysArray.map(d => row.usageByDay[d]),
      row.totalUsage,
      row.finalStock
    ]);

    const dailyTotals = daysArray.map(d => {
      return reportRows.reduce((sum, r) => sum + (r.usageByDay[d] ?? 0), 0);
    });

    bodyCells.push([
      'TOTAL',
      '',
      totalInitialStockAll + totalReceivedAll,
      ...dailyTotals,
      totalUsageAll,
      totalFinalStockAll
    ]);

    (doc as any).autoTable({
      startY: 28,
      head: [headers],
      body: bodyCells,
      theme: 'grid',
      styles: { font: 'times', fontSize: 6.5, cellPadding: 1 },
      headStyles: { fillColor: [240, 240, 255], textColor: [0, 0, 255], fontSize: 7, fontStyle: 'bold', halign: 'center' },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 50 },
        2: { cellWidth: 20, halign: 'center' },
        ...daysArray.reduce((acc, d) => ({
          ...acc,
          [2 + d]: { cellWidth: 7, halign: 'center' }
        }), {}),
        34: { cellWidth: 16, halign: 'center' },
        35: { cellWidth: 15, halign: 'center' },
      }
    });

    doc.save(`Laporan_Pemakaian_Obat_${selectedMonth}.pdf`);
    } catch (error: any) {
      alert("Error Export PDF: " + (error?.message || String(error)));
      console.error(error);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-200 pb-5 gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-cyan-600" />
            LAPORAN PEMAKAIAN OBAT &amp; LOGISTIK
          </h1>
          <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
            Modul Analisis Dan Pelaporan Pengeluaran Terapi Dan Ketersediaan Obat Bulanan
          </p>
        </div>

        {/* Global Select Month */}
        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
          <Calendar className="w-4 h-4 text-cyan-600" />
          <span className="text-[10px] font-bold text-slate-500 uppercase">Periode:</span>
          <input 
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="text-[11px] font-bold text-slate-800 border-none outline-none focus:ring-0 cursor-pointer"
          />
        </div>
      </div>

      {/* Submenu Tabs Selector */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveSubmenu('data-obat')}
          className={cn(
            "px-6 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 cursor-pointer",
            activeSubmenu === 'data-obat' 
              ? "border-cyan-600 text-cyan-700 bg-cyan-50/20" 
              : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          <Database className="w-4 h-4" />
          Data Obat &amp; Stok Awal
        </button>
        <button
          onClick={() => setActiveSubmenu('pemakaian-harian')}
          className={cn(
            "px-6 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 cursor-pointer",
            activeSubmenu === 'pemakaian-harian' 
              ? "border-cyan-600 text-cyan-700 bg-cyan-50/20" 
              : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          <Calendar className="w-4 h-4" />
          Pemakaian Obat Harian
        </button>
        <button
          onClick={() => setActiveSubmenu('laporan-bulanan')}
          className={cn(
            "px-6 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 cursor-pointer",
            activeSubmenu === 'laporan-bulanan' 
              ? "border-cyan-600 text-cyan-700 bg-cyan-50/20" 
              : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          <Sparkles className="w-4 h-4" />
          Laporan Bulanan Obat (Excel)
        </button>
      </div>

      {/* RENDER ACTIVE VIEW */}
      {loading ? (
        <div className="bg-white p-20 rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-10 h-10 text-cyan-600 animate-spin" />
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">LOADING_PERSISTENT_DATA...</p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* VIEW: DATA OBAT */}
          {activeSubmenu === 'data-obat' && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between border-b pb-3 gap-3">
                <div>
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Atur Parameter Bulanan & Pemasukan Logistik</h3>
                  <p className="text-[10px] text-slate-400 uppercase font-semibold">Tentukan Harga, Stok Awal, dan catat tanggal pemasukan obat masuk harian selama sebulan.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={loadingMedsSync}
                    onClick={fetchMedsFromSheets}
                    className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-cyan-300 text-white px-3.5 py-1.5 rounded text-[10px] font-black uppercase tracking-wider transition-colors flex items-center gap-1.5 shadow-sm shadow-cyan-500/10 cursor-pointer h-8 border-none"
                  >
                    {loadingMedsSync ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Tarik Data Obat (Sheet 2)
                  </button>
                  <div className="text-[10px] font-bold text-cyan-600 uppercase bg-cyan-50 px-3 py-1 rounded flex items-center h-8">
                    Periode: {selectedMonth}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto relative max-h-[600px] border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-100 border-b border-slate-200 shadow-sm select-none">
                    <tr className="bg-slate-100 text-[9px] font-black text-slate-500 uppercase tracking-wider">
                      <th className="py-3 px-3 text-center min-w-[45px] border-b border-slate-200 bg-slate-100 sticky left-0 z-20 shadow-[2px_0_5px_rgba(0,0,0,0.05)] border-r">No</th>
                      <th className="py-3 px-4 min-w-[170px] border-b border-slate-200 bg-slate-100 sticky left-[45px] z-20 shadow-[2px_0_5px_rgba(0,0,0,0.05)] border-r">Nama Obat</th>
                      <th className="py-3 px-3 min-w-[110px] border-b border-slate-200">Harga Satuan (Rp)</th>
                      <th className="py-3 px-3 min-w-[120px] text-center border-b border-slate-200">Jenis</th>
                      <th className="py-3 px-3 text-center min-w-[80px] border-b border-slate-200">Satuan</th>
                      <th className="py-3 px-3 min-w-[100px] text-center border-b border-slate-200">Stok Awal Obat</th>
                      
                      {/* 1 to 31 columns for incoming calendar days */}
                      {daysArray.map(day => (
                        <th key={day} className="py-3 px-1 text-center min-w-[45px] border-b border-slate-200 bg-amber-50 text-amber-900 border-l border-r border-amber-200/40 text-[9px] font-black">
                          {day}
                        </th>
                      ))}

                      <th className="py-3 px-3 min-w-[120px] text-center border-b border-slate-200 bg-teal-50 text-teal-900 border-l border-slate-200">Jumlah Obat Masuk</th>
                      <th className="py-3 px-3 min-w-[110px] text-center border-b border-slate-200 bg-cyan-50 text-cyan-900 border-l border-slate-200">Total Stok</th>
                      <th className="py-3 px-3 text-center min-w-[100px] border-b border-slate-200 border-l border-slate-200">Tindakan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/80 text-slate-700 bg-white">
                    {medicines.map((med, index) => {
                      const fields = editForms[med.id!] || { price: '0', initialStock: '0', received: '0' };
                      
                      // Calculate dynamic received from incomingInputs (sum of 1..31 IN logs)
                      let totalIncoming = 0;
                      const medIncoming = incomingInputs[med.id!] || {};
                      daysArray.forEach(d => {
                        totalIncoming += parseInt(medIncoming[d] || '0') || 0;
                      });

                      const totalStok = (parseInt(fields.initialStock) || 0) + totalIncoming;

                      return (
                        <tr key={med.id} className="hover:bg-slate-50/50 transition-colors">
                          {/* Pin first columns with shadow and border for awesome scrolling experience */}
                          <td className="py-2.5 px-3 text-center font-mono text-slate-400 bg-white sticky left-0 z-10 border-r border-slate-200/60 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                            {index + 1}
                          </td>
                          <td className="py-2.5 px-4 font-bold text-slate-800 uppercase bg-white sticky left-[45px] z-10 border-r border-slate-200/60 shadow-[2px_0_5px_rgba(0,0,0,0.02)] min-w-[170px] truncate" title={med.name}>
                            {med.name}
                          </td>
                          <td className="py-2.5 px-3 min-w-[110px]">
                            <div className="relative">
                              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-slate-400">Rp</span>
                              <input 
                                type="number"
                                value={fields.price}
                                onChange={(e) => handleFieldChange(med.id!, 'price', e.target.value)}
                                className="w-full text-center text-xs font-bold border border-slate-200 rounded pl-5 pr-1 py-1 focus:ring-1 focus:ring-cyan-500 font-mono text-slate-800 bg-slate-50/30"
                                placeholder="0"
                              />
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-center min-w-[120px]">
                            <span className="inline-block bg-indigo-50 border border-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full text-[9px] tracking-wide">
                              {getJenisObat(med.name, med.unit)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center min-w-[80px]">
                            <span className="bg-slate-100 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider text-slate-600">
                              {med.unit}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 min-w-[100px]">
                            <input 
                              type="number"
                              value={fields.initialStock}
                              onChange={(e) => handleFieldChange(med.id!, 'initialStock', e.target.value)}
                              className="w-full text-center text-xs font-bold border border-slate-200 rounded px-1.5 py-1 focus:ring-1 focus:ring-cyan-500 font-mono text-slate-800 bg-slate-50/30"
                              placeholder="0"
                            />
                          </td>

                          {/* 1..31 Inputs for incoming daily quantities */}
                          {daysArray.map(day => (
                            <td key={day} className="py-2 px-[3px] border-l border-r border-slate-200/40 bg-amber-50/5 text-center">
                              <input
                                type="number"
                                min="0"
                                placeholder="-"
                                value={incomingInputs[med.id!]?.[day] || ''}
                                onChange={(e) => handleIncomingInputChange(med.id!, day, e.target.value)}
                                className="w-[34px] h-[26px] text-center text-[10px] font-black border border-slate-200 rounded focus:ring-1 focus:ring-cyan-500 bg-white font-mono text-slate-700 p-0 shadow-sm"
                                style={{ MozAppearance: 'textfield' }}
                              />
                            </td>
                          ))}

                          {/* Dynamic Jumlah Obat Masuk (sum of 1-31 inputs) */}
                          <td className="py-2.5 px-3 text-center font-mono font-black text-xs text-teal-700 bg-teal-50/30 border-l border-slate-200">
                            {totalIncoming > 0 ? (
                              <span className="bg-teal-100/70 text-teal-800 border border-teal-200 px-2.5 py-1 rounded-full text-[10px] shadow-sm">
                                {totalIncoming} {med.unit}
                              </span>
                            ) : (
                              <span className="text-slate-400 font-normal">-</span>
                            )}
                          </td>

                          {/* Dynamic Total Stok (Stok Awal + Jumlah Masuk) */}
                          <td className="py-2.5 px-3 text-center font-mono font-black text-xs text-cyan-800 bg-cyan-50/30 border-l border-slate-200">
                            <span className="bg-cyan-100/70 border border-cyan-200 px-2.5 py-1 rounded-full text-[10px] shadow-sm">
                              {totalStok} {med.unit}
                            </span>
                          </td>

                          <td className="py-2.5 px-3 text-center border-l border-slate-200">
                            <button
                              onClick={() => handleSaveMonthlyData(med)}
                              disabled={savingId === med.id}
                              className="bg-slate-950 text-white rounded text-[9px] font-black uppercase tracking-wider px-3.5 py-1.5 cursor-pointer hover:bg-slate-800 active:bg-black transition-colors disabled:opacity-50 min-w-[80px] inline-flex items-center justify-center gap-1 shadow-sm"
                            >
                              {savingId === med.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <>
                                  <Save className="w-3 h-3" />
                                  Simpan
                                </>
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW: PEMAKAIAN HARIAN */}
          {activeSubmenu === 'pemakaian-harian' && (() => {
            const dayVisits = monthVisits.filter(v => {
              if (!v.date) return false;
              const vDateOnly = v.date.split('T')[0];
              return vDateOnly === selectedDate;
            });

            return (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between border-b pb-3 gap-3">
                  <div>
                    <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Input Pemakaian Harian Obat Mandiri</h3>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold">Tentukan angka pemakaian terapetik untuk tanggal tertentu.</p>
                  </div>
                  
                  {/* Specific Date Picker with Month Sync */}
                  <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                    <Calendar className="w-4 h-4 text-cyan-600" />
                    <span className="text-[10px] font-black text-slate-500 uppercase">Pilih Tanggal:</span>
                    <input 
                      type="date"
                      value={selectedDate}
                      onChange={(e) => {
                        const newDate = e.target.value;
                        setSelectedDate(newDate);
                        if (newDate) {
                          const parts = newDate.split('-');
                          if (parts.length >= 2) {
                            setSelectedMonth(`${parts[0]}-${parts[1]}`);
                          }
                        }
                      }}
                      className="text-[11px] font-bold text-slate-800 bg-transparent border-none outline-none focus:ring-0 cursor-pointer"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-200">
                        <th className="py-2.5 px-3 text-center w-12 border-b border-slate-200">No</th>
                        <th className="py-2.5 px-3 min-w-[150px] border-b border-slate-200">Nama Obat</th>
                        <th className="py-2.5 px-3 text-center w-20 border-b border-slate-200">Satuan</th>
                        
                        {/* Dynamic Patient Columns */}
                        {dayVisits.map((v, idx) => (
                          <th key={v.id || idx} className="py-2.5 px-3 text-center min-w-[125px] bg-cyan-50/40 border-l border-b border-slate-200/60 font-black">
                            <span className="text-cyan-800 block text-[9px] tracking-wider">PASIEN {idx + 1}</span>
                            <span className="text-[8px] text-slate-500 font-semibold normal-case block truncate max-w-[115px]" title={`${v.studentName} (${v.grade})`}>
                              {v.studentName} ({v.grade})
                            </span>
                          </th>
                        ))}

                        {dayVisits.length === 0 && (
                          <th className="py-2.5 px-3 text-center text-slate-400 bg-slate-50/50 border-l border-b border-slate-200/60 font-medium italic w-44">
                            Tidak ada kunjungan
                          </th>
                        )}

                        <th className="py-2.5 px-3 w-40 text-center border-l border-b border-slate-200/60">Koreksi / Manual</th>
                        <th className="py-2.5 px-3 text-center w-32 border-l border-b border-slate-200/60">Total Pemakaian</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 font-sans">
                      {medicines.map((med, index) => {
                        const manualVal = parseInt(dailyInputs[med.id!] || '0') || 0;
                        
                        // Extract usage for each patient on this day
                        const patientQuantities = dayVisits.map(v => {
                          const parsedMeds = parseTherapy(v.therapy || '');
                          const matchedMed = parsedMeds.find(pm => pm.name.toLowerCase() === med.name.toLowerCase());
                          return matchedMed ? getParsedQty(matchedMed.qty) : 0;
                        });

                        const totalPatientQty = patientQuantities.reduce((a, b) => a + b, 0);
                        const combinedTotal = totalPatientQty + manualVal;

                        return (
                          <tr key={med.id} className="hover:bg-slate-50/30 transition-colors">
                            <td className="py-3 px-3 text-center font-mono text-slate-400 border-b border-slate-100">{index + 1}</td>
                            <td className="py-3 px-3 font-bold text-slate-800 uppercase border-b border-slate-100">{med.name}</td>
                            <td className="py-3 px-3 text-center border-b border-slate-100">
                              <span className="bg-slate-100 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider text-slate-600">
                                {med.unit}
                              </span>
                            </td>

                            {/* Render value for each patient column */}
                            {dayVisits.map((v, idx) => {
                              const qty = patientQuantities[idx];
                              return (
                                <td key={v.id || idx} className="py-3 px-3 text-center border-l border-b border-slate-100 font-mono">
                                  {qty > 0 ? (
                                    <span className="bg-teal-50 text-teal-700 border border-teal-100 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold shadow-sm">
                                      {qty}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">-</span>
                                  )}
                                </td>
                              );
                            })}

                            {dayVisits.length === 0 && (
                              <td className="py-3 px-3 text-center text-slate-300 font-mono border-l border-b border-slate-100">-</td>
                            )}

                            {/* Manual Input Column */}
                            <td className="py-1 px-3 border-l border-b border-slate-100">
                              <div className="flex items-center justify-center gap-1 max-w-xs mx-auto">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const currentVal = parseInt(dailyInputs[med.id!] || '0') || 0;
                                    handleDailyInputChange(med.id!, String(Math.max(0, currentVal - 1)));
                                  }}
                                  className="w-7 h-7 rounded border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100 cursor-pointer text-xs font-bold transition-colors"
                                >
                                  -
                                </button>
                                <input 
                                  type="number"
                                  min="0"
                                  value={dailyInputs[med.id!] || '0'}
                                  onChange={(e) => handleDailyInputChange(med.id!, e.target.value)}
                                  className="w-14 text-center text-xs font-bold border border-slate-200 rounded px-1.5 py-0.5 focus:ring-1 focus:ring-cyan-500 font-mono"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const currentVal = parseInt(dailyInputs[med.id!] || '0') || 0;
                                    handleDailyInputChange(med.id!, String(currentVal + 1));
                                  }}
                                  className="w-7 h-7 rounded border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100 cursor-pointer text-xs font-bold transition-colors"
                                >
                                  +
                                </button>
                              </div>
                            </td>

                            {/* Combined Total Column */}
                            <td className="py-3 px-3 text-center font-mono font-black text-xs text-cyan-700 border-l border-b border-slate-100">
                              {combinedTotal > 0 ? (
                                <div className="flex flex-col items-center">
                                  <span className="text-cyan-800 font-bold">{combinedTotal} {med.unit}</span>
                                  {totalPatientQty > 0 && manualVal > 0 && (
                                    <span className="text-[8px] text-slate-400 font-medium normal-case block mt-0.5">
                                      ({totalPatientQty} Pasien + {manualVal} Manual)
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-300 font-normal">0</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Save All Date Usages button */}
                <div className="flex justify-end pt-3 border-t">
                  <button
                    onClick={handleSaveDailyUsage}
                    disabled={savingDailyDate}
                    className="bg-cyan-600 hover:bg-cyan-700 text-white rounded text-[10px] font-black uppercase tracking-wider px-6 py-2.5 shadow shadow-cyan-200 cursor-pointer transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {savingDailyDate ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Simpan Seluruh Pemakaian Tanggal {selectedDate}
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })()}

          {/* VIEW: LAPORAN BULANAN OBAT */}
          {activeSubmenu === 'laporan-bulanan' && (
            <div className="space-y-6">
              {/* Header and filters line */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-2 max-w-sm flex-1">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Cari nama obat..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:border-cyan-400 focus:bg-white transition-all text-slate-800 placeholder-slate-400 h-8"
                    />
                  </div>
                </div>

                 {/* Exporters and Print utilities */}
                <div className="flex items-center gap-2">
                  <button
                    disabled={loadingMedsSync}
                    onClick={fetchMedsFromSheets}
                    className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-cyan-300 text-white px-4 py-1.5 rounded text-[10px] font-black uppercase tracking-wider transition-colors flex items-center gap-1.5 shadow-sm shadow-cyan-500/10 cursor-pointer h-8 border-none"
                  >
                    {loadingMedsSync ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Tarik Data Obat (Sheet 2)
                  </button>
                  <button
                    onClick={exportToExcel}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded text-[10px] font-black uppercase tracking-wider transition-colors flex items-center gap-1.5 shadow-sm shadow-emerald-500/10 cursor-pointer h-8"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Export Excel
                  </button>
                  <button
                    onClick={exportToPDF}
                    className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-1.5 rounded text-[10px] font-black uppercase tracking-wider transition-colors flex items-center gap-1.5 shadow-sm shadow-rose-500/10 cursor-pointer h-8"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export PDF
                  </button>
                  <button
                    onClick={handlePrint}
                    className="bg-slate-900 border hover:bg-slate-800 border-slate-300 text-white px-4 py-1.5 rounded text-[10px] font-black uppercase tracking-wider transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer h-8"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print Laporan
                  </button>
                </div>
              </div>

              {/* RENDER GRID TABLE EXCEL-STYLE */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden print:border-none print:shadow-none">
                <div className="p-4 bg-cyan-600 print:bg-white print:text-black text-white flex justify-between items-center border-b border-cyan-700">
                  <div>
                    <h2 className="text-xs font-black uppercase tracking-widest print:text-lg">REKAPITULASI DITRIBUSI &amp; EXPENDITURE OBAT UKS</h2>
                    <p className="text-[9px] uppercase font-bold text-cyan-100 mt-0.5 print:text-slate-500 print:font-semibold">Format Buku Laporan Penggunaan Unit Pelaksana Kesehatan Sekolah</p>
                  </div>
                  <div className="text-[10px] font-mono font-black border border-cyan-500 bg-cyan-700/50 px-3 py-1 rounded print:border-none print:bg-transparent print:text-black">
                    PERIODE: {selectedMonth}
                  </div>
                </div>

                <div className="overflow-x-auto print:overflow-visible">
                  <table className="w-full text-left border-collapse text-[11px] print:text-[8px] table-fixed min-w-[1240px] print:min-w-0">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[8px] print:text-[7px] font-black text-slate-500 uppercase tracking-wider text-center sticky top-0 bg-slate-100">
                        <th className="py-2.5 px-1 border-r w-10">No</th>
                        <th className="py-2.5 px-2 border-r text-left w-56">Nama Obat</th>
                        <th className="py-2.5 px-1 border-r w-36 bg-cyan-50/50 text-cyan-900 font-black">Total Stok (Awal+Masuk)</th>
                        
                        {/* Days 1 to 31 headers */}
                        {daysArray.map((day) => (
                          <th key={day} className="py-1 px-0.5 border-r w-7 text-center font-mono font-bold">
                            {day}
                          </th>
                        ))}

                        <th className="py-2.5 px-1 border-r w-24 bg-indigo-50/50 text-indigo-900 font-black">Jumlah Obat Keluar</th>
                        <th className="py-2.5 px-1 w-20 bg-slate-100">Sisa Stok Akhir</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {reportRows.map((row, index) => {
                        return (
                          <tr key={row.medicine.id} className="hover:bg-slate-50/50 transition-colors">
                            {/* 1. No */}
                            <td className="py-2 px-1 text-center font-mono text-slate-400 border-r">{index + 1}</td>
                            
                            {/* 2. Nama Obat */}
                            <td className="py-2 px-2 font-bold text-slate-800 uppercase border-r tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">
                              {row.medicine.name}
                            </td>

                            {/* 3. Total Stok (Awal+Masuk) */}
                            <td className="py-2 px-1 text-center font-mono font-black text-cyan-800 border-r bg-cyan-50/10">
                              {row.totalStock} {row.medicine.unit}
                            </td>

                            {/* Days 1-31 quantities representation */}
                            {daysArray.map((day) => {
                              const qty = row.usageByDay[day] ?? 0;
                              return (
                                <td 
                                  key={day} 
                                  className={cn(
                                    "py-2 px-0.5 text-center font-mono border-r",
                                    qty > 0 ? "font-black text-red-600 bg-rose-50/50" : "text-slate-300"
                                  )}
                                >
                                  {qty}
                                </td>
                              );
                            })}

                            {/* Total usage */}
                            <td className="py-2 px-1 text-center font-mono font-black text-indigo-600 border-r bg-indigo-50/20">
                              {row.totalUsage}
                            </td>

                            {/* Sisa/Stok akhir */}
                            <td className={cn(
                              "py-2 px-1 text-center font-mono font-black border-r",
                              row.finalStock === 0 ? "text-red-500 bg-red-50/10" : "text-slate-800"
                            )}>
                              {row.finalStock}
                            </td>
                          </tr>
                        );
                      })}

                      {/* TOTALS FOOTER ROW */}
                      <tr className="bg-slate-100 font-black text-slate-800 text-center border-t border-slate-300">
                        <td colSpan={2} className="py-3 px-3 text-left uppercase border-r text-[9px]">TOTAL SELURUH</td>
                        
                        {/* Sum Total Stok */}
                        <td className="py-3 px-1 font-mono text-[10px] border-r bg-cyan-100/50 text-cyan-700">
                          {totalInitialStockAll + totalReceivedAll}
                        </td>

                        {/* Sum daily columns */}
                        {daysArray.map((day) => {
                          const dailySum = reportRows.reduce((sum, r) => sum + (r.usageByDay[day] ?? 0), 0);
                          return (
                            <td key={day} className="py-2 px-0.5 font-mono text-[9px] border-r">
                              {dailySum}
                            </td>
                          );
                        })}

                        {/* Sum Total usage */}
                        <td className="py-3 px-1 font-mono text-[10px] border-r bg-indigo-100/50 text-indigo-700">
                          {totalUsageAll}
                        </td>

                        {/* Sum Sisa ketersediaan */}
                        <td className="py-3 px-1 font-mono text-[10px] bg-slate-200">{totalFinalStockAll}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {reportRows.length === 0 && (
                  <div className="text-center py-12 text-slate-400 uppercase tracking-widest font-mono text-[10px]">
                    Tidak Ada Data Obat Ditemukan
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
