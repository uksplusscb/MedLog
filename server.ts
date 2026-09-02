import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, orderBy, limit, doc, setDoc, Timestamp, getDoc } from "firebase/firestore";
import { format } from "date-fns";
import fs from "fs";
import { getApps as getAdminApps, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

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
      const dbInstance = getFirestore(appInstance, firebaseConfig.firestoreDatabaseId || '(default)');

      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();

      // Support explicit target period query parameters
      let targetYear = req.query.year ? parseInt(req.query.year as string, 10) : null;
      let targetMonth = req.query.month ? parseInt(req.query.month as string, 10) : null;

      if (targetYear === null || targetMonth === null || isNaN(targetYear) || isNaN(targetMonth)) {
        targetYear = currentYear;
        targetMonth = currentMonth;
      }

      console.log(`[Express API Dashboard] Membaca summary untuk periode ${targetYear}-${targetMonth}`);

      const statsDocRef = doc(dbInstance, 'summary', `dashboard_stats_${targetYear}_${targetMonth}`);
      const statsSnap = await getDoc(statsDocRef);

      if (statsSnap.exists()) {
        const data = statsSnap.data();
        console.log(`[Express API Dashboard] Berhasil membaca summary untuk periode ${targetYear}-${targetMonth}`);
        return res.status(200).json({
          status: true,
          stats: data.stats,
          recentVisits: data.recentVisits,
          chartData: data.chartData,
          diagnosisData: data.diagnosisData,
          updatedAt: data.updatedAt
        });
      }

      console.log(`[Express API Dashboard] Summary untuk periode ${targetYear}-${targetMonth} tidak ditemukan. Mengembalikan response kosong default.`);

      // Try to initialize and query using firebase-admin to generate real-time data for Guest
      try {
        if (getAdminApps().length === 0) {
          initializeAdminApp({
            projectId: firebaseConfig.projectId
          });
        }
        
        const adminDb = getAdminFirestore(firebaseConfig.firestoreDatabaseId || '(default)');

        const startOfMonthStr = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-01T00:00:00.000Z`;
        const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
        const endOfMonthStr = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`;

        console.log(`[Express API Dashboard Admin] Query visits dari ${startOfMonthStr} s/d ${endOfMonthStr}...`);
        
        // Fetch visits for this month using admin access
        const visitsSnap = await adminDb.collection('visits')
          .where('date', '>=', startOfMonthStr)
          .where('date', '<=', endOfMonthStr)
          .orderBy('date', 'desc')
          .get();

        const visits = visitsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        console.log(`[Express API Dashboard Admin] Query medicines...`);
        // Fetch medicines using admin access
        const medicinesSnap = await adminDb.collection('medicines').get();
        const medicines = medicinesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        console.log(`[Express API Dashboard Admin] Berhasil mengambil ${visits.length} visits dan ${medicines.length} medicines dari Firestore.`);

        // 1. Calculate lowStock
        const lowStockCount = medicines.filter((mData: any) => {
          const stock = mData.stock !== undefined ? mData.stock : mData.stok || 0;
          return Number(stock) < 10;
        }).length;

        // 2. Format month label
        const monthsList = [
          'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
          'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
        ];
        const activeMonthLabel = `${monthsList[targetMonth]} ${targetYear}`;

        // 3. Today visits
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfTodayStr = startOfToday.toISOString().split('T')[0] + 'T00:00:00.000Z';
        const todayVisitsCount = visits.filter((v: any) => v.date && v.date >= startOfTodayStr).length;

        // 4. Unique students count
        const uniqueStudentsCount = Array.from(new Set(visits.map((v: any) => v.studentName || 'Siswa Anonim'))).length;

        const calculatedStats = {
          todayVisits: todayVisitsCount,
          monthVisits: visits.length,
          lowStock: lowStockCount,
          uniqueStudents: uniqueStudentsCount,
          activeMonthName: activeMonthLabel
        };

        // 5. Weekly trend or month weekly trend
        const isCurrentPeriod = targetYear === now.getFullYear() && targetMonth === now.getMonth();
        let chartData: any[] = [];
        if (isCurrentPeriod) {
          const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
          chartData = Array.from({ length: 7 }).map((_, i) => {
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
          chartData = weeks.map(w => {
            const count = visits.filter((v: any) => {
              if (!v.date) return false;
              try {
                const d = new Date(v.date);
                const day = d.getDate();
                return d.getFullYear() === targetYear && d.getMonth() === targetMonth && day >= w.start && day <= w.end;
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

        // 6. Diagnosis distribution
        const diagMap: Record<string, number> = {};
        visits.forEach((v: any) => {
          if (v.diagnosis) {
            const dName = v.diagnosis.trim();
            diagMap[dName] = (diagMap[dName] || 0) + 1;
          }
        });

        const diagnosisData = Object.entries(diagMap)
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 5);

        // 7. Recent visits with anonymization (last 5)
        const recentVisits = visits.slice(0, 5).map((v: any) => {
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

        // Save calculated summary back to Firestore to cache it for subsequent public/guest page loads!
        const serverSummaryDocRef = adminDb.collection('summary').doc(`dashboard_stats_${targetYear}_${targetMonth}`);
        await serverSummaryDocRef.set({
          stats: calculatedStats,
          recentVisits,
          chartData,
          diagnosisData,
          updatedAt: new Date().toISOString()
        });

        console.log(`[Express API Dashboard Admin] Berhasil mengkalkulasi dan menyimpan cache summary baru ke Firestore.`);

        return res.status(200).json({
          status: true,
          stats: calculatedStats,
          recentVisits,
          chartData,
          diagnosisData,
          message: "Real-time summary generated and cached successfully by server"
        });

      } catch (adminErr: any) {
        console.error(`[Express API Dashboard Admin Error] Gagal melakukan kalkulasi via Admin SDK:`, adminErr);
        // If Admin SDK fails, fall back to empty defaults below
      }

      console.log(`[Express API Dashboard] Gagal menggunakan Admin SDK. Mengembalikan fallback default kosong.`);

      // If everything fails, return empty stats with activeMonthName
      const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
      ];
      const activeMonthName = `${months[targetMonth]} ${targetYear}`;

      return res.status(200).json({
        status: true,
        stats: {
          todayVisits: 0,
          monthVisits: 0,
          lowStock: 0,
          uniqueStudents: 0,
          activeMonthName: activeMonthName
        },
        recentVisits: [],
        chartData: Array.from({ length: 7 }).map((_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const dateLabel = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
          const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
          return {
            name: dayNames[d.getDay()],
            count: 0,
            dateLabel: dateLabel
          };
        }).reverse(),
        diagnosisData: [],
        message: "Summary belum di-generate oleh Admin"
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
