// In-memory deduplication cache across invocations within the same instance
const notifiedIds = new Set<string>();
const recentNotifyFingerprints = new Map<string, number>();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { roomNumber, items, customMessage, id: providedId } = req.body;
  const roomIdStr = String(roomNumber || "Unknown").trim();

  // Guard against system/settings records
  if (!roomIdStr || roomIdStr.toUpperCase() === "SETTINGS" || roomIdStr.toLowerCase().includes("setting") || String(providedId || "").startsWith("system-")) {
    return res.status(200).json({ success: true, message: "Ignored settings configuration record" });
  }

  const sortedItems = (Array.isArray(items) ? items : []).map(i => String(i).trim().toLowerCase()).sort().join("|");
  const msgClean = (customMessage || "").trim().toLowerCase();
  const fingerprint = `${roomIdStr.toLowerCase()}:::${sortedItems}:::${msgClean}`;
  const now = Date.now();

  // Deduplication check 1: Check by explicit ID
  if (providedId && notifiedIds.has(String(providedId))) {
    console.log(`[NOTIFY DEDUPLICATE] Suppressed duplicate email for ID: ${providedId}`);
    return res.status(200).json({ success: true, message: "Request already notified" });
  }

  // Deduplication check 2: Check by content fingerprint within 2 minutes (120,000 ms)
  const lastSent = recentNotifyFingerprints.get(fingerprint);
  if (lastSent && (now - lastSent) < 120000) {
    console.log(`[NOTIFY DEDUPLICATE] Suppressed duplicate email by fingerprint for Room ${roomIdStr} (sent ${(now - lastSent)/1000}s ago)`);
    if (providedId) notifiedIds.add(String(providedId));
    return res.status(200).json({ success: true, message: "Identical request already notified recently" });
  }

  // Lock immediately before async work to prevent concurrent dispatch race condition
  if (providedId) notifiedIds.add(String(providedId));
  recentNotifyFingerprints.set(fingerprint, now);

  const fromAddress = process.env.RESEND_FROM_EMAIL?.trim() || "Hues Stay Concierge <onboarding@resend.dev>";
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

  const formattedMessage = `🛎️ NEW GUEST REQUEST - ROOM ${roomIdStr}\n` +
    `==========================================\n\n` +
    `Room: Room ${roomIdStr}\n` +
    `Time: ${timestamp}\n\n` +
    `Items Requested:\n` +
    `${items && items.length > 0 ? items.map((i: string) => `  • ${i}`).join("\n") : "  (No specific items)"}\n\n` +
    (customMessage ? `Guest Note:\n  "${customMessage}"\n\n` : "") +
    `Open Staff Dashboard to attend to this request.\n` +
    `https://ais-dev-6pq7a4aadlk33uog2vbo7m-437727623674.asia-southeast1.run.app/staff\n\n` +
    `---\nHues Stay Automated Concierge System`;

  // 1. Sync to Supabase if credentials are configured
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY)?.trim();

  if (supabaseUrl && supabaseKey) {
    try {
      const supaPayload = {
        id: providedId || `srv-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        room_id: roomIdStr,
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

  console.log(`[RESEND EMAIL] Dispatching Email alert for Room ${roomIdStr}...`);
  
  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  
  if (resendApiKey) {
    const primaryRecipient = "huesstay@gmail.com";

    try {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [primaryRecipient],
          subject: `🛎️ New Request: Room ${roomNumber}`,
          text: formattedMessage,
          html: `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#2D2926;background:#F9F7F4;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E1DB;padding:28px;"><h2 style="margin:0 0 16px;color:#2D2926;font-size:20px;">🛎️ New Request: Room ${roomNumber}</h2><p style="margin:0 0 12px;color:#59534C;"><strong>Items Requested:</strong></p><ul style="margin:0 0 16px;padding-left:20px;color:#2D2926;">${items && items.length > 0 ? items.map((i: string) => `<li>${i}</li>`).join("") : "<li>No specific items</li>"}</ul>${customMessage ? `<p style="margin:0 0 16px;color:#59534C;"><strong>Note:</strong> ${customMessage}</p>` : ""}<div style="margin-top:24px;"><a href="https://ais-dev-6pq7a4aadlk33uog2vbo7m-437727623674.asia-southeast1.run.app/staff" style="background:#2D2926;color:#ffffff;text-decoration:none;padding:10px 20px;font-size:13px;font-weight:bold;letter-spacing:1px;display:inline-block;">OPEN STAFF DASHBOARD</a></div></div></body></html>`
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
    console.log("Missing RESEND_API_KEY in environment variables.");
    return res.status(500).json({ success: false, error: "Server missing Resend API configuration" });
  }
}
