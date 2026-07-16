import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, orderBy, limit, doc, setDoc, Timestamp } from "firebase/firestore";
import { format } from "date-fns";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route for Fonnte WhatsApp Proxy
  app.post("/api/send-wa", async (req, res) => {
    const { target, message, token: customToken } = req.body;
    const defaultToken = (process.env.FONNTE_TOKEN || "GVsuHmPXyqYQ6TkY3GMK").trim();
    
    const rawToken = (customToken && typeof customToken === "string" && customToken.trim() && customToken !== "undefined" && customToken !== "null")
      ? customToken.trim()
      : defaultToken;
    const token = rawToken.trim();

    if (!token) {
      return res.status(500).json({ 
        status: false, 
        reason: "FONNTE_TOKEN tidak dikonfigurasi di server." 
      });
    }

    if (!target || !message) {
      return res.status(400).json({ 
        status: false, 
        reason: "Nomor tujuan (target) dan pesan (message) diperlukan." 
      });
    }

    const sendWithToken = async (activeToken: string) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      try {
        const maskedToken = activeToken.length > 6 ? `${activeToken.substring(0, 3)}***${activeToken.substring(activeToken.length - 3)}` : "***";
        console.log(`[WA] Mengirim ke ${target} menggunakan token: ${maskedToken} pada ${new Date().toISOString()}`);

        let response: Response;
        let usedMethod = "FormData";

        try {
          // 1. Try sending via FormData (Fonnte's modern preference)
          const formData = new FormData();
          formData.append("target", target);
          formData.append("message", message);
          formData.append("delay", "2");
          formData.append("countryCode", "62");

          response = await fetch("https://api.fonnte.com/send", {
            method: "POST",
            headers: {
              "Authorization": activeToken
            },
            body: formData,
            signal: controller.signal
          });
        } catch (formDataErr: any) {
          usedMethod = "URLSearchParams";
          console.warn(`[WA] FormData approach failed (${formDataErr.message || formDataErr}), trying URLSearchParams fallback...`);
          
          response = await fetch("https://api.fonnte.com/send", {
            method: "POST",
            headers: {
              "Authorization": activeToken,
              "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
              target,
              message,
              token: activeToken,
              delay: "2",
              countryCode: "62"
            }).toString(),
            signal: controller.signal
          });
        }

        clearTimeout(timeoutId);

        const resText = await response.text();
        console.log(`[WA] Respons Mentah Fonnte (${usedMethod}) untuk ${target} dengan Status HTTP ${response.status}: ${resText.substring(0, 500)}`);

        let resData: any = {};
        try {
          resData = JSON.parse(resText);
        } catch (parseErr) {
          console.warn(`[WA] Gagal mengubah respons Fonnte ke JSON. Menggunakan fallback objek.`);
          resData = { status: false, reason: resText || `HTTP ${response.status}` };
        }

        const isSuccess = response.status === 200 && resData.status === true;
        return { success: isSuccess, data: resData, status: response.status };
      } catch (error: any) {
        clearTimeout(timeoutId);
        console.error(`[WA] Error Fonnte ke ${target}:`, error);
        return {
          success: false,
          status: 500,
          data: {
            status: false,
            reason: error.name === "AbortError" ? "Fonnte API request timed out after 12 seconds" : (error.message || "Internal server error")
          }
        };
      }
    };

    let result = await sendWithToken(token);

    // Jika pengiriman gagal (status === false atau error) dan token yang digunakan adalah token kustom,
    // kita secara otomatis melakukan fallback & retry menggunakan token default UKS yang terbukti aktif/online.
    if (!result.success && token !== defaultToken) {
      console.warn(`[WA] Token kustom gagal (${result.data.reason || result.data.detail || "disconnected/unreachable"}). Mencoba otomatis menggunakan Token Default UKS...`);
      const backupResult = await sendWithToken(defaultToken);
      if (backupResult.success) {
        console.log(`[WA] Berhasil mengirim pesan via Token Default UKS (Fallback sukses)`);
        result = {
          success: true,
          status: 200,
          data: {
            ...backupResult.data,
            is_fallback_used: true,
            original_reason: result.data.reason || result.data.detail || "Token kustom terputus/disconnected"
          }
        };
      } else {
        console.error(`[WA] Token kustom AND Token default gagal terkirim.`);
      }
    }

    res.status(result.status).json(result.data);
  });

  // API Route for Public and Officer Dashboard Statistics (Read Only, Guest and Admin)
  app.get("/api/dashboard", async (req, res) => {
    try {
      const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
      if (!fs.existsSync(configPath)) {
        throw new Error(`Firebase configuration file not found at ${configPath}`);
      }
      
      const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const appInstance = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
      const dbInstance = getFirestore(appInstance);

      console.log('[Express API Dashboard] Memulai pengambilan data dari Firestore...');

      const visitsQuery = query(collection(dbInstance, 'visits'), orderBy('date', 'desc'), limit(1500));
      const [visitsSnap, medicinesSnap] = await Promise.all([
        getDocs(visitsQuery),
        getDocs(collection(dbInstance, 'medicines'))
      ]);

      const visits = visitsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      const medicines = medicinesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

      console.log(`[Express API Dashboard] Berhasil mengambil ${visits.length} Kunjungan dan ${medicines.length} Obat.`);

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

      // Support explicit target period query parameters
      let targetYear = req.query.year ? parseInt(req.query.year as string, 10) : null;
      let targetMonth = req.query.month ? parseInt(req.query.month as string, 10) : null;

      if (targetYear === null || targetMonth === null || isNaN(targetYear) || isNaN(targetMonth)) {
        targetYear = currentYear;
        targetMonth = currentMonth;

        if (!hasCurrentMonthData) {
          const latestWithDate = visits.find(v => v.date && !isNaN(new Date(v.date).getTime()));
          if (latestWithDate) {
            const d = new Date(latestWithDate.date);
            targetYear = d.getFullYear();
            targetMonth = d.getMonth();
          }
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

      // Secure anonymization of recent visits
      const recentVisits = visits.slice(0, 5).map(v => {
        const nameParts = (v.studentName || 'Siswa Anonim').trim().split(/\s+/);
        const anonName = nameParts.map((part, idx) => idx === 0 ? part : `${part.charAt(0).toUpperCase()}.`).join(' ');
        return {
          id: v.id,
          studentName: anonName,
          date: v.date || '',
          grade: v.grade || '',
          complaint: v.complaint || '',
          diagnosis: v.diagnosis || '',
          gender: v.gender || ''
        };
      });

      const statsData = {
        todayVisits: todayVisitsCount,
        monthVisits: monthVisitsCount,
        lowStock: lowStockCount,
        uniqueStudents: uniqueStudentsCount,
        activeMonthName: activeMonthName
      };

      // Auto-save calculated summary back to Firestore summary collection
      try {
        const statsDocRef = doc(dbInstance, 'summary', `dashboard_stats_${targetYear}_${targetMonth}`);
        await setDoc(statsDocRef, {
          stats: statsData,
          recentVisits,
          chartData,
          diagnosisData,
          updatedAt: Timestamp.now()
        });
        console.log(`[Express API Dashboard] Auto-saved summary to summary/dashboard_stats_${targetYear}_${targetMonth}`);
      } catch (writeErr) {
        console.warn(`[Express API Dashboard] Non-fatal: Gagal auto-save summary ke Firestore:`, writeErr);
      }

      res.status(200).json({
        status: true,
        stats: statsData,
        recentVisits,
        chartData,
        diagnosisData,
        totalVisitsReceived: visits.length
      });
    } catch (error: any) {
      console.error('[Express API Dashboard Error]:', error);
      res.status(500).json({
        status: false,
        reason: error.message || 'Internal server error',
        details: error.stack || ''
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
