export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { roomNumber, items, customMessage, id: providedId } = req.body;
  
  const formattedMessage = `New Room Request:\n\n- Room: ${roomNumber}\n- Items: ${items && items.length > 0 ? items.join(", ") : "None"}\n- Note: ${customMessage || "None"}`;

  // 1. Sync to Supabase if credentials are configured
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY)?.trim();

  if (supabaseUrl && supabaseKey) {
    try {
      const supaPayload = {
        id: providedId || `srv-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        room_id: String(roomNumber || "Unknown"),
        items: Array.isArray(items) ? items : [],
        custom_message: customMessage || "",
        status: "pending",
        created_at: Date.now(),
        updated_at: new Date().toISOString()
      };

      await fetch(`${supabaseUrl}/rest/v1/guest_requests`, {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates"
        },
        body: JSON.stringify(supaPayload)
      }).catch(e => console.warn("[SUPABASE Vercel] Write error:", e?.message));
    } catch (err: any) {
      console.warn("[SUPABASE Vercel] Exception:", err?.message);
    }
  }

  console.log(`[RESEND EMAIL] Dispatching Email alert from Vercel...`);
  
  const resendApiKey = process.env.RESEND_API_KEY;
  
  if (resendApiKey) {
    const toEmails = process.env.RESEND_TO_EMAILS 
      ? process.env.RESEND_TO_EMAILS.split(',').map(e => e.trim()) 
      : ["alamuri.kishan@gmail.com"];

    try {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: "onboarding@resend.dev",
          to: toEmails,
          subject: `🛎️ New Request from Room ${roomNumber}`,
          text: formattedMessage
        })
      });
      
      if (!resendResponse.ok) {
        const errorText = await resendResponse.text();
        throw new Error(`Resend API returned status: ${resendResponse.status} - ${errorText}`);
      }
      
      return res.status(200).json({ success: true, message: "Staff notified successfully" });
    } catch (e) {
      console.error("Failed to trigger Resend email:", e);
      return res.status(500).json({ success: false, error: "Failed to trigger notification email" });
    }
  } else {
    console.log("Missing RESEND_API_KEY in Vercel environment variables.");
    return res.status(500).json({ success: false, error: "Server missing Resend API configuration" });
  }
}
