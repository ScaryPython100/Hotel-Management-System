import { checkSuperhostPin, createSuperhostToken, getStaffUser } from "./_lib/security.js";

// Staff-only helpers. Every call needs a signed-in staff member (Supabase Auth).
//   POST /api/staff?action=verify-pin   { pin }   -> { superhostToken }
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
      return res.status(503).json({ success: false, error: "SUPABASE_SERVICE_ROLE_KEY is not configured" });
    }
    return res.status(200).json({ success: true, superhostToken });
  }

  return res.status(400).json({ success: false, error: "Unknown action" });
}
