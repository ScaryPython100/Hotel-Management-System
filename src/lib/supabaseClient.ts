import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { RoomRequest, BorrowedItem } from "../types";

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

