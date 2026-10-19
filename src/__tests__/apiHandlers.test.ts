import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import requestsHandler, { escapeHtml, getRequestRejection, resetDedupCachesForTesting } from "../../api/requests";
import borrowedHandler from "../../api/borrowed";

// Every network call is intercepted: no request ever reaches Supabase or Resend.
type FetchCall = { url: string; init: any };
let calls: FetchCall[] = [];
let respond: (url: string, init: any) => { ok: boolean; status: number; body?: any };
const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };

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
    calls.push({ url: String(url), init });
    const r = respond(String(url), init);
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.body ?? [],
      text: async () => JSON.stringify(r.body ?? "")
    };
  }) as any;
  process.env.SUPABASE_URL = "https://mock.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "mock-service-key";
  process.env.RESEND_API_KEY = "re_mock_key";
  delete process.env.RESEND_TO_EMAILS;
  delete process.env.APP_URL;
  resetDedupCachesForTesting();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...savedEnv };
});

const resendCalls = () => calls.filter(c => c.url.includes("api.resend.com"));
const supabaseWrites = (method: string) =>
  calls.filter(c => c.url.includes("mock.supabase.test") && c.init?.method === method);

describe("api/requests helpers", () => {
  it("escapes HTML special characters", () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("rejects reserved ids and rooms", () => {
    assert.equal(getRequestRejection("system-amenities-settings-global", "101"), "Invalid request id");
    assert.equal(getRequestRejection("bad id with spaces", "101"), "Invalid request id");
    assert.equal(getRequestRejection("req-1", "SETTINGS"), "Invalid room");
    assert.equal(getRequestRejection("req-1", ""), "Invalid room");
    assert.equal(getRequestRejection("req-123-abc", "101"), null);
    assert.equal(getRequestRejection(undefined, "101"), null);
  });
});

describe("POST /api/requests", () => {
  it("refuses to overwrite system settings rows", async () => {
    const res = mockRes();
    await requestsHandler({ method: "POST", query: {}, body: { id: "system-amenities-settings-global", roomId: "101", items: [] } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(supabaseWrites("POST").length, 0);
    assert.equal(resendCalls().length, 0);
  });

  it("forces status to pending regardless of the payload", async () => {
    const res = mockRes();
    await requestsHandler({ method: "POST", query: {}, body: { id: "req-1", roomId: "101", items: ["Kettle"], status: "completed" } }, res);
    assert.equal(res.statusCode, 200);
    const insert = supabaseWrites("POST").find(c => c.url.endsWith("/rest/v1/guest_requests"));
    assert.ok(insert);
    assert.equal(JSON.parse(insert!.init.body).status, "pending");
  });

  it("escapes guest text in the staff email HTML", async () => {
    const res = mockRes();
    await requestsHandler({ method: "POST", query: {}, body: { id: "req-2", roomId: "102", items: ["<b>Kettle</b>"], customMessage: `<a href="http://evil">click</a>` } }, res);
    const [email] = resendCalls();
    assert.ok(email);
    const html = JSON.parse(email.init.body).html as string;
    assert.ok(!html.includes(`<a href="http://evil">`));
    assert.ok(html.includes("&lt;a href=&quot;http://evil&quot;&gt;"));
    assert.ok(html.includes("&lt;b&gt;Kettle&lt;/b&gt;"));
  });

  it("sends one email for repeated ids and identical payloads within 3 minutes", async () => {
    const body = { id: "req-3", roomId: "103", items: ["Iron Box"], customMessage: "" };
    await requestsHandler({ method: "POST", query: {}, body }, mockRes());
    await requestsHandler({ method: "POST", query: {}, body }, mockRes());
    await requestsHandler({ method: "POST", query: {}, body: { ...body, id: "req-4" } }, mockRes());
    assert.equal(resendCalls().length, 1);

    await requestsHandler({ method: "POST", query: {}, body: { ...body, id: "req-5", roomId: "104" } }, mockRes());
    assert.equal(resendCalls().length, 2);
  });

  it("reports failure when the request cannot be saved", async () => {
    respond = (url) => url.includes("mock.supabase.test") ? { ok: false, status: 500 } : { ok: true, status: 200 };
    const res = mockRes();
    await requestsHandler({ method: "POST", query: {}, body: { id: "req-6", roomId: "105", items: ["Kettle"] } }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.success, false);
  });

  it("does not treat path-style POSTs as new requests", async () => {
    const res = mockRes();
    await requestsHandler({ method: "POST", query: { id: "clear-all" }, body: {} }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(calls.length, 0);
  });
});

describe("PATCH/DELETE /api/requests", () => {
  it("rejects unknown statuses", async () => {
    const res = mockRes();
    await requestsHandler({ method: "PATCH", query: { id: "req-1" }, body: { status: "hacked" } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(calls.length, 0);
  });

  it("dismisses instead of hard-deleting", async () => {
    const res = mockRes();
    await requestsHandler({ method: "DELETE", query: { id: "req-1" }, body: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(supabaseWrites("DELETE").length, 0);
    const patch = supabaseWrites("PATCH")[0];
    assert.equal(JSON.parse(patch.init.body).is_deleted_from_dashboard, true);
  });
});

describe("GET /api/requests", () => {
  it("hides dismissed requests and settings rows", async () => {
    respond = () => ({
      ok: true,
      status: 200,
      body: [
        { id: "req-a", room_id: "101", items: [], status: "pending", created_at: 1 },
        { id: "req-b", room_id: "102", items: [], status: "pending", created_at: 2, is_deleted_from_dashboard: true },
        { id: "system-amenities-settings-global", room_id: "SETTINGS", items: [] }
      ]
    });
    const res = mockRes();
    await requestsHandler({ method: "GET", query: {} }, res);
    assert.deepEqual(res.body.requests.map((r: any) => r.id), ["req-a"]);
  });
});

describe("POST /api/borrowed relay", () => {
  const relayBody = { sourceBorrowedId: "borrowed-src", sourceRoomId: "204", targetRoomId: "301", itemName: "Iron Box", targetRequestId: "req-w" };

  it("creates the target record before releasing the source", async () => {
    const res = mockRes();
    await borrowedHandler({ method: "POST", query: { id: "relay" }, body: relayBody }, res);
    assert.equal(res.statusCode, 200);
    const order = calls.map(c => `${c.init?.method} ${c.url.split("/rest/v1/")[1]?.split("?")[0]}`);
    assert.deepEqual(order, ["POST borrowed_items", "PATCH borrowed_items", "PATCH guest_requests"]);
  });

  it("leaves the source untouched when the new record cannot be created", async () => {
    respond = (_url, init) => init?.method === "POST" ? { ok: false, status: 500 } : { ok: true, status: 200 };
    const res = mockRes();
    await borrowedHandler({ method: "POST", query: { id: "relay" }, body: relayBody }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(supabaseWrites("PATCH").length, 0);
  });
});
