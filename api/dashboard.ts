import { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { format } from 'date-fns';
import fs from 'fs';
import path from 'path';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ status: false, reason: 'Method Not Allowed' });
  }

  try {
    // Read Firebase config from the root file system
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) {
      throw new Error(`Firebase configuration file not found at ${configPath}`);
    }
    
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    // Initialize Firebase client SDK
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    const db = getFirestore(app);

    console.log('[API Dashboard] Memulai pengambilan data dari Firestore...');

    // Fetch visits ordered by date desc (up to 1500)
    const visitsQuery = query(collection(db, 'visits'), orderBy('date', 'desc'), limit(1500));
    const [visitsSnap, medicinesSnap] = await Promise.all([
      getDocs(visitsQuery),
      getDocs(collection(db, 'medicines'))
    ]);

    const visits = visitsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
    const medicines = medicinesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

    console.log(`[API Dashboard] Berhasil mengambil ${visits.length} Kunjungan dan ${medicines.length} Obat.`);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const lowStockCount = medicines.filter(mData => {
      const stock = mData.stock !== undefined ? mData.stock : mData.stok || 0;
      return Number(stock) < 10;
    }).length;

    const hasCurrentMonthData = visits.some(v => {
      if (!v.date) return false;
      try {
        const d = new Date(v.date);
        return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
      } catch (_) {
        return false;
      }
    });

    let targetYear = currentYear;
    let targetMonth = currentMonth;

    if (!hasCurrentMonthData) {
      const latestWithDate = visits.find(v => v.date && !isNaN(new Date(v.date).getTime()));
      if (latestWithDate) {
        const d = new Date(latestWithDate.date);
        targetYear = d.getFullYear();
        targetMonth = d.getMonth();
      }
    }

    const months = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const activeMonthName = `${months[targetMonth]} ${targetYear}`;

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTodayStr = format(startOfToday, 'yyyy-MM-dd') + 'T00:00:00.000Z';

    const todayVisitsCount = visits.filter(v => v.date && v.date >= startOfTodayStr).length;

    const activeMonthVisits = visits.filter(v => {
      if (!v.date) return false;
      try {
        const d = new Date(v.date);
        return d.getFullYear() === targetYear && d.getMonth() === targetMonth;
      } catch (_) {
        return false;
      }
    });

    const monthVisitsCount = activeMonthVisits.length;
    const uniqueStudentsCount = Array.from(new Set(activeMonthVisits.map(v => v.studentName || 'Siswa Anonim'))).length;

    // Last 7 days chart trend
    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const chartData = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateLabel = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      
      const dayStartStr = format(d, 'yyyy-MM-dd') + 'T00:00:00.000Z';
      const dayEndStr = format(d, 'yyyy-MM-dd') + 'T23:59:59.999Z';
      const count = visits.filter(v => v.date && v.date >= dayStartStr && v.date <= dayEndStr).length;

      return {
        name: dayNames[d.getDay()],
        count: count,
        dateLabel: dateLabel
      };
    }).reverse();

    // Top 5 diagnoses
    const diagMap: Record<string, number> = {};
    activeMonthVisits.forEach(v => {
      if (v.diagnosis) {
        const dName = v.diagnosis.trim();
        diagMap[dName] = (diagMap[dName] || 0) + 1;
      }
    });

    const diagnosisData = Object.entries(diagMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    const recentVisits = visits.slice(0, 5);

    return res.status(200).json({
      status: true,
      stats: {
        todayVisits: todayVisitsCount,
        monthVisits: monthVisitsCount,
        lowStock: lowStockCount,
        uniqueStudents: uniqueStudentsCount,
        activeMonthName: activeMonthName
      },
      recentVisits,
      chartData,
      diagnosisData,
      totalVisitsReceived: visits.length
    });
  } catch (error: any) {
    console.error('[API Dashboard Error]:', error);
    return res.status(500).json({
      status: false,
      reason: error.message || 'Internal server error',
      details: error.stack || ''
    });
  }
}
