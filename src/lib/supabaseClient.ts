import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { RoomRequest, BorrowedItem } from "../types";

// Public Supabase credentials from client environment
const rawMeta = typeof import.meta !== "undefined" ? (import.meta as any).env : {};
const supabaseUrl = String(rawMeta?.VITE_SUPABASE_URL || "").trim().replace(/\/rest\/v1\/?$/, "");
const supabaseAnonKey = String(rawMeta?.VITE_SUPABASE_ANON_KEY || "").trim();

// Settings are stored as special rows in guest_requests (staff-only)
const AMENITY_STATUS_ROW = "system-amenities-settings-global";
const INVENTORY_LIMITS_ROW = "system-inventory-limits-global";
const DELETED_ITEMS_ROW = "system-deleted-items";
const ROOMS_ROW = "system-rooms";

let supabaseClient: SupabaseClient | null = null;

/**
 * Supabase client for the staff portal. Database access requires a signed-in staff member;
 * guest pages talk to the /api functions instead.
 */
export function getClientSupabase(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 10 } }
    });
  }
  return supabaseClient;
}

/** Calls a staff-only /api endpoint with the signed-in staff member's session */
export async function staffApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const sb = getClientSupabase();
  const { data } = sb ? await sb.auth.getSession() : { data: { session: null } };
  const headers = new Headers(init.headers);
  if (data.session?.access_token) {
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(path, { ...init, headers });
}

function mapRequestRow(row: any): RoomRequest {
  let isWaitlist = !!row.is_waitlist;
  let waitlistForItem = row.waitlist_for_item || undefined;
  let queuePosition = typeof row.queue_position === "number" ? row.queue_position : undefined;

  const msg = String(row.custom_message || "");
  if (!isWaitlist && msg.startsWith("[WAITLIST:")) {
    isWaitlist = true;
    const match = msg.match(/\[WAITLIST:\s*([^\]#]+)(?:#(\d+))?\]/i);
    if (match) {
      waitlistForItem = match[1]?.trim();
      if (match[2]) queuePosition = parseInt(match[2], 10);
    }
  }

  return {
    id: row.id,
    roomId: String(row.room_id),
    qrCodeHash: String(row.room_id),
    items: Array.isArray(row.items) ? row.items : [],
    customMessage: row.custom_message || "",
    status: row.status === "completed" ? "completed" : "pending",
    createdAt: Number(row.created_at) || Date.now(),
    isWaitlist,
    waitlistForItem,
    queuePosition
  };
}

function mapBorrowedRow(row: any): BorrowedItem {
  return {
    id: row.id,
    roomId: String(row.room_id),
    itemName: row.item_name,
    status: row.status === "returned" ? "returned" : "borrowed",
    createdAt: Number(row.created_at) || Date.now(),
    returnedAt: row.returned_at ? new Date(row.returned_at).getTime() : undefined,
    relayedFromRoom: row.relayed_from_room || undefined,
    relayCount: typeof row.relay_count === "number" ? row.relay_count : undefined
  };
}

/**
 * Active guest requests (dismissed requests and settings rows are excluded)
 */
export async function fetchLiveRequests(): Promise<RoomRequest[] | null> {
  const sb = getClientSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("guest_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error || !Array.isArray(data)) return null;
    return data
      .filter((row: any) =>
        !row.is_deleted_from_dashboard &&
        row.room_id !== "SETTINGS" &&
        !String(row.id || "").startsWith("system-")
      )
      .map(mapRequestRow);
  } catch (err) {
    console.warn("[SUPABASE] Fetch requests error:", err);
    return null;
  }
}

export async function fetchLiveBorrowed(): Promise<BorrowedItem[] | null> {
  const sb = getClientSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("borrowed_items")
      .select("*")
      .order("created_at", { ascending: false });
    if (error || !Array.isArray(data)) return null;
    return data.map(mapBorrowedRow);
  } catch (err) {
    console.warn("[SUPABASE] Fetch borrowed error:", err);
    return null;
  }
}

export async function updateLiveRequestStatus(id: string, status: "pending" | "completed"): Promise<boolean> {
  const sb = getClientSupabase();
  if (!sb) return false;
  const { error } = await sb
    .from("guest_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.warn("[SUPABASE] Update request status error:", error.message);
  return !error;
}

/**
 * Hide a request from the dashboard. The record stays in the database.
 */
export async function dismissLiveRequest(id: string): Promise<boolean> {
  const sb = getClientSupabase();
  if (!sb) return false;
  const { error } = await sb
    .from("guest_requests")
    .update({
      is_deleted_from_dashboard: true,
      deleted_at: Date.now(),
      updated_at: new Date().toISOString()
    })
    .eq("id", id);
  if (error) console.warn("[SUPABASE] Dismiss request error:", error.message);
  return !error;
}

export async function markLiveBorrowedReturned(id: string): Promise<boolean> {
  const sb = getClientSupabase();
  if (!sb) return false;
  const { error } = await sb
    .from("borrowed_items")
    .update({ status: "returned", returned_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.warn("[SUPABASE] Mark returned error:", error.message);
  return !error;
}

export async function deleteLiveBorrowed(id: string): Promise<boolean> {
  const sb = getClientSupabase();
  if (!sb) return false;
  const { error } = await sb.from("borrowed_items").delete().eq("id", id);
  if (error) console.warn("[SUPABASE] Delete borrowed error:", error.message);
  return !error;
}

export async function saveLiveBorrowed(item: BorrowedItem): Promise<boolean> {
  const sb = getClientSupabase();
  if (!sb) return false;
  const payload = {
    id: item.id,
    room_id: String(item.roomId),
    item_name: item.itemName,
    status: item.status,
    created_at: item.createdAt || Date.now(),
    returned_at: item.returnedAt ? new Date(item.returnedAt).toISOString() : null
  };
  let { error } = await sb.from("borrowed_items").upsert({
    ...payload,
    relayed_from_room: item.relayedFromRoom || null,
    relay_count: item.relayCount || 0
  }, { onConflict: "id" });

  // Older databases may not have the relay columns yet
  if (error && (error.message?.includes("column") || error.code === "PGRST204" || error.code === "42703")) {
    ({ error } = await sb.from("borrowed_items").upsert(payload, { onConflict: "id" }));
  }
  if (error) console.warn("[SUPABASE] Save borrowed error:", error.message);
  return !error;
}

/**
 * Floor-to-Floor Relay: hands an appliance from Room A straight to Room B.
 * The new record is written before the source is released, so a failure never loses the item.
 */
export async function relayLiveBorrowedItem(
  sourceBorrowedId: string,
  sourceRoomId: string,
  targetRoomId: string,
  itemName: string,
  targetRequestId?: string,
  currentRelayCount?: number
): Promise<boolean> {
  const inserted = await saveLiveBorrowed({
    id: `borrowed-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    roomId: String(targetRoomId),
    itemName,
    status: "borrowed",
    createdAt: Date.now(),
    requestId: targetRequestId,
    relayedFromRoom: String(sourceRoomId),
    relayCount: (currentRelayCount || 0) + 1
  });
  if (!inserted) return false;

  let success = true;
  if (sourceBorrowedId) {
    success = (await markLiveBorrowedReturned(sourceBorrowedId)) && success;
  }
  if (targetRequestId) {
    success = (await updateLiveRequestStatus(targetRequestId, "completed")) && success;
  }
  return success;
}

/**
 * Permanently delete all requests and borrowed items (settings rows are kept)
 */
export async function clearAllLiveRequests(): Promise<boolean> {
  const sb = getClientSupabase();
  if (!sb) return false;
  const [reqRes, borRes] = await Promise.all([
    sb.from("guest_requests").delete().neq("room_id", "SETTINGS"),
    sb.from("borrowed_items").delete().neq("id", "")
  ]);
  return !reqRes.error && !borRes.error;
}

async function readSettingsRow<T>(id: string): Promise<T | null> {
  const sb = getClientSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("guest_requests")
      .select("custom_message")
      .eq("id", id)
      .maybeSingle();
    if (error || !data?.custom_message) return null;
    const parsed = JSON.parse(data.custom_message);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    console.warn(`[SUPABASE] Read ${id} error:`, err);
    return null;
  }
}

async function writeSettingsRow(id: string, value: unknown): Promise<boolean> {
  const sb = getClientSupabase();
  if (!sb) return false;
  const { error } = await sb.from("guest_requests").upsert({
    id,
    room_id: "SETTINGS",
    items: [],
    custom_message: JSON.stringify(value),
    status: "completed",
    created_at: 0,
    updated_at: new Date().toISOString()
  }, { onConflict: "id" });
  if (error) console.warn(`[SUPABASE] Save ${id} error:`, error.message);
  return !error;
}

/** Items (and sub-items like "Soft Drinks - Coke") that staff marked out of service */
export function fetchLiveAmenitiesStatus() {
  return readSettingsRow<Record<string, 'available' | 'out_of_service'>>(AMENITY_STATUS_ROW);
}

export function saveLiveAmenitiesStatus(status: Record<string, 'available' | 'out_of_service'>) {
  return writeSettingsRow(AMENITY_STATUS_ROW, status);
}

/** Stock counts that staff changed in Settings */
export function fetchLiveInventoryLimits() {
  return readSettingsRow<Record<string, number>>(INVENTORY_LIMITS_ROW);
}

export function saveLiveInventoryLimits(limits: Record<string, number>) {
  return writeSettingsRow(INVENTORY_LIMITS_ROW, limits);
}

/** Catalog items staff removed from the guest page */
export async function fetchLiveDeletedItems(): Promise<string[] | null> {
  const value = await readSettingsRow<unknown>(DELETED_ITEMS_ROW);
  return Array.isArray(value) ? value.map(String) : null;
}

export function saveLiveDeletedItems(items: string[]) {
  return writeSettingsRow(DELETED_ITEMS_ROW, items);
}

/** Room numbers managed on the Rooms & QR Codes page (null until the first change) */
export async function fetchLiveRooms(): Promise<string[] | null> {
  const value = await readSettingsRow<unknown>(ROOMS_ROW);
  return Array.isArray(value) ? value.map(String) : null;
}

export function saveLiveRooms(roomNumbers: string[]) {
  return writeSettingsRow(ROOMS_ROW, roomNumbers);
}
