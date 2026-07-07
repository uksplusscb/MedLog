import { getCachedDriveToken, setCachedDriveToken } from './drive';

export let SPREADSHEET_ID = '17EEP1c0klbntmLxVsjYGElkEqLejLncqvnDNoqsfZsc';
export let MASTER_SPREADSHEET_ID = '1ucDQBJmJwcWnawmWIuQXTZXBlm4sMA0XKxWzBlA5Fv8';

export function getDailyVisitsSpreadsheetId(): string {
  const custom = localStorage.getItem('uks_daily_visit_spreadsheet_id') || '';
  if (custom && custom.trim() && custom !== 'undefined') {
    return custom.trim();
  }
  return '17EEP1c0klbntmLxVsjYGElkEqLejLncqvnDNoqsfZsc';
}

export function getMasterSpreadsheetId(): string {
  const custom = localStorage.getItem('uks_master_spreadsheet_id') || '';
  if (custom && custom.trim() && custom !== 'undefined') {
    return custom.trim();
  }
  return '1ucDQBJmJwcWnawmWIuQXTZXBlm4sMA0XKxWzBlA5Fv8';
}

export function refreshSpreadsheetIds() {
  SPREADSHEET_ID = getDailyVisitsSpreadsheetId();
  MASTER_SPREADSHEET_ID = getMasterSpreadsheetId();
  cachedTargetSheetName = null;
  // Clear headers initialized map
  for (const k in headersInitializedMap) {
    delete headersInitializedMap[k];
  }
}

// Clear caches automatically when Google Drive connection changes
if (typeof window !== 'undefined') {
  window.addEventListener('uks_drive_connection_changed', () => {
    cachedTargetSheetName = null;
    cachedMasterSheetNames = {
      students: null,
      medicines: null,
      diagnoses: null,
      teachers: null
    };
    for (const k in headersInitializedMap) {
      delete headersInitializedMap[k];
    }
    console.log('[Sheets] Connection state changed, all sheets caches cleared.');
  });
}

export async function getFonnteToken(): Promise<string> {
  const cached = localStorage.getItem('uks_fonnte_token');
  if (cached && cached !== 'undefined') {
    return cached;
  }
  try {
    const { db } = await import('./firebase');
    const { doc, getDoc } = await import('firebase/firestore');
    const docRef = doc(db, 'settings', 'global_config');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      const token = data.fonnte_token || '';
      if (token) {
        localStorage.setItem('uks_fonnte_token', token);
        return token;
      }
    }
  } catch (err) {
    console.warn("Gagal mengambil Fonnte token dari Firestore:", err);
  }
  return '';
}

let cachedTargetSheetName: string | null = null;
const headersInitializedMap: Record<string, boolean> = {};

export interface SheetRowData {
  id: string; // Visit ID
  date: string;
  studentName: string;
  gender: string;
  age: string | number;
  grade: string;
  complaint: string;
  bloodPressure: string;
  weight: string | number;
  temperature: string | number;
  diagnosis: string;
  therapy: string;
  action: string;
  teacherName: string;
  supervisorName: string;
  parentName?: string;
  parentWhatsApp?: string;
  labUrl?: string;
}

/**
 * Retrieves the exact title of the sheet corresponding to gid=0 (the very first sheet)
 */
export async function getTargetSheetName(accessToken: string): Promise<string> {
  refreshSpreadsheetIds();
  if (cachedTargetSheetName) {
    return cachedTargetSheetName;
  }
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${getDailyVisitsSpreadsheetId()}?fields=sheets.properties`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error(`UNAUTHORIZED: Gagal mendapatkan info spreadsheet (HTTP ${res.status})`);
      }
      throw new Error(`Gagal mendapatkan info spreadsheet: HTTP ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const sheets = data.sheets || [];
    // Match the sheet with sheetId === 0 or index === 0
    const firstSheet = sheets.find((s: any) => s.properties?.sheetId === 0) || sheets[0];
    const sheetName = firstSheet?.properties?.title || 'Sheet1';
    cachedTargetSheetName = sheetName;
    return sheetName;
  } catch (err: any) {
    if (err?.message?.includes('UNAUTHORIZED')) {
      throw err;
    }
    console.warn("Fallback to 'Sheet1' sheet name:", err);
    return 'Sheet1';
  }
}

/**
 * Initializes the default headers for the spreadsheet if they are not defined.
 */
export async function initializeHeadersIfNeeded(accessToken: string, sheetName: string): Promise<boolean> {
  refreshSpreadsheetIds();
  if (headersInitializedMap[sheetName]) {
    return true;
  }
  try {
    // Check first 1 row to see if anything is there
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${getDailyVisitsSpreadsheetId()}/values/${encodeURIComponent(sheetName)}!A1:R1`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error(`UNAUTHORIZED: Gagal memeriksa header spreadsheet (HTTP ${res.status})`);
      }
      return false;
    }
    
    const data = await res.json();
    if (data.values && data.values.length > 0 && data.values[0].length > 0) {
      // Headers already exist
      headersInitializedMap[sheetName] = true;
      return true;
    }

    // Write default headers
    const headers = [
      "ID Kunjungan",
      "Tanggal & Waktu",
      "Nama Siswa",
      "Jenis Kelamin",
      "Umur",
      "Kelas",
      "Keluhan",
      "Tekanan Darah",
      "Berat Badan (kg)",
      "Suhu Tubuh (°C)",
      "Diagnosis",
      "Terapi / Obat",
      "Tindakan",
      "Nama Wali Kelas",
      "Nama Pembina UKS",
      "Nama Orang Tua",
      "No. WhatsApp Orang Tua",
      "Tautan Foto Lab/Suket"
    ];

    const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${getDailyVisitsSpreadsheetId()}/values/${encodeURIComponent(sheetName)}!A1:R1?valueInputOption=USER_ENTERED`;
    const writeRes = await fetch(writeUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [headers]
      })
    });

    if (!writeRes.ok) {
      if (writeRes.status === 401 || writeRes.status === 403) {
        throw new Error(`UNAUTHORIZED: Inisialisasi headers gagal (HTTP ${writeRes.status})`);
      }
    }
    headersInitializedMap[sheetName] = true;
    return true;
  } catch (err: any) {
    if (err?.message?.includes('UNAUTHORIZED')) {
      throw err;
    }
    console.error("Gagal inisialisasi headers Google Sheet:", err);
    return false;
  }
}

/**
 * Synchronizes a single visit record to the custom Google Sheet.
 * Searches if the ID already exists to update it; otherwise, appends a new row.
 */
export async function syncVisitToGoogleSheets(row: SheetRowData, isUpdate: boolean = false): Promise<{ success: boolean; error?: string }> {
  refreshSpreadsheetIds();
  const token = getCachedDriveToken();
  if (!token) {
    console.log("Sinkronisasi Google Sheets dilewati: Token Google tidak ditemukan atau belum terhubung.");
    return { success: false, error: 'Hubungkan Google Drive terlebih dahulu' };
  }

  try {
    console.log("Memulai sinkronisasi data kunjungan ke Google Sheets...", row.id, "isUpdate:", isUpdate);
    const sheetName = await getTargetSheetName(token);
    await initializeHeadersIfNeeded(token, sheetName);

    // Format fields cleanly
    const formattedRow = [
      row.id,
      row.date ? new Date(row.date).toLocaleString('id-ID') : '',
      row.studentName || '',
      row.gender || '',
      row.age || '',
      row.grade || '',
      row.complaint || '',
      row.bloodPressure || '',
      row.weight || '',
      row.temperature || '',
      row.diagnosis || '',
      row.therapy || '',
      row.action || '',
      row.teacherName || '',
      row.supervisorName || '',
      row.parentName || '',
      row.parentWhatsApp || '',
      row.labUrl || ''
    ];

    let existingRowIndex = -1;

    // Search existing index ONLY when updating
    if (isUpdate) {
      // Read ID column (A) to find if this record was already added
      const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${getDailyVisitsSpreadsheetId()}/values/${encodeURIComponent(sheetName)}!A:A`;
      const readRes = await fetch(readUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (readRes.ok) {
        const readData = await readRes.json();
        const values = readData.values || [];
        // Find row with matching ID (case-insensitive & trim matching)
        existingRowIndex = values.findIndex((val: any[]) => val && val[0] && val[0].toString().trim() === row.id.trim());
      }
    }

    if (existingRowIndex !== -1) {
      // Row index in Sheets API is 1-based, so it is existingRowIndex + 1
      const rowNum = existingRowIndex + 1;
      const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${getDailyVisitsSpreadsheetId()}/values/${encodeURIComponent(sheetName)}!A${rowNum}:R${rowNum}?valueInputOption=USER_ENTERED`;
      
      console.log(`Menemukan data lama di baris ${rowNum}. Melakukan pembaharuan baris di Google Sheets...`);
      const updateRes = await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          values: [formattedRow]
        })
      });

      if (!updateRes.ok) {
        if (updateRes.status === 401 || updateRes.status === 403) {
          throw new Error(`UNAUTHORIZED: Gagal memperbarui baris ${rowNum} (HTTP ${updateRes.status})`);
        }
        throw new Error(`Gagal memperbarui baris ${rowNum}: HTTP ${updateRes.status} ${updateRes.statusText}`);
      }
      console.log(`Berhasil memperbarui data kunjungan di Google Sheets baris ${rowNum}!`);
    } else {
      // Appending new entry
      const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${getDailyVisitsSpreadsheetId()}/values/${encodeURIComponent(sheetName)}!A:R:append?valueInputOption=USER_ENTERED`;
      
      console.log("Data kunjungan baru. Melakukan append baris di Google Sheets...");
      const appendRes = await fetch(appendUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          values: [formattedRow]
        })
      });

      if (!appendRes.ok) {
        if (appendRes.status === 401 || appendRes.status === 403) {
          throw new Error(`UNAUTHORIZED: Gagal menambahkan data (HTTP ${appendRes.status})`);
        }
        throw new Error(`Gagal melakukan append baris: HTTP ${appendRes.status} ${appendRes.statusText}`);
      }
      console.log("Berhasil menambahkan data pemeriksaan baru ke Google Sheets!");
    }

    // Trigger complete background silent sync notification event
    window.dispatchEvent(new CustomEvent('uks_sheet_sync_completed', { detail: { id: row.id } }));
    return { success: true };
  } catch (err: any) {
    console.error("Sinkronisasi Google Sheets gagal:", err);
    const errMsg = err?.message || '';
    if (errMsg.includes('401') || errMsg.includes('403') || errMsg.toUpperCase().includes('UNAUTHORIZED') || errMsg.toLowerCase().includes('invalid credentials')) {
      console.warn("Token Google kedaluwarsa atau tidak valid, menghapus cache token...");
      setCachedDriveToken(null);
      window.dispatchEvent(new CustomEvent('uks_sheet_sync_completed'));
    }
    return { success: false, error: errMsg || String(err) };
  }
}

/**
 * Performs full synchronisaton of entire visits database into the Google Sheet.
 * Useful for catching up or checking outputs.
 */
export async function syncAllVisitsToGoogleSheets(): Promise<{ success: boolean; count: number; error?: string }> {
  refreshSpreadsheetIds();
  const token = getCachedDriveToken();
  if (!token) {
    return { success: false, count: 0, error: 'Hubungkan Google Drive terlebih dahulu' };
  }

  try {
    const { db } = await import('./firebase');
    const { getDocs, collection, query, orderBy } = await import('firebase/firestore');
    
    console.log("Mengunduh semua kunjungan dari cloud untuk sinkronisasi masal Google Sheets...");
    const snap = await getDocs(query(collection(db, 'visits'), orderBy('date', 'asc')));
    const visits = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

    if (visits.length === 0) {
      return { success: true, count: 0 };
    }

    const sheetName = await getTargetSheetName(token);
    await initializeHeadersIfNeeded(token, sheetName);

    // Prepare rows
    const rows = visits.map(v => [
      v.id,
      v.date ? new Date(v.date).toLocaleString('id-ID') : '',
      v.studentName || '',
      v.gender || '',
      v.age || '',
      v.grade || '',
      v.complaint || '',
      v.bloodPressure || '',
      v.weight || '',
      v.temperature || '',
      v.diagnosis || '',
      v.therapy || '',
      v.action || '',
      v.teacherName || '',
      v.supervisorName || '',
      v.parentName || '',
      v.parentWhatsApp || '',
      v.labPhotos && v.labPhotos.length > 0 
        ? `${window.location.origin}/?view-lab=${v.studentId || '_'}_${v.id}`
        : (v.labPhoto ? `${window.location.origin}/?view-lab=${v.studentId || '_'}_${v.id}` : '')
    ]);

    // Keep the headers and overwrite the remaining rows with values, or append
    // To ensure consistency, let's clear the range or overwrite starting from cell A2
    const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${getDailyVisitsSpreadsheetId()}/values/${encodeURIComponent(sheetName)}!A2:R100000:clear`;
    await fetch(clearUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${getDailyVisitsSpreadsheetId()}/values/${encodeURIComponent(sheetName)}!A2:R${rows.length + 1}?valueInputOption=USER_ENTERED`;
    const writeRes = await fetch(writeUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: rows
      })
    });

    if (!writeRes.ok) {
      if (writeRes.status === 401 || writeRes.status === 403) {
        throw new Error(`UNAUTHORIZED: Gagal sinkronisasi data masal Google Sheets (HTTP ${writeRes.status})`);
      }
      throw new Error(`Gagal sinkronisasi data masal Google Sheets: HTTP ${writeRes.status} ${writeRes.statusText}`);
    }

    console.log(`Berhasil mensinkronisasi masal ${visits.length} baris data ke Google Sheets!`);
    return { success: true, count: visits.length };
  } catch (err: any) {
    console.error("Gagal sinkronisasi masal Google Sheets:", err);
    const errMsg = err?.message || '';
    if (errMsg.includes('401') || errMsg.includes('403') || errMsg.toUpperCase().includes('UNAUTHORIZED') || errMsg.toLowerCase().includes('invalid credentials')) {
      console.warn("Token Google kedaluwarsa atau tidak valid, menghapus cache token...");
      setCachedDriveToken(null);
      window.dispatchEvent(new CustomEvent('uks_sheet_sync_completed'));
    }
    return { success: false, count: 0, error: err.message || 'Error tidak diketahui' };
  }
}

// Cache resolved sheet names to minimize Google API quote consumption
let cachedMasterSheetNames: Record<'students' | 'medicines' | 'diagnoses' | 'teachers', string | null> = {
  students: null,
  medicines: null,
  diagnoses: null,
  teachers: null
};

/**
 * Resolves the actual Google Sheet tab name for each master database type.
 * Tab 1 (Identitas) -> Patient DB, Tab 2 (Obat) -> Medicine DB, Tab 3 (Diagnosa) -> Diagnosis DB.
 * Supports flexible lowercase, uppercase or standard containing names.
 */
export async function resolveMasterSheetName(token: string, type: 'students' | 'medicines' | 'diagnoses' | 'teachers'): Promise<string> {
  refreshSpreadsheetIds();
  if (cachedMasterSheetNames[type]) {
    return cachedMasterSheetNames[type]!;
  }

  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}?fields=sheets.properties`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        setCachedDriveToken(null);
        throw new Error('UNAUTHORIZED');
      }
      return type === 'students' ? 'Identitas' : type === 'medicines' ? 'Obat' : type === 'diagnoses' ? 'Diagnosa' : 'Kontak Guru';
    }

    const data = await res.json();
    const sheets = data.sheets || [];
    const sheetTitles = sheets.map((s: any) => s.properties?.title || '').filter(Boolean);

    // 1. Resolve student sheet: Priority to index 0 (Sheet 1) or search for "identitas"/"pasien"
    let studentSheet = sheets[0]?.properties?.title;
    if (!studentSheet || (!studentSheet.toLowerCase().includes('identitas') && !studentSheet.toLowerCase().includes('pasien') && !studentSheet.toLowerCase().includes('siswa') && sheets.length > 1)) {
      const found = sheetTitles.find((t: string) => {
        const lt = t.toLowerCase();
        return lt === 'identitas' || lt === 'pasien' || lt.includes('identitas') || lt.includes('pasien') || lt === 'data pasien' || lt.includes('siswa');
      });
      if (found) studentSheet = found;
    }
    cachedMasterSheetNames.students = studentSheet || 'Identitas';

    // 2. Resolve medicine sheet: Priority to index 1 (Sheet 2) or search for "obat"
    let medicineSheet = sheets[1]?.properties?.title;
    if (!medicineSheet || (!medicineSheet.toLowerCase().includes('obat') && !medicineSheet.toLowerCase().includes('alkes') && sheets.length > 2)) {
      const found = sheetTitles.find((t: string) => {
        const lt = t.toLowerCase();
        return lt === 'obat-obatan' || lt === 'obat' || lt.includes('obat') || lt === 'data obat' || lt.includes('alkes');
      });
      if (found) medicineSheet = found;
    }
    cachedMasterSheetNames.medicines = medicineSheet || 'Obat';

    // 3. Resolve diagnosis sheet: Priority to index 2 (Sheet 3) or search for "diagnosa"
    let diagnosisSheet = sheets[2]?.properties?.title;
    if (!diagnosisSheet) {
      const found = sheetTitles.find((t: string) => {
        const lt = t.toLowerCase();
        return lt === 'diagnosa' || lt.includes('diagnosa') || lt === 'data diagnosa' || lt.includes('gejala') || lt.includes('diagnosis');
      });
      if (found) diagnosisSheet = found;
    }
    cachedMasterSheetNames.diagnoses = diagnosisSheet || 'Diagnosa';

    // 4. Resolve teacher/pembina sheet: Priority to index 3 (Sheet 4) or search for "guru"/"pembina"/"wali"
    let teacherSheet = sheets[3]?.properties?.title;
    if (!teacherSheet) {
      const found = sheetTitles.find((t: string) => {
        const lt = t.toLowerCase();
        return lt === 'guru' || lt.includes('guru') || lt.includes('pembina') || lt.includes('wali') || lt.includes('kontak') || lt.includes('telepon');
      });
      if (found) teacherSheet = found;
    }
    cachedMasterSheetNames.teachers = teacherSheet || 'Kontak Guru';

    console.log(`Resolved master sheet name for ${type}: "${cachedMasterSheetNames[type]}"`);
    return cachedMasterSheetNames[type]!;
  } catch (err) {
    console.error(`Gagal dinamis mencari sheet master ${type}, menggunakan default:`, err);
    return type === 'students' ? 'Identitas' : type === 'medicines' ? 'Obat' : type === 'diagnoses' ? 'Diagnosa' : 'Kontak Guru';
  }
}

/**
 * Ensures that master database sheet tabs ("Identitas", "Obat", "Diagnosa") exist.
 */
export async function ensureMasterSheetsExist(token: string): Promise<boolean> {
  refreshSpreadsheetIds();
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}?fields=sheets.properties`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        setCachedDriveToken(null);
        throw new Error('UNAUTHORIZED');
      }
      return false;
    }
    const data = await res.json();
    const sheets = data.sheets || [];
    const titles = sheets.map((s: any) => s.properties?.title || '');

    const requiredSheets = ['Identitas', 'Obat', 'Diagnosa', 'Kontak Guru'];
    const requests = requiredSheets
      .filter(title => {
        const checkWord = title === 'Identitas' ? 'identitas' : title === 'Obat' ? 'obat' : title === 'Diagnosa' ? 'diagnosa' : 'guru';
        // Match contains keyword (so 'identitas pasien' or 'obat-obatan' keeps us from making duplicates)
        return !titles.some((t: string) => t.toLowerCase().includes(checkWord));
      })
      .map(title => ({
        addSheet: {
          properties: { title }
        }
      }));

    if (requests.length > 0) {
      console.log("Membuat tabel baru di Google Sheets:", requests.map(r => r.addSheet.properties.title));
      const batchUpdateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}:batchUpdate`;
      const batchRes = await fetch(batchUpdateUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests })
      });
      // Clear cache on sheet generation
      cachedMasterSheetNames = { students: null, medicines: null, diagnoses: null, teachers: null };
      return batchRes.ok;
    }
    return true;
  } catch (err) {
    console.error("Gagal memastikan sheet master ada:", err);
    return false;
  }
}

/**
 * Ensures the headers are populated for a given master sheet index/type.
 */
export async function initializeMasterHeadersIfNeeded(token: string, sheetTitle: string, type: 'students' | 'medicines' | 'diagnoses' | 'teachers'): Promise<boolean> {
  refreshSpreadsheetIds();
  try {
    const checkUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(sheetTitle)}!A1:F1`;
    const checkRes = await fetch(checkUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!checkRes.ok) return false;
    
    const checkData = await checkRes.json();
    if (checkData.values && checkData.values.length > 0 && checkData.values[0].length > 0) {
      return true; // Headers exist
    }

    const headers = 
      type === 'students' ? ["ID Pasien", "Nama Lengkap", "Kelas", "Jenis Kelamin", "Tanggal Lahir", "Bermasalah"] :
      type === 'medicines' ? ["ID Obat", "Nama Obat / Alkes", "Stok", "Satuan"] :
      type === 'teachers' ? ["WALI KELAS", "KATEGORI", "NAMA GURU", "NO. WHATSAPP"] :
      ["ID Diagnosa", "Nama Diagnosa / Gejala"];

    const maxCol = type === 'students' ? 'F' : type === 'medicines' ? 'D' : type === 'teachers' ? 'D' : 'B';
    const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(sheetTitle)}!A1:${maxCol}1?valueInputOption=USER_ENTERED`;
    const writeRes = await fetch(writeUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [headers]
      })
    });
    return writeRes.ok;
  } catch (err) {
    console.error(`Gagal inisialisasi headers master ${sheetTitle}:`, err);
    return false;
  }
}

/**
 * Fetches master data from the public Google Sheet using the Visualization API as an unauthenticated fallback.
 */
export async function fetchPublicMasterDataFromSheets(type: 'students' | 'medicines' | 'diagnoses' | 'teachers'): Promise<any[]> {
  refreshSpreadsheetIds();
  try {
    let url = '';
    if (type === 'teachers') {
      url = `https://docs.google.com/spreadsheets/d/${MASTER_SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=534098063`;
    } else {
      const sheetNameMap = {
        students: 'Identitas Pasien',
        medicines: 'Obat',
        diagnoses: 'Diagnosa'
      };
      const sheetName = sheetNameMap[type as 'students' | 'medicines' | 'diagnoses'];
      url = `https://docs.google.com/spreadsheets/d/${MASTER_SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
    }
    
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const text = await res.text();
    if (!text || text.includes('error') || text.trim().length === 0) {
      throw new Error("Empty or failed response from sheet gviz");
    }

    // Parse CSV rows safely
    const lines: string[][] = [];
    const rows = text.split(/\r?\n/);
    for (const row of rows) {
      if (!row.trim()) continue;
      const cols: string[] = [];
      let insideQuote = false;
      let current = '';
      for (let i = 0; i < row.length; i++) {
        const char = row[i];
        if (char === '"') {
          insideQuote = !insideQuote;
        } else if (char === ',' && !insideQuote) {
          cols.push(current.replace(/^"(.*)"$/, '$1').trim());
          current = '';
        } else {
          current += char;
        }
      }
      cols.push(current.replace(/^"(.*)"$/, '$1').trim());
      lines.push(cols);
    }

    if (lines.length <= 1) return []; // Only headers

    const firstRow = lines[0] || [];
    const headerMap: Record<number, string> = {};
    firstRow.forEach((hVal, index) => {
      const h = hVal ? hVal.toString().toLowerCase().trim().replace(/^"+|"+$/g, '') : '';
      let mappedKey = '';
      
      if (type === 'students') {
        if (h === 'id' || h === 'id siswa' || h === 'id_siswa' || h === 'no' || h === 'no.') {
          mappedKey = 'id';
        } else if (h === 'nama siswa' || h === 'nama' || h === 'name' || h.includes('nama') || h.includes('name')) {
          mappedKey = 'name';
        } else if (h === 'kelas' || h === 'grade' || h === 'rombel') {
          mappedKey = 'grade';
        } else if (h === 'jenis kelamin' || h === 'gender' || h === 'jk' || h.includes('kelamin') || h.includes('gender')) {
          mappedKey = 'gender';
        } else if (h === 'tanggal lahir' || h === 'birthdate' || h === 'tgl' || h.includes('lahir') || h.includes('tanggal')) {
          mappedKey = 'birthDate';
        } else if (h === 'bermasalah' || h === 'masalah' || h === 'is_problem') {
          mappedKey = 'bermasalah';
        } else if (h === 'nis' || h === 'no_induk' || h === 'no induk' || h === 'nomor induk' || h.includes('nis') || h.includes('induk')) {
          mappedKey = 'nis';
        } else if (h === 'asrama' || h === 'dormitory' || h === 'rayon' || h.includes('asrama') || h.includes('dorm')) {
          mappedKey = 'asrama';
        }
      } else if (type === 'medicines') {
        if (h === 'id' || h === 'id obat' || h === 'id_obat' || h === 'no' || h === 'no.') {
          mappedKey = 'id';
        } else if (h === 'nama obat' || h === 'nama' || h === 'name' || h === 'obat' || h.includes('nama') || h.includes('obat') || h.includes('name')) {
          mappedKey = 'name';
        } else if (h === 'stok' || h === 'stock' || h === 'jumlah' || h === 'qty') {
          mappedKey = 'stock';
        } else if (h === 'satuan' || h === 'unit') {
          mappedKey = 'unit';
        }
      } else if (type === 'diagnoses') {
        if (h === 'id' || h === 'id diagnosa' || h === 'id_diagnosa' || h === 'no' || h === 'no.') {
          mappedKey = 'id';
        } else if (h === 'nama diagnosa' || h === 'nama' || h === 'name' || h === 'diagnosa' || h.includes('nama') || h.includes('diagnosa') || h.includes('name') || h.includes('gejala')) {
          mappedKey = 'name';
        }
      } else if (type === 'teachers') {
        const lh = h.toLowerCase();
        if (lh === 'id' || lh === 'id_guru' || lh === 'id guru' || lh === 'no' || lh === 'no.') {
          mappedKey = 'id';
        } else if (lh === 'wali kelas' || lh === 'wali_kelas' || lh === 'kelas' || lh === 'grade') {
          mappedKey = 'grade';
        } else if (lh === 'kategori' || lh === 'category' || lh === 'gender' || lh === 'jk') {
          mappedKey = 'gender';
        } else if (lh === 'nama' || lh === 'nama lengkap' || lh === 'nama guru' || lh === 'nama pembina' || lh.includes('nama') || lh.includes('pembina') || lh === 'name' || lh.includes('name')) {
          mappedKey = 'name';
        } else if (lh === 'whatsapp' || lh === 'no wa' || lh === 'no_wa' || lh === 'no hp' || lh === 'no. wa' || lh.includes('whatsapp') || lh.includes('wa') || lh.includes('telp') || lh.includes('phone')) {
          mappedKey = 'whatsapp';
        }
      }

      let fallbackKey = '';
      if (!mappedKey) {
        if (type === 'students') {
          if (index === 0) fallbackKey = 'id';
          else if (index === 1) fallbackKey = 'name';
          else if (index === 2) fallbackKey = 'grade';
          else if (index === 3) fallbackKey = 'gender';
          else if (index === 4) fallbackKey = 'birthDate';
          else if (index === 5) fallbackKey = 'bermasalah';
        } else if (type === 'medicines') {
          if (index === 0) fallbackKey = 'id';
          else if (index === 1) fallbackKey = 'name';
          else if (index === 2) fallbackKey = 'stock';
          else if (index === 3) fallbackKey = 'unit';
        } else if (type === 'diagnoses') {
          if (index === 0) fallbackKey = 'id';
          else if (index === 1) fallbackKey = 'name';
        } else if (type === 'teachers') {
          if (index === 0) fallbackKey = 'grade';
          else if (index === 1) fallbackKey = 'gender';
          else if (index === 2) fallbackKey = 'name';
          else if (index === 3) fallbackKey = 'whatsapp';
          else fallbackKey = '';
        }
      }

      headerMap[index] = mappedKey || fallbackKey || h;
    });

    // Safeguard
    const hasNameMapping = Object.values(headerMap).includes('name');
    if (!hasNameMapping) {
      headerMap[2] = 'name';
    }

    const records: any[] = [];
    const dataRows = lines.slice(1);

    let currentRole = 'wali_kelas';
    dataRows.forEach((row, idx) => {
      const col2Val = row[2] ? row[2].toString().toLowerCase().trim().replace(/^"+|"+$/g, '') : '';
      if (col2Val.includes('pembina')) {
        currentRole = 'pembina';
      } else if (col2Val.includes('wali kelas') || col2Val.includes('nama guru')) {
        currentRole = 'wali_kelas';
      }

      const item: any = {};
      item.id = `pub_sheet_row_${idx + 2}`;

      row.forEach((cell, idx) => {
        const key = headerMap[idx];
        if (key) {
          let val = cell !== undefined && cell !== null ? cell.toString().trim().replace(/^"+|"+$/g, '') : '';
          if (key === 'stock') {
            item[key] = parseInt(val, 10) || 0;
          } else if (key === 'bermasalah') {
            const lowVal = val.toLowerCase();
            item[key] = lowVal === 'ya' || lowVal === 'yes' || lowVal === 'y' || lowVal === 'true' || lowVal === '1';
          } else {
            item[key] = val;
          }
        }
      });

      if (!item.name) {
        item.name = item.obat || item.nama || row[2] || row[1] || '';
      }

      item.name = (item.name || '').trim().replace(/^"+|"+$/g, '');
      const cleanName = item.name.toLowerCase();
      
      const isHeaderOrEmpty = !item.name || 
        item.name === 'Tanpa Nama' || 
        cleanName === 'nama' || 
        cleanName === 'nama obat' || 
        cleanName === 'diagnosa' || 
        cleanName === 'nama guru' || 
        cleanName === 'pembina' || 
        cleanName === 'nama pembina' || 
        cleanName === 'wali kelas' || 
        cleanName === 'kategori' || 
        cleanName === 'nama lengkap' || 
        cleanName === 'no. whatsapp' || 
        cleanName === 'whatsapp' ||
        cleanName.includes('nama guru') ||
        cleanName.includes('nama pembina');

      if (isHeaderOrEmpty) {
        return;
      }

      if (type === 'students') {
        item.gender = item.gender || 'Laki-laki';
        item.birthDate = item.birthDate || '';
        item.grade = item.grade || '';
        item.bermasalah = !!item.bermasalah;
        item.nis = item.nis || '';
        item.asrama = item.asrama || '';
      } else if (type === 'medicines') {
        item.obat = item.name;
        item.stock = item.stock !== undefined ? item.stock : 100;
        item.unit = item.unit || 'Pcs';
      } else if (type === 'diagnoses') {
        item.diagnosa = item.name;
      } else if (type === 'teachers') {
        // Build stable unique ID based on cleaned lowercase name so they do not overwrite each other
        item.id = 'tr_' + item.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
        item.whatsapp = item.whatsapp || '';
        item.role = currentRole;
      }

      records.push(item);
    });

    return records;
  } catch (err) {
    console.warn(`Gagal memuat public sheet master ${type}:`, err);
    return [];
  }
}

/**
 * Fetches the clinic master database records (patients, medicines, diagnoses) from Google Sheets.
 * Supports tokenized Google Drive session with automatic unauthenticated public fallback.
 */
export async function fetchMasterDataFromSheets(token: string | null | undefined, type: 'students' | 'medicines' | 'diagnoses' | 'teachers'): Promise<any[]> {
  refreshSpreadsheetIds();
  if (!token) {
    console.log(`Token tidak ditemukan untuk Google Drive, memuat ${type} via fallback pembaca publik...`);
    return fetchPublicMasterDataFromSheets(type);
  }

  try {
    const sheetName = await resolveMasterSheetName(token, type);
    await ensureMasterSheetsExist(token);
    await initializeMasterHeadersIfNeeded(token, sheetName, type);

    const maxCol = type === 'students' ? 'F' : type === 'medicines' ? 'D' : type === 'teachers' ? 'D' : 'B';
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A1:${maxCol}100000`;
    
    const res = await fetch(readUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        setCachedDriveToken(null);
        console.warn('Sesi Google Drive berakhir, memuat lewat pembaca publik...');
      }
      return fetchPublicMasterDataFromSheets(type);
    }

    const data = await res.json();
    const values = data.values || [];
    if (values.length === 0) {
      return fetchPublicMasterDataFromSheets(type);
    }

    // Robust header row locator: find first row containing key indicators, defaulting to row 0
    let headerRowIndex = 0;
    for (let i = 0; i < Math.min(values.length, 10); i++) {
      const r = values[i];
      if (r && r.some(cell => {
        const val = cell ? cell.toString().toLowerCase() : '';
        return val.includes('nama') || val.includes('obat') || val.includes('siswa') || val.includes('pasien') || val.includes('stok') || val.includes('diagnosa') || val.includes('id') || val.includes('alkes') || val.includes('guru') || val.includes('pembina') || val.includes('wali') || val.includes('whatsapp') || val.includes('wa');
      })) {
        headerRowIndex = i;
        break;
      }
    }

    const headers = values[headerRowIndex].map((h: any) => h ? h.toString().toLowerCase().trim() : '');
    const rows = values.slice(headerRowIndex + 1);

    const headerMap: Record<number, string> = {};
    headers.forEach((h: string, index: number) => {
      let mappedKey: string | null = null;
      if (type === 'students') {
        if (h === 'id' || h === 'id pasien' || h === 'id_pasien' || h === 'no' || h === 'no.') {
          mappedKey = 'id';
        } else if (h === 'nama lengkap' || h === 'nama' || h === 'name' || h === 'siswa' || h === 'pasien' || h.includes('nama') || h.includes('name')) {
          mappedKey = 'name';
        } else if (h === 'kelas' || h === 'grade' || h === 'class' || h.includes('kelas') || h.includes('grade')) {
          mappedKey = 'grade';
        } else if (h === 'jenis kelamin' || h === 'gender' || h === 'jk' || h.includes('kelamin') || h.includes('gender') || h.includes('jk')) {
          mappedKey = 'gender';
        } else if (h === 'tanggal lahir' || h === 'birthdate' || h === 'tgl lahir' || h.includes('lahir') || h.includes('tanggal') || h.includes('birth')) {
          mappedKey = 'birthDate';
        } else if (h === 'bermasalah' || h === 'status' || h.includes('masalah')) {
          mappedKey = 'bermasalah';
        }
      } else if (type === 'medicines') {
        const lh = h.toLowerCase();
        if (lh === 'id' || lh === 'id obat' || lh === 'id_obat' || lh === 'no' || lh === 'no.') {
          mappedKey = 'id';
        } else if (lh === 'stok' || lh === 'stock' || lh === 'jumlah' || lh.includes('stok') || lh.includes('stock') || lh.includes('jumlah') || lh.includes('qty')) {
          mappedKey = 'stock';
        } else if (lh === 'satuan' || lh === 'unit' || lh.includes('satuan') || lh.includes('unit')) {
          mappedKey = 'unit';
        } else if (lh === 'nama obat' || lh === 'nama' || lh === 'name' || lh === 'obat' || lh.includes('nama') || lh.includes('obat') || lh.includes('name') || lh.includes('alkes')) {
          mappedKey = 'name';
        }
      } else if (type === 'diagnoses') {
        if (h === 'id' || h === 'id diagnosa' || h === 'id_diagnosa' || h === 'no' || h === 'no.') {
          mappedKey = 'id';
        } else if (h === 'nama diagnosa' || h === 'nama' || h === 'name' || h === 'diagnosa' || h.includes('nama') || h.includes('diagnosa') || h.includes('name') || h.includes('gejala')) {
          mappedKey = 'name';
        }
      } else if (type === 'teachers') {
        const lh = h.toLowerCase();
        if (lh === 'id' || lh === 'id_guru' || lh === 'id guru' || lh === 'no' || lh === 'no.') {
          mappedKey = 'id';
        } else if (lh === 'wali kelas' || lh === 'wali_kelas' || lh === 'kelas' || lh === 'grade') {
          mappedKey = 'grade';
        } else if (lh === 'kategori' || lh === 'category' || lh === 'gender' || lh === 'jk') {
          mappedKey = 'gender';
        } else if (lh === 'nama' || lh === 'nama lengkap' || lh === 'nama guru' || lh === 'nama pembina' || lh.includes('nama') || lh.includes('pembina') || lh === 'name' || lh.includes('name')) {
          mappedKey = 'name';
        } else if (lh === 'whatsapp' || lh === 'no wa' || lh === 'no_wa' || lh === 'no hp' || lh === 'no. wa' || lh.includes('whatsapp') || lh.includes('wa') || lh.includes('telp') || lh.includes('phone')) {
          mappedKey = 'whatsapp';
        }
      }

      let fallbackKey = '';
      if (!mappedKey) {
        if (type === 'students') {
          if (index === 0) fallbackKey = 'id';
          else if (index === 1) fallbackKey = 'name';
          else if (index === 2) fallbackKey = 'grade';
          else if (index === 3) fallbackKey = 'gender';
          else if (index === 4) fallbackKey = 'birthDate';
          else if (index === 5) fallbackKey = 'bermasalah';
        } else if (type === 'medicines') {
          if (index === 0) fallbackKey = 'id';
          else if (index === 1) fallbackKey = 'name';
          else if (index === 2) fallbackKey = 'stock';
          else if (index === 3) fallbackKey = 'unit';
        } else if (type === 'diagnoses') {
          if (index === 0) fallbackKey = 'id';
          else if (index === 1) fallbackKey = 'name';
        } else if (type === 'teachers') {
          if (index === 0) fallbackKey = 'grade';
          else if (index === 1) fallbackKey = 'gender';
          else if (index === 2) fallbackKey = 'name';
          else if (index === 3) fallbackKey = 'whatsapp';
          else fallbackKey = '';
        }
      }

      headerMap[index] = mappedKey || fallbackKey || h;
    });

    // Safeguard: if 'name' was not resolved, default appropriate column to 'name'
    const hasNameMapping = Object.values(headerMap).includes('name');
    if (!hasNameMapping) {
      if (type === 'teachers') {
        headerMap[2] = 'name';
      } else {
        headerMap[1] = 'name';
      }
    }

    let currentRole = 'wali_kelas';
    return rows
      .map((row: any[], rowIndex: number) => {
        const col2Val = row[2] ? row[2].toString().toLowerCase().trim().replace(/^"+|"+$/g, '') : '';
        if (col2Val.includes('pembina')) {
          currentRole = 'pembina';
        } else if (col2Val.includes('wali kelas') || col2Val.includes('nama guru')) {
          currentRole = 'wali_kelas';
        }

        const item: any = {};
        // Unique fallback identifier based on row number
        item.id = `sheet_row_${headerRowIndex + rowIndex + 2}`;

        row.forEach((cell, idx) => {
          const key = headerMap[idx];
          if (key) {
            let val = cell !== undefined && cell !== null ? cell.toString().trim() : '';
            if (key === 'stock') {
              item[key] = parseInt(val, 10) || 0;
            } else if (key === 'bermasalah') {
              const lowVal = val.toLowerCase();
              item[key] = lowVal === 'ya' || lowVal === 'yes' || lowVal === 'y' || lowVal === 'true' || lowVal === '1';
            } else {
              item[key] = val;
            }
          }
        });

        // Retain compatibility fields
        if (!item.name) {
          item.name = item.obat || item.nama || row[2] || row[1] || 'Tanpa Nama';
        }
        
        item.name = (item.name || '').trim();
        const cleanName = item.name.toLowerCase();

        const isHeaderOrEmpty = !item.name || 
          item.name === 'Tanpa Nama' || 
          cleanName === 'nama' || 
          cleanName === 'nama obat' || 
          cleanName === 'diagnosa' || 
          cleanName === 'nama guru' || 
          cleanName === 'pembina' || 
          cleanName === 'nama pembina' || 
          cleanName === 'wali kelas' || 
          cleanName === 'kategori' || 
          cleanName === 'nama lengkap' || 
          cleanName === 'no. whatsapp' || 
          cleanName === 'whatsapp' ||
          cleanName.includes('nama guru') ||
          cleanName.includes('nama pembina');

        if (isHeaderOrEmpty) {
          return null;
        }
        
        if (type === 'students') {
          item.gender = item.gender || 'Laki-laki';
          item.grade = item.grade || '';
          item.birthDate = item.birthDate || '';
          item.bermasalah = !!item.bermasalah;
        } else if (type === 'medicines') {
          item.obat = item.name;
          item.stock = item.stock || 0;
          item.unit = item.unit || 'Pcs';
        } else if (type === 'diagnoses') {
          item.diagnosa = item.name;
        } else if (type === 'teachers') {
          // Build stable unique ID based on cleaned lowercase name so they do not overwrite each other
          item.id = 'tr_' + item.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
          item.whatsapp = item.whatsapp || '';
          item.role = currentRole;
        }

        return item;
      })
      .filter((item): item is any => item !== null);
  } catch (err) {
    console.error(`Gagal memuat master data ${type} dari Google Sheets, mencoba pembaca publik...`, err);
    return fetchPublicMasterDataFromSheets(type);
  }
}

/**
 * Pushes/rewrites all master records (patients, medicines, diagnoses) to Google Sheets.
 */
export async function syncMasterDataToSheets(token: string, type: 'students' | 'medicines' | 'diagnoses' | 'teachers', items: any[]): Promise<boolean> {
  refreshSpreadsheetIds();
  try {
    const sheetName = await resolveMasterSheetName(token, type);
    await ensureMasterSheetsExist(token);
    await initializeMasterHeadersIfNeeded(token, sheetName, type);

    const rows = items.map((item, index) => {
      const itemId = item.id || `M-${type === 'students' ? 'PS' : type === 'medicines' ? 'OB' : type === 'teachers' ? 'TR' : 'DG'}-${Date.now()}-${index}`;
      if (type === 'students') {
        return [
          itemId,
          item.name || '',
          item.grade || '',
          item.gender || '',
          item.birthDate || '',
          item.bermasalah ? 'Ya' : 'Tidak'
        ];
      } else if (type === 'medicines') {
        return [
          itemId,
          item.name || '',
          item.stock || 0,
          item.unit || 'Pcs'
        ];
      } else if (type === 'teachers') {
        return [
          item.grade || '',
          item.gender || '',
          item.name || '',
          item.whatsapp || ''
        ];
      } else {
        return [
          itemId,
          item.name || ''
        ];
      }
    });

    // Clear old rows starting A2
    const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A2:F100000:clear`;
    await fetch(clearUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const maxCol = type === 'students' ? 'F' : type === 'medicines' ? 'D' : type === 'teachers' ? 'D' : 'B';
    const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A2:${maxCol}${rows.length + 1}?valueInputOption=USER_ENTERED`;
    const writeRes = await fetch(writeUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: rows
      })
    });

    return writeRes.ok;
  } catch (err) {
    console.error(`Gagal syncMasterDataToSheets untuk ${type}:`, err);
    return false;
  }
}

/**
 * Adds or updates an individual master database row in Google Sheets.
 */
export async function addOrUpdateMasterItemInSheets(token: string, type: 'students' | 'medicines' | 'diagnoses' | 'teachers', item: any, isUpdate: boolean): Promise<boolean> {
  refreshSpreadsheetIds();
  try {
    const sheetName = await resolveMasterSheetName(token, type);
    await ensureMasterSheetsExist(token);
    await initializeMasterHeadersIfNeeded(token, sheetName, type);

    const itemId = item.id || `M-${type === 'students' ? 'PS' : type === 'medicines' ? 'OB' : type === 'teachers' ? 'TR' : 'DG'}-${Date.now()}`;
    let existingRowIndex = -1;

    if (isUpdate && item.id) {
      const readRange = type === 'teachers' ? 'C:C' : 'A:A';
      const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!${readRange}`;
      const readRes = await fetch(readUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (readRes.ok) {
        const readData = await readRes.json();
        const values = readData.values || [];
        if (type === 'teachers' && item.name) {
          existingRowIndex = values.findIndex((val: any[]) => val && val[0] && val[0].toString().trim().toLowerCase() === item.name.trim().toLowerCase());
        } else {
          existingRowIndex = values.findIndex((val: any[]) => val && val[0] && val[0].toString().trim() === item.id.trim());
        }
      }
    }

    const formattedRow = type === 'students' ? [
      itemId,
      item.name || '',
      item.grade || '',
      item.gender || '',
      item.birthDate || '',
      item.bermasalah ? 'Ya' : 'Tidak'
    ] : type === 'medicines' ? [
      itemId,
      item.name || '',
      item.stock || 0,
      item.unit || 'Pcs'
    ] : type === 'teachers' ? [
      item.grade || '',
      item.gender || '',
      item.name || '',
      item.whatsapp || ''
    ] : [
      itemId,
      item.name || ''
    ];

    const maxCol = type === 'students' ? 'F' : type === 'medicines' ? 'D' : type === 'teachers' ? 'D' : 'B';

    if (existingRowIndex !== -1) {
      const rowNum = existingRowIndex + 1;
      const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A${rowNum}:${maxCol}${rowNum}?valueInputOption=USER_ENTERED`;
      const updateRes = await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          values: [formattedRow]
        })
      });
      return updateRes.ok;
    } else {
      const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A:${maxCol}:append?valueInputOption=USER_ENTERED`;
      const appendRes = await fetch(appendUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          values: [formattedRow]
        })
      });
      return appendRes.ok;
    }
  } catch (err) {
    console.error("Gagal menambahkan/mengupdate item database master di Google Sheets:", err);
    return false;
  }
}

/**
 * Deletes an individual master database row in Google Sheets.
 */
export async function deleteMasterItemInSheets(token: string, type: 'students' | 'medicines' | 'diagnoses' | 'teachers', itemId: string): Promise<boolean> {
  refreshSpreadsheetIds();
  try {
    const sheetName = await resolveMasterSheetName(token, type);
    
    // Find the row number first
    let existingRowIndex = -1;
    if (type === 'teachers') {
      const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!C:C`;
      const readRes = await fetch(readUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!readRes.ok) return false;
      const readData = await readRes.json();
      const values = readData.values || [];
      existingRowIndex = values.findIndex((val: any[]) => {
        if (!val || !val[0]) return false;
        const cleanValName = 'tr_' + val[0].toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
        return cleanValName === itemId.trim().toLowerCase();
      });
    } else {
      const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A:A`;
      const readRes = await fetch(readUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!readRes.ok) return false;
      const readData = await readRes.json();
      const values = readData.values || [];
      existingRowIndex = values.findIndex((val: any[]) => val && val[0] && val[0].toString().trim() === itemId.trim());
    }
    if (existingRowIndex === -1) return false;

    // Get the sheetId of the sheetName
    const getSheetsRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}?fields=sheets.properties`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!getSheetsRes.ok) return false;

    const getSheetsData = await getSheetsRes.json();
    const sheets = getSheetsData.sheets || [];
    const sheetObj = sheets.find((s: any) => s.properties?.title?.toLowerCase() === sheetName.toLowerCase());
    if (!sheetObj) return false;

    const sheetId = sheetObj.properties.sheetId;

    // Delete the row using batchUpdate
    const batchUpdateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}:batchUpdate`;
    const reqBody = {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetId,
              dimension: "ROWS",
              startIndex: existingRowIndex, // include this row
              endIndex: existingRowIndex + 1 // exclusive, so exactly 1 row
            }
          }
        }
      ]
    };

    const deleteRes = await fetch(batchUpdateUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(reqBody)
    });

    return deleteRes.ok;
  } catch (err) {
    console.error("Gagal menghapus item database master di Google Sheets:", err);
    return false;
  }
}

const normalizeMedicineName = (name: string) => {
  if (!name) return '';
  return name.trim();
};

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
  return (isNaN(parsedQty) || parsedQty <= 0) ? 1 : parsedQty;
};

const parseTherapy = (therapyStr: string) => {
  if (!therapyStr) return [];
  const parts = therapyStr.split(/,(?![^(]*\))/);
  return parts.map(part => {
    let name = part.trim();
    let qty = '';
    const matches = name.match(/^(.*?)\((.*?)\)$/);
    if (matches) {
      name = matches[1].trim();
      qty = matches[2].trim();
    }
    return { name: normalizeMedicineName(name), qty };
  }).filter(x => x.name !== '');
};

const sortVisits = (v1: any, v2: any) => {
  const t1 = v1.createdAt?.seconds !== undefined
    ? v1.createdAt.seconds * 1000 + Math.floor((v1.createdAt.nanoseconds || 0) / 1000000)
    : (v1.createdAt instanceof Date ? v1.createdAt.getTime() : (typeof v1.createdAt === 'string' ? new Date(v1.createdAt).getTime() : 0));
    
  const t2 = v2.createdAt?.seconds !== undefined
    ? v2.createdAt.seconds * 1000 + Math.floor((v2.createdAt.nanoseconds || 0) / 1000000)
    : (v2.createdAt instanceof Date ? v2.createdAt.getTime() : (typeof v2.createdAt === 'string' ? new Date(v2.createdAt).getTime() : 0));

  if (t1 !== t2) return t1 - t2;
  return (v1.id || '').localeCompare(v2.id || '');
};

/**
 * Synchronizes medicine usage from a visit to the monthly Google Spreadsheet link.
 * Calculates daily and cumulative balances, and updates 'PEMASUKAN', day sheets, and 'STOK AKHIR'.
 */
export async function syncMedicineUsageToGoogleSheets(
  visitId: string,
  dateStr: string, // ISO string or 'yyyy-MM-dd'
  studentName: string,
  activeMeds: Array<{ name: string; quantity: number }>,
  isDelete: boolean = false
): Promise<boolean> {
  const token = getCachedDriveToken();
  if (!token) {
    console.log("Sinkronisasi Pemakaian Obat Google Sheets dilewati: Token tidak ditemukan.");
    return false;
  }

  try {
    console.log("Memulai sinkronisasi pemakaian obat ke Google Sheets...", { visitId, dateStr, studentName, activeMeds, isDelete });
    
    // 1. Get visit date components
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj.getTime())) {
      console.error("Format tanggal tidak valid:", dateStr);
      return false;
    }
    const year = dateObj.getFullYear();
    const monthNum = String(dateObj.getMonth() + 1).padStart(2, '0'); // '01' to '12'
    const dayNum = dateObj.getDate(); // 1 to 31
    const daySheetName = `Tgl ${dayNum}`;

    // Month name in Indonesian
    const monthsId = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const monthName = monthsId[dateObj.getMonth()];

    // 2. Fetch monthly Google Spreadsheet ID of the current month from Firestore settings
    const { db } = await import('./firebase');
    const { doc, getDoc, getDocs, collection, query, orderBy, where } = await import('firebase/firestore');
    
    const configDocRef = doc(db, 'settings', 'global_config');
    const configSnap = await getDoc(configDocRef);
    if (!configSnap.exists()) {
      console.log("Dokumen global_config tidak ditemukan.");
      return false;
    }

    const configData = configSnap.data();
    let link = '';
    if (configData.medicine_usage_monthly_links && configData.medicine_usage_monthly_links[monthNum]) {
      link = configData.medicine_usage_monthly_links[monthNum];
    } else if (configData.medicine_usage_spreadsheet) {
      link = configData.medicine_usage_spreadsheet;
    }

    if (!link || !link.trim()) {
      console.log(`Link Google Spreadsheet untuk bulan ${monthNum} tidak dikonfigurasi.`);
      return false;
    }

    const matchSId = link.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const spreadsheetId = matchSId ? matchSId[1] : null;
    if (!spreadsheetId) {
      console.error("Format link Google Spreadsheet tidak valid:", link);
      return false;
    }

    // 3. Retrieve list of sheets / tabs inside the spreadsheet to check if they exist
    const getSpreadsheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
    const getSpreadsheetRes = await fetch(getSpreadsheetUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!getSpreadsheetRes.ok) {
      throw new Error(`Gagal membaca info spreadsheet: HTTP ${getSpreadsheetRes.status}`);
    }

    const spreadsheetData = await getSpreadsheetRes.json();
    const sheets = spreadsheetData.sheets || [];
    const sheetTitles = sheets.map((s: any) => s.properties.title);

    // 4. Fetch list of master medicines from Firestore to initialize sheet rows if needed
    const medSnap = await getDocs(query(collection(db, 'medicines'), orderBy('name', 'asc')));
    const masterMedicines = medSnap.docs.map(d => {
      const data = d.data();
      return { id: d.id, name: (data.name || data.obat || '').trim() };
    }).filter(m => m.name !== '');

    // 5. Check missing essential tabs and build them
    const reqsToCreate: any[] = [];
    if (!sheetTitles.includes('PEMASUKAN')) {
      reqsToCreate.push({ addSheet: { properties: { title: 'PEMASUKAN' } } });
    }
    if (!sheetTitles.includes('STOK AKHIR')) {
      reqsToCreate.push({ addSheet: { properties: { title: 'STOK AKHIR' } } });
    }
    if (!sheetTitles.includes(daySheetName)) {
      reqsToCreate.push({ addSheet: { properties: { title: daySheetName } } });
    }

    if (reqsToCreate.length > 0) {
      const batchUpdateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
      const createRes = await fetch(batchUpdateUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests: reqsToCreate })
      });
      if (!createRes.ok) {
        console.error("Gagal membuat worksheet tab baru:", await createRes.text());
      }
    }

    // 6. PROCESS DAY SHEET: 'Tgl X'
    const daySheetRangeName = `'Tgl ${dayNum}'!A1:CZ150`;
    const readDayUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(daySheetRangeName)}`;
    const readDayRes = await fetch(readDayUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    let dayRows: any[][] = [];
    if (readDayRes.ok) {
      const dayData = await readDayRes.json();
      dayRows = dayData.values || [];
    }

    const maxPatients = 100;

    // Initialize day sheet structure if empty or missing headers
    if (dayRows.length < 4) {
      dayRows = [];
      dayRows.push([`PEMAKAIAN OBAT HARIAN - TANGGAL ${dayNum}`]);
      dayRows.push([`Periode: Bulan ${monthName} Tahun ${year}`]);
      dayRows.push([]); // Row 3
      const headers = ['NO', 'NAMA OBAT'];
      for (let i = 1; i <= maxPatients; i++) {
        headers.push(i.toString());
      }
      headers.push('JUMLAH OBAT KELUAR');
      dayRows.push(headers);

      // Add each master medicine as a row
      masterMedicines.forEach((med, mIdx) => {
        const row = [mIdx + 1, med.name];
        for (let i = 1; i <= maxPatients; i++) {
          row.push('');
        }
        row.push(''); // Total sum cell
        dayRows.push(row);
      });
    }

    // Ensure we have at least 4 rows (0 to 3)
    while (dayRows.length < 4) {
      dayRows.push([]);
    }
    // Make sure Row 3 is completely blank
    dayRows[2] = Array(2 + maxPatients + 1).fill('');

    // Fetch all visits of this day from Firestore
    const targetDateISO = `${year}-${monthNum}-${String(dayNum).padStart(2, '0')}`;
    const visitsQ = query(
      collection(db, 'visits'),
      where('date', '==', targetDateISO)
    );
    const visitsSnap = await getDocs(visitsQ);
    const dayVisits = visitsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

    // Fetch all medicine logs for this day to get correct quantities
    const logsQ = query(
      collection(db, 'medicineLogs'),
      where('date', '>=', targetDateISO),
      where('date', '<=', targetDateISO)
    );
    const logsSnap = await getDocs(logsQ);
    const dayLogs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

    // Sort the visits of today chronologically
    dayVisits.sort(sortVisits);

    // Filter and map visits to their active medications
    const patientsWithMeds: Array<{ visitId: string; activeMeds: Array<{ name: string; quantity: number }> }> = [];

    dayVisits.forEach(v => {
      const isCurrentVisit = v.id === visitId;
      
      // If we are deleting the current visit, skip its medicines
      if (isCurrentVisit && isDelete) {
        return;
      }

      let mList: Array<{ name: string; quantity: number }> = [];
      if (isCurrentVisit) {
        // Use the passed activeMeds
        mList = activeMeds;
      } else {
        // Parse from logs or therapy
        const matchedLogs = dayLogs.filter(l => l.visitId === v.id && l.type === 'OUT');
        if (matchedLogs.length > 0) {
          mList = matchedLogs.map(l => ({
            name: (l.medicineName || '').trim(),
            quantity: l.quantity || 1
          }));
        } else if (v.therapy) {
          const parsed = parseTherapy(v.therapy);
          mList = parsed.map(pm => ({
            name: pm.name,
            quantity: getParsedQty(pm.qty)
          }));
        }
      }

      if (mList.length > 0) {
        patientsWithMeds.push({
          visitId: v.id || '',
          activeMeds: mList
        });
      }
    });

    // Reset columns 1 to 100 to empty string '' for all medicine rows (index 4 to length - 1)
    for (let r = 4; r < dayRows.length; r++) {
      for (let col = 2; col <= 1 + maxPatients; col++) {
        dayRows[r][col] = '';
      }
    }

    // Write medicine quantities in order of patients
    const totalPatientsToProcess = Math.min(patientsWithMeds.length, maxPatients);
    for (let pIdx = 0; pIdx < totalPatientsToProcess; pIdx++) {
      const patient = patientsWithMeds[pIdx];
      const targetColIdx = 2 + pIdx;

      patient.activeMeds.forEach(med => {
        const medNameClean = med.name.trim();
        if (!medNameClean) return;

        // Find matches in medicine row name (Column B / index 1)
        let medRowIdx = -1;
        for (let r = 4; r < dayRows.length; r++) {
          const rowMedName = (dayRows[r][1] || '').toString().trim().toLowerCase();
          if (rowMedName === medNameClean.toLowerCase()) {
            medRowIdx = r;
            break;
          }
        }

        // If not found, append a new row for this medicine
        if (medRowIdx === -1) {
          medRowIdx = dayRows.length;
          const newRow = [medRowIdx - 3, medNameClean];
          for (let i = 1; i <= maxPatients; i++) {
            newRow.push('');
          }
          newRow.push(''); // Total sum
          dayRows.push(newRow);
        }

        dayRows[medRowIdx][targetColIdx] = med.quantity || 1;
      });
    }

    // Recalculate row sums (index 2 + maxPatients representing 'JUMLAH OBAT KELUAR')
    for (let r = 4; r < dayRows.length; r++) {
      let sum = 0;
      let hasValue = false;
      for (let c = 2; c <= 1 + maxPatients; c++) {
        const val = Number(dayRows[r][c]);
        if (!isNaN(val) && dayRows[r][c] !== '' && dayRows[r][c] !== undefined) {
          sum += val;
          hasValue = true;
        }
      }
      dayRows[r][2 + maxPatients] = hasValue && sum > 0 ? sum : '';
    }

    // Write 'Tgl X' sheet back as a complete block
    const writeDayUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(daySheetRangeName)}?valueInputOption=USER_ENTERED`;
    const writeDayRes = await fetch(writeDayUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: dayRows })
    });
    if (!writeDayRes.ok) {
      console.error("Gagal menulis data ke Google Sheets harian:", await writeDayRes.text());
    } else {
      console.log(`Berhasil menulis data pemakaian obat harian ke tab ${daySheetName}!`);
    }

    // 7. PROCESS 'STOK AKHIR' SHEET
    const stokAkhirRangeName = `'STOK AKHIR'!A1:CZ150`;
    const readStokUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(stokAkhirRangeName)}`;
    const readStokRes = await fetch(readStokUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    let stokRows: any[][] = [];
    if (readStokRes.ok) {
      const stokData = await readStokRes.json();
      stokRows = stokData.values || [];
    }

    // Determine the days count in this month
    const daysInMonth = new Date(year, dateObj.getMonth() + 1, 0).getDate();
    const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    // Initialize 'STOK AKHIR' sheet structure if empty or missing headers
    if (stokRows.length < 4) {
      stokRows = [];
      stokRows.push(['LAPORAN BULANAN PEMAKAIAN OBAT UKS (STOK AKHIR)']);
      stokRows.push([`Periode: Bulan ${monthName} Tahun ${year}`]);
      stokRows.push([]);
      
      const stokHeaders = [
        'NO',
        'NAMA OBAT',
        'TOTAL STOK (AWAL+MASUK)',
        ...daysArray.map(d => `Tgl ${d}`),
        'JUMLAH OBAT KELUAR',
        'SISA STOK AKHIR'
      ];
      stokRows.push(stokHeaders);

      // Add each master medicine
      masterMedicines.forEach((med, mIdx) => {
        const row = [
          mIdx + 1,
          med.name,
          100, // Total Stock default
          ...daysArray.map(() => ''), // usage columns for Tgl 1 to Tgl 31
          '', // jumlah obat keluar
          100 // sisa stok akhir
        ];
        stokRows.push(row);
      });
    }

    const headersStok = stokRows[3] || [];
    const tglColIdx = headersStok.indexOf(`Tgl ${dayNum}`);

    if (tglColIdx !== -1) {
      // Update each medicine daily total on STOK AKHIR
      for (let r = 4; r < dayRows.length; r++) {
        const medName = (dayRows[r][1] || '').toString().trim();
        if (!medName) continue;

        const totalUsageForDay = dayRows[r][2 + maxPatients] || '';

        // Find matches in STOK AKHIR sheet
        let stokMedRowIdx = -1;
        for (let sr = 4; sr < stokRows.length; sr++) {
          const rowMedName = (stokRows[sr][1] || '').toString().trim().toLowerCase();
          if (rowMedName === medName.toLowerCase()) {
            stokMedRowIdx = sr;
            break;
          }
        }

        // Add row if missing in STOK AKHIR
        if (stokMedRowIdx === -1) {
          stokMedRowIdx = stokRows.length;
          const newRow = [
            stokMedRowIdx - 3,
            medName,
            100, // Total Stock (Awal+Masuk)
            ...daysArray.map(() => ''),
            '', // Total Usage out
            100 // Final Stock
          ];
          stokRows.push(newRow);
        }

        // Set the specific day's total usage
        stokRows[stokMedRowIdx][tglColIdx] = totalUsageForDay;
      }

      // Recalculate horizontal Sum and Remaining Stock for all medicines on STOK AKHIR sheet
      const outColIdx = headersStok.indexOf('JUMLAH OBAT KELUAR');
      const finalStockColIdx = headersStok.indexOf('SISA STOK AKHIR');

      for (let sr = 4; sr < stokRows.length; sr++) {
        const totalStock = Number(stokRows[sr][2]) || 0;

        let sumOut = 0;
        let hasUsage = false;
        for (let dCol = 3; dCol < outColIdx; dCol++) {
          const usageVal = Number(stokRows[sr][dCol]);
          if (!isNaN(usageVal) && stokRows[sr][dCol] !== '' && stokRows[sr][dCol] !== undefined) {
            sumOut += usageVal;
            hasUsage = true;
          }
        }

        stokRows[sr][outColIdx] = hasUsage && sumOut > 0 ? sumOut : '';
        stokRows[sr][finalStockColIdx] = totalStock - sumOut;
      }

      // Write 'STOK AKHIR' sheet back as a complete block
      const writeStokUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(stokAkhirRangeName)}?valueInputOption=USER_ENTERED`;
      const writeStokRes = await fetch(writeStokUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: stokRows })
      });
      if (!writeStokRes.ok) {
        console.error("Gagal menulis data ke Google Sheets STOK AKHIR:", await writeStokRes.text());
      } else {
        console.log("Berhasil menyinkronkan data Stok Akhir bulanan!");
      }
    }

    return true;
  } catch (err) {
    console.error("Sistem gagal memproses sinkronisasi pemakaian obat Google Sheets:", err);
    return false;
  }
}

/**
 * Performs a highly optimized batch synchronization of ALL existing visits
 * for a specific month of the current year into the configured Google Spreadsheet.
 */
export async function syncMonthlyUsageBatch(
  monthNum: string, // '01' to '12'
  onProgress?: (progress: number, message: string) => void
): Promise<{ success: boolean; totalProcessed: number; message: string }> {
  const token = getCachedDriveToken();
  if (!token) {
    return { success: false, totalProcessed: 0, message: "Token Google Drive tidak ditemukan. Silakan hubungkan kembali." };
  }

  try {
    const { db } = await import('./firebase');
    const { collection, getDocs, query, where, doc, getDoc, orderBy } = await import('firebase/firestore');

    const year = new Date().getFullYear();
    const startDateISO = `${year}-${monthNum}-01`;
    const endDateISO = `${year}-${monthNum}-32`;

    const startLogDate = `${year}-${monthNum}-01`;
    const endLogDate = `${year}-${monthNum}-32`;

    if (onProgress) onProgress(10, "Mengambil data kunjungan dari database cloud...");

    // Fetch visits of the selected month
    const visitsQ = query(
      collection(db, 'visits'),
      where('date', '>=', startDateISO),
      where('date', '<=', endDateISO)
    );
    const visitsSnap = await getDocs(visitsQ);
    const visits = visitsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

    if (visits.length === 0) {
      return { success: true, totalProcessed: 0, message: `Tidak ada data kunjungan pada bulan ${monthNum} yang perlu disinkronkan.` };
    }

    if (onProgress) onProgress(25, "Mengambil data pemakaian obat...");

    // Fetch medicineLogs of the selected month
    const logsQ = query(
      collection(db, 'medicineLogs'),
      where('date', '>=', startLogDate),
      where('date', '<=', endLogDate)
    );
    const logsSnap = await getDocs(logsQ);
    const logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

    // Get spreadsheet link
    const configDocRef = doc(db, 'settings', 'global_config');
    const configSnap = await getDoc(configDocRef);
    if (!configSnap.exists()) {
      return { success: false, totalProcessed: 0, message: "Konfigurasi global belum diatur." };
    }

    const configData = configSnap.data();
    let link = '';
    if (configData.medicine_usage_monthly_links && configData.medicine_usage_monthly_links[monthNum]) {
      link = configData.medicine_usage_monthly_links[monthNum];
    } else if (configData.medicine_usage_spreadsheet) {
      link = configData.medicine_usage_spreadsheet;
    }

    if (!link || !link.trim()) {
      return { success: false, totalProcessed: 0, message: `Tautan Google Spreadsheet untuk bulan ${monthNum} belum dikonfigurasi.` };
    }

    const matchSId = link.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const spreadsheetId = matchSId ? matchSId[1] : null;
    if (!spreadsheetId) {
      return { success: false, totalProcessed: 0, message: "Format link Google Spreadsheet tidak valid." };
    }

    // Retrieve sheets info
    if (onProgress) onProgress(35, "Memeriksa tab Sheet di Google Spreadsheet...");
    const getSpreadsheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
    const getSpreadsheetRes = await fetch(getSpreadsheetUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!getSpreadsheetRes.ok) {
      return { success: false, totalProcessed: 0, message: `Gagal membaca spreadsheet: HTTP ${getSpreadsheetRes.status}` };
    }

    const spreadsheetData = await getSpreadsheetRes.json();
    const sheets = spreadsheetData.sheets || [];
    const sheetTitles = sheets.map((s: any) => s.properties.title);

    // Fetch master medicines list
    const medSnap = await getDocs(query(collection(db, 'medicines'), orderBy('name', 'asc')));
    const masterMedicines = medSnap.docs.map(d => {
      const dData = d.data();
      return { id: d.id, name: (dData.name || dData.obat || '').trim() };
    }).filter(m => m.name !== '');

    // Group visits by day of month (1 to 31)
    const visitsByDay: Record<number, any[]> = {};
    visits.forEach(v => {
      const dateObj = new Date(v.date);
      if (!isNaN(dateObj.getTime())) {
        const day = dateObj.getDate();
        if (!visitsByDay[day]) visitsByDay[day] = [];
        visitsByDay[day].push(v);
      }
    });

    const activeDays = Object.keys(visitsByDay).map(Number).sort((a, b) => a - b);
    let processedCount = 0;

    // Check missing essential tabs and build them
    const reqsToCreate: any[] = [];
    if (!sheetTitles.includes('PEMASUKAN')) {
      reqsToCreate.push({ addSheet: { properties: { title: 'PEMASUKAN' } } });
    }
    if (!sheetTitles.includes('STOK AKHIR')) {
      reqsToCreate.push({ addSheet: { properties: { title: 'STOK AKHIR' } } });
    }
    
    // Add missing day sheets for days that have visits
    activeDays.forEach(dayNum => {
      const daySheetName = `Tgl ${dayNum}`;
      if (!sheetTitles.includes(daySheetName)) {
        reqsToCreate.push({ addSheet: { properties: { title: daySheetName } } });
      }
    });

    if (reqsToCreate.length > 0) {
      if (onProgress) onProgress(45, "Membuat tab Sheet kosong yang diperlukan...");
      const batchUpdateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
      await fetch(batchUpdateUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests: reqsToCreate })
      });
    }

    const monthsId = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const monthName = monthsId[parseInt(monthNum) - 1];

    // Helper functions inside the batch sync
    const normalizeMedicineName = (name: string) => {
      if (!name) return '';
      return name.trim();
    };

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
      return (isNaN(parsedQty) || parsedQty <= 0) ? 1 : parsedQty;
    };

    const parseTherapy = (therapyStr: string) => {
      if (!therapyStr) return [];
      const parts = therapyStr.split(/,(?![^(]*\))/);
      return parts.map(part => {
        let name = part.trim();
        let qty = '';
        const matches = name.match(/^(.*?)\((.*?)\)$/);
        if (matches) {
          name = matches[1].trim();
          qty = matches[2].trim();
        }
        return { name: normalizeMedicineName(name), qty };
      }).filter(x => x.name !== '');
    };

    // We will hold a running state of the STOK AKHIR rows so we can query/write it once or iteratively safely
    const stokAkhirRangeName = `'STOK AKHIR'!A1:CZ150`;
    const readStokRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(stokAkhirRangeName)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    let stokRows: any[][] = [];
    if (readStokRes.ok) {
      const stokData = await readStokRes.json();
      stokRows = stokData.values || [];
    }

    const daysInMonth = new Date(year, parseInt(monthNum), 0).getDate();
    const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    // Initialize "STOK AKHIR" if empty
    if (stokRows.length < 4) {
      stokRows = [];
      stokRows.push(['LAPORAN BULANAN PEMAKAIAN OBAT UKS (STOK AKHIR)']);
      stokRows.push([`Periode: Bulan ${monthName} Tahun ${year}`]);
      stokRows.push([]);
      
      const stokHeaders = [
        'NO',
        'NAMA OBAT',
        'TOTAL STOK (AWAL+MASUK)',
        ...daysArray.map(d => `Tgl ${d}`),
        'JUMLAH OBAT KELUAR',
        'SISA STOK AKHIR'
      ];
      stokRows.push(stokHeaders);

      masterMedicines.forEach((med, mIdx) => {
        const row = [
          mIdx + 1,
          med.name,
          100, // Total Stock default
          ...daysArray.map(() => ''), // usage columns
          '', // total sum
          100 // sisa stok
        ];
        stokRows.push(row);
      });
    }

    const headersStok = stokRows[3] || [];

    // Loop through each active day to process and write its day sheet
    for (let index = 0; index < activeDays.length; index++) {
      const dayNum = activeDays[index];
      const dayVisitsList = visitsByDay[dayNum];
      const progressPercent = Math.min(50 + Math.floor((index / activeDays.length) * 40), 90);
      
      if (onProgress) {
        onProgress(progressPercent, `Memproses Pemakaian Hari Tgl ${dayNum} (${dayVisitsList.length} kunjungan)...`);
      }

      const daySheetRangeName = `'Tgl ${dayNum}'!A1:CZ150`;
      const readDayRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(daySheetRangeName)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      let dayRows: any[][] = [];
      if (readDayRes.ok) {
        const dayData = await readDayRes.json();
        dayRows = dayData.values || [];
      }

      const maxPatients = 100;

      // Initialize day sheet if empty
      if (dayRows.length < 4) {
        dayRows = [];
        dayRows.push([`PEMAKAIAN OBAT HARIAN - TANGGAL ${dayNum}`]);
        dayRows.push([`Periode: Bulan ${monthName} Tahun ${year}`]);
        dayRows.push([]); // Row 3
        const headers = ['NO', 'NAMA OBAT'];
        for (let i = 1; i <= maxPatients; i++) {
          headers.push(i.toString());
        }
        headers.push('JUMLAH OBAT KELUAR');
        dayRows.push(headers);

        masterMedicines.forEach((med, mIdx) => {
          const row = [mIdx + 1, med.name];
          for (let i = 1; i <= maxPatients; i++) {
            row.push('');
          }
          row.push('');
          dayRows.push(row);
        });
      }

      while (dayRows.length < 4) {
        dayRows.push([]);
      }
      // Make sure Row 3 is completely blank
      dayRows[2] = Array(2 + maxPatients + 1).fill('');

      // Sort visits chronologically
      dayVisitsList.sort(sortVisits);

      const patientsWithMeds: Array<{ visitId: string; activeMeds: Array<{ name: string; quantity: number }> }> = [];

      dayVisitsList.forEach(v => {
        const visitId = v.id;
        const matchedLogs = logs.filter(l => l.visitId === visitId && l.type === 'OUT');
        let activeMeds: Array<{ name: string; quantity: number }> = [];

        if (matchedLogs.length > 0) {
          activeMeds = matchedLogs.map(l => ({
            name: (l.medicineName || '').trim(),
            quantity: l.quantity || 1
          }));
        } else if (v.therapy) {
          const parsed = parseTherapy(v.therapy);
          activeMeds = parsed.map(pm => ({
            name: pm.name,
            quantity: getParsedQty(pm.qty)
          }));
        }

        if (activeMeds.length > 0) {
          patientsWithMeds.push({
            visitId: visitId || '',
            activeMeds
          });
        }
      });

      // Clear columns 1 to 100 for all rows
      for (let r = 4; r < dayRows.length; r++) {
        for (let col = 2; col <= 1 + maxPatients; col++) {
          dayRows[r][col] = '';
        }
      }

      // Write medicine quantities in order of patients
      const totalPatientsToProcess = Math.min(patientsWithMeds.length, maxPatients);
      for (let pIdx = 0; pIdx < totalPatientsToProcess; pIdx++) {
        const patient = patientsWithMeds[pIdx];
        const targetColIdx = 2 + pIdx;

        patient.activeMeds.forEach(med => {
          const medName = med.name.trim();
          if (!medName) return;

          let rowIdx = -1;
          for (let r = 4; r < dayRows.length; r++) {
            const rowMedName = (dayRows[r][1] || '').toString().trim().toLowerCase();
            if (rowMedName === medName.toLowerCase()) {
              rowIdx = r;
              break;
            }
          }

          if (rowIdx === -1) {
            rowIdx = dayRows.length;
            const newRow = [rowIdx - 3, medName];
            for (let i = 1; i <= maxPatients; i++) {
              newRow.push('');
            }
            newRow.push('');
            dayRows.push(newRow);
          }

          dayRows[rowIdx][targetColIdx] = med.quantity || 1;
        });

        processedCount++;
      }

      // Recalculate row sums on this day sheet
      for (let r = 4; r < dayRows.length; r++) {
        let sum = 0;
        let hasValue = false;
        for (let c = 2; c <= 1 + maxPatients; c++) {
          const val = Number(dayRows[r][c]);
          if (!isNaN(val) && dayRows[r][c] !== '' && dayRows[r][c] !== undefined) {
            sum += val;
            hasValue = true;
          }
        }
        dayRows[r][2 + maxPatients] = hasValue && sum > 0 ? sum : '';
      }

      // Write 'Tgl X' sheet back successfully
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(daySheetRangeName)}?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: dayRows })
      });

      // Synchronize back to the cached STOK AKHIR sheet rows!
      const tglColIdx = headersStok.indexOf(`Tgl ${dayNum}`);
      if (tglColIdx !== -1) {
        for (let r = 4; r < dayRows.length; r++) {
          const medName = (dayRows[r][1] || '').toString().trim();
          if (!medName) continue;

          const totalUsageForDay = dayRows[r][2 + maxPatients] || '';

          let stokMedRowIdx = -1;
          for (let sr = 4; sr < stokRows.length; sr++) {
            const rowMedName = (stokRows[sr][1] || '').toString().trim().toLowerCase();
            if (rowMedName === medName.toLowerCase()) {
              stokMedRowIdx = sr;
              break;
            }
          }

          if (stokMedRowIdx === -1) {
            stokMedRowIdx = stokRows.length;
            const newRow = [
              stokMedRowIdx - 3,
              medName,
              100,
              ...daysArray.map(() => ''),
              '',
              100
            ];
            stokRows.push(newRow);
          }

          stokRows[stokMedRowIdx][tglColIdx] = totalUsageForDay;
        }
      }
    }

    // Recalculate all sums and Final Stocks on STOK AKHIR sheets
    if (onProgress) onProgress(93, "Menghitung ulang data saldo akhir pada STOK AKHIR...");
    const outColIdx = headersStok.indexOf('JUMLAH OBAT KELUAR');
    const finalStockColIdx = headersStok.indexOf('SISA STOK AKHIR');

    if (outColIdx !== -1 && finalStockColIdx !== -1) {
      for (let sr = 4; sr < stokRows.length; sr++) {
        const totalStock = Number(stokRows[sr][2]) || 0;

        let sumOut = 0;
        let hasUsage = false;
        for (let dCol = 3; dCol < outColIdx; dCol++) {
          const usageVal = Number(stokRows[sr][dCol]);
          if (!isNaN(usageVal) && stokRows[sr][dCol] !== '' && stokRows[sr][dCol] !== undefined) {
            sumOut += usageVal;
            hasUsage = true;
          }
        }

        stokRows[sr][outColIdx] = hasUsage && sumOut > 0 ? sumOut : '';
        stokRows[sr][finalStockColIdx] = totalStock - sumOut;
      }
    }

    // Write the complete STOK AKHIR sheet back to spreadsheet
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(stokAkhirRangeName)}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: stokRows })
    });

    if (onProgress) onProgress(100, "Sinkronisasi selesai!");
    return {
      success: true,
      totalProcessed: processedCount,
      message: `Telah berhasil menyinkronkan total ${processedCount} data pemakaian obat dari pemeriksaan ke Google Spreadsheet!`
    };

  } catch (err: any) {
    console.error("Gagal melakukan batch sinkronisasi:", err);
    return {
      success: false,
      totalProcessed: 0,
      message: `Terjadi kesalahan internal: ${err.message || String(err)}`
    };
  }
}

