import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { 
  RoomRequest, 
  BorrowedItem, 
  TARGET_AUTO_UNAVAILABLE_ITEMS, 
  DEFAULT_INVENTORY_LIMITS, 
  DEFAULT_AMENITY_STATUS, 
  normalizeReturnableName 
} from "../types";

// Public Supabase credentials from client environment
const rawMeta = typeof import.meta !== "undefined" ? (import.meta as any).env : {};
const supabaseUrl = (rawMeta?.VITE_SUPABASE_URL || "https://gsavyysjbgxszjauoglf.supabase.co").replace(/\/rest\/v1\/?$/, "");
const supabaseAnonKey = rawMeta?.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzYXZ5eXNqYmd4c3pqYXVvZ2xmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMzIzNzQsImV4cCI6MjEwNDgwODM3NH0.bOUIqUUdsxgplSI088CCzPRk5eDWbNms1nANBGsAOwU";

let supabaseClient: SupabaseClient | null = null;

export function getClientSupabase(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 10 } }
    });
  }
  return supabaseClient;
}

/**
 * Fetch requests directly from Supabase (works on mobile, laptop, preview URL, and dev)
 */
export async function fetchLiveRequests(): Promise<RoomRequest[]> {
  const sb = getClientSupabase();
  
  // Try direct Supabase query first (guaranteed cross-device consistency)
  if (sb) {
    try {
      const { data, error } = await sb
        .from("guest_requests")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && data && Array.isArray(data)) {
        const activeRows = data.filter((row: any) => 
          !row.is_deleted_from_dashboard && 
          row.room_id !== "SETTINGS" && 
          !String(row.id || "").startsWith("system-")
        );
        return activeRows.map((row: any): RoomRequest => ({
          id: row.id,
          roomId: String(row.room_id),
          qrCodeHash: String(row.room_id),
          items: Array.isArray(row.items) ? row.items : [],
          customMessage: row.custom_message || "",
          status: row.status === "completed" ? "completed" : "pending",
          createdAt: Number(row.created_at) || Date.now()
        }));
      }
    } catch (err) {
      console.warn("[CLIENT SUPABASE] Direct fetch requests fallback to API:", err);
    }
  }

  // Fallback to server API
  try {
    const res = await fetch("/api/requests");
    if (res.ok) {
      const json = await res.json();
      if (json.requests && Array.isArray(json.requests)) {
        return json.requests;
      }
    }
  } catch (err) {
    console.warn("[API] Fetch requests error:", err);
  }

  return [];
}

/**
 * Fetch borrowed items directly from Supabase (works on mobile, laptop, preview URL, and dev)
 */
export async function fetchLiveBorrowed(): Promise<BorrowedItem[]> {
  const sb = getClientSupabase();

  if (sb) {
    try {
      const { data, error } = await sb
        .from("borrowed_items")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && data && Array.isArray(data)) {
        return data.map((row: any): BorrowedItem => ({
          id: row.id,
          roomId: String(row.room_id),
          itemName: row.item_name,
          status: row.status === "returned" ? "returned" : "borrowed",
          createdAt: Number(row.created_at) || Date.now(),
          returnedAt: row.returned_at ? new Date(row.returned_at).getTime() : undefined
        }));
      }
    } catch (err) {
      console.warn("[CLIENT SUPABASE] Direct fetch borrowed fallback to API:", err);
    }
  }

  // Fallback to server API
  try {
    const res = await fetch("/api/borrowed");
    if (res.ok) {
      const json = await res.json();
      if (json.items && Array.isArray(json.items)) {
        return json.items;
      }
    }
  } catch (err) {
    console.warn("[API] Fetch borrowed error:", err);
  }

  return [];
}

/**
 * Update request status directly in Supabase + notify server API
 */
export async function updateLiveRequestStatus(id: string, status: "pending" | "completed"): Promise<boolean> {
  let success = false;
  const sb = getClientSupabase();

  if (sb) {
    try {
      const { error } = await sb
        .from("guest_requests")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (!error) success = true;
    } catch (err) {
      console.warn("[CLIENT SUPABASE] Update request status error:", err);
    }
  }

  // Also notify server API non-blockingly
  fetch(`/api/requests/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  }).catch(() => {});

  return success;
}

/**
 * Mark borrowed item as returned directly in Supabase + notify server API
 */
export async function markLiveBorrowedReturned(id: string): Promise<boolean> {
  let success = false;
  const sb = getClientSupabase();

  if (sb) {
    try {
      const { error } = await sb
        .from("borrowed_items")
        .update({ status: "returned", returned_at: new Date().toISOString() })
        .eq("id", id);
      if (!error) success = true;
    } catch (err) {
      console.warn("[CLIENT SUPABASE] Mark borrowed returned error:", err);
    }
  }

  // Also notify server API non-blockingly
  fetch(`/api/borrowed/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "returned" })
  }).catch(() => {});

  return success;
}

/**
 * Delete borrowed item directly in Supabase + notify server API
 */
export async function deleteLiveBorrowed(id: string): Promise<boolean> {
  let success = false;
  const sb = getClientSupabase();

  if (sb) {
    try {
      const { error } = await sb
        .from("borrowed_items")
        .delete()
        .eq("id", id);
      if (!error) success = true;
    } catch (err) {
      console.warn("[CLIENT SUPABASE] Delete borrowed error:", err);
    }
  }

  fetch(`/api/borrowed/${id}`, { method: "DELETE" }).catch(() => {});
  return success;
}

/**
 * Mark request as dismissed from dashboard in Supabase + notify server API
 */
export async function dismissLiveRequest(id: string): Promise<boolean> {
  let success = false;
  const sb = getClientSupabase();

  if (sb) {
    try {
      const { error } = await sb
        .from("guest_requests")
        .update({
          is_deleted_from_dashboard: true,
          deleted_at: Date.now(),
          updated_at: new Date().toISOString()
        })
        .eq("id", id);
      if (!error) success = true;
    } catch (err) {
      console.warn("[CLIENT SUPABASE] Dismiss request error:", err);
    }
  }

  fetch(`/api/requests/${id}`, { method: "DELETE" }).catch(() => {});
  return success;
}

/**
 * Save newly borrowed item directly to Supabase + notify server API
 */
export async function saveLiveBorrowed(item: BorrowedItem): Promise<boolean> {
  let success = false;
  const sb = getClientSupabase();

  if (sb) {
    try {
      const payload = {
        id: item.id,
        room_id: String(item.roomId),
        item_name: item.itemName,
        status: item.status,
        created_at: item.createdAt || Date.now(),
        returned_at: item.returnedAt ? new Date(item.returnedAt).toISOString() : null
      };
      const { error } = await sb
        .from("borrowed_items")
        .upsert(payload, { onConflict: "id" });
      if (!error) success = true;
    } catch (err) {
      console.warn("[CLIENT SUPABASE] Save borrowed error:", err);
    }
  }

  fetch("/api/borrowed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item)
  }).catch(() => {});

  return success;
}

/**
 * Fetch global amenities status directly from Supabase (instant cross-device sync)
 */
export async function fetchLiveAmenitiesStatus(): Promise<Record<string, 'available' | 'out_of_service'> | null> {
  const sb = getClientSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("guest_requests")
        .select("custom_message")
        .eq("id", "system-amenities-settings-global")
        .single();

      if (!error && data && data.custom_message) {
        const parsed = JSON.parse(data.custom_message);
        if (parsed && typeof parsed === "object") {
          return parsed;
        }
      }
    } catch (err) {
      console.warn("[CLIENT SUPABASE] Direct fetch amenities fallback to API:", err);
    }
  }

  // Fallback to server API
  try {
    const res = await fetch("/api/settings/amenities");
    if (res.ok) {
      const json = await res.json();
      if (json.success && json.amenities) {
        return json.amenities;
      }
    }
  } catch (err) {
    console.warn("[API] Fetch amenities fallback error:", err);
  }

  return null;
}

/**
 * Save global amenities status directly to Supabase + notify server API
 */
export async function saveLiveAmenitiesStatus(status: Record<string, 'available' | 'out_of_service'>): Promise<boolean> {
  let success = false;
  const sb = getClientSupabase();

  if (sb) {
    try {
      const { error } = await sb
        .from("guest_requests")
        .upsert({
          id: "system-amenities-settings-global",
          room_id: "SETTINGS",
          items: [],
          custom_message: JSON.stringify(status),
          status: "completed",
          created_at: 0
        }, { onConflict: "id" });

      if (!error) {
        success = true;
      } else {
        console.warn("[CLIENT SUPABASE] Upsert amenities error:", error.message);
      }
    } catch (err) {
      console.warn("[CLIENT SUPABASE] Save amenities exception:", err);
    }
  }

  // Also notify server API non-blockingly to update server cache & file
  fetch("/api/settings/amenities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amenities: status })
  }).catch(() => {});

  // Also sync to Firestore non-blockingly so Firestore real-time listeners trigger instantly
  try {
    import("./firebase").then(({ db }) => {
      import("firebase/firestore").then(({ doc, setDoc }) => {
        setDoc(doc(db, "settings", "amenities"), status, { merge: true }).catch(() => {});
      });
    }).catch(() => {});
  } catch (e) {}

  return success;
}

/**
 * Permanently clear all requests and borrowed items from Supabase, server API, and local state
 */
export async function clearAllLiveRequests(): Promise<boolean> {
  const sb = getClientSupabase();
  if (sb) {
    try {
      await sb.from("guest_requests").delete().neq("room_id", "SETTINGS");
      await sb.from("borrowed_items").delete().neq("id", "none_placeholder_never_matches");
      await saveLiveDismissedRequests([]);
    } catch (e) {
      console.warn("[CLIENT SUPABASE] Clear error:", e);
    }
  }
  try {
    localStorage.removeItem("hues_stay_dismissed_requests");
  } catch (e) {}

  try {
    const res = await fetch("/api/requests/clear-all", { method: "POST" });
    return res.ok;
  } catch (e) {
    return false;
  }
}

/**
 * Fetch global inventory limits directly from Supabase
 */
export async function fetchLiveInventoryLimits(): Promise<Record<string, number> | null> {
  const sb = getClientSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("guest_requests")
        .select("custom_message")
        .eq("id", "system-inventory-limits-global")
        .single();

      if (!error && data && data.custom_message) {
        const parsed = JSON.parse(data.custom_message);
        if (parsed && typeof parsed === "object") {
          return parsed;
        }
      }
    } catch (err) {
      console.warn("[CLIENT SUPABASE] Direct fetch limits fallback:", err);
    }
  }
  return null;
}

/**
 * Save global inventory limits directly to Supabase
 */
export async function saveLiveInventoryLimits(limits: Record<string, number>): Promise<boolean> {
  let success = false;
  const sb = getClientSupabase();
  if (sb) {
    try {
      const { error } = await sb
        .from("guest_requests")
        .upsert({
          id: "system-inventory-limits-global",
          room_id: "SETTINGS",
          items: [],
          custom_message: JSON.stringify(limits),
          status: "completed",
          created_at: 0
        }, { onConflict: "id" });
      if (!error) success = true;
    } catch (err) {
      console.warn("[CLIENT SUPABASE] Save limits error:", err);
    }
  }
  return success;
}

/**
 * Fetch list of items automatically depleted by inventory
 */
export async function fetchLiveAutoDepleted(): Promise<string[]> {
  const sb = getClientSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("guest_requests")
        .select("custom_message")
        .eq("id", "system-auto-depleted-items")
        .single();
      if (!error && data && data.custom_message) {
        const parsed = JSON.parse(data.custom_message);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
  }
  try {
    const saved = localStorage.getItem("hues_stay_auto_depleted");
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return [];
}

/**
 * Save list of items automatically depleted by inventory
 */
export async function saveLiveAutoDepleted(items: string[]): Promise<boolean> {
  try {
    localStorage.setItem("hues_stay_auto_depleted", JSON.stringify(items));
  } catch (e) {}
  const sb = getClientSupabase();
  if (sb) {
    try {
      await sb
        .from("guest_requests")
        .upsert({
          id: "system-auto-depleted-items",
          room_id: "SETTINGS",
          items: [],
          custom_message: JSON.stringify(items),
          status: "completed",
          created_at: 0
        }, { onConflict: "id" });
      return true;
    } catch (e) {}
  }
  return false;
}

/**
 * Fetch list of dismissed/cleared request IDs directly from Supabase (instant cross-device sync)
 */
export async function fetchLiveDismissedRequests(): Promise<string[]> {
  const sb = getClientSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("guest_requests")
        .select("custom_message")
        .eq("id", "system-dismissed-requests-global")
        .single();
      if (!error && data && data.custom_message) {
        const parsed = JSON.parse(data.custom_message);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
  }
  try {
    const saved = localStorage.getItem("hues_stay_dismissed_requests");
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return [];
}

/**
 * Save list of dismissed/cleared request IDs directly to Supabase so ALL devices clear them instantly
 */
export async function saveLiveDismissedRequests(ids: string[]): Promise<boolean> {
  try {
    localStorage.setItem("hues_stay_dismissed_requests", JSON.stringify(ids));
  } catch (e) {}
  const sb = getClientSupabase();
  if (sb) {
    try {
      await sb
        .from("guest_requests")
        .upsert({
          id: "system-dismissed-requests-global",
          room_id: "SETTINGS",
          items: [],
          custom_message: JSON.stringify(ids),
          status: "completed",
          created_at: 0,
          updated_at: new Date().toISOString()
        }, { onConflict: "id" });
      return true;
    } catch (e) {}
  }
  return false;
}

/**
 * Fetch permanently deleted items from Supabase
 */
export async function fetchLiveDeletedItems(): Promise<string[]> {
  const sb = getClientSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("guest_requests")
        .select("custom_message")
        .eq("id", "system-deleted-items")
        .single();
      if (!error && data && data.custom_message) {
        const parsed = JSON.parse(data.custom_message);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
  }
  try {
    const saved = localStorage.getItem("hues_stay_deleted_items");
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return [];
}

/**
 * Save permanently deleted items to Supabase so they are excluded across all devices
 */
export async function saveLiveDeletedItems(items: string[]): Promise<boolean> {
  try {
    localStorage.setItem("hues_stay_deleted_items", JSON.stringify(items));
  } catch (e) {}
  const sb = getClientSupabase();
  if (sb) {
    try {
      await sb
        .from("guest_requests")
        .upsert({
          id: "system-deleted-items",
          room_id: "SETTINGS",
          items: [],
          custom_message: JSON.stringify(items),
          status: "completed",
          created_at: 0,
          updated_at: new Date().toISOString()
        }, { onConflict: "id" });
      return true;
    } catch (e) {}
  }
  return false;
}

/**
 * Synchronize amenity availability for the 8 target items based on live inventory limits and active in-use items.
 * An item automatically becomes 'out_of_service' when active borrowed items + pending requests >= inventory limit.
 * It automatically returns to 'available' when items are returned ONLY IF it was automatically depleted.
 * Manual settings by the owner/staff are NEVER overwritten.
 */
export async function syncInventoryAvailability(
  borrowedList?: BorrowedItem[],
  requestsList?: RoomRequest[],
  customLimits?: Record<string, number>
): Promise<Record<string, 'available' | 'out_of_service'>> {
  const sb = getClientSupabase();

  // 1. Fetch live borrowed if not provided
  let activeBorrowed = borrowedList;
  if (!activeBorrowed && sb) {
    activeBorrowed = await fetchLiveBorrowed();
  }
  const borrowed = (activeBorrowed || []).filter(b => b.status === "borrowed");

  // 2. Fetch live requests if not provided
  let liveReqs = requestsList;
  if (!liveReqs && sb) {
    liveReqs = await fetchLiveRequests();
  }
  const pending = (liveReqs || []).filter(r => r.status === "pending");

  // 3. Resolve inventory limits
  const limits: Record<string, number> = {
    ...DEFAULT_INVENTORY_LIMITS,
    ...(customLimits || {})
  };

  try {
    const savedLimits = localStorage.getItem("hues_stay_inventory_limits");
    if (savedLimits) {
      Object.assign(limits, JSON.parse(savedLimits));
    }
  } catch (e) {}

  const liveLimits = await fetchLiveInventoryLimits();
  if (liveLimits) {
    Object.assign(limits, liveLimits);
    try {
      localStorage.setItem("hues_stay_inventory_limits", JSON.stringify(limits));
    } catch (e) {}
  }

  // 4. Resolve current amenity availability status
  let currentStatus: Record<string, 'available' | 'out_of_service'> = { ...DEFAULT_AMENITY_STATUS };
  try {
    const saved = localStorage.getItem("hues_stay_amenities");
    if (saved) {
      Object.assign(currentStatus, JSON.parse(saved));
    }
  } catch (e) {}

  const liveStatus = await fetchLiveAmenitiesStatus();
  if (liveStatus) {
    Object.assign(currentStatus, liveStatus);
  }

  // 5. Fetch auto-depleted items (items marked out of service strictly by inventory limit)
  const autoDepleted = await fetchLiveAutoDepleted();
  const autoDepletedSet = new Set<string>(autoDepleted);

  // 6. Evaluate availability strictly for the 8 target items
  let hasChanged = false;
  let autoDepletedChanged = false;
  const updatedStatus = { ...currentStatus };

  for (const itemKey of TARGET_AUTO_UNAVAILABLE_ITEMS) {
    const borrowedCount = borrowed.filter(b => normalizeReturnableName(b.itemName) === itemKey).length;
    const pendingCount = pending.filter(r => 
      (r.items || []).some(i => normalizeReturnableName(i) === itemKey)
    ).length;

    const inUse = borrowedCount + pendingCount;
    const limit = limits[itemKey] ?? DEFAULT_INVENTORY_LIMITS[itemKey] ?? 1;

    if (inUse >= limit) {
      if (updatedStatus[itemKey] !== "out_of_service") {
        updatedStatus[itemKey] = "out_of_service";
        hasChanged = true;
      }
      if (!autoDepletedSet.has(itemKey)) {
        autoDepletedSet.add(itemKey);
        autoDepletedChanged = true;
      }
    } else {
      // In stock (inUse < limit):
      // ONLY restore to 'available' if the system previously auto-depleted it!
      // If the owner manually chose 'out_of_service' in Settings, NEVER touch it!
      if (autoDepletedSet.has(itemKey)) {
        autoDepletedSet.delete(itemKey);
        autoDepletedChanged = true;
        if (updatedStatus[itemKey] !== "available") {
          updatedStatus[itemKey] = "available";
          hasChanged = true;
        }
      }
    }
  }

  if (autoDepletedChanged) {
    saveLiveAutoDepleted(Array.from(autoDepletedSet)).catch(() => {});
  }

  // 7. If any status changed, update localStorage and Supabase immediately
  if (hasChanged) {
    try {
      localStorage.setItem("hues_stay_amenities", JSON.stringify(updatedStatus));
    } catch (e) {}
    await saveLiveAmenitiesStatus(updatedStatus);
  }

  return updatedStatus;
}



