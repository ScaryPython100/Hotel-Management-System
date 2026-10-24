import {
  checkSuperhostPin,
  createRoomToken,
  createSuperhostToken,
  getStaffUser,
  verifySuperhostToken
} from "./_lib/security.js";

// Staff-only helpers. Every call needs a signed-in staff member (Supabase Auth).
//   POST /api/staff?action=verify-pin   { pin }           -> { superhostToken }
//   GET  /api/staff?action=room-links&rooms=101,102       -> { links: { "101": "101.Xk2…" } }
//        (needs the x-superhost-token header from verify-pin)
export default async function handler(req: any, res: any) {
  const staff = await getStaffUser(req);
  if (!staff) {
    return res.status(401).json({ success: false, error: "Staff sign-in required" });
  }

  const action = String(req.query?.action || "");

  if (action === "verify-pin" && req.method === "POST") {
    if (!checkSuperhostPin(req.body?.pin)) {
      return res.status(403).json({ success: false, error: "Incorrect PIN" });
    }
    const superhostToken = createSuperhostToken();
    if (!superhostToken) {
      return res.status(503).json({ success: false, error: "ROOM_LINK_SECRET is not configured" });
    }
    return res.status(200).json({ success: true, superhostToken });
  }

  if (action === "room-links" && req.method === "GET") {
    if (!verifySuperhostToken(req.headers?.["x-superhost-token"])) {
      return res.status(403).json({ success: false, error: "Superhost access required" });
    }
    const rooms = String(req.query?.rooms || "")
      .split(",")
      .map(r => r.trim())
      .filter(Boolean)
      .slice(0, 500);
    const links: Record<string, string> = {};
    for (const room of rooms) {
      const token = createRoomToken(room);
      if (!token) {
        return res.status(503).json({ success: false, error: "ROOM_LINK_SECRET is not configured" });
      }
      links[room] = token;
    }
    return res.status(200).json({ success: true, links });
  }

  return res.status(400).json({ success: false, error: "Unknown action" });
}
