// In-memory deduplication cache across invocations within the same instance
const notifiedIds = new Set<string>();
const recentNotifyFingerprints = new Map<string, number>();

function getSenderConfig(): { from: string; replyTo: string } {
  const envFrom = process.env.RESEND_FROM_EMAIL?.trim();
  const replyTo = "huesstay@gmail.com";

  // Resend strictly rejects requests where 'from' contains @gmail.com or other public email domains
  // because public domains cannot have SPF/DKIM configured by individual users.
  // We sanitize the sender to use Resend's verified onboarding domain while setting reply_to so all replies
  // go directly to huesstay@gmail.com.
  const isPublicWebmail = !envFrom || /@(gmail\.com|yahoo\.com|outlook\.com|hotmail\.com|icloud\.com)/i.test(envFrom);
  const from = isPublicWebmail
    ? "Hues Stay Concierge <onboarding@resend.dev>"
    : (envFrom.includes("<") ? envFrom : `Hues Stay Concierge <${envFrom}>`);

  return { from, replyTo };
}

function getRecipientList(): string[] {
  const envTo = process.env.RESEND_TO_EMAILS?.trim();
  if (envTo) {
    const list = envTo.split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    if (list.length > 0) return list;
  }
  return ["huesstay@gmail.com"];
}

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { roomNumber, items, customMessage, id: providedId } = req.body || {};
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

  // Deduplication check 2: Check by content fingerprint within 15 seconds (catches rapid double-clicks)
  const lastSent = recentNotifyFingerprints.get(fingerprint);
  if (lastSent && (now - lastSent) < 15000) {
    console.log(`[NOTIFY DEDUPLICATE] Suppressed duplicate email by fingerprint for Room ${roomIdStr} (sent ${(now - lastSent)/1000}s ago)`);
    if (providedId) notifiedIds.add(String(providedId));
    return res.status(200).json({ success: true, message: "Identical request already notified recently" });
  }

  // Lock immediately before async work to prevent concurrent dispatch race condition
  if (providedId) notifiedIds.add(String(providedId));
  recentNotifyFingerprints.set(fingerprint, now);

  const { from: fromAddress, replyTo: replyToAddress } = getSenderConfig();
  const recipientList = getRecipientList();
  const primaryRecipient = recipientList[0] || "huesstay@gmail.com";

  const timestamp = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

  const formattedMessage = `🛎️ NEW GUEST REQUEST - ROOM ${roomIdStr}\n` +
    `==========================================\n\n` +
    `Room: Room ${roomIdStr}\n` +
    `Time: ${timestamp}\n\n` +
    `Items Requested:\n` +
    `${items && items.length > 0 ? items.map((i: string) => `  • ${i}`).join("\n") : "  (No specific items)"}\n\n` +
    (customMessage ? `Guest Note:\n  "${customMessage}"\n\n` : "") +
    `Open Staff Dashboard to attend to this request.\n` +
    `https://huesstayluxuryrooms.vercel.app/staff\n\n` +
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

  console.log(`[RESEND EMAIL] Dispatching Email alert for Room ${roomIdStr} to ${primaryRecipient}...`);

  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const dashboardUrl = process.env.APP_URL 
    ? `${process.env.APP_URL.replace(/\/$/, '')}/staff` 
    : "https://huesstayluxuryrooms.vercel.app/staff";

  if (resendApiKey) {
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
          reply_to: replyToAddress,
          subject: `🛎️ New Request: Room ${roomIdStr}`,
          text: formattedMessage,
          html: `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#2D2926;background:#F9F7F4;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E1DB;padding:28px;"><h2 style="margin:0 0 16px;color:#2D2926;font-size:20px;">🛎️ New Request: Room ${roomIdStr}</h2><p style="margin:0 0 12px;color:#59534C;"><strong>Items Requested:</strong></p><ul style="margin:0 0 16px;padding-left:20px;color:#2D2926;">${items && items.length > 0 ? items.map((i: string) => `<li>${i}</li>`).join("") : "<li>No specific items</li>"}</ul>${customMessage ? `<p style="margin:0 0 16px;color:#59534C;"><strong>Note:</strong> ${customMessage}</p>` : ""}<div style="margin-top:24px;"><a href="${dashboardUrl}" style="background:#2D2926;color:#ffffff;text-decoration:none;padding:10px 20px;font-size:13px;font-weight:bold;letter-spacing:1px;display:inline-block;">OPEN STAFF DASHBOARD</a></div></div></body></html>`
        })
      });

      if (!resendResponse.ok) {
        const errorText = await resendResponse.text();
        console.error(`[RESEND] Failed with status ${resendResponse.status}: ${errorText}`);
        return res.status(500).json({ success: false, error: "Resend API rejected dispatch", details: errorText });
      }

      const resData = await resendResponse.json().catch(() => ({}));
      console.log(`[RESEND] Successfully sent email to ${primaryRecipient}. Resend ID: ${resData.id}`);
      return res.status(200).json({ success: true, message: "Staff notified successfully", id: resData.id });
    } catch (e: any) {
      console.error("[RESEND] Network or execution failure:", e?.message || e);
      return res.status(500).json({ success: false, error: "Failed to trigger notification email", details: e?.message });
    }
  } else {
    console.warn("[RESEND] Missing RESEND_API_KEY in environment variables.");
    return res.status(500).json({ success: false, error: "Server missing Resend API configuration" });
  }
}
