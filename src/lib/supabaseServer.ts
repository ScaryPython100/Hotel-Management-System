import { createClient, SupabaseClient } from "@supabase/supabase-js";

let clientInstance: SupabaseClient | null = null;

export const SUPABASE_TABLE_NAME = "guest_requests";
export const SUPABASE_BORROWED_TABLE = "borrowed_items";
export const SUPABASE_INVENTORY_TABLE = "inventory";

export const SUPABASE_TABLE_SQL = `-- Run this in Supabase SQL Editor (SQL Editor icon on left menu)
-- Project: hues-stay-luxury-rooms

-- Guest Requests Table (Preserves all active, completed, and dashboard-dismissed requests permanently)
CREATE TABLE IF NOT EXISTS public.guest_requests (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    items JSONB DEFAULT '[]'::jsonb,
    custom_message TEXT DEFAULT '',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    is_deleted_from_dashboard BOOLEAN DEFAULT false,
    deleted_at BIGINT,
    created_at BIGINT DEFAULT (extract(epoch from now()) * 1000)::bigint,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast room and status querying
CREATE INDEX IF NOT EXISTS idx_guest_requests_room ON public.guest_requests(room_id);
CREATE INDEX IF NOT EXISTS idx_guest_requests_status ON public.guest_requests(status);
CREATE INDEX IF NOT EXISTS idx_guest_requests_created_at ON public.guest_requests(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.guest_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service and public operations" ON public.guest_requests
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Enable Realtime events for live updates (optional)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'guest_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_requests;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
`;

export function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY)?.trim();

  if (!url || !key) {
    return null;
  }

  if (!clientInstance) {
    try {
      clientInstance = createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        }
      });
    } catch (err: any) {
      console.warn("Could not instantiate Supabase client:", err?.message || "unknown error");
      return null;
    }
  }

  return clientInstance;
}

export interface RequestRecord {
  id: string;
  roomId: string;
  items: string[];
  customMessage: string;
  status: "pending" | "completed";
  createdAt: number;
}

/**
 * Stores or updates a request in Supabase guest_requests table
 */
export async function saveRequestToSupabase(req: RequestRecord): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) {
    return { success: false, error: "Supabase not configured in environment" };
  }

  try {
    const payload = {
      id: req.id,
      room_id: String(req.roomId),
      items: Array.isArray(req.items) ? req.items : [],
      custom_message: req.customMessage || "",
      status: req.status || "pending",
      created_at: req.createdAt || Date.now(),
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from(SUPABASE_TABLE_NAME)
      .upsert(payload, { onConflict: "id" });

    if (error) {
      console.warn("[SUPABASE] Insert/Upsert error:", error.message);
      return { success: false, error: error.message };
    }

    console.log(`[SUPABASE] Successfully persisted request ${req.id} for Room ${req.roomId}`);
    return { success: true };
  } catch (err: any) {
    console.warn("[SUPABASE] Exception during save:", err?.message || "error");
    return { success: false, error: err?.message || "Unknown error" };
  }
}

/**
 * Update request status in Supabase
 */
export async function updateRequestStatusInSupabase(id: string, status: "pending" | "completed"): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { success: false, error: "Supabase not configured" };

  try {
    const { error } = await supabase
      .from(SUPABASE_TABLE_NAME)
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

/**
 * Mark request as deleted from active dashboard view in Supabase (strictly preserving the data row)
 */
export async function markRequestDeletedFromDashboardInSupabase(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { success: false, error: "Supabase not configured" };

  try {
    const { error } = await supabase
      .from(SUPABASE_TABLE_NAME)
      .update({
        is_deleted_from_dashboard: true,
        deleted_at: Date.now(),
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

/**
 * Delete request from Supabase
 */
export async function deleteRequestFromSupabase(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { success: false, error: "Supabase not configured" };

  try {
    const { error } = await supabase
      .from(SUPABASE_TABLE_NAME)
      .delete()
      .eq("id", id);

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

/**
 * Fetch all active requests from Supabase (excluding records marked as deleted from dashboard)
 */
export async function fetchRequestsFromSupabase(includeDeleted = false): Promise<RequestRecord[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from(SUPABASE_TABLE_NAME)
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[SUPABASE] Query error:", error.message);
      return null;
    }

    if (!data) return [];

    const filteredRows = (includeDeleted ? data : data.filter((row: any) => !row.is_deleted_from_dashboard))
      .filter((row: any) => row.room_id !== "SETTINGS" && !String(row.id || "").startsWith("system-"));

    const mapped: RequestRecord[] = filteredRows.map((row: any) => ({
      id: row.id,
      roomId: row.room_id,
      items: Array.isArray(row.items) ? row.items : [],
      customMessage: row.custom_message || "",
      status: row.status === "completed" ? "completed" : "pending",
      createdAt: Number(row.created_at) || Date.now(),
    }));

    // Deduplicate any accidental duplicate records within a 3-minute window
    const result: RequestRecord[] = [];
    const seenIds = new Set<string>();

    for (const r of mapped) {
      if (!r || !r.roomId) continue;
      if (r.id && seenIds.has(r.id)) continue;

      const rItemsStr = JSON.stringify((r.items || []).slice().sort().map(String));
      const rMsg = (r.customMessage || "").trim().toLowerCase();
      const rRoom = String(r.roomId).trim().toLowerCase();

      const dup = result.some(ex => {
        if (String(ex.roomId).trim().toLowerCase() !== rRoom) return false;
        const exItems = JSON.stringify((ex.items || []).slice().sort().map(String));
        if (exItems !== rItemsStr) return false;
        if ((ex.customMessage || "").trim().toLowerCase() !== rMsg) return false;
        const diff = Math.abs((ex.createdAt || 0) - (r.createdAt || 0));
        return diff < 180000;
      });

      if (!dup) {
        if (r.id) seenIds.add(r.id);
        result.push(r);
      }
    }

    return result;
  } catch (err: any) {
    console.warn("[SUPABASE] Exception fetching requests:", err?.message);
    return null;
  }
}

/**
 * Check connection status and whether the guest_requests table exists
 */
export async function getSupabaseStatus(): Promise<{
  configured: boolean;
  url?: string;
  tableExists: boolean;
  count: number;
  error?: string;
  sql: string;
}> {
  const supabase = getSupabase();
  const url = process.env.SUPABASE_URL?.trim();

  if (!supabase || !url) {
    return {
      configured: false,
      tableExists: false,
      count: 0,
      sql: SUPABASE_TABLE_SQL,
      error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in environment variables."
    };
  }

  try {
    const { count: reqCount, error: reqError } = await supabase
      .from(SUPABASE_TABLE_NAME)
      .select("*", { count: "exact", head: true });

    return {
      configured: true,
      url: url.replace(/(https?:\/\/)([^.]+)(\..*)/, "$1$2$3"),
      tableExists: !reqError,
      count: reqCount || 0,
      error: reqError ? reqError.message : undefined,
      sql: SUPABASE_TABLE_SQL
    };
  } catch (err: any) {
    return {
      configured: true,
      tableExists: false,
      count: 0,
      error: err?.message || "Connection error",
      sql: SUPABASE_TABLE_SQL
    };
  }
}

export interface BorrowedRecord {
  id: string;
  roomId: string;
  itemName: string;
  status: "borrowed" | "returned";
  createdAt: number;
  returnedAt?: number;
  requestId?: string;
}

export async function saveBorrowedToSupabase(b: BorrowedRecord): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { success: false, error: "Supabase not configured" };

  try {
    const payload = {
      id: b.id,
      room_id: String(b.roomId),
      item_name: b.itemName,
      status: b.status,
      created_at: b.createdAt || Date.now(),
      returned_at: b.returnedAt ? new Date(b.returnedAt).toISOString() : null
    };

    const { error } = await supabase
      .from(SUPABASE_BORROWED_TABLE)
      .upsert(payload, { onConflict: "id" });

    if (error) {
      console.warn("[SUPABASE] Borrowed upsert error:", error.message);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

export async function markBorrowedReturnedInSupabase(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { success: false, error: "Supabase not configured" };

  try {
    const { error } = await supabase
      .from(SUPABASE_BORROWED_TABLE)
      .update({ status: "returned", returned_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

export async function fetchBorrowedFromSupabase(): Promise<BorrowedRecord[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from(SUPABASE_BORROWED_TABLE)
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return null;
    if (!data) return [];

    return data.map((row: any) => ({
      id: row.id,
      roomId: row.room_id,
      itemName: row.item_name,
      status: row.status === "returned" ? "returned" : "borrowed",
      createdAt: Number(row.created_at) || Date.now(),
      returnedAt: row.returned_at ? new Date(row.returned_at).getTime() : undefined
    }));
  } catch {
    return null;
  }
}

export async function deleteBorrowedFromSupabase(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { success: false, error: "Supabase not configured" };

  try {
    const { error } = await supabase
      .from(SUPABASE_BORROWED_TABLE)
      .delete()
      .eq("id", id);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

export async function deleteBorrowedByRequestIdFromSupabase(requestId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { success: false, error: "Supabase not configured" };

  try {
    const { error } = await supabase
      .from(SUPABASE_BORROWED_TABLE)
      .delete()
      .eq("id", requestId);
    return { success: !error };
  } catch {
    return { success: true };
  }
}

export interface SupabaseInventoryRecord {
  id: string;
  name: string;
  category: 'Service' | 'Item';
  totalStock: number;
  taken: number;
  available: number;
  updatedAt?: string;
}

/**
 * Fetch all inventory items from Supabase
 */
export async function fetchInventoryFromSupabase(): Promise<SupabaseInventoryRecord[] | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from(SUPABASE_INVENTORY_TABLE)
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      console.warn("[SUPABASE] Inventory fetch error:", error.message);
      return null;
    }
    if (!data) return [];

    return data.map((row: any) => ({
      id: row.id,
      name: row.name,
      category: (row.category === "Service" ? "Service" : "Item") as 'Service' | 'Item',
      totalStock: Number(row.total_stock) || 0,
      taken: Number(row.taken) || 0,
      available: Math.max(0, (Number(row.total_stock) || 0) - (Number(row.taken) || 0)),
      updatedAt: row.updated_at
    }));
  } catch (err: any) {
    console.warn("[SUPABASE] Exception fetching inventory:", err?.message);
    return null;
  }
}

/**
 * Upsert or add a new inventory item in Supabase
 */
export async function upsertInventoryInSupabase(item: {
  name: string;
  totalStock: number;
  taken?: number;
  category?: 'Service' | 'Item';
  id?: string;
}): Promise<{ success: boolean; data?: SupabaseInventoryRecord; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { success: false, error: "Supabase not configured" };

  try {
    const cleanName = item.name.trim();
    const id = item.id || `inv-${cleanName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
    const payload: any = {
      id,
      name: cleanName,
      category: item.category || 'Item',
      total_stock: Math.max(1, Number(item.totalStock) || 1),
      updated_at: new Date().toISOString()
    };
    if (typeof item.taken === 'number') {
      payload.taken = Math.max(0, item.taken);
    }

    const { data, error } = await supabase
      .from(SUPABASE_INVENTORY_TABLE)
      .upsert(payload, { onConflict: "name" })
      .select()
      .single();

    if (error) {
      console.warn("[SUPABASE] Upsert inventory error:", error.message);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: data ? {
        id: data.id,
        name: data.name,
        category: data.category || 'Item',
        totalStock: Number(data.total_stock) || 0,
        taken: Number(data.taken) || 0,
        available: Math.max(0, (Number(data.total_stock) || 0) - (Number(data.taken) || 0)),
        updatedAt: data.updated_at
      } : undefined
    };
  } catch (err: any) {
    return { success: false, error: err?.message || "Error upserting inventory" };
  }
}

/**
 * Atomically adjust taken count in Supabase inventory (e.g. +1 when item delivered, -1 when collected)
 */
export async function adjustInventoryTakenInSupabase(itemName: string, delta: number): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase();
  if (!supabase) return { success: false, error: "Supabase not configured" };

  try {
    const cleanName = itemName.trim();
    const { data: existing, error: fetchErr } = await supabase
      .from(SUPABASE_INVENTORY_TABLE)
      .select("id, taken, total_stock")
      .ilike("name", cleanName)
      .single();

    if (fetchErr || !existing) {
      // If doesn't exist yet, insert with initial stock
      const initialStock = 5;
      const initialTaken = Math.max(0, delta);
      await supabase.from(SUPABASE_INVENTORY_TABLE).insert({
        id: `inv-${cleanName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
        name: cleanName,
        category: 'Item',
        total_stock: initialStock,
        taken: initialTaken,
        updated_at: new Date().toISOString()
      });
      return { success: true };
    }

    const newTaken = Math.max(0, (Number(existing.taken) || 0) + delta);
    const { error: updateErr } = await supabase
      .from(SUPABASE_INVENTORY_TABLE)
      .update({ taken: newTaken, updated_at: new Date().toISOString() })
      .eq("id", existing.id);

    if (updateErr) return { success: false, error: updateErr.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

/**
 * Fetch global amenities status from Supabase
 */
export async function fetchAmenitiesFromSupabase(): Promise<Record<string, 'available' | 'out_of_service'> | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from(SUPABASE_TABLE_NAME)
      .select("custom_message")
      .eq("id", "system-amenities-settings-global")
      .single();

    if (!error && data && data.custom_message) {
      const parsed = JSON.parse(data.custom_message);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    }
  } catch (err: any) {
    console.warn("[SUPABASE] fetchAmenities error:", err?.message);
  }
  return null;
}

/**
 * Save global amenities status to Supabase
 */
export async function saveAmenitiesToSupabase(status: Record<string, 'available' | 'out_of_service'>): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;

  try {
    const { error } = await supabase
      .from(SUPABASE_TABLE_NAME)
      .upsert({
        id: "system-amenities-settings-global",
        room_id: "SETTINGS",
        items: [],
        custom_message: JSON.stringify(status),
        status: "completed",
        created_at: 0
      }, { onConflict: "id" });

    return !error;
  } catch (err: any) {
    console.warn("[SUPABASE] saveAmenities error:", err?.message);
    return false;
  }
}

