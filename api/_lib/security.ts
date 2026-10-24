import { createHmac, timingSafeEqual } from "node:crypto";

// Shared by the /api functions. Files under api/_lib are not deployed as endpoints.

export function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)?.trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)?.trim();
  return { url, serviceKey, anonKey };
}

// Server-only secret for signing superhost sessions (never sent to the browser)
function getSigningSecret(): string | null {
  const secret = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)?.trim();
  return secret && secret.length >= 16 ? secret : null;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url").slice(0, 22);
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

const ROOM_PATTERN = /^[A-Za-z0-9-]{1,20}$/;

/**
 * Room number from a room link. QR codes in the rooms open /room/<room number>,
 * so the link value is the room number itself.
 */
export function resolveRoomToken(token: unknown): string | null {
  const value = String(token ?? "").trim();
  if (!ROOM_PATTERN.test(value) || value.toUpperCase() === "SETTINGS") return null;
  return value;
}

/** Signed-in staff member for this request (Supabase Auth bearer token), or null */
export async function getStaffUser(req: any): Promise<{ id: string; email?: string } | null> {
  const header = String(req.headers?.authorization || req.headers?.Authorization || "");
  const jwt = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const { url, anonKey, serviceKey } = getSupabaseConfig();
  if (!jwt || !url || !(anonKey || serviceKey)) return null;

  try {
    const resp = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: (anonKey || serviceKey) as string, Authorization: `Bearer ${jwt}` }
    });
    if (!resp.ok) return null;
    const user = await resp.json();
    return user?.id ? { id: user.id, email: user.email } : null;
  } catch {
    return null;
  }
}

/** True when the PIN matches SUPERHOST_PIN (never true if it is not set) */
export function checkSuperhostPin(pin: unknown): boolean {
  const expected = process.env.SUPERHOST_PIN?.trim();
  const provided = String(pin ?? "").trim();
  return Boolean(expected && provided && safeEqual(provided, expected));
}

const SUPERHOST_SESSION_MS = 12 * 60 * 60 * 1000;

/** Short-lived proof that this staff member entered the superhost PIN */
export function createSuperhostToken(now = Date.now()): string | null {
  const secret = getSigningSecret();
  if (!secret) return null;
  const expires = String(now + SUPERHOST_SESSION_MS);
  return `${expires}.${sign(`superhost:${expires}`, secret)}`;
}

export function verifySuperhostToken(token: unknown, now = Date.now()): boolean {
  const secret = getSigningSecret();
  const value = String(token ?? "");
  const dot = value.indexOf(".");
  if (!secret || dot < 1) return false;
  const expires = value.slice(0, dot);
  if (!/^\d+$/.test(expires) || Number(expires) < now) return false;
  return safeEqual(value.slice(dot + 1), sign(`superhost:${expires}`, secret));
}
