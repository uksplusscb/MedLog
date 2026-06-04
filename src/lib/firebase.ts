import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import firebaseConfig from '@/firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Use getFirestore and optionally enable local persistence for offline support (Tersimpan Permanen)
export const db = getFirestore(app);

try {
  enableIndexedDbPersistence(db).catch((err) => {
    console.warn("Offline persistence cannot be enabled (might be iframe restriction):", err.message);
  });
} catch(e) {
  console.warn("Offline persistence failed to initialize:", e);
}

export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, shouldThrow = false) {
  const errMsg = error instanceof Error ? error.message : String(error);
  
  // Classify error category as per audit requirements
  let category = 'Firebase read error';
  if (
    operationType === OperationType.WRITE || 
    operationType === OperationType.CREATE || 
    operationType === OperationType.UPDATE || 
    operationType === OperationType.DELETE
  ) {
    category = 'Firebase write error';
  }
  if (path === 'dashboard_data_group') {
    category = 'Dashboard fetch error';
  }
  if (
    errMsg.toLowerCase().includes('auth') || 
    errMsg.toLowerCase().includes('permission') || 
    errMsg.toLowerCase().includes('signin') || 
    path === 'auth'
  ) {
    category = 'Authentication error';
  }

  const errInfo: FirestoreErrorInfo & { category: string; timestamp: string } = {
    category,
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path,
    timestamp: new Date().toISOString()
  };

  console.error(`[AUDIT_LOG] ${category}:`, JSON.stringify(errInfo, null, 2));
  
  if (shouldThrow) {
    throw new Error(JSON.stringify(errInfo));
  }
}

// Check if network is available
export function isNetworkAvailable(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return true;
}

// Automatic retry with exponential backoff for Firestore queries and operations
export async function runWithRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  let attempt = 0;
  let currentDelay = delayMs;
  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      attempt++;
      const errMsg = error instanceof Error ? error.message : String(error);
      const isQuotaExceeded = errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('limit');
      const isPermissionDenied = errMsg.toLowerCase().includes('permission') || errMsg.toLowerCase().includes('denied');
      
      // If permission is denied or quota is exceeded, retry immediately is futile; propagate error
      if (attempt >= maxRetries || isQuotaExceeded || isPermissionDenied) {
        throw error;
      }
      
      console.warn(`[Firebase Retry] Percobaan ${attempt} gagal: ${errMsg}. Mencoba kembali dalam ${currentDelay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, currentDelay));
      currentDelay *= 2; // exponential backoff
    }
  }
}
