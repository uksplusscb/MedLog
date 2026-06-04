import { getCachedDriveToken, setCachedDriveToken } from './drive';

export const SPREADSHEET_ID = '17EEP1c0klbntmLxVsjYGElkEqLejLncqvnDNoqsfZsc';

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
