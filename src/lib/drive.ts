import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from './firebase';

let driveAccessToken: string | null = null;

// Listen to signout to automatically clear cached token
auth.onAuthStateChanged((user) => {
  if (!user) {
    driveAccessToken = null;
  }
});

export function getCachedDriveToken(): string | null {
  return driveAccessToken;
}

export function setCachedDriveToken(token: string | null) {
  driveAccessToken = token;
}

export async function connectGoogleDrive(): Promise<string> {
  const provider = new GoogleAuthProvider();
  // Request Google Drive specific access scope
  provider.addScope('https://www.googleapis.com/auth/drive.file');
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
    driveAccessToken = accessToken;
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
  const queryParam = encodeURIComponent("name contains 'backup_uks_' and mimeType = 'application/json' and trashed = false");
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
