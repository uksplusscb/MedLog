import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, reason: 'Method Not Allowed' });
  }

  const { target, message } = req.body;
  const token = process.env.FONNTE_TOKEN || "Fv1WXAS8ph4UaE5nzKGs";

  if (!target || !message) {
    return res.status(400).json({ 
      status: false, 
      reason: "Target and message are required." 
    });
  }

  try {
    const response = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        "Authorization": token.trim()
      },
      body: new URLSearchParams({
        target,
        message,
        delay: "2",
        countryCode: "62"
      })
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error: any) {
    console.error("Fonnte API error:", error);
    return res.status(500).json({ 
      status: false, 
      reason: error.message || "Internal server error" 
    });
  }
}
