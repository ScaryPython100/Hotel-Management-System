import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import {
  getSupabase,
  saveRequestToSupabase,
  updateRequestStatusInSupabase,
  deleteRequestFromSupabase,
  markRequestDeletedFromDashboardInSupabase,
  fetchRequestsFromSupabase,
  getSupabaseStatus,
  BorrowedRecord,
  saveBorrowedToSupabase,
  markBorrowedReturnedInSupabase,
  fetchBorrowedFromSupabase,
  deleteBorrowedFromSupabase,
  SUPABASE_TABLE_SQL,
  SUPABASE_TABLE_NAME,
  fetchAmenitiesFromSupabase,
  saveAmenitiesToSupabase
} from "./src/lib/supabaseServer";
import { isReturnableItem, getItemUnitConsumption, normalizeReturnableName } from "./src/types";

function extractBaseApplianceName(name: string): string {
  const clean = String(name || "").toLowerCase().trim();
  if (clean.includes("glass")) return "glasses";
  if (clean.includes("kettle")) return "kettle";
  if (clean.includes("iron")) return "iron";
  if (clean.includes("dryer")) return "hair dryer";
  if (clean.includes("laptop")) return "laptop table";
  if (clean.includes("massager")) return "leg massager";
  if (clean.includes("usb 2")) return "usb 2.0";
  if (clean.includes("usb 3")) return "usb 3.0";
  return clean;
}

const app = express();
const PORT = 3000;

interface ServerRequest {
  id: string;
  roomId: string;
  items: string[];
  customMessage: string;
  status: "pending" | "completed";
  createdAt: number;
}

// In-memory requests store on server
const serverRequests: ServerRequest[] = [];

// In-memory borrowed items store
const serverBorrowed: BorrowedRecord[] = [];
const serverDismissedRequests = new Set<string>();

// Data directory & files for durable persistence across restarts and devices
const DATA_DIR = path.join(process.cwd(), ".data");
const AMENITIES_FILE = path.join(DATA_DIR, "amenities_settings.json");
const INVENTORY_LIMITS_FILE = path.join(DATA_DIR, "inventory_limits.json");

// Default availability based on hotel amenities
const DEFAULT_AMENITIES_STATUS: Record<string, 'available' | 'out_of_service'> = {
  "Soap Refill": "available",
  "Shampoo Refill": "available",
  "Hand wash Refill": "available",
  "Wifi Password Request": "available",
  "Extend the Stay (Inform Supervisor via Call)": "available",
  "Housekeeping Service (Only Between 9 A.M. and 5 P.M.)": "available",
  "Water Bottle (Paid)": "out_of_service",
  "Laundry wash assistance (Paid, self responsibility)": "available",
  "Iron Box": "available",
  "Teakettle": "available",
  "Hair Dryer": "out_of_service",
  "Laptop Table": "out_of_service",
  "Leg Massager (Paid)": "out_of_service",
  "Glasses (Set of 2)": "out_of_service",
  "USB 2.0 Adaptor + Cable": "out_of_service",
  "USB 3.0 Adaptor + Cable": "out_of_service"
};

function loadAmenitiesSettings(): Record<string, 'available' | 'out_of_service'> {
  try {
    if (fs.existsSync(AMENITIES_FILE)) {
      const data = JSON.parse(fs.readFileSync(AMENITIES_FILE, "utf-8"));
      if (data && typeof data === "object") {
        return { ...DEFAULT_AMENITIES_STATUS, ...data };
      }
    }
  } catch (e) {
    console.warn("Failed to read amenities_settings.json:", e);
  }
  return { ...DEFAULT_AMENITIES_STATUS };
}

function saveAmenitiesSettings(settings: Record<string, 'available' | 'out_of_service'>) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(AMENITIES_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to write amenities_settings.json:", e);
  }
}

let serverAmenitiesStatus: Record<string, 'available' | 'out_of_service'> = loadAmenitiesSettings();

function loadInventoryLimits(): Record<string, number> {
  const defaults: Record<string, number> = {
    "Iron Box": 5,
    "Teakettle": 5,
    "Hair Dryer": 2,
    "Laptop Table": 2,
    "Leg Massager (Paid)": 1,
    "Glasses (Set of 2)": 10,
    "USB 2.0 Adaptor + Cable": 2,
    "USB 3.0 Adaptor + Cable": 2
  };
  try {
    if (fs.existsSync(INVENTORY_LIMITS_FILE)) {
      const data = JSON.parse(fs.readFileSync(INVENTORY_LIMITS_FILE, "utf-8"));
      if (data && typeof data === "object") {
        return { ...defaults, ...data };
      }
    }
  } catch (e) {}
  return defaults;
}

function saveInventoryLimits(limits: Record<string, number>) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(INVENTORY_LIMITS_FILE, JSON.stringify(limits, null, 2), "utf-8");
  } catch (e) {}
}

// Canonical inventory stock limits (stored in-memory on server, synced across all clients)
const serverInventoryLimits: Record<string, number> = loadInventoryLimits();

function calculateItemTaken(itemName: string): number {
  const clean = itemName.toLowerCase().trim();
  const isGlass = clean.includes("glass");
  const isKettle = clean.includes("kettle") || clean.includes("teakettle");
  const multiplier = isGlass ? 2 : 1;

  let taken = 0;

  // 1. Pending requests
  for (const r of serverRequests) {
    if (r.status === "pending" && Array.isArray(r.items)) {
      for (const item of r.items) {
        const itemClean = String(item).toLowerCase();
        if (isGlass && itemClean.includes("glass")) {
          taken += multiplier;
        } else if (isKettle && (itemClean.includes("kettle") || itemClean.includes("teakettle"))) {
          taken += multiplier;
        } else if (!isGlass && !isKettle && itemClean.includes(clean)) {
          taken += multiplier;
        }
      }
    }
  }

  // 2. Active borrowed items in rooms
  for (const b of serverBorrowed) {
    if (b.status === "borrowed") {
      const bClean = String(b.itemName).toLowerCase();
      if (isGlass && bClean.includes("glass")) {
        taken += multiplier;
      } else if (isKettle && (bClean.includes("kettle") || bClean.includes("teakettle"))) {
        taken += multiplier;
      } else if (!isGlass && !isKettle && bClean.includes(clean)) {
        taken += multiplier;
      }
    }
  }

  return taken;
}

// Canonical 22 hotel rooms
const serverRooms: Array<{ id: string; roomNumber: string; qrCodeHash: string; status: "occupied" | "vacant" }> = [
  { id: "room-101", roomNumber: "101", qrCodeHash: "101", status: "occupied" },
  { id: "room-102", roomNumber: "102", qrCodeHash: "102", status: "vacant" },
  { id: "room-103", roomNumber: "103", qrCodeHash: "103", status: "occupied" },
  { id: "room-104", roomNumber: "104", qrCodeHash: "104", status: "vacant" },
  { id: "room-201", roomNumber: "201", qrCodeHash: "201", status: "vacant" },
  { id: "room-202", roomNumber: "202", qrCodeHash: "202", status: "occupied" },
  { id: "room-203", roomNumber: "203", qrCodeHash: "203", status: "vacant" },
  { id: "room-204", roomNumber: "204", qrCodeHash: "204", status: "vacant" },
  { id: "room-301", roomNumber: "301", qrCodeHash: "301", status: "vacant" },
  { id: "room-302", roomNumber: "302", qrCodeHash: "302", status: "vacant" },
  { id: "room-303", roomNumber: "303", qrCodeHash: "303", status: "vacant" },
  { id: "room-304", roomNumber: "304", qrCodeHash: "304", status: "vacant" },
  { id: "room-401", roomNumber: "401", qrCodeHash: "401", status: "vacant" },
  { id: "room-402", roomNumber: "402", qrCodeHash: "402", status: "vacant" },
  { id: "room-403", roomNumber: "403", qrCodeHash: "403", status: "vacant" },
  { id: "room-404", roomNumber: "404", qrCodeHash: "404", status: "vacant" },
  { id: "room-501", roomNumber: "501", qrCodeHash: "501", status: "vacant" },
  { id: "room-502", roomNumber: "502", qrCodeHash: "502", status: "vacant" },
  { id: "room-503", roomNumber: "503", qrCodeHash: "503", status: "vacant" },
  { id: "room-504", roomNumber: "504", qrCodeHash: "504", status: "vacant" },
  { id: "room-601", roomNumber: "601", qrCodeHash: "601", status: "vacant" },
  { id: "room-602", roomNumber: "602", qrCodeHash: "602", status: "vacant" },
];

async function startServer() {
  app.use(express.json());

  // Hydrate amenities status from Supabase for guaranteed multi-device consistency
  try {
    const sbAmenities = await fetchAmenitiesFromSupabase();
    if (sbAmenities && typeof sbAmenities === "object") {
      serverAmenitiesStatus = { ...serverAmenitiesStatus, ...sbAmenities };
      saveAmenitiesSettings(serverAmenitiesStatus);
      console.log("[SERVER] Successfully hydrated amenities status from Supabase:", Object.keys(serverAmenitiesStatus).length, "items");
    }
  } catch (e: any) {
    console.warn("[SERVER] Could not hydrate amenities from Supabase:", e?.message);
  }

function deduplicateServerRequests(list: ServerRequest[]): ServerRequest[] {
  const result: ServerRequest[] = [];
  const seenIds = new Set<string>();

  for (const r of list) {
    if (!r || !r.roomId) continue;
    if (r.id && seenIds.has(r.id)) continue;

    const rItems = (r.items || []).slice().sort().map(String);
    const rItemsStr = JSON.stringify(rItems);
    const rMsg = (r.customMessage || "").trim().toLowerCase();
    const rRoom = String(r.roomId).trim().toLowerCase();

    // Check if duplicate of an existing item in result within 3 minutes
    const dup = result.some(ex => {
      if (String(ex.roomId).trim().toLowerCase() !== rRoom) return false;
      const exItems = (ex.items || []).slice().sort().map(String);
      if (JSON.stringify(exItems) !== rItemsStr) return false;
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
}

  // GET all requests (from Supabase if configured, falling back to memory)
  app.get("/api/requests", async (req, res) => {
    try {
      const supabaseRequests = await fetchRequestsFromSupabase();
      if (supabaseRequests && supabaseRequests.length > 0) {
        // Merge into serverRequests to maintain local hot cache while filtering dismissed items
        const mergedMap = new Map<string, ServerRequest>();
        supabaseRequests.forEach(r => {
          if (!serverDismissedRequests.has(r.id)) mergedMap.set(r.id, r);
        });
        // In-memory serverRequests holds the most immediate status transitions
        serverRequests.forEach(r => {
          if (!serverDismissedRequests.has(r.id)) mergedMap.set(r.id, r);
        });
        const combined = Array.from(mergedMap.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const deduplicated = deduplicateServerRequests(combined);
        return res.json({ success: true, requests: deduplicated, source: "supabase" });
      }
    } catch (e: any) {
      console.warn("Could not retrieve requests from Supabase, using server cache:", e?.message);
    }
    const filteredMemory = serverRequests.filter(r => !serverDismissedRequests.has(r.id));
    const deduplicated = deduplicateServerRequests(filteredMemory);
    res.json({ success: true, requests: deduplicated, source: "memory" });
  });

  // DELETE / dismiss request from active dashboard/screen views (STRICTLY PRESERVED in Supabase database)
  app.delete("/api/requests/:id", async (req, res) => {
    const { id } = req.params;
    serverDismissedRequests.add(id);
    const idx = serverRequests.findIndex(r => r.id === id);
    if (idx !== -1) {
      serverRequests.splice(idx, 1);
    }
    // Update Supabase to mark as dismissed from dashboard without deleting the record
    markRequestDeletedFromDashboardInSupabase(id).catch(err => {
      console.warn("[SUPABASE] Mark dismissed flag error:", err?.message || err);
    });
    console.log(`[REQUESTS] Request ${id} dismissed from dashboard view (remains preserved permanently in Supabase table)`);
    res.json({ success: true, message: "Request dismissed from dashboard view (preserved in Supabase database)" });
  });

  // POST new request
  app.post("/api/requests", async (req, res) => {
    const { roomId, items, customMessage, status, createdAt, id: providedId } = req.body;
    const newReq: ServerRequest = {
      id: providedId || `srv-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      roomId: String(roomId || "Unknown"),
      items: Array.isArray(items) ? items : [],
      customMessage: customMessage || "",
      status: status || "pending",
      createdAt: createdAt || Date.now()
    };

    // If serverRequests is empty (e.g. fresh reboot), populate from Supabase
    if (serverRequests.length === 0) {
      try {
        const existingFromDb = await fetchRequestsFromSupabase();
        if (existingFromDb && existingFromDb.length > 0) {
          existingFromDb.forEach(r => {
            if (!serverDismissedRequests.has(r.id)) serverRequests.push(r);
          });
        }
      } catch (e) {}
    }

    // Avoid duplicate if same room and items within 180 seconds or matching ID
    const newItemsSorted = JSON.stringify(newReq.items.slice().sort().map(String));
    const existingReq = serverRequests.find(r => 
      (r.id && newReq.id && r.id === newReq.id) ||
      (r.roomId.trim().toLowerCase() === newReq.roomId.trim().toLowerCase() && 
       JSON.stringify((r.items || []).slice().sort().map(String)) === newItemsSorted &&
       (r.customMessage || "").trim().toLowerCase() === (newReq.customMessage || "").trim().toLowerCase() &&
       Math.abs(r.createdAt - newReq.createdAt) < 180000)
    );

    if (existingReq) {
      return res.json({ success: true, request: existingReq, isDuplicate: true });
    }

    // Check if any requested item is currently marked out_of_service
    const unavailableItems = newReq.items.filter(item => {
      const clean = String(item).toLowerCase().trim();
      for (const [name, status] of Object.entries(serverAmenitiesStatus)) {
        if (status === 'out_of_service') {
          const lowerName = name.toLowerCase().trim();
          if (lowerName === clean || clean.includes(lowerName) || lowerName.includes(clean)) {
            return true;
          }
          if (clean.includes("glass") && lowerName.includes("glass")) return true;
          if ((clean.includes("kettle") || clean.includes("teakettle")) && (lowerName.includes("kettle") || lowerName.includes("teakettle"))) return true;
        }
      }
      return false;
    });

    if (unavailableItems.length > 0 && !newReq.customMessage) {
      return res.status(400).json({
        success: false,
        error: `${unavailableItems.join(", ")} is currently unavailable and cannot be requested.`
      });
    }

    serverRequests.unshift(newReq);

    // Persist to Supabase asynchronously (strictly saved)
    saveRequestToSupabase(newReq).catch(err => {
      console.warn("[SUPABASE] Background write error:", err);
    });

    // Also dispatch notification email (tracked & deduplicated)
    dispatchStaffEmailForRequest({
      id: newReq.id,
      roomId: newReq.roomId,
      items: newReq.items,
      customMessage: newReq.customMessage,
      createdAt: newReq.createdAt
    }).catch(err => console.warn("[EMAIL] Auto-notify error:", err));

    res.json({ success: true, request: newReq });
  });

  // GET borrowed items (deduplicated by active room & appliance, synchronized with Supabase)
  app.get("/api/borrowed", async (req, res) => {
    try {
      const supaBorrowed = await fetchBorrowedFromSupabase();
      if (supaBorrowed && Array.isArray(supaBorrowed)) {
        const idMap = new Map<string, BorrowedRecord>();
        // Supabase records
        supaBorrowed.forEach(b => idMap.set(b.id, b));
        // Server memory records (in-flight)
        serverBorrowed.forEach(b => idMap.set(b.id, b));
        serverBorrowed.length = 0;
        serverBorrowed.push(...idMap.values());
      }
    } catch (e: any) {
      console.warn("[SUPABASE] Fetch borrowed error:", e?.message || e);
    }

    const dedupMap = new Map<string, BorrowedRecord>();
    serverBorrowed.forEach(b => {
      const baseName = extractBaseApplianceName(b.itemName);
      const key = b.status === "borrowed"
        ? `${b.roomId.toLowerCase().trim()}::${baseName}`
        : b.id;
      if (!dedupMap.has(key)) {
        dedupMap.set(key, b);
      }
    });
    res.json({ success: true, items: Array.from(dedupMap.values()) });
  });

  // POST newly borrowed item (persists to Supabase and memory)
  app.post("/api/borrowed", async (req, res) => {
    const { roomId, itemName, id: providedId, requestId } = req.body;
    if (!roomId || !itemName) {
      return res.status(400).json({ error: "Missing roomId or itemName" });
    }
    const cleanItemName = normalizeReturnableName(String(itemName));
    const itemRecord: BorrowedRecord = {
      id: providedId || `borrowed-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      roomId: String(roomId),
      itemName: cleanItemName,
      status: "borrowed",
      createdAt: Date.now(),
      requestId: requestId ? String(requestId) : undefined
    };

    const baseName = extractBaseApplianceName(itemRecord.itemName);

    // Strictly check for existing active borrowed record to prevent duplicates
    const existingIdx = serverBorrowed.findIndex(
      b => b.id === itemRecord.id || 
          (b.requestId && itemRecord.requestId && b.requestId === itemRecord.requestId && extractBaseApplianceName(b.itemName) === baseName) ||
          (b.roomId.trim().toLowerCase() === itemRecord.roomId.trim().toLowerCase() && 
           extractBaseApplianceName(b.itemName) === baseName && 
           b.status === "borrowed")
    );
    if (existingIdx === -1) {
      serverBorrowed.unshift(itemRecord);
    } else {
      // Update existing record rather than creating a duplicate
      serverBorrowed[existingIdx] = {
        ...serverBorrowed[existingIdx],
        itemName: itemRecord.itemName,
        status: "borrowed"
      };
    }

    // Persist to Supabase
    saveBorrowedToSupabase(itemRecord).catch(e => console.warn("[SUPABASE] Save borrowed:", e));

    res.json({ success: true, item: itemRecord });
  });

  // Return borrowed item (when staff collects it back from room)
  const handleReturnBorrowed = async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const found = serverBorrowed.find(b => b.id === id);
    if (found) {
      found.status = "returned";
      found.returnedAt = Date.now();
    }
    // Update in Supabase
    markBorrowedReturnedInSupabase(id).catch(e => console.warn("[SUPABASE] Mark returned error:", e));
    res.json({ success: true, message: "Item marked as returned" });
  };
  app.patch("/api/borrowed/:id", handleReturnBorrowed);
  app.put("/api/borrowed/:id", handleReturnBorrowed);
  app.post("/api/borrowed/:id/return", handleReturnBorrowed);

  // DELETE borrowed item
  app.delete("/api/borrowed/:id", async (req, res) => {
    const { id } = req.params;
    const idx = serverBorrowed.findIndex(b => b.id === id);
    if (idx !== -1) {
      serverBorrowed.splice(idx, 1);
    }
    deleteBorrowedFromSupabase(id).catch(e => console.warn("[SUPABASE] Delete borrowed error:", e));
    res.json({ success: true, message: "Borrowed item removed" });
  });

  // ============================================
  // INTERNAL INVENTORY TRACKER ENDPOINTS
  // ============================================

  // GET all inventory items (live count: totalStock, taken, available)
  app.get("/api/inventory", (req, res) => {
    const items = Object.entries(serverInventoryLimits).map(([name, limit]) => {
      const taken = calculateItemTaken(name);
      return {
        id: `inv-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        name,
        category: "Item",
        totalStock: limit,
        limit,
        taken,
        inUse: taken,
        available: Math.max(0, limit - taken)
      };
    });
    return res.json({ success: true, inventory: items, source: "memory" });
  });

  // GET all rooms
  app.get("/api/rooms", (req, res) => {
    res.json({ success: true, rooms: serverRooms });
  });

  // POST add new room
  app.post("/api/rooms", (req, res) => {
    const { roomNumber, qrCodeHash, status } = req.body;
    if (!roomNumber) {
      return res.status(400).json({ error: "Missing roomNumber" });
    }
    const cleanNum = String(roomNumber).trim();
    const existingIdx = serverRooms.findIndex(r => r.roomNumber.toLowerCase() === cleanNum.toLowerCase());
    const roomObj = {
      id: `room-${cleanNum}`,
      roomNumber: cleanNum,
      qrCodeHash: qrCodeHash || cleanNum,
      status: (status === "occupied" ? "occupied" : "vacant") as "occupied" | "vacant"
    };

    if (existingIdx !== -1) {
      serverRooms[existingIdx] = roomObj;
    } else {
      serverRooms.push(roomObj);
      serverRooms.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
    }

    res.json({ success: true, room: roomObj, rooms: serverRooms });
  });

  // DELETE room
  app.delete("/api/rooms/:roomNumber", (req, res) => {
    const { roomNumber } = req.params;
    const cleanNum = String(roomNumber).trim();
    const idx = serverRooms.findIndex(r => r.roomNumber.toLowerCase() === cleanNum.toLowerCase());
    if (idx !== -1) {
      serverRooms.splice(idx, 1);
    }
    res.json({ success: true, message: `Room ${cleanNum} deleted`, rooms: serverRooms });
  });

  // POST or upsert new inventory item
  app.post("/api/inventory", (req, res) => {
    const { name, totalStock } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: "Item name is required" });
    }

    const clean = name.trim();
    const stockNum = Math.max(1, parseInt(totalStock, 10) || 1);
    serverInventoryLimits[clean] = stockNum;
    saveInventoryLimits(serverInventoryLimits);

    return res.json({
      success: true,
      item: {
        id: `inv-${clean.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        name: clean,
        totalStock: stockNum,
        limit: stockNum,
        taken: calculateItemTaken(clean),
        inUse: calculateItemTaken(clean),
        available: Math.max(0, stockNum - calculateItemTaken(clean))
      }
    });
  });

  // PATCH adjust inventory item (e.g. change totalStock)
  app.patch("/api/inventory/:name", (req, res) => {
    const { name } = req.params;
    const decodedName = decodeURIComponent(name);
    const { totalStock, limit } = req.body;
    const stockNum = Math.max(1, parseInt(totalStock || limit, 10) || 1);
    serverInventoryLimits[decodedName] = stockNum;
    saveInventoryLimits(serverInventoryLimits);

    return res.json({
      success: true,
      name: decodedName,
      totalStock: stockNum,
      limit: stockNum,
      taken: calculateItemTaken(decodedName),
      inUse: calculateItemTaken(decodedName),
      available: Math.max(0, stockNum - calculateItemTaken(decodedName))
    });
  });

  // ============================================
  // SETTINGS & AMENITIES AVAILABILITY ENDPOINTS
  // ============================================

  // GET live amenities availability (accessible by both desktop & mobile instant sync)
  app.get("/api/settings/amenities", (req, res) => {
    return res.json({
      success: true,
      amenities: serverAmenitiesStatus
    });
  });

  // POST update amenities availability
  app.post("/api/settings/amenities", (req, res) => {
    const { amenities } = req.body;
    if (!amenities || typeof amenities !== "object") {
      return res.status(400).json({ success: false, error: "Invalid amenities data" });
    }
    serverAmenitiesStatus = { ...serverAmenitiesStatus, ...amenities };
    saveAmenitiesSettings(serverAmenitiesStatus);
    saveAmenitiesToSupabase(serverAmenitiesStatus).catch(() => {});
    console.log("[SETTINGS] Updated amenities availability:", Object.keys(serverAmenitiesStatus).length, "items");
    return res.json({
      success: true,
      amenities: serverAmenitiesStatus
    });
  });

  // GET combined settings (amenities, inventory limits)
  app.get("/api/settings", (req, res) => {
    return res.json({
      success: true,
      amenities: serverAmenitiesStatus,
      inventoryLimits: serverInventoryLimits
    });
  });

  // POST save-all settings (instant sub-100ms response so Staff never hangs)
  app.post("/api/settings/save-all", (req, res) => {
    const { amenities, inventory } = req.body;

    if (amenities && typeof amenities === "object") {
      serverAmenitiesStatus = { ...serverAmenitiesStatus, ...amenities };
      saveAmenitiesSettings(serverAmenitiesStatus);
      saveAmenitiesToSupabase(serverAmenitiesStatus).catch(() => {});
    }

    if (inventory && typeof inventory === "object") {
      for (const [name, data] of Object.entries(inventory)) {
        const limit = (data as any)?.limit ?? (data as any)?.totalStock;
        if (typeof limit === "number") {
          serverInventoryLimits[name] = limit;
        }
      }
      saveInventoryLimits(serverInventoryLimits);
    }

    console.log("[SETTINGS] Saved all settings successfully to disk and server memory");
    return res.json({
      success: true,
      message: "Settings saved successfully",
      amenities: serverAmenitiesStatus,
      inventory: serverInventoryLimits,
      savedAt: Date.now()
    });
  });

  // PATCH or PUT update request status
  const handleUpdateStatus = async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const { status } = req.body;
    if (status !== "pending" && status !== "completed") {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    // 1. Sync update to Supabase guest_requests table first
    try {
      await updateRequestStatusInSupabase(id, status);
    } catch (e: any) {
      console.warn("[SUPABASE] Status update error:", e?.message || e);
    }

    // 2. Locate or hydrate in serverRequests memory
    let found = serverRequests.find(r => r.id === id);
    if (!found) {
      try {
        const supaReqs = await fetchRequestsFromSupabase();
        const dbReq = supaReqs?.find(r => r.id === id);
        if (dbReq) {
          found = { ...dbReq, status };
          serverRequests.unshift(found);
        }
      } catch (e) {}
    }

    if (found) {
      found.status = status;
    }

    const createdBorrowed: BorrowedRecord[] = [];

    // 3. When marked completed, automatically track returnable items in Borrowed section
    if (status === "completed" && found && Array.isArray(found.items)) {
      for (const rawItem of found.items) {
        const itemStr = String(rawItem);
        if (isReturnableItem(itemStr)) {
          const canonicalName = normalizeReturnableName(itemStr);
          const baseName = extractBaseApplianceName(canonicalName);

          const already = serverBorrowed.some(
            b => (b.roomId.trim().toLowerCase() === found!.roomId.trim().toLowerCase() &&
                 extractBaseApplianceName(b.itemName) === baseName &&
                 b.status === "borrowed")
          );

          if (!already) {
            const newBor: BorrowedRecord = {
              id: `borrowed-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
              roomId: found.roomId,
              itemName: canonicalName,
              status: "borrowed",
              createdAt: Date.now(),
              requestId: found.id
            };
            serverBorrowed.unshift(newBor);
            createdBorrowed.push(newBor);
            // Persist to Supabase borrowed_items table
            await saveBorrowedToSupabase(newBor).catch(e => {
              console.warn("[SUPABASE] Save borrowed error:", e?.message || e);
            });
          }
        }
      }
    } else if (status === "pending" && found) {
      // Note: Do not automatically mark physical appliances as returned when a request is reopened.
      // Physical appliances in guest rooms must only be marked as returned when staff explicitly
      // clicks "Collect & Return" after retrieving them from the room.
      console.log(`[REQUESTS] Request ${id} toggled to pending. Keeping active borrowed appliances intact.`);
    }

    return res.json({ 
      success: true, 
      request: found || { id, status }, 
      borrowedCreated: createdBorrowed 
    });
  };
  app.patch("/api/requests/:id", handleUpdateStatus);
  app.put("/api/requests/:id", handleUpdateStatus);

  // Check Supabase connection and table status
  app.get("/api/supabase/status", async (req, res) => {
    try {
      const status = await getSupabaseStatus();
      res.json({ success: true, status });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message });
    }
  });

  // Endpoint to return the exact SQL snippet to create the table
  app.get("/api/supabase/sql", (req, res) => {
    res.type("text/plain").send(SUPABASE_TABLE_SQL);
  });

  // Sync / Backfill all existing requests to Supabase
  app.post("/api/supabase/sync", async (req, res) => {
    const requestsToSync: ServerRequest[] = Array.isArray(req.body?.requests) && req.body.requests.length > 0
      ? req.body.requests
      : serverRequests;

    let syncedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const r of requestsToSync) {
      const result = await saveRequestToSupabase(r);
      if (result.success) {
        syncedCount++;
      } else {
        failedCount++;
        if (result.error && !errors.includes(result.error)) {
          errors.push(result.error);
        }
      }
    }

    res.json({
      success: syncedCount > 0 || requestsToSync.length === 0,
      total: requestsToSync.length,
      syncedCount,
      failedCount,
      errors
    });
  });

  interface EmailAlertParams {
    roomNumber: string;
    items: string[];
    customMessage?: string;
  }

  async function sendStaffEmailAlert({ roomNumber, items, customMessage }: EmailAlertParams): Promise<{ success: boolean; details?: any; error?: string }> {
    const rawApiKey = process.env.RESEND_API_KEY?.trim();
    if (!rawApiKey) {
      console.log("[EMAIL] RESEND_API_KEY not configured in environment variables.");
      return { success: false, error: "RESEND_API_KEY not configured" };
    }

    // Sole recipient as requested: huesstay@gmail.com
    const rawRecipients = process.env.RESEND_TO_EMAILS?.trim() || "huesstay@gmail.com";
    const toEmails = rawRecipients
      .split(",")
      .map(e => e.trim())
      .filter(e => e.includes("@"));

    if (toEmails.length === 0) {
      toEmails.push("huesstay@gmail.com");
    }

    // Free Resend tier enforces exactly 1 recipient per dispatch
    const primaryRecipient = toEmails[0] || "huesstay@gmail.com";

    const fromAddress = process.env.RESEND_FROM_EMAIL?.trim() || "Hues Stay Concierge <onboarding@resend.dev>";
    const timestamp = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

    const plainText = `🛎️ NEW GUEST REQUEST - ROOM ${roomNumber}\n` +
      `==========================================\n\n` +
      `Room: Room ${roomNumber}\n` +
      `Time: ${timestamp}\n\n` +
      `Items Requested:\n` +
      `${items && items.length > 0 ? items.map(i => `  • ${i}`).join("\n") : "  (No specific items)"}\n\n` +
      (customMessage ? `Guest Note:\n  "${customMessage}"\n\n` : "") +
      `Open Staff Dashboard to attend to this request.\n` +
      `https://ais-dev-6pq7a4aadlk33uog2vbo7m-437727623674.asia-southeast1.run.app/staff\n\n` +
      `---\nHues Stay Automated Concierge System`;

    const htmlContent = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>New Guest Request - Room ${roomNumber}</title>
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; background-color: #F4F1EA; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  </style>
</head>
<body style="margin: 0; padding: 30px 10px; background-color: #F4F1EA; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #2D2926; -webkit-font-smoothing: antialiased;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 580px; background-color: #FFFFFF; border: 1px solid #E5E1DB; border-radius: 6px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
          
          <!-- Header Banner -->
          <tr>
            <td style="background-color: #1A1A1A; padding: 28px 30px; text-align: center;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <span style="display: inline-block; font-size: 10px; letter-spacing: 0.25em; text-transform: uppercase; color: #A68966; font-weight: 700; margin-bottom: 6px;">HUES STAY LUXURY SUITES</span>
                    <h1 style="margin: 0; color: #FFFFFF; font-size: 22px; font-family: Georgia, 'Times New Roman', serif; font-weight: 400; letter-spacing: 0.05em; font-style: italic;">New Guest Service Request</h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content Area -->
          <tr>
            <td style="padding: 32px 30px;">
              
              <!-- Room & Timestamp Card -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #FAF8F5; border: 1px solid #EBE7E1; border-left: 4px solid #A68966; border-radius: 4px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 16px 20px;">
                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td align="left">
                          <span style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.15em; color: #8C857D; font-weight: 700; display: block; margin-bottom: 2px;">ROOM NUMBER</span>
                          <span style="font-size: 26px; font-weight: 700; color: #2D2926; font-family: Georgia, 'Times New Roman', serif;">Room ${roomNumber}</span>
                        </td>
                        <td align="right" valign="bottom">
                          <span style="font-size: 11px; color: #8C857D; font-family: monospace; background: #FFFFFF; border: 1px solid #E5E1DB; padding: 4px 8px; border-radius: 3px; display: inline-block;">
                            ${timestamp}
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Requested Items Section -->
              <div style="margin-bottom: 24px;">
                <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; color: #8C857D; font-weight: 700; display: block; margin-bottom: 10px;">
                  REQUESTED ITEMS & SERVICES
                </span>
                
                ${items && items.length > 0 ? `
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: separate; border-spacing: 0 6px;">
                    ${items.map(item => `
                      <tr>
                        <td style="background-color: #FAF8F5; border: 1px solid #EBE7E1; padding: 12px 16px; border-radius: 4px; font-size: 14px; color: #2D2926; font-weight: 500;">
                          <span style="color: #A68966; font-weight: bold; margin-right: 8px;">✓</span> ${item}
                        </td>
                      </tr>
                    `).join('')}
                  </table>
                ` : `
                  <p style="margin: 0; padding: 12px; background-color: #FAF8F5; border: 1px dashed #E5E1DB; color: #8C857D; font-size: 13px; font-style: italic; border-radius: 4px;">
                    No specific checklist items selected.
                  </p>
                `}
              </div>

              <!-- Custom Guest Message / Note -->
              ${customMessage ? `
                <div style="margin-bottom: 28px;">
                  <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; color: #8C857D; font-weight: 700; display: block; margin-bottom: 8px;">
                    SPECIAL INSTRUCTIONS / GUEST NOTE
                  </span>
                  <div style="background-color: #FFFDF9; border: 1px solid #EAD8C3; border-radius: 4px; padding: 16px;">
                    <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #2D2926; font-style: italic;">
                      "${customMessage}"
                    </p>
                  </div>
                </div>
              ` : ''}

              <!-- Action Button to Staff Dashboard -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 24px; margin-bottom: 12px;">
                <tr>
                  <td align="center">
                    <a href="https://ais-dev-6pq7a4aadlk33uog2vbo7m-437727623674.asia-southeast1.run.app/staff" target="_blank" style="display: inline-block; background-color: #2D2926; color: #FFFFFF; text-decoration: none; padding: 14px 28px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.15em; border-radius: 3px; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">
                      Open Staff Dashboard &rarr;
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #FAF8F5; border-top: 1px solid #EBE7E1; padding: 20px 24px; text-align: center;">
              <p style="margin: 0 0 4px 0; font-size: 11px; color: #8C857D;">
                This is an automated notification from Hues Stay Guest Concierge System.
              </p>
              <p style="margin: 0; font-size: 10px; color: #A09890;">
                Hues Stay &bull; Real-Time Room Request Dispatch
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    console.log(`[RESEND EMAIL] Preparing notification dispatch for Room ${roomNumber} to primary recipient:`, primaryRecipient);

    // Free Resend tier: send to single recipient
    try {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${rawApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [primaryRecipient],
          subject: `🛎️ New Request: Room ${roomNumber}`,
          text: plainText,
          html: htmlContent
        })
      });

      if (resendRes.ok) {
        const data = await resendRes.json();
        console.log(`[RESEND EMAIL] Successfully dispatched to ${primaryRecipient}! ID:`, data.id);
        return { success: true, details: data };
      }

      const errText = await resendRes.text();
      console.warn(`[RESEND EMAIL] Send returned status ${resendRes.status} for ${primaryRecipient}: ${errText}`);

      // If Resend free testing sandbox rejects unverified domain recipient (HTTP 403),
      // attempt delivery to account owner (alamuri.kishan@gmail.com) so the hotel still receives the alert!
      if (resendRes.status === 403 && primaryRecipient !== "alamuri.kishan@gmail.com") {
        console.log(`[RESEND EMAIL] Free tier sandbox restriction detected. Dispatching safety copy to verified account email...`);
        try {
          const fallbackRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${rawApiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              from: fromAddress,
              to: ["alamuri.kishan@gmail.com"],
              subject: `🛎️ [Forwarded for ${primaryRecipient}] New Request: Room ${roomNumber}`,
              text: plainText,
              html: htmlContent
            })
          });
          if (fallbackRes.ok) {
            const fbData = await fallbackRes.json();
            console.log(`[RESEND EMAIL] Successfully dispatched safety copy to verified account! ID:`, fbData.id);
            return { success: true, details: { ...fbData, note: `Dispatched to verified account fallback because ${primaryRecipient} requires domain verification on Resend free tier` } };
          }
        } catch (e: any) {
          console.warn("[RESEND EMAIL] Fallback dispatch failed:", e?.message);
        }
      }

      return { success: false, error: errText };
    } catch (err: any) {
      console.error(`[RESEND EMAIL] Network error during dispatch:`, err?.message);
      return { success: false, error: err?.message };
    }
  }

  // File-backed tracker for emailed request IDs to avoid re-sending or duplicates
  const EMAILED_FILE = path.join(process.cwd(), ".data", "emailed_requests.json");
  const emailedRequestIds = new Set<string>();

  function loadEmailedRequestIds() {
    try {
      if (fs.existsSync(EMAILED_FILE)) {
        const content = fs.readFileSync(EMAILED_FILE, "utf-8");
        const list = JSON.parse(content);
        if (Array.isArray(list)) {
          list.forEach(id => emailedRequestIds.add(String(id)));
        }
      }
    } catch (err) {
      console.warn("[EMAIL] Could not read emailed_requests.json:", err);
    }
  }

  function saveEmailedRequestIds() {
    try {
      const dir = path.dirname(EMAILED_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(EMAILED_FILE, JSON.stringify(Array.from(emailedRequestIds), null, 2));
    } catch (err) {
      console.warn("[EMAIL] Could not write emailed_requests.json:", err);
    }
  }

  loadEmailedRequestIds();

  async function dispatchStaffEmailForRequest(req: {
    id: string;
    roomId: string;
    items: string[];
    customMessage?: string;
    createdAt?: number;
    forceResend?: boolean;
  }): Promise<{ success: boolean; details?: any; error?: string }> {
    const reqId = String(req.id || `req-${Date.now()}`);
    if (!req.forceResend && emailedRequestIds.has(reqId)) {
      return { success: true, details: "Already notified" };
    }

    console.log(`[EMAIL DISPATCH] Triggering notification email for request ${reqId} (Room ${req.roomId})`);
    const result = await sendStaffEmailAlert({
      roomNumber: req.roomId,
      items: req.items,
      customMessage: req.customMessage
    });

    if (result.success) {
      emailedRequestIds.add(reqId);
      saveEmailedRequestIds();
      console.log(`[EMAIL DISPATCH] Successfully sent & tracked email for request ${reqId}`);
    } else {
      console.warn(`[EMAIL DISPATCH] Failed to send email for request ${reqId}:`, result.error);
    }

    return result;
  }

  function startEmailNotificationDaemon() {
    console.log("[EMAIL DAEMON] Starting Supabase Realtime & Polling Email Watcher...");

    const checkSupabaseForNewRequests = async () => {
      try {
        const sb = getSupabase();
        if (!sb) return;

        const { data, error } = await sb
          .from("guest_requests")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(20);

        if (error || !data || !Array.isArray(data)) return;

        for (const row of data) {
          const reqId = String(row.id);
          const createdAt = Number(row.created_at) || 0;
          // Check if created within last 24 hours and not yet emailed
          const isRecent = (Date.now() - createdAt) < (24 * 60 * 60 * 1000);

          if (!emailedRequestIds.has(reqId) && isRecent) {
            console.log(`[EMAIL DAEMON] Found un-notified request ${reqId} for Room ${row.room_id} in Supabase!`);
            await dispatchStaffEmailForRequest({
              id: reqId,
              roomId: String(row.room_id),
              items: Array.isArray(row.items) ? row.items : [],
              customMessage: row.custom_message || "",
              createdAt
            });
          }
        }
      } catch (err: any) {
        console.warn("[EMAIL DAEMON] Polling check warning:", err?.message || err);
      }
    };

    // Run on startup
    checkSupabaseForNewRequests();

    // Fast poll every 3 seconds - catches mobile QR submissions regardless of origin
    setInterval(checkSupabaseForNewRequests, 3000);

    // Realtime subscription for instant zero-latency email dispatch
    try {
      const sb = getSupabase();
      if (sb) {
        sb.channel("server_request_email_watcher")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "guest_requests" }, async (payload: any) => {
            const row = payload.new;
            if (row && row.id && !emailedRequestIds.has(String(row.id))) {
              console.log(`[EMAIL REALTIME] Instant notification for newly inserted request ${row.id} Room ${row.room_id}`);
              await dispatchStaffEmailForRequest({
                id: String(row.id),
                roomId: String(row.room_id),
                items: Array.isArray(row.items) ? row.items : [],
                customMessage: row.custom_message || "",
                createdAt: Number(row.created_at) || Date.now()
              });
            }
          })
          .subscribe();
      }
    } catch (err: any) {
      console.warn("[EMAIL REALTIME] Subscription error:", err?.message || err);
    }
  }

  // Webhook Endpoint for Notifications (Resend Email API notification dispatch)
  app.post("/api/notify", async (req, res) => {
    const { roomNumber, items, customMessage, id } = req.body;
    
    // Trigger email alert
    const emailResult = await dispatchStaffEmailForRequest({
      id: String(id || `notify-${Date.now()}`),
      roomId: String(roomNumber || "Unknown"),
      items: Array.isArray(items) ? items : [],
      customMessage: customMessage || ""
    });
    
    res.json({ success: true, message: "Staff notification processed", email: emailResult });
  });

  // Ensure request has email dispatched
  app.post("/api/email/ensure-dispatched", async (req, res) => {
    const { id, roomId, items, customMessage } = req.body;
    if (!id || !roomId) {
      return res.status(400).json({ error: "Missing id or roomId" });
    }
    const result = await dispatchStaffEmailForRequest({
      id: String(id),
      roomId: String(roomId),
      items: Array.isArray(items) ? items : [],
      customMessage: customMessage || ""
    });
    res.json(result);
  });

  // Diagnostic Endpoint: Check email configuration and history
  app.get("/api/email/status", (req, res) => {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const rawRecipients = process.env.RESEND_TO_EMAILS?.trim() || "huesstay@gmail.com";
    const toEmails = rawRecipients.split(",").map(e => e.trim()).filter(Boolean);
    const primaryRecipient = toEmails[0] || "huesstay@gmail.com";
    
    res.json({
      configured: Boolean(apiKey && apiKey.length > 5),
      primaryRecipient,
      recipients: [primaryRecipient],
      from: process.env.RESEND_FROM_EMAIL || "Hues Stay Concierge <onboarding@resend.dev>",
      emailedCount: emailedRequestIds.size,
      recentEmailedIds: Array.from(emailedRequestIds).slice(-10)
    });
  });

  // Diagnostic Endpoint: Trigger a test email
  app.post("/api/email/test", async (req, res) => {
    const testResult = await sendStaffEmailAlert({
      roomNumber: "101",
      items: ["Water Glasses (Qty: 2)", "Kettle", "Soap Refill"],
      customMessage: "This is a test notification from Hues Stay Settings to verify email routing."
    });

    res.json(testResult);
  });


  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startEmailNotificationDaemon();
  });
}

startServer();
