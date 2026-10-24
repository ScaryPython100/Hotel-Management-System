import { getSupabaseConfig, resolveRoomToken } from "./_lib/security.js";
import { normalizeReturnableName } from "../src/types.js";

// GET /api/guest?token=<room link>
// Everything the guest page needs, without other guests' names, phones or messages.
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const room = resolveRoomToken(req.query?.token);
  if (!room) {
    return res.status(404).json({ success: false, error: "Unknown room link" });
  }

  const { url, serviceKey } = getSupabaseConfig();
  if (!url || !serviceKey) {
    return res.status(503).json({ success: false, error: "Database is not configured" });
  }

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const settingsIds = ["system-amenities-settings-global", "system-inventory-limits-global", "system-deleted-items"];

  try {
    const [pendingRes, borrowedRes, settingsRes] = await Promise.all([
      fetch(`${url}/rest/v1/guest_requests?select=items,is_waitlist,waitlist_for_item,custom_message&status=eq.pending&room_id=neq.SETTINGS&or=(is_deleted_from_dashboard.is.null,is_deleted_from_dashboard.eq.false)`, { headers }),
      fetch(`${url}/rest/v1/borrowed_items?select=item_name&status=eq.borrowed`, { headers }),
      fetch(`${url}/rest/v1/guest_requests?select=id,custom_message&id=in.(${settingsIds.join(",")})`, { headers })
    ]);
    if (!pendingRes.ok || !borrowedRes.ok || !settingsRes.ok) {
      return res.status(502).json({ success: false, error: "Could not read live availability" });
    }

    const pending: any[] = await pendingRes.json();
    const borrowed: any[] = await borrowedRes.json();
    const settingsRows: any[] = await settingsRes.json();

    const readSetting = (id: string) => {
      const row = settingsRows.find(r => r.id === id);
      try {
        return row?.custom_message ? JSON.parse(row.custom_message) : null;
      } catch {
        return null;
      }
    };

    const inUse: Record<string, number> = {};
    for (const b of borrowed) {
      const name = normalizeReturnableName(String(b.item_name || ""));
      inUse[name] = (inUse[name] || 0) + 1;
    }

    const waitlistCounts: Record<string, number> = {};
    for (const r of pending) {
      const names = new Set<string>((Array.isArray(r.items) ? r.items : []).map((i: any) => normalizeReturnableName(String(i))));
      for (const name of names) {
        inUse[name] = (inUse[name] || 0) + 1;
      }

      let waitlistItem = r.is_waitlist ? r.waitlist_for_item : null;
      const msgMatch = !waitlistItem && String(r.custom_message || "").match(/^\[WAITLIST:\s*([^\]#]+)/i);
      if (msgMatch) waitlistItem = msgMatch[1].trim();
      if (waitlistItem) {
        const name = normalizeReturnableName(String(waitlistItem));
        waitlistCounts[name] = (waitlistCounts[name] || 0) + 1;
      }
    }

    return res.status(200).json({
      success: true,
      room,
      amenityStatus: readSetting("system-amenities-settings-global") || {},
      limits: readSetting("system-inventory-limits-global") || {},
      deletedItems: readSetting("system-deleted-items") || [],
      inUse,
      waitlistCounts
    });
  } catch (e: any) {
    return res.status(502).json({ success: false, error: e?.message || "Could not read live availability" });
  }
}
