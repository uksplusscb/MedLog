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
    const token = (customToken && customToken.trim()) ? customToken.trim() : (process.env.FONNTE_TOKEN || "Fv1WXAS8ph4UaE5nzKGs");

    if (!token) {
      return res.status(500).json({ 
        status: false, 
        reason: "FONNTE_TOKEN is not configured on the server." 
      });
    }

    if (!target || !message) {
      return res.status(400).json({ 
        status: false, 
        reason: "Target and message are required." 
      });
    }

    // Use AbortController for a 8-second timeout to prevent the server from hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: {
          "Authorization": token
        },
        body: new URLSearchParams({
          target,
          message,
          token, // Fonnte also accepts token directly in post body
          delay: "2", // Add a small delay for stability
          countryCode: "62"
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const data = await response.json();
      console.log("Fonnte API Response for", target, ":", data);
      res.status(response.status).json(data);
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error("Fonnte API error:", error);
      res.status(500).json({ 
        status: false, 
        reason: error.name === "AbortError" ? "Fonnte API request timed out after 8 seconds" : (error.message || "Internal server error")
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
