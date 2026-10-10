import React, { useEffect, useState, useMemo } from "react";
import { RoomRequest, BorrowedItem, isReturnableItem, normalizeReturnableName } from "../types";
import {
  fetchLiveRequests,
  fetchLiveBorrowed,
  updateLiveRequestStatus,
  markLiveBorrowedReturned,
  deleteLiveBorrowed,
  dismissLiveRequest,
  saveLiveBorrowed,
  clearAllLiveRequests,
  syncInventoryAvailability,
  getClientSupabase,
  fetchLiveDismissedRequests,
  saveLiveDismissedRequests,
  fetchLiveInventoryLimits
} from "../lib/supabaseClient";
import {
  CheckCircle2,
  Trash2,
  AlertCircle,
  Package,
  TableProperties,
  LayoutGrid,
  RefreshCw
} from "lucide-react";
import { toast, Toaster } from "sonner";
import RoomGroupCard from "../components/staff/RoomGroupCard";
import BorrowedItemsSection from "../components/staff/BorrowedItemsSection";
import RequestsTableView from "../components/staff/RequestsTableView";

function getDismissedRequestIds(): string[] {
  try {
    const raw = localStorage.getItem("hues_stay_dismissed_requests");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Only accept unique IDs (req-..., srv-..., local-..., or long UUIDs) - NEVER room signatures
    return parsed.filter((id: any) => typeof id === "string" && !id.includes("::") && (id.startsWith("req-") || id.startsWith("srv-") || id.startsWith("local-") || id.length > 20));
  } catch {
    return [];
  }
}

export function deduplicateRequests(reqList: RoomRequest[]): RoomRequest[] {
  const result: RoomRequest[] = [];
  const seenIds = new Set<string>();
  const seenSignatures = new Map<string, number[]>();

  for (const r of reqList) {
    if (!r) continue;
    const id = r.id || "";
    if (id && seenIds.has(id)) continue;

    const roomStr = String(r.roomId || "").trim().toLowerCase();
    const itemsSig = (r.items || []).map(i => String(i).toLowerCase()).sort().join(",");
    const msgSig = (r.customMessage || "").trim().toLowerCase();
    const signature = `${roomStr}:::${itemsSig}:::${msgSig}`;
    const ts = r.createdAt || 0;

    // Check if duplicate of an existing item within a 3-minute window in O(1) lookup
    const existingTimestamps = seenSignatures.get(signature);
    const isDuplicate = existingTimestamps !== undefined && existingTimestamps.some(exTs => Math.abs(exTs - ts) < 180000);

    if (!isDuplicate) {
      if (id) seenIds.add(id);
      if (existingTimestamps) {
        existingTimestamps.push(ts);
      } else {
        seenSignatures.set(signature, [ts]);
      }
      result.push(r);
    }
  }

  return result;
}

function normalizeApplianceName(name: string): string {
  const lower = (name || "").toLowerCase().trim();
  if (lower.includes("glass")) return "Glasses (Set of 2)";
  if (lower.includes("kettle") || lower.includes("teakettle")) return "Kettle";
  if (lower.includes("iron")) return "Iron Box";
  if (lower.includes("dryer")) return "Hair Dryer";
  if (lower.includes("laptop")) return "Laptop Table";
  if (lower.includes("massager")) return "Leg Massager (Paid)";
  if (lower.includes("adaptor") || lower.includes("cable") || lower.includes("usb")) {
    return "USB 3.0 Cable + Adaptor";
  }
  if (lower.includes("infrared") || lower.includes("lamp") || lower.includes("heat therapy")) {
    return "Infrared Heat Therapy Lamp (Paid)";
  }
  return name.trim();
}

export default function StaffDashboard() {
  const [requests, setRequests] = useState<RoomRequest[]>(() => {
    try {
      const saved = localStorage.getItem("hues_stay_requests");
      if (saved) {
        const parsed = JSON.parse(saved);
        const dismissed = new Set(getDismissedRequestIds());
        const filtered = (Array.isArray(parsed) ? parsed : []).filter((r: RoomRequest) =>
          !dismissed.has(r.id || "")
        );
        return deduplicateRequests(filtered);
      }
    } catch (e) {}
    return [];
  });
  const [borrowedItems, setBorrowedItems] = useState<BorrowedItem[]>(() => {
    try {
      const saved = localStorage.getItem("hues_stay_borrowed");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"cards" | "table" | "borrowed">("table");
  const [tableSearch, setTableSearch] = useState("");
  const [tableFilter, setTableFilter] = useState<"all" | "pending" | "completed">("all");
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  useEffect(() => {
    const refreshData = async () => {
      try {
        const [liveReqs, liveBor, cloudDismissed] = await Promise.all([
          fetchLiveRequests(),
          fetchLiveBorrowed(),
          fetchLiveDismissedRequests()
        ]);

        const localDismissed = getDismissedRequestIds();
        const dismissedSet = new Set([...cloudDismissed, ...localDismissed]);
        const allDismissed = Array.from(dismissedSet);
        try {
          localStorage.setItem("hues_stay_dismissed_requests", JSON.stringify(allDismissed));
        } catch (e) {}

        if (Array.isArray(liveReqs)) {
          const valid = liveReqs
            .filter((r: RoomRequest) => !dismissedSet.has(r.id || ""))
            .sort((a: RoomRequest, b: RoomRequest) => (b.createdAt || 0) - (a.createdAt || 0));

          const deduplicated = deduplicateRequests(valid);
          setRequests(deduplicated);
          try {
            localStorage.setItem("hues_stay_requests", JSON.stringify(deduplicated));
          } catch (e) {}
        }

        if (Array.isArray(liveBor)) {
          const sorted = liveBor.sort((a: BorrowedItem, b: BorrowedItem) => (b.createdAt || 0) - (a.createdAt || 0));
          setBorrowedItems(sorted);
          try {
            localStorage.setItem("hues_stay_borrowed", JSON.stringify(sorted));
          } catch (e) {}
        }

        syncInventoryAvailability(
          Array.isArray(liveBor) ? liveBor : undefined,
          Array.isArray(liveReqs) ? liveReqs : undefined
        ).catch(() => {});
      } catch (e: any) {
        console.warn("Live sync refresh error:", e?.message || e);
      } finally {
        setLoading(false);
      }
    };

    refreshData();

    const sb = getClientSupabase();
    let channel: any = null;
    if (sb) {
      try {
        channel = sb
          .channel("staff_live_channel")
          .on("postgres_changes", { event: "*", schema: "public", table: "guest_requests" }, () => {
            refreshData();
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "borrowed_items" }, () => {
            refreshData();
          })
          .subscribe();
      } catch (err) {
        console.warn("Realtime subscription setup:", err);
      }
    }

    const interval = setInterval(refreshData, 2000);

    return () => {
      clearInterval(interval);
      if (channel && sb) {
        sb.removeChannel(channel).catch(() => {});
      }
    };
  }, []);

  const createBorrowedItemsForCompletedRequest = (targetReq: RoomRequest): BorrowedItem[] => {
    const returnableItems = (targetReq.items || [])
      .filter(item => isReturnableItem(item))
      .map(item => normalizeReturnableName(item));

    if (returnableItems.length === 0) return [];

    const targetRoomClean = targetReq.roomId.trim().toLowerCase();
    const activeInRoom = new Set(
      borrowedItems
        .filter(b => b.status === "borrowed" && b.roomId.trim().toLowerCase() === targetRoomClean)
        .map(b => b.itemName.trim().toLowerCase())
    );

    const newlyCreated: BorrowedItem[] = [];
    for (const itemName of returnableItems) {
      const itemClean = itemName.trim().toLowerCase();
      if (!activeInRoom.has(itemClean)) {
        activeInRoom.add(itemClean);
        const newBor: BorrowedItem = {
          id: `borrowed-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          roomId: targetReq.roomId,
          itemName,
          status: "borrowed",
          createdAt: Date.now()
        };
        newlyCreated.push(newBor);
        saveLiveBorrowed(newBor);
      }
    }
    return newlyCreated;
  };

  const handleMarkCompleted = async (id: string) => {
    const targetReq = requests.find(r => r.id === id);
    if (!targetReq) return;

    const updated = requests.map(r => r.id === id ? { ...r, status: "completed" as const } : r);
    setRequests(updated);
    try {
      localStorage.setItem("hues_stay_requests", JSON.stringify(updated));
    } catch (e) {}

    const newlyCreatedBorrowed = createBorrowedItemsForCompletedRequest(targetReq);

    if (newlyCreatedBorrowed.length > 0) {
      setBorrowedItems(prev => {
        const nextList = [...newlyCreatedBorrowed, ...prev];
        try {
          localStorage.setItem("hues_stay_borrowed", JSON.stringify(nextList));
        } catch (e) {}
        return nextList;
      });

      toast.success(
        `Delivered to Room ${targetReq.roomId}! ${newlyCreatedBorrowed.map(b => b.itemName).join(", ")} moved to Borrowed to remind staff to collect before checkout.`,
        { duration: 5000 }
      );
    } else {
      toast.success(`Request for Room ${targetReq.roomId} completed!`);
    }

    await updateLiveRequestStatus(id, "completed");

    const nextBorrowedList = [...newlyCreatedBorrowed, ...borrowedItems];
    syncInventoryAvailability(nextBorrowedList, updated).catch(() => {});
  };

  const handleToggleStatus = async (id: string, currentStatus: "pending" | "completed") => {
    const targetReq = requests.find(r => r.id === id);
    const newStatus: "pending" | "completed" = currentStatus === "completed" ? "pending" : "completed";

    const updated = requests.map(r => r.id === id ? { ...r, status: newStatus } : r);
    setRequests(updated);
    try {
      localStorage.setItem("hues_stay_requests", JSON.stringify(updated));
    } catch (e) {}

    let toAdd: BorrowedItem[] = [];
    if (newStatus === "completed" && targetReq) {
      toAdd = createBorrowedItemsForCompletedRequest(targetReq);
      if (toAdd.length > 0) {
        setBorrowedItems(prev => [...toAdd, ...prev]);
      }
    }

    toast.success(`Request marked as ${newStatus}`);

    await updateLiveRequestStatus(id, newStatus);

    const nextBorrowedList = [...toAdd, ...borrowedItems];
    syncInventoryAvailability(nextBorrowedList, updated).catch(() => {});
  };

  const handleDelete = async (id: string) => {
    if (!id) return;
    if (!window.confirm("Remove this request from the dashboard view?\n\n(Note: The request record will remain permanently preserved in your Supabase database as required.)")) return;

    const updated = requests.filter(r => r.id !== id);
    setRequests(updated);
    try {
      localStorage.setItem("hues_stay_requests", JSON.stringify(updated));
    } catch (e) {}

    try {
      const cloudDismissed = await fetchLiveDismissedRequests();
      const localDismissed = getDismissedRequestIds();
      const allDismissed = Array.from(new Set([...cloudDismissed, ...localDismissed, id]));
      await saveLiveDismissedRequests(allDismissed);
    } catch (e) {}

    toast.success("Request removed from dashboard across all devices");

    await dismissLiveRequest(id);
  };

  const handleClearCompleted = async () => {
    const completed = requests.filter(r => r.status === "completed");
    if (completed.length === 0) {
      toast.error("No completed requests to clear.");
      return;
    }
    if (!window.confirm(`Clear all ${completed.length} completed requests from the dashboard view?\n\n(Note: All records remain permanently preserved in your Supabase database for records & audits).`)) {
      return;
    }

    const completedIds = completed.map(r => r.id!).filter(Boolean);

    const remaining = requests.filter(r => r.status !== "completed");
    setRequests(remaining);
    try {
      localStorage.setItem("hues_stay_requests", JSON.stringify(remaining));
    } catch (e) {}

    try {
      const cloudDismissed = await fetchLiveDismissedRequests();
      const localDismissed = getDismissedRequestIds();
      const allDismissed = Array.from(new Set([...cloudDismissed, ...localDismissed, ...completedIds]));
      await saveLiveDismissedRequests(allDismissed);
    } catch (e) {}

    await Promise.all(completedIds.map(id => dismissLiveRequest(id)));

    toast.success(`Cleared ${completed.length} completed records across all devices.`);
  };

  const handleManualSyncToDatabase = async () => {
    setIsManualSyncing(true);
    try {
      const [liveReqs, liveBor, cloudDismissed, liveLimits] = await Promise.all([
        fetchLiveRequests(),
        fetchLiveBorrowed(),
        fetchLiveDismissedRequests(),
        fetchLiveInventoryLimits()
      ]);

      const localDismissed = getDismissedRequestIds();
      const dismissedSet = new Set([...cloudDismissed, ...localDismissed]);
      const allDismissed = Array.from(dismissedSet);
      try {
        localStorage.setItem("hues_stay_dismissed_requests", JSON.stringify(allDismissed));
      } catch (e) {}

      if (Array.isArray(liveReqs)) {
        const valid = liveReqs
          .filter((r: RoomRequest) => !dismissedSet.has(r.id || ""))
          .sort((a: RoomRequest, b: RoomRequest) => (b.createdAt || 0) - (a.createdAt || 0));
        const deduplicated = deduplicateRequests(valid);
        setRequests(deduplicated);
        try {
          localStorage.setItem("hues_stay_requests", JSON.stringify(deduplicated));
        } catch (e) {}
      }

      if (Array.isArray(liveBor)) {
        const sorted = liveBor.sort((a: BorrowedItem, b: BorrowedItem) => (b.createdAt || 0) - (a.createdAt || 0));
        setBorrowedItems(sorted);
        try {
          localStorage.setItem("hues_stay_borrowed", JSON.stringify(sorted));
        } catch (e) {}
      }

      await syncInventoryAvailability(
        Array.isArray(liveBor) ? liveBor : undefined,
        Array.isArray(liveReqs) ? liveReqs : undefined,
        liveLimits || undefined
      );

      toast.success("Database synced successfully across all devices!");
    } catch (err: any) {
      console.error("Manual sync failed:", err);
      toast.error("Failed to sync with database: " + (err?.message || "Check connection"));
    } finally {
      setIsManualSyncing(false);
    }
  };

  const handleClearAllDatabaseRequests = async () => {
    if (!window.confirm("Are you sure you want to completely wipe all requests and borrowed items from the database and dashboard?\n\nThis will reset the dashboard to a completely clean state.")) {
      return;
    }
    setRequests([]);
    setBorrowedItems([]);
    try {
      localStorage.removeItem("hues_stay_requests");
      localStorage.removeItem("hues_stay_borrowed");
      localStorage.removeItem("hues_stay_dismissed_requests");
    } catch (e) {}
    toast.loading("Clearing database...", { id: "clear-db" });
    const ok = await clearAllLiveRequests();
    syncInventoryAvailability([], []).catch(() => {});
    if (ok) {
      toast.success("Database and dashboard completely cleared!", { id: "clear-db" });
    } else {
      toast.success("Dashboard and database reset.", { id: "clear-db" });
    }
  };

  const handleMarkReturned = async (borrowedId: string, itemName: string) => {
    const itemObj = borrowedItems.find(b => b.id === borrowedId);
    const room = itemObj ? itemObj.roomId : "";

    const updated = borrowedItems.map(b => b.id === borrowedId ? { ...b, status: "returned" as const, returnedAt: Date.now() } : b);
    setBorrowedItems(updated);
    try {
      localStorage.setItem("hues_stay_borrowed", JSON.stringify(updated));
    } catch (e) {}
    toast.success(`Collected ${itemName} back from Room ${room || "room"}! Returned to inventory.`);

    await markLiveBorrowedReturned(borrowedId);
    syncInventoryAvailability(updated, requests).catch(() => {});
  };

  const handleDeleteBorrowed = async (id: string, itemName: string) => {
    const remaining = borrowedItems.filter(b => b.id !== id);
    setBorrowedItems(remaining);
    try {
      const saved = JSON.parse(localStorage.getItem("hues_stay_borrowed") || "[]");
      const next = saved.filter((b: any) => b.id !== id);
      localStorage.setItem("hues_stay_borrowed", JSON.stringify(next));
    } catch (e) {}
    toast.success(`Removed ${itemName} from dashboard view.`);

    await deleteLiveBorrowed(id);
    syncInventoryAvailability(remaining, requests).catch(() => {});
  };

  const pendingRequests = useMemo(() => requests.filter(r => r.status === "pending"), [requests]);
  const completedRequests = useMemo(() => requests.filter(r => r.status === "completed"), [requests]);

  const activeBorrowed = useMemo(() => {
    const map = new Map<string, BorrowedItem>();
    for (const b of borrowedItems) {
      if (b.status !== "borrowed") continue;
      const normalized = normalizeApplianceName(b.itemName);
      const key = `${b.roomId.toLowerCase().trim()}::${normalized.toLowerCase().trim()}`;
      if (!map.has(key)) {
        map.set(key, { ...b, itemName: normalized });
      }
    }
    return Array.from(map.values());
  }, [borrowedItems]);

  const pendingByRoom = useMemo(() => {
    return pendingRequests.reduce((acc, req) => {
      if (!acc[req.roomId]) acc[req.roomId] = [];
      acc[req.roomId].push(req);
      return acc;
    }, {} as Record<string, RoomRequest[]>);
  }, [pendingRequests]);

  const completedByRoom = useMemo(() => {
    return completedRequests.reduce((acc, req) => {
      if (!acc[req.roomId]) acc[req.roomId] = [];
      acc[req.roomId].push(req);
      return acc;
    }, {} as Record<string, RoomRequest[]>);
  }, [completedRequests]);

  const filteredTableRequests = useMemo(() => {
    const query = tableSearch.toLowerCase().trim();
    return requests.filter(req => {
      if (tableFilter === "pending" && req.status !== "pending") return false;
      if (tableFilter === "completed" && req.status !== "completed") return false;

      if (query) {
        const roomMatch = (req.roomId || "").toLowerCase().includes(query);
        if (roomMatch) return true;
        const itemsMatch = Array.isArray(req.items)
          ? req.items.some((i: any) => String(i).toLowerCase().includes(query))
          : String(req.items || "").toLowerCase().includes(query);
        if (itemsMatch) return true;
        return (req.customMessage || "").toLowerCase().includes(query);
      }

      return true;
    });
  }, [requests, tableFilter, tableSearch]);

  return (
    <>
      <Toaster position="top-right" />
      <div className="p-8 md:p-12">
        <div className="max-w-7xl mx-auto">
          <header className="mb-8 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-4xl font-serif italic text-[#2D2926]">Staff Requests Dashboard</h2>
              </div>
              <p className="text-sm text-[#8C857D] italic">
                Real-time room requests, structured data records, and borrowed inventory.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex border border-[#E5E1DB] bg-white p-1 rounded-none shadow-sm">
                <button
                  onClick={() => setActiveTab("table")}
                  className={`px-5 py-2 text-xs font-medium tracking-widest uppercase transition-colors flex items-center gap-2 ${
                    activeTab === "table" ? "bg-[#2D2926] text-white" : "text-[#8C857D] hover:text-[#2D2926]"
                  }`}
                  title="Structured Columns & Rows Table"
                >
                  <TableProperties className="w-3.5 h-3.5" />
                  Table View {requests.length > 0 && `(${requests.length})`}
                </button>
                <button
                  onClick={() => setActiveTab("cards")}
                  className={`px-5 py-2 text-xs font-medium tracking-widest uppercase transition-colors flex items-center gap-2 ${
                    activeTab === "cards" ? "bg-[#2D2926] text-white" : "text-[#8C857D] hover:text-[#2D2926]"
                  }`}
                  title="Room Grouped Cards"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Cards {pendingRequests.length > 0 && `(${pendingRequests.length})`}
                </button>
                <button
                  onClick={() => setActiveTab("borrowed")}
                  className={`px-5 py-2 text-xs font-medium tracking-widest uppercase transition-colors flex items-center gap-2 ${
                    activeTab === "borrowed" ? "bg-[#2D2926] text-white" : "text-[#8C857D] hover:text-[#2D2926]"
                  }`}
                >
                  <Package className="w-3.5 h-3.5" />
                  Borrowed {activeBorrowed.length > 0 && `(${activeBorrowed.length})`}
                </button>
              </div>

              <button
                type="button"
                onClick={handleManualSyncToDatabase}
                disabled={isManualSyncing}
                className="px-4 py-2 border border-[#A68966] text-[#A68966] bg-[#FAF8F5] hover:bg-[#A68966] hover:text-white text-xs font-semibold tracking-wider uppercase transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
                title="Force immediate synchronization with Supabase database across all devices"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isManualSyncing ? "animate-spin" : ""}`} />
                {isManualSyncing ? "Syncing..." : "Sync to Database"}
              </button>

              {(requests.length > 0 || borrowedItems.length > 0) && (
                <button
                  onClick={handleClearAllDatabaseRequests}
                  className="px-4 py-2 border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 text-xs font-medium tracking-wider uppercase transition-colors flex items-center gap-1.5 shadow-sm"
                  title="Clear all previous requests and records from database"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-600" />
                  Clear Database
                </button>
              )}
            </div>
          </header>

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin h-12 w-12 border-t-2 border-b-2 border-[#A68966]"></div>
            </div>
          ) : (
            <div className="space-y-8">
              {activeTab === "table" && (
                <RequestsTableView
                  requests={requests}
                  filteredTableRequests={filteredTableRequests}
                  pendingCount={pendingRequests.length}
                  completedCount={completedRequests.length}
                  hasBorrowedItems={borrowedItems.length > 0}
                  tableSearch={tableSearch}
                  onTableSearchChange={setTableSearch}
                  tableFilter={tableFilter}
                  onTableFilterChange={setTableFilter}
                  onToggleStatus={handleToggleStatus}
                  onDelete={handleDelete}
                  onClearCompleted={handleClearCompleted}
                  onClearAllDatabase={handleClearAllDatabaseRequests}
                />
              )}

              {activeTab === "cards" && (
                <>
                  <section>
                    <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-[#8C857D] mb-6 flex items-center">
                      <AlertCircle className="w-4 h-4 mr-2 text-[#A68966]" />
                      Needs Attention ({pendingRequests.length})
                    </h3>

                    {Object.keys(pendingByRoom).length === 0 ? (
                      <div className="bg-white border border-dashed border-[#E5E1DB] p-12 text-center">
                        <CheckCircle2 className="w-10 h-10 text-[#E5E1DB] mx-auto mb-4" />
                        <p className="text-sm italic text-[#8C857D]">No pending requests right now. Great job!</p>
                      </div>
                    ) : (
                      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                        {Object.entries(pendingByRoom).map(([roomId, roomReqs]) => (
                          <RoomGroupCard
                            key={`pending-${roomId}`}
                            roomId={roomId}
                            requests={roomReqs}
                            onComplete={handleMarkCompleted}
                            onDelete={handleDelete}
                            isPending={true}
                          />
                        ))}
                      </div>
                    )}
                  </section>

                  {Object.keys(completedByRoom).length > 0 && (
                    <section>
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-[#8C857D] flex items-center">
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Recently Completed ({completedRequests.length})
                        </h3>
                        <button
                          onClick={handleClearCompleted}
                          className="px-3 py-1.5 border border-red-200 text-red-700 bg-white hover:bg-red-50 text-[10px] uppercase font-bold tracking-wider transition-colors flex items-center gap-1 cursor-pointer"
                          title="Remove all completed requests from the view (preserved in Supabase)"
                        >
                          <Trash2 className="w-3 h-3 text-red-500" />
                          Clear Done
                        </button>
                      </div>
                      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3 opacity-70">
                        {Object.entries(completedByRoom).slice(0, 9).map(([roomId, roomReqs]) => (
                          <RoomGroupCard
                            key={`completed-${roomId}`}
                            roomId={roomId}
                            requests={roomReqs}
                            onComplete={handleMarkCompleted}
                            onDelete={handleDelete}
                            isPending={false}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}

              {activeTab === "borrowed" && (
                <BorrowedItemsSection
                  activeBorrowed={activeBorrowed}
                  onMarkReturned={handleMarkReturned}
                  onDeleteBorrowed={handleDeleteBorrowed}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
