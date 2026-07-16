import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence, collection, query, where, getDocs, doc, setDoc, orderBy, Timestamp } from 'firebase/firestore';
import firebaseConfig from '@/firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Use getFirestore and optionally enable local persistence for offline support (Tersimpan Permanen)
const databaseId = (firebaseConfig as any).firestoreDatabaseId || '(default)';
export const db = getFirestore(app, databaseId);

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

export async function updateDashboardStats(dbInstance: any, year: number, month: number) {
  try {
    const startOfMonthStr = `${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00.000Z`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const endOfMonthStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`;

    console.log(`[Dashboard Stats Sync] Membaca data visits untuk periode ${year}-${month + 1}...`);
    // 1. Fetch visits for this month
    const visitsQ = query(
      collection(dbInstance, 'visits'),
      where('date', '>=', startOfMonthStr),
      where('date', '<=', endOfMonthStr),
      orderBy('date', 'desc')
    );
    const visitsSnap = await getDocs(visitsQ);
    const visits = visitsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

    console.log(`[Dashboard Stats Sync] Membaca data medicines...`);
    // 2. Fetch medicines
    const medicinesSnap = await getDocs(collection(dbInstance, 'medicines'));
    const medicines = medicinesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

    console.log(`[Dashboard Stats Sync] Berhasil membaca ${visits.length} visits dan ${medicines.length} medicines.`);

    // 3. Calculate stats
    const lowStockCount = medicines.filter((mData: any) => {
      const stock = mData.stock !== undefined ? mData.stock : mData.stok || 0;
      return Number(stock) < 10;
    }).length;

    const monthsList = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const activeMonthLabel = `${monthsList[month]} ${year}`;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTodayStr = startOfToday.toISOString().split('T')[0] + 'T00:00:00.000Z';

    const todayVisitsCount = visits.filter((v: any) => v.date && v.date >= startOfTodayStr).length;
    const monthVisitsCount = visits.length;
    const uniqueStudentsCount = Array.from(new Set(visits.map((v: any) => v.studentName || 'Siswa Anonim'))).length;

    const calculatedStats = {
      todayVisits: todayVisitsCount,
      monthVisits: monthVisitsCount,
      lowStock: lowStockCount,
      uniqueStudents: uniqueStudentsCount,
      activeMonthName: activeMonthLabel
    };

    // Prepare weekly trend data
    const isCurrentPeriod = year === now.getFullYear() && month === now.getMonth();
    let trendData = [];
    if (isCurrentPeriod) {
      const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
      trendData = Array.from({ length: 7 }).map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateLabel = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        
        const dayStartStr = d.toISOString().split('T')[0] + 'T00:00:00.000Z';
        const dayEndStr = d.toISOString().split('T')[0] + 'T23:59:59.999Z';
        const count = visits.filter((v: any) => v.date && v.date >= dayStartStr && v.date <= dayEndStr).length;

        return {
          name: dayNames[d.getDay()],
          count: count,
          dateLabel: dateLabel
        };
      }).reverse();
    } else {
      const weeks = [
        { name: 'W1 (1-7)', start: 1, end: 7 },
        { name: 'W2 (8-14)', start: 8, end: 14 },
        { name: 'W3 (15-21)', start: 15, end: 21 },
        { name: 'W4 (22-28)', start: 22, end: 28 },
        { name: 'W5 (29+)', start: 29, end: 31 }
      ];
      trendData = weeks.map(w => {
        const count = visits.filter((v: any) => {
          if (!v.date) return false;
          try {
            const d = new Date(v.date);
            const day = d.getDate();
            return d.getFullYear() === year && d.getMonth() === month && day >= w.start && day <= w.end;
          } catch (_) {
            return false;
          }
        }).length;

        return {
          name: w.name,
          count: count,
          dateLabel: `Minggu ${w.name.split(' ')[0].substring(1)}`
        };
      });
    }

    // Prepare diagnosis distribution
    const diagMap: Record<string, number> = {};
    visits.forEach((v: any) => {
      if (v.diagnosis) {
        const dName = v.diagnosis.trim();
        diagMap[dName] = (diagMap[dName] || 0) + 1;
      }
    });

    const topDiagnoses = Object.entries(diagMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // Save to summary collection
    const statsDocRef = doc(dbInstance, 'summary', `dashboard_stats_${year}_${month}`);
    const summaryData = {
      stats: calculatedStats,
      recentVisits: visits.slice(0, 5).map((v: any) => {
        // Anonymize name to initials or formatted string for public view, e.g. "Siswa A. B."
        const nameParts = (v.studentName || 'Siswa Anonim').trim().split(/\s+/);
        const anonName = nameParts.map((part: string, idx: number) => idx === 0 ? part : `${part.charAt(0).toUpperCase()}.`).join(' ');
        
        return {
          id: v.id,
          studentName: anonName,
          date: v.date || '',
          grade: v.grade || '',
          complaint: v.complaint || '',
          diagnosis: v.diagnosis || '',
          gender: v.gender || ''
        };
      }),
      chartData: trendData,
      diagnosisData: topDiagnoses,
      updatedAt: Timestamp.now()
    };

    await setDoc(statsDocRef, summaryData);
    console.log(`[Dashboard Stats Sync] Berhasil memperbarui summary/dashboard_stats_${year}_${month}`);
    console.log(`- User: Terotentikasi (Admin/Officer)`);
    console.log(`- Nama Koleksi: summary`);
    console.log(`- Jumlah Dokumen Ditemukan: 1 (updated)`);
  } catch (err: any) {
    console.error(`[Dashboard Stats Sync] Gagal memperbarui summary stats untuk ${year}-${month + 1}:`, err);
    console.error(`- User: Terotentikasi (Admin/Officer)`);
    console.error(`- Nama Koleksi: summary`);
    console.error(`- Error Firebase: ${err.message || String(err)}`);
  }
}
