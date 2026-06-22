import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";

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
