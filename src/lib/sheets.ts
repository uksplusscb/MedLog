import { getCachedDriveToken, setCachedDriveToken } from './drive';

export const SPREADSHEET_ID = '17EEP1c0klbntmLxVsjYGElkEqLejLncqvnDNoqsfZsc';
export const MASTER_SPREADSHEET_ID = '1ucDQBJmJwcWnawmWIuQXTZXBlm4sMA0XKxWzBlA5Fv8';

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
  if (cachedTargetSheetName) {
    return cachedTargetSheetName;
  }
  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`, {
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
  if (headersInitializedMap[sheetName]) {
    return true;
  }
  try {
    // Check first 1 row to see if anything is there
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A1:R1`;
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

    const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A1:R1?valueInputOption=USER_ENTERED`;
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
export async function syncVisitToGoogleSheets(row: SheetRowData, isUpdate: boolean = false): Promise<boolean> {
  const token = getCachedDriveToken();
  if (!token) {
    console.log("Sinkronisasi Google Sheets dilewati: Token Google tidak ditemukan atau belum terhubung.");
    return false;
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
      const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A:A`;
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
      const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A${rowNum}:R${rowNum}?valueInputOption=USER_ENTERED`;
      
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
      const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A:R:append?valueInputOption=USER_ENTERED`;
      
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
    return true;
  } catch (err: any) {
    console.error("Sinkronisasi Google Sheets gagal:", err);
    const errMsg = err?.message || '';
    if (errMsg.includes('401') || errMsg.includes('403') || errMsg.toUpperCase().includes('UNAUTHORIZED') || errMsg.toLowerCase().includes('invalid credentials')) {
      console.warn("Token Google kedaluwarsa atau tidak valid, menghapus cache token...");
      setCachedDriveToken(null);
      window.dispatchEvent(new CustomEvent('uks_sheet_sync_completed'));
    }
    return false;
  }
}

/**
 * Performs full synchronisaton of entire visits database into the Google Sheet.
 * Useful for catching up or checking outputs.
 */
export async function syncAllVisitsToGoogleSheets(): Promise<{ success: boolean; count: number; error?: string }> {
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
    const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A2:R100000:clear`;
    await fetch(clearUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A2:R${rows.length + 1}?valueInputOption=USER_ENTERED`;
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
let cachedMasterSheetNames: Record<'students' | 'medicines' | 'diagnoses', string | null> = {
  students: null,
  medicines: null,
  diagnoses: null
};

/**
 * Resolves the actual Google Sheet tab name for each master database type.
 * Tab 1 (Identitas) -> Patient DB, Tab 2 (Obat) -> Medicine DB, Tab 3 (Diagnosa) -> Diagnosis DB.
 * Supports flexible lowercase, uppercase or standard containing names.
 */
export async function resolveMasterSheetName(token: string, type: 'students' | 'medicines' | 'diagnoses'): Promise<string> {
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
      return type === 'students' ? 'Identitas' : type === 'medicines' ? 'Obat' : 'Diagnosa';
    }

    const data = await res.json();
    const sheets = data.sheets || [];
    const sheetTitles = sheets.map((s: any) => s.properties?.title || '').filter(Boolean);

    // 1. Resolve student sheet (Search for "identitas" or "pasien" case-insensitive, or fallback to first sheet)
    let studentSheet = sheetTitles.find((t: string) => {
      const lt = t.toLowerCase();
      return lt === 'identitas' || lt === 'pasien' || lt.includes('identitas') || lt.includes('pasien') || lt === 'data pasien';
    });
    if (!studentSheet && sheets.length > 0) {
      studentSheet = sheets[0].properties?.title;
    }
    cachedMasterSheetNames.students = studentSheet || 'Identitas';

    // 2. Resolve medicine sheet (Search for "obat" case-insensitive, or fallback to second sheet)
    let medicineSheet = sheetTitles.find((t: string) => {
      const lt = t.toLowerCase();
      return lt === 'obat' || lt.includes('obat') || lt === 'data obat';
    });
    if (!medicineSheet && sheets.length > 1) {
      medicineSheet = sheets[1].properties?.title;
    }
    cachedMasterSheetNames.medicines = medicineSheet || 'Obat';

    // 3. Resolve diagnosis sheet (Search for "diagnosa" case-insensitive, or fallback to third sheet)
    let diagnosisSheet = sheetTitles.find((t: string) => {
      const lt = t.toLowerCase();
      return lt === 'diagnosa' || lt.includes('diagnosa') || lt === 'data diagnosa';
    });
    if (!diagnosisSheet && sheets.length > 2) {
      diagnosisSheet = sheets[2].properties?.title;
    }
    cachedMasterSheetNames.diagnoses = diagnosisSheet || 'Diagnosa';

    console.log(`Resolved master sheet name for ${type}: "${cachedMasterSheetNames[type]}"`);
    return cachedMasterSheetNames[type]!;
  } catch (err) {
    console.error(`Gagal dinamis mencari sheet master ${type}, menggunakan default:`, err);
    return type === 'students' ? 'Identitas' : type === 'medicines' ? 'Obat' : 'Diagnosa';
  }
}

/**
 * Ensures that master database sheet tabs ("Identitas", "Obat", "Diagnosa") exist.
 */
export async function ensureMasterSheetsExist(token: string): Promise<boolean> {
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

    const requiredSheets = ['Identitas', 'Obat', 'Diagnosa'];
    const requests = requiredSheets
      .filter(title => !titles.some((t: string) => t.toLowerCase() === title.toLowerCase()))
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
      cachedMasterSheetNames = { students: null, medicines: null, diagnoses: null };
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
export async function initializeMasterHeadersIfNeeded(token: string, sheetTitle: string, type: 'students' | 'medicines' | 'diagnoses'): Promise<boolean> {
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
      ["ID Diagnosa", "Nama Diagnosa / Gejala"];

    const maxCol = type === 'students' ? 'F' : type === 'medicines' ? 'D' : 'B';
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
 * Fetches the clinic master database records (patients, medicines, diagnoses) from Google Sheets.
 */
export async function fetchMasterDataFromSheets(token: string, type: 'students' | 'medicines' | 'diagnoses'): Promise<any[]> {
  try {
    const sheetName = await resolveMasterSheetName(token, type);
    await ensureMasterSheetsExist(token);
    await initializeMasterHeadersIfNeeded(token, sheetName, type);

    const maxCol = type === 'students' ? 'F' : type === 'medicines' ? 'D' : 'B';
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A1:${maxCol}100000`;
    
    const res = await fetch(readUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        setCachedDriveToken(null);
        throw new Error('UNAUTHORIZED');
      }
      return [];
    }

    const data = await res.json();
    const values = data.values || [];
    if (values.length < 2) return [];

    const headers = values[0].map((h: any) => h ? h.toString().toLowerCase().trim() : '');
    const rows = values.slice(1);

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
        if (h === 'id' || h === 'id obat' || h === 'id_obat' || h === 'no' || h === 'no.') {
          mappedKey = 'id';
        } else if (h === 'stok' || h === 'stock' || h === 'jumlah' || h.includes('stok') || h.includes('stock') || h.includes('jumlah') || h.includes('qty')) {
          mappedKey = 'stock';
        } else if (h === 'satuan' || h === 'unit' || h.includes('satuan') || h.includes('unit')) {
          mappedKey = 'unit';
        } else if (h === 'nama obat' || h === 'nama' || h === 'name' || h === 'obat' || h.includes('nama') || h.includes('obat') || h.includes('name')) {
          mappedKey = 'name';
        }
      } else if (type === 'diagnoses') {
        if (h === 'id' || h === 'id diagnosa' || h === 'id_diagnosa' || h === 'no' || h === 'no.') {
          mappedKey = 'id';
        } else if (h === 'nama diagnosa' || h === 'nama' || h === 'name' || h === 'diagnosa' || h.includes('nama') || h.includes('diagnosa') || h.includes('name') || h.includes('gejala')) {
          mappedKey = 'name';
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
        }
      }

      headerMap[index] = mappedKey || fallbackKey || h;
    });

    // Safeguard: if 'name' was not resolved, default the second column (index 1) to 'name'
    const hasNameMapping = Object.values(headerMap).includes('name');
    if (!hasNameMapping) {
      headerMap[1] = 'name';
    }

    return rows
      .map((row: any[], rowIndex: number) => {
        const item: any = {};
        // Unique fallback identifier based on row number
        item.id = `sheet_row_${rowIndex + 2}`;

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
        if (!item.name) item.name = 'Tanpa Nama';
        
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
        }

        return item;
      })
      .filter(item => item.name && item.name !== 'Tanpa Nama');
  } catch (err) {
    console.error(`Gagal memuat master data ${type} dari Google Sheets:`, err);
    return [];
  }
}

/**
 * Pushes/rewrites all master records (patients, medicines, diagnoses) to Google Sheets.
 */
export async function syncMasterDataToSheets(token: string, type: 'students' | 'medicines' | 'diagnoses', items: any[]): Promise<boolean> {
  try {
    const sheetName = await resolveMasterSheetName(token, type);
    await ensureMasterSheetsExist(token);
    await initializeMasterHeadersIfNeeded(token, sheetName, type);

    const rows = items.map((item, index) => {
      const itemId = item.id || `M-${type === 'students' ? 'PS' : type === 'medicines' ? 'OB' : 'DG'}-${Date.now()}-${index}`;
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

    const maxCol = type === 'students' ? 'F' : type === 'medicines' ? 'D' : 'B';
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
export async function addOrUpdateMasterItemInSheets(token: string, type: 'students' | 'medicines' | 'diagnoses', item: any, isUpdate: boolean): Promise<boolean> {
  try {
    const sheetName = await resolveMasterSheetName(token, type);
    await ensureMasterSheetsExist(token);
    await initializeMasterHeadersIfNeeded(token, sheetName, type);

    const itemId = item.id || `M-${type === 'students' ? 'PS' : type === 'medicines' ? 'OB' : 'DG'}-${Date.now()}`;
    let existingRowIndex = -1;

    if (isUpdate && item.id) {
      const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A:A`;
      const readRes = await fetch(readUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (readRes.ok) {
        const readData = await readRes.json();
        const values = readData.values || [];
        existingRowIndex = values.findIndex((val: any[]) => val && val[0] && val[0].toString().trim() === item.id.trim());
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
    ] : [
      itemId,
      item.name || ''
    ];

    const maxCol = type === 'students' ? 'F' : type === 'medicines' ? 'D' : 'B';

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
export async function deleteMasterItemInSheets(token: string, type: 'students' | 'medicines' | 'diagnoses', itemId: string): Promise<boolean> {
  try {
    const sheetName = await resolveMasterSheetName(token, type);
    
    // Find the row number first
    const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}!A:A`;
    const readRes = await fetch(readUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!readRes.ok) return false;

    const readData = await readRes.json();
    const values = readData.values || [];
    const existingRowIndex = values.findIndex((val: any[]) => val && val[0] && val[0].toString().trim() === itemId.trim());
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

