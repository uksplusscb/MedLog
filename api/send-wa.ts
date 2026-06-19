import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, reason: 'Method Not Allowed' });
  }

  const { target, message, token: customToken } = req.body;
  const token = (customToken && customToken.trim()) ? customToken.trim() : (process.env.FONNTE_TOKEN || "Fv1WXAS8ph4UaE5nzKGs");

  if (!target || !message) {
    return res.status(400).json({ 
      status: false, 
      reason: "Target and message are required." 
    });
  }

  try {
    let response: Response;
    let usedMethod = "FormData";

    try {
      const formData = new FormData();
      formData.append("target", target);
      formData.append("message", message);
      formData.append("delay", "2");
      formData.append("countryCode", "62");

      response = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: {
          "Authorization": token
        },
        body: formData
      });
    } catch (formDataErr: any) {
      usedMethod = "URLSearchParams";
      console.warn(`[WA Vercel Proxy] FormData approach failed, trying URLSearchParams fallback:`, formDataErr);

      response = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: {
          "Authorization": token,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          target,
          message,
          token,
          delay: "2",
          countryCode: "62"
        }).toString()
      });
    }

    const resText = await response.text();
    console.log(`[WA Vercel Proxy] Respons Mentah Fonnte (${usedMethod}) untuk ${target} dengan Status HTTP ${response.status}: ${resText.substring(0, 500)}`);

    let resData: any = {};
    try {
      resData = JSON.parse(resText);
    } catch (parseErr) {
      resData = { status: false, reason: resText || `HTTP ${response.status}` };
    }
    return res.status(response.status).json(resData);
  } catch (error: any) {
    console.error("Fonnte API error:", error);
    return res.status(500).json({ 
      status: false, 
      reason: error.message || "Internal server error" 
    });
  }
}
