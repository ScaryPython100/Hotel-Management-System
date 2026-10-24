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
  relayLiveBorrowedItem,
  clearAllLiveRequests,
  getClientSupabase
} from "../lib/supabaseClient";
import {
  CheckCircle2,
  Trash2,
  AlertCircle,
  Package,
  LayoutGrid,
  RefreshCw
} from "lucide-react";
import { toast, Toaster } from "sonner";
import RoomGroupCard from "../components/staff/RoomGroupCard";
import BorrowedItemsSection from "../components/staff/BorrowedItemsSection";

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

export default function StaffDashboard() {
  const [requests, setRequests] = useState<RoomRequest[]>(() => {
    try {
      const saved = localStorage.getItem("hues_stay_requests");
      if (saved) {
        const parsed = JSON.parse(saved);
        return deduplicateRequests(Array.isArray(parsed) ? parsed : []);
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
  const [activeTab, setActiveTab] = useState<"cards" | "borrowed">("cards");
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  const applyLiveData = (liveReqs: RoomRequest[] | null, liveBor: BorrowedItem[] | null) => {
    if (Array.isArray(liveReqs)) {
      const sorted = [...liveReqs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const deduplicated = deduplicateRequests(sorted);
      setRequests(deduplicated);
      try {
        localStorage.setItem("hues_stay_requests", JSON.stringify(deduplicated));
      } catch (e) {}
    }
    if (Array.isArray(liveBor)) {
      const sorted = [...liveBor].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setBorrowedItems(sorted);
      try {
        localStorage.setItem("hues_stay_borrowed", JSON.stringify(sorted));
      } catch (e) {}
    }
  };

  useEffect(() => {
    const refreshData = async () => {
      try {
        const [liveReqs, liveBor] = await Promise.all([fetchLiveRequests(), fetchLiveBorrowed()]);
        applyLiveData(liveReqs, liveBor);
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
  };

  const handleDelete = async (id: string) => {
    if (!id) return;
    if (!window.confirm("Remove this request from the dashboard view?\n\n(Note: The request record will remain permanently preserved in your Supabase database as required.)")) return;

    const updated = requests.filter(r => r.id !== id);
    setRequests(updated);
    try {
      localStorage.setItem("hues_stay_requests", JSON.stringify(updated));
    } catch (e) {}

    if (await dismissLiveRequest(id)) {
      toast.success("Request removed from dashboard across all devices");
    } else {
      toast.error("Could not remove the request. Please try again.");
    }
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

    const results = await Promise.all(completedIds.map(id => dismissLiveRequest(id)));
    if (results.every(Boolean)) {
      toast.success(`Cleared ${completed.length} completed records across all devices.`);
    } else {
      toast.error("Some completed requests could not be cleared. Please try again.");
    }
  };

  const handleManualSyncToDatabase = async () => {
    setIsManualSyncing(true);
    try {
      const [liveReqs, liveBor] = await Promise.all([fetchLiveRequests(), fetchLiveBorrowed()]);
      if (!liveReqs || !liveBor) throw new Error("Database not reachable");
      applyLiveData(liveReqs, liveBor);
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
    } catch (e) {}
    toast.loading("Clearing database...", { id: "clear-db" });
    const ok = await clearAllLiveRequests();
    if (ok) {
      toast.success("Database and dashboard completely cleared!", { id: "clear-db" });
    } else {
      toast.error("Could not clear the database. Please try again.", { id: "clear-db" });
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
  };

  const handleRelayBorrowedItem = async (
    sourceBorrowedId: string,
    sourceRoom: string,
    targetRoom: string,
    itemName: string,
    targetRequestId?: string,
    currentRelayCount?: number
  ) => {
    const cleanItemName = normalizeReturnableName(itemName);
    const newRelayCount = (currentRelayCount || 0) + 1;
    const now = Date.now();

    // 1. Mark source item returned and add new borrowed record for target room
    const newBorrowedItem: BorrowedItem = {
      id: `borrowed-${now}-${Math.random().toString(36).substr(2, 6)}`,
      roomId: targetRoom,
      itemName: cleanItemName,
      status: "borrowed",
      createdAt: now,
      requestId: targetRequestId,
      relayedFromRoom: sourceRoom,
      relayCount: newRelayCount
    };

    const updatedBorrowed = borrowedItems.map(b => 
      b.id === sourceBorrowedId 
        ? { ...b, status: "returned" as const, returnedAt: now } 
        : b
    );
    const nextBorrowed = [newBorrowedItem, ...updatedBorrowed];
    setBorrowedItems(nextBorrowed);
    try {
      localStorage.setItem("hues_stay_borrowed", JSON.stringify(nextBorrowed));
    } catch (e) {}

    // 2. Mark the waitlist request as completed if targetRequestId exists
    let updatedRequests = requests;
    if (targetRequestId) {
      updatedRequests = requests.map(r => 
        r.id === targetRequestId 
          ? { ...r, status: "completed" as const } 
          : r
      );
      setRequests(updatedRequests);
      try {
        localStorage.setItem("hues_stay_requests", JSON.stringify(updatedRequests));
      } catch (e) {}
    }

    toast.success(
      `Floor-to-Floor Relay complete! ${cleanItemName} handed from Room ${sourceRoom} directly to Room ${targetRoom}.`,
      { duration: 6000 }
    );

    // Call live relay function (syncs Supabase and server API)
    const relayed = await relayLiveBorrowedItem(sourceBorrowedId, sourceRoom, targetRoom, cleanItemName, targetRequestId, currentRelayCount);
    if (!relayed) {
      toast.error(`Relay of ${cleanItemName} to Room ${targetRoom} did not fully save. Please refresh and check the borrowed items.`, { duration: 8000 });
    }
  };

  const pendingRequests = useMemo(() => requests.filter(r => r.status === "pending"), [requests]);
  const completedRequests = useMemo(() => requests.filter(r => r.status === "completed"), [requests]);

  const activeBorrowed = useMemo(() => {
    const map = new Map<string, BorrowedItem>();
    for (const b of borrowedItems) {
      if (b.status !== "borrowed") continue;
      const normalized = normalizeReturnableName(b.itemName);
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
                Real-time room requests, structured cards, and borrowed inventory.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex border border-[#E5E1DB] bg-white p-1 rounded-none shadow-sm">
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

              {activeTab === "cards" && (
                <>
                  <section>
                    <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-[#8C857D] mb-6 flex items-center">
                      <AlertCircle className="w-4 h-4 mr-2 text-[#A68966]" />
                      Needs Attention ({pendingRequests.length})
                    </h3>

                    {pendingRequests.length === 0 ? (
                      <div className="bg-white border border-dashed border-[#E5E1DB] p-12 text-center">
                        <CheckCircle2 className="w-10 h-10 text-[#E5E1DB] mx-auto mb-4" />
                        <p className="text-sm italic text-[#8C857D]">No pending requests right now. Great job!</p>
                      </div>
                    ) : (
                      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                        {pendingRequests.map((req) => (
                          <RoomGroupCard
                            key={`pending-${req.id}`}
                            request={req}
                            onComplete={handleMarkCompleted}
                            onDelete={handleDelete}
                            isPending={true}
                          />
                        ))}
                      </div>
                    )}
                  </section>

                  {completedRequests.length > 0 && (
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
                        {completedRequests.slice(0, 12).map((req) => (
                          <RoomGroupCard
                            key={`completed-${req.id}`}
                            request={req}
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
                  pendingRequests={pendingRequests}
                  onMarkReturned={handleMarkReturned}
                  onDeleteBorrowed={handleDeleteBorrowed}
                  onRelayItem={handleRelayBorrowedItem}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
