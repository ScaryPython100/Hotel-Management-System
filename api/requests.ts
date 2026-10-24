import { getStaffUser, resolveRoomToken } from "./_lib/security.js";

// In-memory deduplication cache across invocations within the same instance
const DEDUP_WINDOW_MS = 3 * 60 * 1000;
const MAX_DEDUP_ENTRIES = 500;
const emailedReqIds = new Map<string, number>();
const recentReqFingerprints = new Map<string, number>();

function pruneDedupCaches(now: number) {
  for (const cache of [emailedReqIds, recentReqFingerprints]) {
    for (const [key, ts] of cache) {
      if (now - ts >= DEDUP_WINDOW_MS) cache.delete(key);
    }
    // Maps iterate in insertion order, so the oldest entries go first
    while (cache.size > MAX_DEDUP_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
}

export function resetDedupCachesForTesting() {
  emailedReqIds.clear();
  recentReqFingerprints.clear();
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Guest-submitted requests must never target the reserved settings rows
export function getRequestRejection(providedId: unknown, roomId: unknown): string | null {
  if (providedId !== undefined && providedId !== null && providedId !== "") {
    if (typeof providedId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(providedId)) return "Invalid request id";
    if (providedId.toLowerCase().startsWith("system-")) return "Invalid request id";
  }
  const room = String(roomId ?? "").trim();
  if (!room || room.toUpperCase() === "SETTINGS" || room.length > 20) return "Invalid room";
  return null;
}

function getSenderConfig(): { from: string; replyTo: string } {
  const envFrom = process.env.RESEND_FROM_EMAIL?.trim();
  const replyTo = "huesstay@gmail.com";

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
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)?.trim();

  // GET requests from Supabase
  if (req.method === 'GET') {
    if (!(await getStaffUser(req))) {
      return res.status(401).json({ success: false, error: "Staff sign-in required" });
    }
    if (!supabaseUrl || !supabaseKey) {
      return res.status(200).json({ success: true, requests: [], source: "memory" });
    }

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/guest_requests?select=*&order=created_at.desc`, {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });
      if (!response.ok) {
        return res.status(200).json({ success: true, requests: [], source: "fallback" });
      }
      const data = await response.json();
      const mapped = (Array.isArray(data) ? data : [])
        .filter((r: any) => r.room_id !== "SETTINGS" && !String(r.id || "").startsWith("system-") && !r.is_deleted_from_dashboard)
        .map((r: any) => {
          let isWaitlist = !!r.is_waitlist;
          let waitlistForItem = r.waitlist_for_item || undefined;
          let queuePosition = typeof r.queue_position === "number" ? r.queue_position : undefined;
          const msg = String(r.custom_message || "");
          if (!isWaitlist && msg.startsWith("[WAITLIST:")) {
            isWaitlist = true;
            const match = msg.match(/\[WAITLIST:\s*([^\]#]+)(?:#(\d+))?\]/i);
            if (match) {
              waitlistForItem = match[1]?.trim();
              if (match[2]) queuePosition = parseInt(match[2], 10);
            }
          }
          return {
            id: r.id,
            roomId: r.room_id,
            items: Array.isArray(r.items) ? r.items : [],
            customMessage: r.custom_message || "",
            status: r.status || "pending",
            createdAt: Number(r.created_at) || Date.now(),
            isWaitlist,
            waitlistForItem,
            queuePosition
          };
        });
      return res.status(200).json({ success: true, requests: mapped, source: "supabase" });
    } catch (e: any) {
      return res.status(200).json({ success: true, requests: [], error: e?.message });
    }
  }

  // POST new request to Supabase
  if (req.method === 'POST') {
    // Path-style POSTs (e.g. /api/requests/clear-all) are rewritten to ?id= and are not request submissions
    if (req.query?.id) {
      return res.status(404).json({ success: false, error: "Not found" });
    }

    const { roomToken, roomId, items, customMessage, createdAt, id: providedId, isWaitlist, waitlistForItem, queuePosition } = req.body || {};
    // The room comes from the signed QR link; plain room numbers only work in legacy mode
    const rawRoomId = resolveRoomToken(roomToken ?? roomId);
    if (!rawRoomId) {
      return res.status(403).json({ success: false, error: "Invalid room link. Please scan the QR code in your room." });
    }
    const rejection = getRequestRejection(providedId, rawRoomId);
    if (rejection) {
      return res.status(400).json({ success: false, error: rejection });
    }

    const resolvedRoomId = String(rawRoomId).trim();
    const newReq: any = {
      id: providedId || `srv-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      room_id: resolvedRoomId,
      items: Array.isArray(items) ? items.map((i: any) => String(i)) : [],
      custom_message: typeof customMessage === "string" ? customMessage : "",
      status: "pending",
      created_at: Number(createdAt) || Date.now(),
      updated_at: new Date().toISOString(),
      is_waitlist: Boolean(isWaitlist),
      waitlist_for_item: waitlistForItem || null,
      queue_position: typeof queuePosition === "number" ? queuePosition : null
    };

    let persisted = !(supabaseUrl && supabaseKey);
    if (supabaseUrl && supabaseKey) {
      try {
        const resp = await fetch(`${supabaseUrl}/rest/v1/guest_requests`, {
          method: "POST",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
          },
          body: JSON.stringify(newReq)
        });
        if (resp.ok) {
          persisted = true;
        } else {
          // Fallback without waitlist columns if schema does not have them yet
          let fallbackMessage = newReq.custom_message;
          if (isWaitlist && waitlistForItem && !fallbackMessage.startsWith("[WAITLIST:")) {
            fallbackMessage = `[WAITLIST: ${waitlistForItem}#${queuePosition || 1}] ${fallbackMessage}`.trim();
          }
          const baseReq = {
            id: newReq.id,
            room_id: newReq.room_id,
            items: newReq.items,
            custom_message: fallbackMessage,
            status: newReq.status,
            created_at: newReq.created_at,
            updated_at: newReq.updated_at
          };
          const retry = await fetch(`${supabaseUrl}/rest/v1/guest_requests`, {
            method: "POST",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "resolution=merge-duplicates"
            },
            body: JSON.stringify(baseReq)
          });
          persisted = retry.ok;
          if (!retry.ok) {
            console.warn(`[SUPABASE] api/requests insert failed with status ${retry.status}`);
          }
        }
      } catch (e: any) {
        console.warn("[SUPABASE] api/requests insert error:", e?.message);
      }
    }

    // Dispatch staff notification email via Resend (deduplicated). Sent even if the insert failed,
    // so staff still hear about the request.
    const roomIdStr = newReq.room_id;
    const sortedItems = newReq.items.map((i: string) => i.trim().toLowerCase()).sort().join("|");
    const msgClean = newReq.custom_message.trim().toLowerCase();
    const fingerprint = `${roomIdStr.toLowerCase()}:::${sortedItems}:::${msgClean}`;
    const now = Date.now();
    pruneDedupCaches(now);

    const lastSent = recentReqFingerprints.get(fingerprint);
    const isDuplicate = emailedReqIds.has(String(newReq.id)) || (lastSent !== undefined && (now - lastSent) < DEDUP_WINDOW_MS);

    if (!isDuplicate) {
      emailedReqIds.set(String(newReq.id), now);
      recentReqFingerprints.set(fingerprint, now);

      const apiKey = process.env.RESEND_API_KEY?.trim();
      if (apiKey) {
        const { from, replyTo } = getSenderConfig();
        const recipient = getRecipientList()[0] || "huesstay@gmail.com";
        const timestamp = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
        const dashboardUrl = process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/staff` : "https://huesstayluxuryrooms.vercel.app/staff";

        const isWaitlistReservation = Boolean(isWaitlist);
        const emailSubject = isWaitlistReservation
          ? `⏳ Waitlist Reservation (Queue #${queuePosition || 1}): Room ${roomIdStr}`
          : `🛎️ New Request: Room ${roomIdStr}`;

        const plainText = (isWaitlistReservation
          ? `⏳ SMART WAITLIST RESERVATION (QUEUE #${queuePosition || 1}) - ROOM ${roomIdStr}\n` +
            `============================================================\n\n` +
            `Room: Room ${roomIdStr}\n` +
            `Time: ${timestamp}\n\n` +
            `Scarce Item Reserved: ${waitlistForItem || newReq.items[0] || "Appliance"}\n` +
            `Status: In line for Floor-to-Floor Relay as soon as freed from current room\n\n`
          : `🛎️ NEW GUEST REQUEST - ROOM ${roomIdStr}\n` +
            `==========================================\n\n` +
            `Room: Room ${roomIdStr}\n` +
            `Time: ${timestamp}\n\n` +
            `Items Requested:\n` +
            `${newReq.items.length > 0 ? newReq.items.map((i: string) => `  • ${i}`).join("\n") : "  (No specific items)"}\n\n`) +
          (newReq.custom_message ? `Guest Note:\n  "${newReq.custom_message}"\n\n` : "") +
          `Open Staff Dashboard to attend to this request.\n` +
          `${dashboardUrl}\n\n` +
          `---\nHues Stay Automated Concierge System`;

        const htmlRoom = escapeHtml(roomIdStr);
        const htmlContent = `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#2D2926;background:#F9F7F4;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E1DB;padding:28px;"><h2 style="margin:0 0 16px;color:#2D2926;font-size:20px;">${isWaitlistReservation ? `⏳ Waitlist Reservation (Queue #${escapeHtml(queuePosition || 1)}): Room ${htmlRoom}` : `🛎️ New Request: Room ${htmlRoom}`}</h2>${isWaitlistReservation ? `<p style="margin:0 0 8px;padding:8px 12px;background:#FEF3C7;color:#92400E;font-size:12px;font-weight:bold;">⚡ FLOOR-TO-FLOOR RELAY PENDING: Item currently in use in another room.</p>` : ""}<p style="margin:0 0 12px;color:#59534C;"><strong>${isWaitlistReservation ? "Reserved Appliance:" : "Items Requested:"}</strong></p><ul style="margin:0 0 16px;padding-left:20px;color:#2D2926;">${newReq.items.length > 0 ? newReq.items.map((i: string) => `<li>${escapeHtml(i)}</li>`).join("") : "<li>No specific items</li>"}</ul>${newReq.custom_message ? `<p style="margin:0 0 16px;color:#59534C;white-space:pre-line;"><strong>Note:</strong> ${escapeHtml(newReq.custom_message)}</p>` : ""}<div style="margin-top:24px;"><a href="${escapeHtml(dashboardUrl)}" style="background:#2D2926;color:#ffffff;text-decoration:none;padding:10px 20px;font-size:13px;font-weight:bold;letter-spacing:1px;display:inline-block;">OPEN STAFF DASHBOARD</a></div></div></body></html>`;

        try {
          const emailPromise = fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              from,
              to: [recipient],
              reply_to: replyTo,
              subject: emailSubject,
              text: plainText,
              html: htmlContent
            })
          }).then(async (r) => {
            if (!r.ok) {
              const err = await r.text();
              console.warn(`[RESEND] api/requests dispatch returned status ${r.status}: ${err}`);
            }
          }).catch((err) => {
            console.warn("[RESEND] api/requests dispatch error:", err?.message);
          });

          // Allow up to 2500ms for Resend to complete before serverless function responds
          await Promise.race([emailPromise, new Promise(r => setTimeout(r, 2500))]);
        } catch (err: any) {
          console.warn("[RESEND] api/requests dispatch exception:", err?.message);
        }
      } else {
        console.warn("[EMAIL] RESEND_API_KEY is not configured in environment variables. Email notification skipped.");
      }
    }

    // Awaited: serverless functions may be frozen as soon as the response is sent
    const responseRequest = {
      id: newReq.id,
      roomId: newReq.room_id,
      items: newReq.items,
      customMessage: newReq.custom_message,
      status: newReq.status,
      createdAt: newReq.created_at
    };

    if (!persisted) {
      return res.status(502).json({ success: false, error: "Request could not be saved", request: responseRequest });
    }

    return res.status(200).json({ success: true, request: responseRequest });
  }

  // PATCH status, or DELETE = dismiss from dashboard (the record is preserved in Supabase)
  if (req.method === 'PATCH' || req.method === 'DELETE') {
    const id = req.query?.id || req.body?.id;
    if (!id) return res.status(400).json({ error: "Missing ID" });
    if (String(id).startsWith("system-")) return res.status(400).json({ error: "Invalid ID" });

    const isStaff = Boolean(await getStaffUser(req));
    if (!isStaff) {
      // Guests may only cancel a pending request from their own room
      const guestRoom = req.method === 'DELETE' ? resolveRoomToken(req.headers?.["x-room-token"]) : null;
      if (!guestRoom || !supabaseUrl || !supabaseKey) {
        return res.status(401).json({ success: false, error: "Staff sign-in required" });
      }
      const lookup = await fetch(`${supabaseUrl}/rest/v1/guest_requests?select=room_id,status&id=eq.${encodeURIComponent(id)}`, {
        headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
      });
      const rows: any[] = lookup.ok ? await lookup.json() : [];
      if (!rows[0] || String(rows[0].room_id) !== guestRoom || rows[0].status !== "pending") {
        return res.status(403).json({ success: false, error: "This request cannot be cancelled from this room" });
      }
    }

    let patch: Record<string, any>;
    if (req.method === 'PATCH') {
      const status = req.body?.status;
      if (status !== "pending" && status !== "completed") {
        return res.status(400).json({ error: "Invalid status" });
      }
      patch = { status, updated_at: new Date().toISOString() };
    } else {
      patch = { is_deleted_from_dashboard: true, deleted_at: Date.now(), updated_at: new Date().toISOString() };
    }

    if (supabaseUrl && supabaseKey) {
      try {
        const resp = await fetch(`${supabaseUrl}/rest/v1/guest_requests?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(patch)
        });
        if (!resp.ok) {
          return res.status(502).json({ success: false, error: `Supabase returned status ${resp.status}` });
        }
      } catch (e: any) {
        return res.status(502).json({ success: false, error: e?.message });
      }
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
