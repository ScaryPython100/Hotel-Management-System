import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import {
  saveRequestToSupabase,
  updateRequestStatusInSupabase,
  deleteRequestFromSupabase,
  fetchRequestsFromSupabase,
  getSupabaseStatus,
  saveBorrowedToSupabase,
  markBorrowedReturnedInSupabase,
  fetchBorrowedFromSupabase,
  fetchInventoryFromSupabase,
  upsertInventoryInSupabase,
  adjustInventoryTakenInSupabase,
  BorrowedRecord,
  SupabaseInventoryRecord,
  SUPABASE_TABLE_SQL,
  SUPABASE_TABLE_NAME
} from "./src/lib/supabaseServer";

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
const serverRequests: ServerRequest[] = [
  {
    id: "req-102-kettle",
    roomId: "102",
    items: ["Kettle"],
    customMessage: "",
    status: "pending",
    createdAt: Date.now() - (25 * 60 * 1000),
  },
  {
    id: "req-101-initial",
    roomId: "101",
    items: ["Soap Refill", "Shampoo Refill", "Hand wash Refill", "Iron Box"],
    customMessage: "abcd",
    status: "pending",
    createdAt: Date.now() - (30 * 60 * 1000),
  }
];

// In-memory borrowed items store
const serverBorrowed: BorrowedRecord[] = [];
const serverDismissedRequests = new Set<string>();

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

  // GET all requests (from Supabase if configured, falling back to memory)
  app.get("/api/requests", async (req, res) => {
    try {
      const supabaseRequests = await fetchRequestsFromSupabase();
      if (supabaseRequests && supabaseRequests.length > 0) {
        // Merge into serverRequests to maintain local hot cache while filtering dismissed items
        const mergedMap = new Map<string, ServerRequest>();
        serverRequests.forEach(r => {
          if (!serverDismissedRequests.has(r.id)) mergedMap.set(r.id, r);
        });
        supabaseRequests.forEach(r => {
          if (!serverDismissedRequests.has(r.id)) mergedMap.set(r.id, r);
        });
        const combined = Array.from(mergedMap.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return res.json({ success: true, requests: combined, source: "supabase" });
      }
    } catch (e: any) {
      console.warn("Could not retrieve requests from Supabase, using server cache:", e?.message);
    }
    const filteredMemory = serverRequests.filter(r => !serverDismissedRequests.has(r.id));
    res.json({ success: true, requests: filteredMemory, source: "memory" });
  });

  // DELETE / dismiss request from active dashboard/screen views (STRICTLY PRESERVED in Supabase database)
  app.delete("/api/requests/:id", (req, res) => {
    const { id } = req.params;
    serverDismissedRequests.add(id);
    const idx = serverRequests.findIndex(r => r.id === id);
    if (idx !== -1) {
      serverRequests.splice(idx, 1);
    }
    console.log(`[REQUESTS] Request ${id} dismissed from dashboard view (remains preserved permanently in Supabase table)`);
    res.json({ success: true, message: "Request dismissed from view (preserved in Supabase database)" });
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

    // Avoid duplicate if same room and items within 10 seconds
    const isDup = serverRequests.some(r => 
      r.roomId === newReq.roomId && 
      JSON.stringify(r.items) === JSON.stringify(newReq.items) &&
      Math.abs(r.createdAt - newReq.createdAt) < 10000
    );
    if (!isDup) {
      serverRequests.unshift(newReq);
    }

    // Persist to Supabase asynchronously (strictly saved)
    saveRequestToSupabase(newReq).catch(err => {
      console.warn("[SUPABASE] Background write error:", err);
    });

    // Also dispatch notification email
    sendStaffEmailAlert({
      roomNumber: newReq.roomId,
      items: newReq.items,
      customMessage: newReq.customMessage
    }).catch(err => console.warn("[EMAIL] Auto-notify error:", err));

    res.json({ success: true, request: newReq });
  });

  // GET borrowed items (from Supabase or memory, deduplicated by active room & appliance)
  app.get("/api/borrowed", async (req, res) => {
    try {
      const supaItems = await fetchBorrowedFromSupabase();
      if (supaItems && supaItems.length > 0) {
        const mergedMap = new Map<string, BorrowedRecord>();
        // Group and deduplicate active items by room & itemName
        serverBorrowed.forEach(b => {
          const key = b.status === "borrowed"
            ? `${b.roomId.toLowerCase().trim()}::${b.itemName.toLowerCase().trim()}`
            : b.id;
          mergedMap.set(key, b);
        });
        supaItems.forEach(b => {
          const key = b.status === "borrowed"
            ? `${b.roomId.toLowerCase().trim()}::${b.itemName.toLowerCase().trim()}`
            : b.id;
          mergedMap.set(key, b);
        });
        return res.json({ success: true, items: Array.from(mergedMap.values()) });
      }
    } catch (e: any) {
      console.warn("[BORROWED] Supabase fetch error:", e?.message);
    }
    const dedupMap = new Map<string, BorrowedRecord>();
    serverBorrowed.forEach(b => {
      const key = b.status === "borrowed"
        ? `${b.roomId.toLowerCase().trim()}::${b.itemName.toLowerCase().trim()}`
        : b.id;
      dedupMap.set(key, b);
    });
    res.json({ success: true, items: Array.from(dedupMap.values()) });
  });

  // POST newly borrowed item (when staff delivers item and marks request done)
  app.post("/api/borrowed", async (req, res) => {
    const { roomId, itemName, id: providedId, requestId } = req.body;
    if (!roomId || !itemName) {
      return res.status(400).json({ error: "Missing roomId or itemName" });
    }
    const itemRecord: BorrowedRecord = {
      id: providedId || `borrowed-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      roomId: String(roomId),
      itemName: String(itemName),
      status: "borrowed",
      createdAt: Date.now()
    };

    // Store in memory
    const existingIdx = serverBorrowed.findIndex(b => b.id === itemRecord.id || (b.roomId === itemRecord.roomId && b.itemName === itemRecord.itemName && b.status === "borrowed"));
    if (existingIdx === -1) {
      serverBorrowed.unshift(itemRecord);
    }

    // Persist to Supabase borrowed table
    saveBorrowedToSupabase(itemRecord).catch(err => {
      console.warn("[SUPABASE] Borrowed record save error:", err);
    });

    // Automatically increment taken count in Supabase inventory
    adjustInventoryTakenInSupabase(itemRecord.itemName, 1).catch(err => {
      console.warn("[SUPABASE] Inventory taken increment error:", err);
    });

    res.json({ success: true, item: itemRecord });
  });

  // PATCH return borrowed item (when staff collects it back from room)
  app.patch("/api/borrowed/:id", async (req, res) => {
    const { id } = req.params;
    const found = serverBorrowed.find(b => b.id === id);
    let itemName = req.body?.itemName;
    if (found) {
      found.status = "returned";
      found.returnedAt = Date.now();
      if (!itemName) itemName = found.itemName;
    }
    markBorrowedReturnedInSupabase(id).catch(err => {
      console.warn("[SUPABASE] Borrowed return update error:", err);
    });

    // Automatically decrement taken count in Supabase inventory
    if (itemName) {
      adjustInventoryTakenInSupabase(itemName, -1).catch(err => {
        console.warn("[SUPABASE] Inventory taken decrement error:", err);
      });
    }

    res.json({ success: true, message: "Item marked as returned" });
  });

  // ============================================
  // SUPABASE INVENTORY TRACKER ENDPOINTS
  // ============================================

  // GET all inventory items (live count: total, taken, available)
  app.get("/api/inventory", async (req, res) => {
    try {
      const items = await fetchInventoryFromSupabase();
      if (items && items.length > 0) {
        return res.json({ success: true, inventory: items, source: "supabase" });
      }
    } catch (e: any) {
      console.warn("[INVENTORY] Supabase fetch error:", e?.message);
    }

    // Fallback if Supabase table not created yet or empty
    return res.json({
      success: true,
      inventory: [
        { id: "inv-iron-box", name: "Iron Box", category: "Item", totalStock: 5, taken: 0, available: 5 },
        { id: "inv-kettle", name: "Kettle", category: "Item", totalStock: 5, taken: 0, available: 5 },
        { id: "inv-hair-dryer", name: "Hair Dryer", category: "Item", totalStock: 2, taken: 0, available: 2 },
        { id: "inv-laptop-table", name: "Laptop Table", category: "Item", totalStock: 2, taken: 0, available: 2 },
        { id: "inv-leg-massager", name: "Leg Massager (Paid)", category: "Item", totalStock: 1, taken: 0, available: 1 },
        { id: "inv-glasses", name: "Water Glasses", category: "Item", totalStock: 10, taken: 0, available: 10 },
        { id: "inv-usb-2", name: "USB 2.0 Adaptor + Cable", category: "Item", totalStock: 2, taken: 0, available: 2 },
        { id: "inv-usb-3", name: "USB 3.0 Adaptor + Cable", category: "Item", totalStock: 2, taken: 0, available: 2 }
      ],
      source: "fallback"
    });
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

  // POST or upsert new inventory item (allowing owner to add new item rows)
  app.post("/api/inventory", async (req, res) => {
    const { name, totalStock, category, taken, id } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: "Item name is required" });
    }

    const stockNum = Math.max(1, parseInt(totalStock, 10) || 1);
    const result = await upsertInventoryInSupabase({
      name: name.trim(),
      totalStock: stockNum,
      category: category === "Service" ? "Service" : "Item",
      taken: typeof taken === "number" ? taken : 0,
      id
    });

    if (result.success) {
      return res.json({ success: true, item: result.data });
    }
    return res.status(500).json({ success: false, error: result.error });
  });

  // PATCH adjust inventory item (e.g. change totalStock or taken)
  app.patch("/api/inventory/:name", async (req, res) => {
    const { name } = req.params;
    const { totalStock, deltaTaken, taken } = req.body;

    if (typeof deltaTaken === "number") {
      const adjRes = await adjustInventoryTakenInSupabase(name, deltaTaken);
      return res.json(adjRes);
    }

    const stockNum = Math.max(1, parseInt(totalStock, 10) || 1);
    const result = await upsertInventoryInSupabase({
      name: decodeURIComponent(name),
      totalStock: stockNum,
      taken: typeof taken === "number" ? taken : undefined
    });

    return res.json(result);
  });

  // PATCH update request status
  app.patch("/api/requests/:id", async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const found = serverRequests.find(r => r.id === id);
    if (found && (status === "pending" || status === "completed")) {
      found.status = status;
      // Sync update to Supabase
      updateRequestStatusInSupabase(id, status).catch(e => {
        console.warn("[SUPABASE] Status update error:", e);
      });
      return res.json({ success: true, request: found });
    }
    
    // Also try updating directly in Supabase if not found in memory
    if (status === "pending" || status === "completed") {
      const supaRes = await updateRequestStatusInSupabase(id, status);
      if (supaRes.success) {
        return res.json({ success: true, message: "Updated in Supabase" });
      }
    }

    res.status(404).json({ success: false, message: "Request not found or invalid status" });
  });

  // DELETE request (removes from active staff dashboard, but PRESERVES permanently in Supabase)
  app.delete("/api/requests/:id", async (req, res) => {
    const { id } = req.params;
    const idx = serverRequests.findIndex(r => r.id === id);
    if (idx !== -1) {
      serverRequests.splice(idx, 1);
    }
    // IMPORTANT: Per hotel requirements, deleting from the staff dashboard must NOT delete
    // the request from the Supabase database. It remains preserved permanently in Supabase table guest_requests.
    console.log(`[STAFF DASHBOARD] Request ${id} dismissed from dashboard view; preserved in Supabase.`);
    return res.json({ success: true, message: "Request removed from dashboard view and preserved in Supabase" });
  });

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

    const rawRecipients = process.env.RESEND_TO_EMAILS?.trim() || "alamuri.kishan@gmail.com";
    const toEmails = rawRecipients
      .split(",")
      .map(e => e.trim())
      .filter(e => e.includes("@"));

    if (toEmails.length === 0) {
      toEmails.push("alamuri.kishan@gmail.com");
    }

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

    console.log(`[RESEND EMAIL] Preparing notification dispatch for Room ${roomNumber} to:`, toEmails);

    // Attempt batch send
    try {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${rawApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: fromAddress,
          to: toEmails,
          subject: `🛎️ New Request: Room ${roomNumber}`,
          text: plainText,
          html: htmlContent
        })
      });

      if (resendRes.ok) {
        const data = await resendRes.json();
        console.log(`[RESEND EMAIL] Successfully dispatched to all recipients! ID:`, data.id);
        return { success: true, details: data };
      }

      const errText = await resendRes.text();
      console.warn(`[RESEND EMAIL] Batch send returned status ${resendRes.status}: ${errText}`);

      // If batch send failed (e.g. testing tier restriction for secondary unverified email addresses),
      // attempt sending individually to each recipient so primary verified address receives it
      if (toEmails.length > 1) {
        console.log(`[RESEND EMAIL] Falling back to individual recipient dispatch...`);
        let anySuccess = false;
        for (const email of toEmails) {
          try {
            const singleRes = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${rawApiKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                from: fromAddress,
                to: email,
                subject: `🛎️ New Request: Room ${roomNumber}`,
                text: plainText,
                html: htmlContent
              })
            });
            if (singleRes.ok) {
              console.log(`[RESEND EMAIL] Dispatched to ${email}`);
              anySuccess = true;
            } else {
              const singleErr = await singleRes.text();
              console.warn(`[RESEND EMAIL] Failed for ${email}: ${singleErr}`);
            }
          } catch (e: any) {
            console.warn(`[RESEND EMAIL] Network error for ${email}:`, e?.message);
          }
        }
        if (anySuccess) {
          return { success: true, details: "Dispatched to verified recipient(s)" };
        }
      }

      return { success: false, error: errText };
    } catch (err: any) {
      console.error(`[RESEND EMAIL] Network error during dispatch:`, err?.message);
      return { success: false, error: err?.message };
    }
  }

  // Webhook Endpoint for Notifications (Resend Email API + Supabase Storage)
  app.post("/api/notify", async (req, res) => {
    const { roomNumber, items, customMessage, id: providedId } = req.body;
    
    // Also record in server requests store so staff dashboard always sees it
    const newReq: ServerRequest = {
      id: providedId || `srv-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      roomId: String(roomNumber || "Unknown"),
      items: Array.isArray(items) ? items : [],
      customMessage: customMessage || "",
      status: "pending",
      createdAt: Date.now()
    };
    
    const isDup = serverRequests.some(r => 
      r.roomId === newReq.roomId && 
      JSON.stringify(r.items) === JSON.stringify(newReq.items) &&
      Math.abs(r.createdAt - newReq.createdAt) < 10000
    );
    if (!isDup) {
      serverRequests.unshift(newReq);
    }

    // Persist to Supabase database table
    saveRequestToSupabase(newReq).catch(err => {
      console.warn("[SUPABASE] Sync error during notify:", err);
    });

    // Trigger email alert
    const emailResult = await sendStaffEmailAlert({
      roomNumber: newReq.roomId,
      items: newReq.items,
      customMessage: newReq.customMessage
    });
    
    res.json({ success: true, message: "Staff notified successfully", email: emailResult, request: newReq });
  });

  // Diagnostic Endpoint: Check email configuration
  app.get("/api/email/status", (req, res) => {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const rawRecipients = process.env.RESEND_TO_EMAILS?.trim() || "alamuri.kishan@gmail.com";
    const toEmails = rawRecipients.split(",").map(e => e.trim()).filter(Boolean);
    
    res.json({
      configured: Boolean(apiKey && apiKey.length > 5),
      recipients: toEmails,
      from: process.env.RESEND_FROM_EMAIL || "Hues Stay Concierge <onboarding@resend.dev>"
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
  });
}

startServer();
