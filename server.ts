import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, orderBy, limit, doc, setDoc, Timestamp, getDoc } from "firebase/firestore";
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

      // If summary doesn't exist, return empty stats with activeMonthName
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
