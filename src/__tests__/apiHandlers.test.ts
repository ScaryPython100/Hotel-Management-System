import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import requestsHandler, { escapeHtml, getRequestRejection, resetDedupCachesForTesting } from "../../api/requests";
import borrowedHandler from "../../api/borrowed";
import guestHandler from "../../api/guest";
import staffHandler from "../../api/staff";
import {
  resolveRoomToken,
  createSuperhostToken,
  verifySuperhostToken,
  checkSuperhostPin
} from "../../api/_lib/security";

// Every network call is intercepted: no request ever reaches Supabase or Resend.
type FetchCall = { url: string; init: any };
let calls: FetchCall[] = [];
let respond: (url: string, init: any) => { ok: boolean; status: number; body?: any };
const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };

const STAFF_HEADERS = { authorization: "Bearer good-staff-jwt" };

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  res.end = () => res;
  return res;
}

beforeEach(() => {
  calls = [];
  respond = () => ({ ok: true, status: 200, body: [] });
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const href = String(url);
    calls.push({ url: href, init });
    // Supabase Auth: only "good-staff-jwt" is a signed-in staff member
    if (href.endsWith("/auth/v1/user")) {
      const ok = init?.headers?.Authorization === "Bearer good-staff-jwt";
      return { ok, status: ok ? 200 : 401, json: async () => (ok ? { id: "staff-1", email: "staff@example.test" } : {}) };
    }
    const r = respond(href, init);
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.body ?? [],
      text: async () => JSON.stringify(r.body ?? "")
    };
  }) as any;
  process.env.SUPABASE_URL = "https://mock.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key";
  process.env.SUPABASE_ANON_KEY = "mock-anon-key";
  process.env.RESEND_API_KEY = "re_mock_key";
  process.env.SUPERHOST_PIN = "4321";
  delete process.env.RESEND_TO_EMAILS;
  delete process.env.APP_URL;
  resetDedupCachesForTesting();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...savedEnv };
});

const resendCalls = () => calls.filter(c => c.url.includes("api.resend.com"));
const dbCalls = () => calls.filter(c => c.url.includes("/rest/v1/"));
const supabaseWrites = (method: string) => dbCalls().filter(c => c.init?.method === method);
// QR codes in the rooms open /room/<room number>
const roomToken = (room: string) => room;

describe("room links and superhost tokens", () => {
  it("uses the room number from the printed QR link", () => {
    assert.equal(resolveRoomToken("101"), "101");
    assert.equal(resolveRoomToken(" 204 "), "204");
    assert.equal(resolveRoomToken("SETTINGS"), null);
    assert.equal(resolveRoomToken("../101"), null);
    assert.equal(resolveRoomToken(""), null);
  });

  it("expires superhost tokens", () => {
    const token = createSuperhostToken(0) as string;
    assert.equal(verifySuperhostToken(token, 1000), true);
    assert.equal(verifySuperhostToken(token, 13 * 60 * 60 * 1000), false);
    assert.equal(verifySuperhostToken("999999999999999.forged"), false);
  });

  it("checks the PIN against SUPERHOST_PIN only", () => {
    assert.equal(checkSuperhostPin("4321"), true);
    assert.equal(checkSuperhostPin("9999"), false);
    delete process.env.SUPERHOST_PIN;
    assert.equal(checkSuperhostPin(""), false);
  });
});

describe("api/requests helpers", () => {
  it("escapes HTML special characters", () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("rejects reserved ids and rooms", () => {
    assert.equal(getRequestRejection("system-amenities-settings-global", "101"), "Invalid request id");
    assert.equal(getRequestRejection("bad id with spaces", "101"), "Invalid request id");
    assert.equal(getRequestRejection("req-1", "SETTINGS"), "Invalid room");
    assert.equal(getRequestRejection("req-123-abc", "101"), null);
  });
});

describe("POST /api/requests", () => {
  it("rejects requests without a valid room link", async () => {
    const res = mockRes();
    await requestsHandler({ method: "POST", query: {}, headers: {}, body: { id: "req-1", roomToken: "SETTINGS", items: ["Kettle"] } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(dbCalls().length, 0);
    assert.equal(resendCalls().length, 0);
  });

  it("takes the room from the room link and always starts as pending", async () => {
    const res = mockRes();
    await requestsHandler({ method: "POST", query: {}, headers: {}, body: { id: "req-1", roomId: "999", roomToken: roomToken("101"), items: ["Kettle"], status: "completed" } }, res);
    assert.equal(res.statusCode, 200);
    const insert = JSON.parse(supabaseWrites("POST")[0].init.body);
    assert.equal(insert.room_id, "101");
    assert.equal(insert.status, "pending");
  });

  it("refuses to overwrite system settings rows", async () => {
    const res = mockRes();
    await requestsHandler({ method: "POST", query: {}, headers: {}, body: { id: "system-amenities-settings-global", roomToken: roomToken("101"), items: [] } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(dbCalls().length, 0);
  });

  it("escapes guest text in the staff email HTML", async () => {
    await requestsHandler({ method: "POST", query: {}, headers: {}, body: { id: "req-2", roomToken: roomToken("102"), items: ["<b>Kettle</b>"], customMessage: `<a href="http://evil">click</a>` } }, mockRes());
    const html = JSON.parse(resendCalls()[0].init.body).html as string;
    assert.ok(!html.includes(`<a href="http://evil">`));
    assert.ok(html.includes("&lt;b&gt;Kettle&lt;/b&gt;"));
  });

  it("sends one email for repeated ids and identical payloads within 3 minutes", async () => {
    const body = { id: "req-3", roomToken: roomToken("103"), items: ["Iron Box"], customMessage: "" };
    await requestsHandler({ method: "POST", query: {}, headers: {}, body }, mockRes());
    await requestsHandler({ method: "POST", query: {}, headers: {}, body }, mockRes());
    await requestsHandler({ method: "POST", query: {}, headers: {}, body: { ...body, id: "req-4" } }, mockRes());
    assert.equal(resendCalls().length, 1);
  });

  it("reports failure when the request cannot be saved", async () => {
    respond = (url) => url.includes("mock.supabase.test") ? { ok: false, status: 500 } : { ok: true, status: 200 };
    const res = mockRes();
    await requestsHandler({ method: "POST", query: {}, headers: {}, body: { id: "req-6", roomToken: roomToken("105"), items: ["Kettle"] } }, res);
    assert.equal(res.statusCode, 502);
  });
});

describe("GET/PATCH/DELETE /api/requests", () => {
  it("requires staff sign-in to list or update requests", async () => {
    const list = mockRes();
    await requestsHandler({ method: "GET", query: {}, headers: {} }, list);
    assert.equal(list.statusCode, 401);

    const patch = mockRes();
    await requestsHandler({ method: "PATCH", query: { id: "req-1" }, headers: {}, body: { status: "completed" } }, patch);
    assert.equal(patch.statusCode, 401);
    assert.equal(dbCalls().length, 0);
  });

  it("lets staff update a status", async () => {
    const res = mockRes();
    await requestsHandler({ method: "PATCH", query: { id: "req-1" }, headers: STAFF_HEADERS, body: { status: "completed" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(supabaseWrites("PATCH")[0].init.body).status, "completed");
  });

  it("lets a guest cancel only a pending request from their own room", async () => {
    respond = (url, init) => (!init?.method || init.method === "GET") && url.includes("select=room_id,status")
      ? { ok: true, status: 200, body: [{ room_id: "101", status: "pending" }] }
      : { ok: true, status: 200 };

    const own = mockRes();
    await requestsHandler({ method: "DELETE", query: { id: "req-1" }, headers: { "x-room-token": roomToken("101") } }, own);
    assert.equal(own.statusCode, 200);
    assert.equal(JSON.parse(supabaseWrites("PATCH")[0].init.body).is_deleted_from_dashboard, true);

    const other = mockRes();
    await requestsHandler({ method: "DELETE", query: { id: "req-1" }, headers: { "x-room-token": roomToken("202") } }, other);
    assert.equal(other.statusCode, 403);
  });
});

describe("GET /api/guest", () => {
  it("rejects unknown room links", async () => {
    const res = mockRes();
    await guestHandler({ method: "GET", query: { token: "SETTINGS" }, headers: {} }, res);
    assert.equal(res.statusCode, 404);
  });

  it("returns counts without other guests' details", async () => {
    respond = (url) => {
      if (url.includes("borrowed_items")) return { ok: true, status: 200, body: [{ item_name: "Kettle" }] };
      if (url.includes("status=eq.pending")) {
        return { ok: true, status: 200, body: [
          { items: ["Kettle (qty: 2)", "Maggi (₹20 Per Pack)"], custom_message: "Guest Name: Someone\nPhone Number: 123" },
          { items: ["Iron Box"], is_waitlist: true, waitlist_for_item: "Iron Box", custom_message: "" }
        ] };
      }
      return { ok: true, status: 200, body: [{ id: "system-inventory-limits-global", custom_message: JSON.stringify({ Kettle: 3 }) }] };
    };
    const res = mockRes();
    await guestHandler({ method: "GET", query: { token: roomToken("101") }, headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.room, "101");
    assert.equal(res.body.inUse.Kettle, 2);
    assert.equal(res.body.inUse.Maggi, 1);
    assert.equal(res.body.waitlistCounts["Iron Box"], 1);
    assert.deepEqual(res.body.limits, { Kettle: 3 });
    assert.ok(!JSON.stringify(res.body).includes("Someone"));
  });
});

describe("/api/staff", () => {
  it("requires staff sign-in", async () => {
    const res = mockRes();
    await staffHandler({ method: "POST", query: { action: "verify-pin" }, headers: {}, body: { pin: "4321" } }, res);
    assert.equal(res.statusCode, 401);
  });

  it("checks the superhost PIN on the server", async () => {
    const wrong = mockRes();
    await staffHandler({ method: "POST", query: { action: "verify-pin" }, headers: STAFF_HEADERS, body: { pin: "0000" } }, wrong);
    assert.equal(wrong.statusCode, 403);

    const pin = mockRes();
    await staffHandler({ method: "POST", query: { action: "verify-pin" }, headers: STAFF_HEADERS, body: { pin: "4321" } }, pin);
    assert.equal(pin.statusCode, 200);
    assert.equal(verifySuperhostToken(pin.body.superhostToken), true);
  });
});

describe("/api/borrowed", () => {
  const relayBody = { sourceBorrowedId: "borrowed-src", sourceRoomId: "204", targetRoomId: "301", itemName: "Iron Box", targetRequestId: "req-w" };

  it("requires staff sign-in", async () => {
    const res = mockRes();
    await borrowedHandler({ method: "POST", query: { id: "relay" }, headers: {}, body: relayBody }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(dbCalls().length, 0);
  });

  it("creates the target record before releasing the source", async () => {
    const res = mockRes();
    await borrowedHandler({ method: "POST", query: { id: "relay" }, headers: STAFF_HEADERS, body: relayBody }, res);
    assert.equal(res.statusCode, 200);
    const order = dbCalls().map(c => `${c.init?.method} ${c.url.split("/rest/v1/")[1]?.split("?")[0]}`);
    assert.deepEqual(order, ["POST borrowed_items", "PATCH borrowed_items", "PATCH guest_requests"]);
  });
});
