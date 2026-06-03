import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from './firebase';

let driveAccessToken: string | null = localStorage.getItem('drive_access_token');

// Listen to signout to automatically clear cached token
auth.onAuthStateChanged((user) => {
  if (!user) {
    driveAccessToken = null;
    localStorage.removeItem('drive_access_token');
  }
});

export function getCachedDriveToken(): string | null {
  if (!driveAccessToken) {
    driveAccessToken = localStorage.getItem('drive_access_token');
  }
  return driveAccessToken;
}

export function setCachedDriveToken(token: string | null) {
  driveAccessToken = token;
  if (token) {
    localStorage.setItem('drive_access_token', token);
  } else {
    localStorage.removeItem('drive_access_token');
  }
}

export async function connectGoogleDrive(): Promise<string> {
  const provider = new GoogleAuthProvider();
  // Request Google Drive specific access scope and Google Sheets scope
  provider.addScope('https://www.googleapis.com/auth/drive.file');
  provider.addScope('https://www.googleapis.com/auth/spreadsheets');
  provider.setCustomParameters({
    prompt: 'select_account',
  });

  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken;
    if (!accessToken) {
      throw new Error('Gagal mendapatkan token akses Google Drive dari autentikasi.');
    }
    setCachedDriveToken(accessToken);
    return accessToken;
  } catch (error: any) {
    console.error('Error connecting to Google Drive:', error);
    throw error;
  }
}

export async function uploadBackupToDrive(accessToken: string, backupData: any, filename: string) {
  const metadata = {
    name: filename,
    mimeType: 'application/json',
  };

  const boundary = '314159265358979323846';
  const delimiter = "\r\n--" + boundary + "\r\n";
  const close_delimiter = "\r\n--" + boundary + "--";

  const contentType = "application/json";
  const metadataPart = JSON.stringify(metadata);
  const contentPart = JSON.stringify(backupData);

  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    metadataPart +
    delimiter +
    'Content-Type: ' + contentType + '\n\r\n' +
    contentPart +
    close_delimiter;

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: body,
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gagal mengunggah ke Google Drive: ${err}`);
  }

  return await response.json();
}

export async function listBackupsFromDrive(accessToken: string) {
  const queryParam = encodeURIComponent("(name contains 'backup_uks_' or name contains 'backup_uks_auto_') and mimeType = 'application/json' and trashed = false");
  const url = `https://www.googleapis.com/drive/v3/files?q=${queryParam}&orderBy=createdTime%20desc&fields=files(id,name,createdTime,size)`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gagal memuat daftar cadangan dari Google Drive: ${err}`);
  }

  const data = await response.json();
  return data.files || [];
}

export async function downloadBackupFromDrive(accessToken: string, fileId: string) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });

  if (!response.ok) {
    throw new Error(`Gagal mengunduh file cadangan dari Google Drive`);
  }

  return await response.json();
}

export async function deleteBackupFromDrive(accessToken: string, fileId: string) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  });

  if (!response.ok) {
    throw new Error(`Gagal menghapus file cadangan dari Google Drive`);
  }

  return true;
}

/**
 * Triggers an automated, silent backup to Google Drive in the background.
 * Performs collection-wide dump of UKS data safely.
 */
export async function triggerAutoBackup(): Promise<boolean> {
  const isAutoBackupEnabled = localStorage.getItem('uks_auto_backup') !== 'false';
  if (!isAutoBackupEnabled) {
    console.log("Automatic Google Drive backup is disabled by user settings.");
    return false;
  }

  const token = getCachedDriveToken();
  if (!token) {
    console.log("Automatic Google Drive backup skipped: No Google Drive connection active.");
    return false;
  }

  try {
    const { db } = await import('./firebase');
    const { getDocs, collection } = await import('firebase/firestore');
    
    console.count("Iniciating background auto-backup to Google Drive...");
    const collectionsToBackup = [
      'students',
      'medicines',
      'diagnoses',
      'teachers',
      'visits',
      'medicineLogs',
      'medicineMonthlyData'
    ];

    const backupData: Record<string, any[]> = {};
    for (const colName of collectionsToBackup) {
      const snap = await getDocs(collection(db, colName));
      backupData[colName] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    const formattedDate = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup_uks_auto_${formattedDate}.json`;
    
    await uploadBackupToDrive(token, backupData, filename);
    console.log(`Automatic background backup completed successfully! Filename: ${filename}`);
    
    // Store latest automatic backup metadata in local storage
    localStorage.setItem('uks_last_auto_backup', new Date().toISOString());
    localStorage.setItem('uks_last_auto_backup_name', filename);
    
    // Dispatch custom event so the UI can update automatically if open
    window.dispatchEvent(new CustomEvent('uks_auto_backup_completed'));
    return true;
  } catch (err: any) {
    console.error("Automatic background backup to Google Drive failed:", err);
    // Silent token cleanup if unauthorized
    if (err?.message?.includes('401') || err?.message?.toLowerCase().includes('unauthorized') || err?.message?.toLowerCase().includes('invalid credentials')) {
      setCachedDriveToken(null);
    }
    return false;
  }
}
