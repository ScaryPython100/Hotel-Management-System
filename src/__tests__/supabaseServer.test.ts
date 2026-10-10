import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  saveRequestToSupabase,
  updateRequestStatusInSupabase,
  upsertInventoryInSupabase,
  setSupabaseClientForTesting,
  SUPABASE_TABLE_NAME,
  SUPABASE_INVENTORY_TABLE
} from "../lib/supabaseServer";

describe("src/lib/supabaseServer.ts functions", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    setSupabaseClientForTesting(null);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setSupabaseClientForTesting(null);
  });

  describe("saveRequestToSupabase", () => {
    it("returns failure when Supabase environment variables are missing", async () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_ANON_KEY;
      delete process.env.SUPABASE_KEY;
      setSupabaseClientForTesting(null);

      const res = await saveRequestToSupabase({
        id: "req-1",
        roomId: "101",
        items: ["Kettle"],
        customMessage: "Please send quickly",
        status: "pending",
        createdAt: 1700000000000
      });

      assert.equal(res.success, false);
      assert.match(res.error || "", /Supabase not configured/);
    });

    it("upserts a request record with normalized payload and returns success", async () => {
      let capturedTable = "";
      let capturedPayload: any = null;
      let capturedOptions: any = null;

      const mockClient: any = {
        from(table: string) {
          capturedTable = table;
          return {
            async upsert(payload: any, options: any) {
              capturedPayload = payload;
              capturedOptions = options;
              return { error: null };
            }
          };
        }
      };
      setSupabaseClientForTesting(mockClient);

      const res = await saveRequestToSupabase({
        id: "req-101",
        roomId: "101",
        items: ["Iron Box", "Kettle"],
        customMessage: "Guest Name: Alice",
        status: "pending",
        createdAt: 1700000000000
      });

      assert.equal(res.success, true);
      assert.equal(capturedTable, SUPABASE_TABLE_NAME);
      assert.equal(capturedPayload.id, "req-101");
      assert.equal(capturedPayload.room_id, "101");
      assert.deepEqual(capturedPayload.items, ["Iron Box", "Kettle"]);
      assert.equal(capturedPayload.custom_message, "Guest Name: Alice");
      assert.equal(capturedPayload.status, "pending");
      assert.equal(capturedPayload.created_at, 1700000000000);
      assert.deepEqual(capturedOptions, { onConflict: "id" });
    });

    it("returns error message when Supabase upsert returns an error", async () => {
      const mockClient: any = {
        from() {
          return {
            async upsert() {
              return { error: { message: "Database constraint violation" } };
            }
          };
        }
      };
      setSupabaseClientForTesting(mockClient);

      const res = await saveRequestToSupabase({
        id: "req-err",
        roomId: "102",
        items: [],
        customMessage: "",
        status: "pending",
        createdAt: 1700000000000
      });

      assert.equal(res.success, false);
      assert.equal(res.error, "Database constraint violation");
    });
  });

  describe("updateRequestStatusInSupabase", () => {
    it("returns failure when Supabase is not configured", async () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_ANON_KEY;
      delete process.env.SUPABASE_KEY;
      setSupabaseClientForTesting(null);

      const res = await updateRequestStatusInSupabase("req-1", "completed");
      assert.equal(res.success, false);
      assert.equal(res.error, "Supabase not configured");
    });

    it("updates status for the matching request id and returns success", async () => {
      let capturedTable = "";
      let capturedUpdate: any = null;
      let capturedEq: [string, string] | null = null;

      const mockClient: any = {
        from(table: string) {
          capturedTable = table;
          return {
            update(values: any) {
              capturedUpdate = values;
              return {
                async eq(col: string, val: string) {
                  capturedEq = [col, val];
                  return { error: null };
                }
              };
            }
          };
        }
      };
      setSupabaseClientForTesting(mockClient);

      const res = await updateRequestStatusInSupabase("req-202", "completed");
      assert.equal(res.success, true);
      assert.equal(capturedTable, SUPABASE_TABLE_NAME);
      assert.equal(capturedUpdate.status, "completed");
      assert.equal(typeof capturedUpdate.updated_at, "string");
      assert.deepEqual(capturedEq, ["id", "req-202"]);
    });

    it("returns failure when Supabase update fails", async () => {
      const mockClient: any = {
        from() {
          return {
            update() {
              return {
                async eq() {
                  return { error: { message: "Update failed" } };
                }
              };
            }
          };
        }
      };
      setSupabaseClientForTesting(mockClient);

      const res = await updateRequestStatusInSupabase("req-202", "completed");
      assert.equal(res.success, false);
      assert.equal(res.error, "Update failed");
    });
  });

  describe("upsertInventoryInSupabase", () => {
    it("returns failure when Supabase is not configured", async () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.SUPABASE_ANON_KEY;
      delete process.env.SUPABASE_KEY;
      setSupabaseClientForTesting(null);

      const res = await upsertInventoryInSupabase({ name: "Kettle", totalStock: 5 });
      assert.equal(res.success, false);
      assert.equal(res.error, "Supabase not configured");
    });

    it("upserts inventory item, normalizes id and stock, and maps returned record", async () => {
      let capturedTable = "";
      let capturedPayload: any = null;
      let capturedOptions: any = null;

      const mockClient: any = {
        from(table: string) {
          capturedTable = table;
          return {
            upsert(payload: any, options: any) {
              capturedPayload = payload;
              capturedOptions = options;
              return {
                select() {
                  return {
                    async single() {
                      return {
                        data: {
                          id: payload.id,
                          name: payload.name,
                          category: payload.category,
                          total_stock: payload.total_stock,
                          taken: payload.taken ?? 2,
                          updated_at: payload.updated_at
                        },
                        error: null
                      };
                    }
                  };
                }
              };
            }
          };
        }
      };
      setSupabaseClientForTesting(mockClient);

      const res = await upsertInventoryInSupabase({
        name: "  Kettle  ",
        totalStock: 5,
        taken: 2
      });

      assert.equal(res.success, true);
      assert.equal(capturedTable, SUPABASE_INVENTORY_TABLE);
      assert.equal(capturedPayload.id, "inv-kettle");
      assert.equal(capturedPayload.name, "Kettle");
      assert.equal(capturedPayload.category, "Item");
      assert.equal(capturedPayload.total_stock, 5);
      assert.equal(capturedPayload.taken, 2);
      assert.deepEqual(capturedOptions, { onConflict: "name" });
      assert.ok(res.data);
      assert.equal(res.data.name, "Kettle");
      assert.equal(res.data.totalStock, 5);
      assert.equal(res.data.taken, 2);
      assert.equal(res.data.available, 3);
    });

    it("returns error when Supabase inventory upsert returns an error", async () => {
      const mockClient: any = {
        from() {
          return {
            upsert() {
              return {
                select() {
                  return {
                    async single() {
                      return { data: null, error: { message: "Inventory table error" } };
                    }
                  };
                }
              };
            }
          };
        }
      };
      setSupabaseClientForTesting(mockClient);

      const res = await upsertInventoryInSupabase({ name: "Iron Box", totalStock: 1 });
      assert.equal(res.success, false);
      assert.equal(res.error, "Inventory table error");
    });
  });
});
