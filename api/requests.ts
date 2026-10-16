// In-memory deduplication cache across invocations within the same instance
const emailedReqIds = new Set<string>();
const recentReqFingerprints = new Map<string, number>();

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

const TARGET_AUTO_ITEMS = [
  "Iron Box",
  "Kettle",
  "Hair Dryer",
  "Laptop Table",
  "Hot Pack",
  "Set of Plates",
  "Set of Cups/Bowls",
  "Set of Glasses",
  "Empty Water Bottle",
  "Cooking Oil Dispenser",
  "Leg Massager (Paid)",
  "Glasses (Set of 2)",
  "USB 3.0 Cable + Adaptor",
  "Infrared Heat Therapy Lamp (Paid)"
];

const DEFAULT_LIMITS: Record<string, number> = {
  "Iron Box": 1,
  "Kettle": 5,
  "Hair Dryer": 2,
  "Laptop Table": 2,
  "Hot Pack": 2,
  "Set of Plates": 10,
  "Set of Cups/Bowls": 10,
  "Set of Glasses": 10,
  "Empty Water Bottle": 5,
  "Cooking Oil Dispenser": 5,
  "Leg Massager (Paid)": 1,
  "Glasses (Set of 2)": 10,
  "USB 3.0 Cable + Adaptor": 2,
  "Infrared Heat Therapy Lamp (Paid)": 1
};

function normalizeItemName(name: string): string {
  if (!name) return "";
  const lower = name.toLowerCase().trim();
  if (lower.includes("iron")) return "Iron Box";
  if (lower.includes("kettle") || lower.includes("teakettle")) return "Kettle";
  if (lower.includes("hair") && lower.includes("dryer")) return "Hair Dryer";
  if (lower.includes("laptop")) return "Laptop Table";
  if (lower.includes("hot pack") || lower.includes("pack")) return "Hot Pack";
  if (lower.includes("plate")) return "Set of Plates";
  if (lower.includes("cup") || lower.includes("bowl")) return "Set of Cups/Bowls";
  if (lower.includes("glass")) return "Set of Glasses";
  if (lower.includes("bottle") && lower.includes("empty")) return "Empty Water Bottle";
  if (lower.includes("dispenser") || lower.includes("oil")) return "Cooking Oil Dispenser";
  if (lower.includes("massager")) return "Leg Massager (Paid)";
  if (lower.includes("usb") || lower.includes("cable") || lower.includes("adaptor")) return "USB 3.0 Cable + Adaptor";
  if (lower.includes("infrared") || lower.includes("heat therapy")) return "Infrared Heat Therapy Lamp (Paid)";
  return name.trim();
}

async function reconcileServerlessInventory(supabaseUrl: string, supabaseKey: string) {
  try {
    const headers = {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`
    };

    const [borRes, reqRes, settingsRes, limitsRes, autoDepletedRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/borrowed_items?status=eq.borrowed`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/guest_requests?status=eq.pending`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/guest_requests?id=eq.system-amenities-settings-global`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/guest_requests?id=eq.system-inventory-limits-global`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/guest_requests?id=eq.system-auto-depleted-items`, { headers })
    ]);

    const activeBorrowed: any[] = borRes.ok ? await borRes.json().catch(() => []) : [];
    const pendingReqs: any[] = reqRes.ok ? await reqRes.json().catch(() => []) : [];
    const settingsRows: any[] = settingsRes.ok ? await settingsRes.json().catch(() => []) : [];
    const limitsRows: any[] = limitsRes.ok ? await limitsRes.json().catch(() => []) : [];
    const autoDepletedRows: any[] = autoDepletedRes.ok ? await autoDepletedRes.json().catch(() => []) : [];

    const limits: Record<string, number> = { ...DEFAULT_LIMITS };
    if (limitsRows[0]?.custom_message) {
      try {
        Object.assign(limits, JSON.parse(limitsRows[0].custom_message));
      } catch (e) {}
    }

    let amenityStatus: Record<string, string> = {};
    if (settingsRows[0]?.custom_message) {
      try {
        amenityStatus = JSON.parse(settingsRows[0].custom_message);
      } catch (e) {}
    }

    let autoDepleted: string[] = [];
    if (autoDepletedRows[0]?.custom_message) {
      try {
        const parsed = JSON.parse(autoDepletedRows[0].custom_message);
        if (Array.isArray(parsed)) autoDepleted = parsed;
      } catch (e) {}
    }
    const autoDepletedSet = new Set<string>(autoDepleted);
    let autoDepletedChanged = false;

    const borCounts = new Map<string, number>();
    for (const b of activeBorrowed) {
      const key = normalizeItemName(b.item_name);
      borCounts.set(key, (borCounts.get(key) || 0) + 1);
    }

    const pendCounts = new Map<string, number>();
    for (const r of pendingReqs) {
      if (!Array.isArray(r.items)) continue;
      const seenInReq = new Set<string>();
      for (const i of r.items) {
        const key = normalizeItemName(i);
        if (!seenInReq.has(key)) {
          seenInReq.add(key);
          pendCounts.set(key, (pendCounts.get(key) || 0) + 1);
        }
      }
    }

    let hasChanged = false;
    for (const item of TARGET_AUTO_ITEMS) {
      if (autoDepletedSet.has(item)) {
        autoDepletedSet.delete(item);
        autoDepletedChanged = true;
        if (amenityStatus[item] === "out_of_service") {
          amenityStatus[item] = "available";
          hasChanged = true;
        }
      }
    }

    if (autoDepletedChanged) {
      await fetch(`${supabaseUrl}/rest/v1/guest_requests`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates"
        },
        body: JSON.stringify({
          id: "system-auto-depleted-items",
          room_id: "SETTINGS",
          items: [],
          custom_message: JSON.stringify(Array.from(autoDepletedSet)),
          status: "completed",
          created_at: 0,
          updated_at: new Date().toISOString()
        })
      }).catch(() => {});
    }

    if (hasChanged) {
      await fetch(`${supabaseUrl}/rest/v1/guest_requests`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates"
        },
        body: JSON.stringify({
          id: "system-amenities-settings-global",
          room_id: "SETTINGS",
          items: [],
          custom_message: JSON.stringify(amenityStatus),
          status: "completed",
          created_at: 0,
          updated_at: new Date().toISOString()
        })
      });
    }
  } catch (err: any) {
    console.warn("[INVENTORY RECONCILE] Error:", err?.message);
  }
}

export default async function handler(req: any, res: any) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY)?.trim();

  // GET requests from Supabase
  if (req.method === 'GET') {
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
        .filter((r: any) => r.room_id !== "SETTINGS" && !String(r.id || "").startsWith("system-"))
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
    const { roomId, roomNumber, room_id, items, customMessage, status, createdAt, id: providedId, isWaitlist, waitlistForItem, queuePosition } = req.body || {};
    const resolvedRoomId = String(roomId || roomNumber || room_id || "Unknown");
    const newReq: any = {
      id: providedId || `srv-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      room_id: resolvedRoomId,
      items: Array.isArray(items) ? items : [],
      custom_message: customMessage || "",
      status: status || "pending",
      created_at: createdAt || Date.now(),
      updated_at: new Date().toISOString(),
      is_waitlist: Boolean(isWaitlist),
      waitlist_for_item: waitlistForItem || null,
      queue_position: typeof queuePosition === "number" ? queuePosition : null
    };

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
        if (!resp.ok) {
          // Fallback without waitlist columns if schema does not have them yet
          let fallbackMessage = customMessage || "";
          if (isWaitlist && waitlistForItem) {
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
          await fetch(`${supabaseUrl}/rest/v1/guest_requests`, {
            method: "POST",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "resolution=merge-duplicates"
            },
            body: JSON.stringify(baseReq)
          });
        }
      } catch (e) {}
    }

    // Dispatch staff notification email via Resend (deduplicated)
    const roomIdStr = String(newReq.room_id).trim();
    if (roomIdStr && roomIdStr.toUpperCase() !== "SETTINGS" && !String(newReq.id).startsWith("system-")) {
      const sortedItems = (newReq.items || []).map((i: string) => String(i).trim().toLowerCase()).sort().join("|");
      const msgClean = (newReq.custom_message || "").trim().toLowerCase();
      const fingerprint = `${roomIdStr.toLowerCase()}:::${sortedItems}:::${msgClean}`;
      const now = Date.now();

      const lastSent = recentReqFingerprints.get(fingerprint);
      const isDuplicate = emailedReqIds.has(String(newReq.id)) || (lastSent && (now - lastSent) < 15000);

      if (!isDuplicate) {
        emailedReqIds.add(String(newReq.id));
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
              `Scarce Item Reserved: ${waitlistForItem || (newReq.items && newReq.items[0]) || "Appliance"}\n` +
              `Status: In line for Floor-to-Floor Relay as soon as freed from current room\n\n`
            : `🛎️ NEW GUEST REQUEST - ROOM ${roomIdStr}\n` +
              `==========================================\n\n` +
              `Room: Room ${roomIdStr}\n` +
              `Time: ${timestamp}\n\n` +
              `Items Requested:\n` +
              `${newReq.items && newReq.items.length > 0 ? newReq.items.map((i: string) => `  • ${i}`).join("\n") : "  (No specific items)"}\n\n`) +
            (newReq.custom_message ? `Guest Note:\n  "${newReq.custom_message}"\n\n` : "") +
            `Open Staff Dashboard to attend to this request.\n` +
            `${dashboardUrl}\n\n` +
            `---\nHues Stay Automated Concierge System`;

          const htmlContent = `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#2D2926;background:#F9F7F4;padding:24px;"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E1DB;padding:28px;"><h2 style="margin:0 0 16px;color:#2D2926;font-size:20px;">${isWaitlistReservation ? `⏳ Waitlist Reservation (Queue #${queuePosition || 1}): Room ${roomIdStr}` : `🛎️ New Request: Room ${roomIdStr}`}</h2>${isWaitlistReservation ? `<p style="margin:0 0 8px;padding:8px 12px;background:#FEF3C7;color:#92400E;font-size:12px;font-weight:bold;">⚡ FLOOR-TO-FLOOR RELAY PENDING: Item currently in use in another room.</p>` : ""}<p style="margin:0 0 12px;color:#59534C;"><strong>${isWaitlistReservation ? "Reserved Appliance:" : "Items Requested:"}</strong></p><ul style="margin:0 0 16px;padding-left:20px;color:#2D2926;">${newReq.items && newReq.items.length > 0 ? newReq.items.map((i: string) => `<li>${i}</li>`).join("") : "<li>No specific items</li>"}</ul>${newReq.custom_message ? `<p style="margin:0 0 16px;color:#59534C;"><strong>Note:</strong> ${newReq.custom_message}</p>` : ""}<div style="margin-top:24px;"><a href="${dashboardUrl}" style="background:#2D2926;color:#ffffff;text-decoration:none;padding:10px 20px;font-size:13px;font-weight:bold;letter-spacing:1px;display:inline-block;">OPEN STAFF DASHBOARD</a></div></div></body></html>`;

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
    }

    if (supabaseUrl && supabaseKey) {
      reconcileServerlessInventory(supabaseUrl, supabaseKey).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      request: {
        id: newReq.id,
        roomId: newReq.room_id,
        items: newReq.items,
        customMessage: newReq.custom_message,
        status: newReq.status,
        createdAt: newReq.created_at
      }
    });
  }

  // PATCH or DELETE
  if (req.method === 'PATCH' || req.method === 'DELETE') {
    const id = req.query?.id || req.body?.id;
    if (!id) return res.status(400).json({ error: "Missing ID" });

    if (supabaseUrl && supabaseKey) {
      if (req.method === 'PATCH') {
        const { status } = req.body;
        await fetch(`${supabaseUrl}/rest/v1/guest_requests?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ status, updated_at: new Date().toISOString() })
        });
      } else {
        await fetch(`${supabaseUrl}/rest/v1/guest_requests?id=eq.${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        });
      }
      reconcileServerlessInventory(supabaseUrl, supabaseKey).catch(() => {});
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
