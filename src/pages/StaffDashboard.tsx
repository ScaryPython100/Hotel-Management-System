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
  getClientSupabase 
} from "../lib/supabaseClient";
import { formatDistanceToNow } from "date-fns";
import { 
  CheckCircle2, 
  Clock, 
  Trash2, 
  BedDouble, 
  AlertCircle, 
  Package, 
  TableProperties, 
  LayoutGrid, 
  Search, 
  Filter,
  Check,
  RotateCcw,
  History,
  ArchiveRestore
} from "lucide-react";
import toast, { Toaster } from "react-hot-toast";

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

function deduplicateRequests(reqList: RoomRequest[]): RoomRequest[] {
  const result: RoomRequest[] = [];
  const seenIds = new Set<string>();

  for (const r of reqList) {
    if (!r) continue;
    const id = r.id || "";
    if (id && seenIds.has(id)) continue;

    const roomStr = String(r.roomId || "").trim().toLowerCase();
    const itemsSig = (r.items || []).slice().sort().join(',').toLowerCase();
    const msgSig = (r.customMessage || "").trim().toLowerCase();

    // Check if duplicate of an existing item within a 3-minute window
    const isDuplicate = result.some(existing => {
      if (String(existing.roomId || "").trim().toLowerCase() !== roomStr) return false;
      const exItems = (existing.items || []).slice().sort().join(',').toLowerCase();
      if (exItems !== itemsSig) return false;
      const exMsg = (existing.customMessage || "").trim().toLowerCase();
      if (exMsg !== msgSig) return false;
      const timeDiff = Math.abs((existing.createdAt || 0) - (r.createdAt || 0));
      return timeDiff < 180000;
    });

    if (!isDuplicate) {
      if (id) seenIds.add(id);
      result.push(r);
    }
  }

  return result;
}

function normalizeApplianceName(name: string): string {
  const lower = (name || "").toLowerCase().trim();
  if (lower.includes("glass")) return "Glasses (Set of 2)";
  if (lower.includes("kettle") || lower.includes("teakettle")) return "Teakettle";
  if (lower.includes("iron")) return "Iron Box";
  if (lower.includes("dryer")) return "Hair Dryer";
  if (lower.includes("laptop")) return "Laptop Table";
  if (lower.includes("massager")) return "Leg Massager (Paid)";
  if (lower.includes("adaptor") || lower.includes("cable")) {
    if (lower.includes("3.0")) return "USB 3.0 Adaptor + Cable";
    return "USB 2.0 Adaptor + Cable";
  }
  return name.trim();
}

export default function StaffDashboard() {
  const [requests, setRequests] = useState<RoomRequest[]>(() => {
    try {
      const saved = localStorage.getItem("hues_stay_requests");
      if (saved) {
        const parsed = JSON.parse(saved);
        const dismissed = getDismissedRequestIds();
        const filtered = (Array.isArray(parsed) ? parsed : []).filter((r: RoomRequest) => 
          !dismissed.includes(r.id || "")
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
  const [activeTab, setActiveTab] = useState<'cards' | 'table' | 'borrowed'>('table');
  const [tableSearch, setTableSearch] = useState('');
  const [tableFilter, setTableFilter] = useState<'all' | 'pending' | 'completed'>('all');

  useEffect(() => {
    // Shared single source of truth across all devices (Supabase live queries with API fallback)
    const refreshData = async () => {
      try {
        const [liveReqs, liveBor] = await Promise.all([
          fetchLiveRequests(),
          fetchLiveBorrowed()
        ]);

        if (Array.isArray(liveReqs) && liveReqs.length > 0) {
          const dismissed = getDismissedRequestIds();
          const valid = liveReqs
            .filter((r: RoomRequest) => !dismissed.includes(r.id || ""))
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
      } catch (e: any) {
        console.warn("Live sync refresh error:", e?.message || e);
      } finally {
        setLoading(false);
      }
    };

    // Initial load
    refreshData();

    // Realtime Supabase change listener across all laptops, phones, and tabs
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

    // Fast 2-second polling fallback ensures guaranteed synchronization
    const interval = setInterval(refreshData, 2000);

    return () => {
      clearInterval(interval);
      if (channel && sb) {
        sb.removeChannel(channel).catch(() => {});
      }
    };
  }, []);

  const handleMarkCompleted = async (id: string) => {
    const targetReq = requests.find(r => r.id === id);
    if (!targetReq) return;

    // 1. Optimistic local update (instant)
    const updated = requests.map(r => r.id === id ? { ...r, status: "completed" as const } : r);
    setRequests(updated);
    try {
      localStorage.setItem("hues_stay_requests", JSON.stringify(updated));
    } catch (e) {}

    // 2. Identify returnable appliances (Teakettle, Iron Box, Hair Dryer, Laptop Table, Glasses, USB Adaptor, etc.)
    const returnableItems = (targetReq.items || [])
      .filter(item => isReturnableItem(item))
      .map(item => normalizeReturnableName(item));

    const newlyCreatedBorrowed: BorrowedItem[] = [];

    if (returnableItems.length > 0) {
      for (const itemName of returnableItems) {
        const alreadyActive = borrowedItems.some(
          b => b.roomId.trim().toLowerCase() === targetReq.roomId.trim().toLowerCase() &&
               b.itemName.trim().toLowerCase() === itemName.trim().toLowerCase() &&
               b.status === "borrowed"
        );

        if (!alreadyActive) {
          const newBor: BorrowedItem = {
            id: `borrowed-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            roomId: targetReq.roomId,
            itemName,
            status: "borrowed",
            createdAt: Date.now()
          };
          newlyCreatedBorrowed.push(newBor);
          saveLiveBorrowed(newBor);
        }
      }

      if (newlyCreatedBorrowed.length > 0) {
        setBorrowedItems(prev => {
          const nextList = [...newlyCreatedBorrowed, ...prev];
          try {
            localStorage.setItem("hues_stay_borrowed", JSON.stringify(nextList));
          } catch (e) {}
          return nextList;
        });
      }

      toast.success(
        `Delivered to Room ${targetReq.roomId}! ${returnableItems.join(", ")} moved to Borrowed to remind staff to collect before checkout.`,
        { duration: 5000 }
      );
    } else {
      toast.success(`Request for Room ${targetReq.roomId} completed!`);
    }

    // 3. Update status in live Supabase and server
    await updateLiveRequestStatus(id, "completed");
  };

  const handleToggleStatus = async (id: string, currentStatus: "pending" | "completed") => {
    const targetReq = requests.find(r => r.id === id);
    const newStatus: "pending" | "completed" = currentStatus === "completed" ? "pending" : "completed";
    
    // 1. Optimistic local update
    const updated = requests.map(r => r.id === id ? { ...r, status: newStatus } : r);
    setRequests(updated);
    try {
      localStorage.setItem("hues_stay_requests", JSON.stringify(updated));
    } catch (e) {}

    // 2. If marking completed, also track returnable appliances
    if (newStatus === "completed" && targetReq && Array.isArray(targetReq.items)) {
      const returnables = targetReq.items
        .filter(item => isReturnableItem(item))
        .map(item => normalizeReturnableName(item));

      const toAdd: BorrowedItem[] = [];
      for (const item of returnables) {
        const alreadyActive = borrowedItems.some(
          b => b.roomId.trim().toLowerCase() === targetReq.roomId.trim().toLowerCase() &&
               b.itemName.trim().toLowerCase() === item.trim().toLowerCase() &&
               b.status === "borrowed"
        );
        if (!alreadyActive) {
          const newBor: BorrowedItem = {
            id: `borrowed-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            roomId: targetReq.roomId,
            itemName: item,
            status: "borrowed",
            createdAt: Date.now()
          };
          toAdd.push(newBor);
          saveLiveBorrowed(newBor);
        }
      }
      if (toAdd.length > 0) {
        setBorrowedItems(prev => [...toAdd, ...prev]);
      }
    }

    toast.success(`Request marked as ${newStatus}`);

    // 3. Persist to live Supabase and server
    await updateLiveRequestStatus(id, newStatus);
  };

  const handleDelete = async (id: string) => {
    if (!id) return;
    if (!window.confirm("Remove this request from the dashboard view?\n\n(Note: The request record will remain permanently preserved in your Supabase database as required.)")) return;

    // Save ONLY the specific request ID to dismissed list
    try {
      const dismissed = getDismissedRequestIds();
      if (!dismissed.includes(id)) {
        dismissed.push(id);
        localStorage.setItem("hues_stay_dismissed_requests", JSON.stringify(dismissed));
      }
    } catch (e) {}

    // Optimistic local update (instant)
    const updated = requests.filter(r => r.id !== id);
    setRequests(updated);
    try {
      localStorage.setItem("hues_stay_requests", JSON.stringify(updated));
    } catch (e) {}
    toast.success("Request removed from dashboard (preserved in Supabase)");

    // Dismiss in live Supabase and server
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
    try {
      const dismissed = getDismissedRequestIds();
      completedIds.forEach(id => {
        if (!dismissed.includes(id)) dismissed.push(id);
      });
      localStorage.setItem("hues_stay_dismissed_requests", JSON.stringify(dismissed));
    } catch (e) {}

    const remaining = requests.filter(r => r.status !== "completed");
    setRequests(remaining);
    try {
      localStorage.setItem("hues_stay_requests", JSON.stringify(remaining));
    } catch (e) {}

    // Tell Supabase to soft-delete each completed item
    for (const id of completedIds) {
      dismissLiveRequest(id);
    }

    toast.success(`Cleared ${completed.length} completed records from view.`);
  };

  const handleMarkReturned = async (borrowedId: string, itemName: string) => {
    const itemObj = borrowedItems.find(b => b.id === borrowedId);
    const room = itemObj ? itemObj.roomId : "";

    // 1. Optimistic local update (instant)
    const updated = borrowedItems.map(b => b.id === borrowedId ? { ...b, status: "returned" as const, returnedAt: Date.now() } : b);
    setBorrowedItems(updated);
    try {
      localStorage.setItem("hues_stay_borrowed", JSON.stringify(updated));
    } catch (e) {}
    toast.success(`Collected ${itemName} back from Room ${room || 'room'}! Returned to inventory.`);

    // 2. Automatically sync to live Supabase and backend
    await markLiveBorrowedReturned(borrowedId);
  };

  const handleDeleteBorrowed = async (id: string, itemName: string) => {
    setBorrowedItems(prev => prev.filter(b => b.id !== id));
    try {
      const saved = JSON.parse(localStorage.getItem("hues_stay_borrowed") || "[]");
      const next = saved.filter((b: any) => b.id !== id);
      localStorage.setItem("hues_stay_borrowed", JSON.stringify(next));
    } catch (e) {}
    toast.success(`Removed ${itemName} from dashboard view.`);
    
    // Delete in live Supabase and backend
    await deleteLiveBorrowed(id);
  };

  const pendingRequests = requests.filter(r => r.status === "pending");
  const completedRequests = requests.filter(r => r.status === "completed");

  const activeBorrowed = useMemo(() => {
    const map = new Map<string, BorrowedItem>();
    borrowedItems
      .filter(b => b.status === "borrowed")
      .forEach(b => {
        const normalized = normalizeApplianceName(b.itemName);
        const key = `${b.roomId.toLowerCase().trim()}::${normalized.toLowerCase().trim()}`;
        if (!map.has(key)) {
          map.set(key, { ...b, itemName: normalized });
        }
      });
    return Array.from(map.values());
  }, [borrowedItems]);

  const pendingByRoom = pendingRequests.reduce((acc, req) => {
    if (!acc[req.roomId]) acc[req.roomId] = [];
    acc[req.roomId].push(req);
    return acc;
  }, {} as Record<string, RoomRequest[]>);

  const completedByRoom = completedRequests.reduce((acc, req) => {
    if (!acc[req.roomId]) acc[req.roomId] = [];
    acc[req.roomId].push(req);
    return acc;
  }, {} as Record<string, RoomRequest[]>);

  // Filtered requests for the table view
  const filteredTableRequests = useMemo(() => {
    return requests.filter(req => {
      // Status filter
      if (tableFilter === 'pending' && req.status !== 'pending') return false;
      if (tableFilter === 'completed' && req.status !== 'completed') return false;

      // Search filter
      if (tableSearch.trim()) {
        const query = tableSearch.toLowerCase().trim();
        const roomMatch = (req.roomId || "").toLowerCase().includes(query);
        const itemsMatch = Array.isArray(req.items) 
          ? req.items.some((i: any) => String(i).toLowerCase().includes(query))
          : String(req.items || "").toLowerCase().includes(query);
        const messageMatch = (req.customMessage || "").toLowerCase().includes(query);
        return roomMatch || itemsMatch || messageMatch;
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
            
            {/* View & Tab Switcher */}
            <div className="flex border border-[#E5E1DB] bg-white p-1 rounded-none shadow-sm">
              <button 
                onClick={() => setActiveTab('table')}
                className={`px-5 py-2 text-xs font-medium tracking-widest uppercase transition-colors flex items-center gap-2 ${
                  activeTab === 'table' ? 'bg-[#2D2926] text-white' : 'text-[#8C857D] hover:text-[#2D2926]'
                }`}
                title="Structured Columns & Rows Table"
              >
                <TableProperties className="w-3.5 h-3.5" />
                Table View {requests.length > 0 && `(${requests.length})`}
              </button>
              <button 
                onClick={() => setActiveTab('cards')}
                className={`px-5 py-2 text-xs font-medium tracking-widest uppercase transition-colors flex items-center gap-2 ${
                  activeTab === 'cards' ? 'bg-[#2D2926] text-white' : 'text-[#8C857D] hover:text-[#2D2926]'
                }`}
                title="Room Grouped Cards"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Cards {pendingRequests.length > 0 && `(${pendingRequests.length})`}
              </button>
              <button 
                onClick={() => setActiveTab('borrowed')}
                className={`px-5 py-2 text-xs font-medium tracking-widest uppercase transition-colors flex items-center gap-2 ${
                  activeTab === 'borrowed' ? 'bg-[#2D2926] text-white' : 'text-[#8C857D] hover:text-[#2D2926]'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                Borrowed {activeBorrowed.length > 0 && `(${activeBorrowed.length})`}
              </button>
            </div>
          </header>

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin h-12 w-12 border-t-2 border-b-2 border-[#A68966]"></div>
            </div>
          ) : (
            <div className="space-y-8">
              {/* TABLE VIEW (COLUMNS AND ROWS) */}
              {activeTab === 'table' && (
                <div className="bg-white border border-[#E5E1DB] shadow-sm">
                  {/* Table Toolbar */}
                  <div className="p-4 border-b border-[#E5E1DB] flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#FAF8F5]">
                    <div className="flex items-center gap-3 flex-1 max-w-md">
                      <div className="relative w-full">
                        <Search className="w-4 h-4 text-[#8C857D] absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          placeholder="Search room, amenity, message..."
                          value={tableSearch}
                          onChange={(e) => setTableSearch(e.target.value)}
                          className="w-full pl-9 pr-4 py-2 border border-[#E5E1DB] bg-white text-xs text-[#2D2926] focus:outline-none focus:border-[#A68966]"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-widest text-[#8C857D] font-bold flex items-center mr-1">
                        <Filter className="w-3 h-3 mr-1" />
                        Status:
                      </span>
                      <div className="inline-flex border border-[#E5E1DB] bg-white p-0.5 text-xs">
                        <button
                          onClick={() => setTableFilter('all')}
                          className={`px-3 py-1 font-medium text-[11px] uppercase tracking-wider transition-colors ${
                            tableFilter === 'all' ? 'bg-[#A68966] text-white' : 'text-[#8C857D] hover:text-[#2D2926]'
                          }`}
                        >
                          All ({requests.length})
                        </button>
                        <button
                          onClick={() => setTableFilter('pending')}
                          className={`px-3 py-1 font-medium text-[11px] uppercase tracking-wider transition-colors ${
                            tableFilter === 'pending' ? 'bg-[#A68966] text-white' : 'text-[#8C857D] hover:text-[#2D2926]'
                          }`}
                        >
                          Pending ({pendingRequests.length})
                        </button>
                        <button
                          onClick={() => setTableFilter('completed')}
                          className={`px-3 py-1 font-medium text-[11px] uppercase tracking-wider transition-colors ${
                            tableFilter === 'completed' ? 'bg-[#A68966] text-white' : 'text-[#8C857D] hover:text-[#2D2926]'
                          }`}
                        >
                          Done ({completedRequests.length})
                        </button>
                      </div>

                      {completedRequests.length > 0 && (
                        <button
                          onClick={handleClearCompleted}
                          className="px-3 py-1.5 border border-red-200 text-red-700 bg-white hover:bg-red-50 text-[10px] uppercase font-bold tracking-wider transition-colors flex items-center gap-1"
                          title="Remove all completed requests from the view (preserved in Supabase)"
                        >
                          <Trash2 className="w-3 h-3 text-red-500" />
                          Clear Done ({completedRequests.length})
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Table Content */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[#E5E1DB] bg-[#F4F1EC] text-[#2D2926] uppercase text-[10px] tracking-wider font-semibold">
                          <th className="py-3 px-4">Room Number</th>
                          <th className="py-3 px-4">Requests Asked</th>
                          <th className="py-3 px-4">Message</th>
                          <th className="py-3 px-4">Date</th>
                          <th className="py-3 px-4">Day</th>
                          <th className="py-3 px-4">Time</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5E1DB]">
                        {filteredTableRequests.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-12 text-center text-[#8C857D] italic bg-white">
                              No requests match your current filters.
                            </td>
                          </tr>
                        ) : (
                          filteredTableRequests.map((req) => {
                            const dateObj = req.createdAt ? new Date(req.createdAt) : new Date();
                            const isPending = req.status === "pending";

                            return (
                              <tr 
                                key={req.id} 
                                className={`transition-colors hover:bg-[#FAF8F5] ${
                                  isPending ? "bg-white" : "bg-[#FAF8F5]/40 opacity-75"
                                }`}
                              >
                                {/* Room Number */}
                                <td className="py-3 px-4 font-mono font-bold text-[#2D2926]">
                                  <span className="inline-flex items-center px-2 py-1 bg-[#F4F1EC] border border-[#E5E1DB] rounded-none">
                                    <BedDouble className="w-3.5 h-3.5 mr-1.5 text-[#A68966]" />
                                    {req.roomId || "N/A"}
                                  </span>
                                </td>

                                {/* Requests Asked */}
                                <td className="py-3 px-4 text-[#2D2926]">
                                  {req.items && req.items.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {req.items.map((item, idx) => (
                                        <span 
                                          key={idx} 
                                          className="px-2 py-0.5 bg-[#F9F7F4] border border-[#E5E1DB] text-[10px] font-medium uppercase tracking-wider text-[#2D2926]"
                                        >
                                          {item}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-[#8C857D] italic">—</span>
                                  )}
                                </td>

                                {/* Message */}
                                <td className="py-3 px-4 text-[#2D2926] max-w-xs">
                                  {req.customMessage ? (
                                    <span className="italic text-[#555] block truncate" title={req.customMessage}>
                                      "{req.customMessage}"
                                    </span>
                                  ) : (
                                    <span className="text-[#8C857D] italic">—</span>
                                  )}
                                </td>

                                {/* Date */}
                                <td className="py-3 px-4 text-[#555] whitespace-nowrap font-mono">
                                  {dateObj.toLocaleDateString()}
                                </td>

                                {/* Day */}
                                <td className="py-3 px-4 text-[#555] whitespace-nowrap">
                                  {dateObj.toLocaleDateString(undefined, { weekday: 'long' })}
                                </td>

                                {/* Time */}
                                <td className="py-3 px-4 text-[#555] whitespace-nowrap font-mono">
                                  {dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </td>

                                {/* Status */}
                                <td className="py-3 px-4 whitespace-nowrap">
                                  <button
                                    onClick={() => handleToggleStatus(req.id!, req.status || "pending")}
                                    className={`inline-flex items-center px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors border ${
                                      isPending
                                        ? "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                                        : "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                                    }`}
                                    title="Click to toggle status"
                                  >
                                    {isPending ? (
                                      <>
                                        <Clock className="w-3 h-3 mr-1 text-amber-600" />
                                        Pending
                                      </>
                                    ) : (
                                      <>
                                        <Check className="w-3 h-3 mr-1 text-emerald-600" />
                                        Completed
                                      </>
                                    )}
                                  </button>
                                </td>

                                {/* Actions */}
                                <td className="py-3 px-4 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1.5">
                                    <button
                                      onClick={() => handleToggleStatus(req.id!, req.status || "pending")}
                                      className="p-1 text-[#8C857D] hover:text-[#2D2926] border border-[#E5E1DB] bg-white transition-colors"
                                      title={isPending ? "Mark as Done" : "Mark as Pending"}
                                    >
                                      {isPending ? <Check className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                                    </button>
                                    <button
                                      onClick={() => handleDelete(req.id!)}
                                      className="p-1 text-red-500 hover:text-red-700 border border-red-200 hover:bg-red-50 transition-colors"
                                      title="Delete Record"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Table Footer Summary */}
                  <div className="p-3 border-t border-[#E5E1DB] bg-[#FAF8F5] flex items-center justify-between text-[11px] text-[#8C857D]">
                    <span>
                      Showing {filteredTableRequests.length} of {requests.length} total request records
                    </span>
                    <span className="font-mono">
                      {pendingRequests.length} pending · {completedRequests.length} completed
                    </span>
                  </div>
                </div>
              )}

              {/* CARD VIEW */}
              {activeTab === 'cards' && (
                <>
                  {/* Pending Section */}
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

                  {/* Completed Section */}
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

              {/* BORROWED ITEMS VIEW */}
              {activeTab === 'borrowed' && (
                <section>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-6 border-b border-[#E5E1DB] gap-2">
                    <div>
                      <h3 className="text-sm uppercase tracking-[0.2em] font-bold text-[#2D2926] flex items-center">
                        <Package className="w-4 h-4 mr-2 text-[#A68966]" />
                        Appliances & Items In Rooms ({activeBorrowed.length})
                      </h3>
                      <p className="text-xs text-[#8C857D] mt-1">
                        Delivered appliances currently inside guest rooms. Mark collected once housekeeping retrieves them.
                      </p>
                    </div>
                  </div>
                  
                  {activeBorrowed.length === 0 ? (
                    <div className="bg-white border border-dashed border-[#E5E1DB] p-12 text-center">
                      <CheckCircle2 className="w-10 h-10 text-[#A68966] mx-auto mb-4 opacity-50" />
                      <h4 className="text-sm font-semibold text-[#2D2926] mb-1">No items currently in guest rooms</h4>
                      <p className="text-xs text-[#8C857D] max-w-md mx-auto">
                        When you mark a request done for a Kettle, Iron Box, or other appliance, it is automatically logged here so you know which room has it and needs to be collected back.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                      {activeBorrowed.map(item => (
                        <div key={item.id} className="bg-white p-6 border border-[#E5E1DB] shadow-sm flex flex-col relative">
                          <div className="absolute top-0 left-0 w-full h-[3px] bg-[#A68966]"></div>
                          
                          <div className="flex justify-between items-start pb-4 border-b border-dashed border-[#E5E1DB] mb-5">
                            <div className="flex items-center text-[#2D2926] font-serif text-2xl font-bold">
                              <BedDouble className="w-5 h-5 mr-2.5 text-[#A68966]" />
                              Room {item.roomId}
                            </div>
                            <span className="inline-flex items-center px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] uppercase font-bold tracking-wider">
                              In Room — Needs Collection
                            </span>
                          </div>
                          
                          <div className="flex-1">
                            <h4 className="text-[10px] uppercase tracking-[0.2em] text-[#8C857D] font-bold mb-1.5">Delivered Appliance</h4>
                            <p className="text-lg font-semibold text-[#2D2926]">{item.itemName}</p>
                            <div className="mt-3 flex items-center text-[11px] text-[#8C857D]">
                              <Clock className="w-3.5 h-3.5 mr-1.5 text-[#A68966]" />
                              Delivered {formatDistanceToNow(item.createdAt, { addSuffix: true })}
                            </div>
                          </div>
                          
                          <div className="mt-6 pt-5 border-t border-dashed border-[#E5E1DB] flex items-center gap-2">
                            <button 
                              onClick={() => handleMarkReturned(item.id!, item.itemName)}
                              className="flex-1 bg-[#2D2926] text-white py-2.5 px-3 text-xs font-semibold uppercase tracking-wider hover:bg-[#A68966] transition-colors flex items-center justify-center gap-2"
                              title="Click once you collect the item back from the room"
                            >
                              <CheckCircle2 className="w-4 h-4 text-[#A68966]" />
                              <span>Collect & Return</span>
                            </button>
                            <button
                              onClick={() => handleDeleteBorrowed(item.id!, item.itemName)}
                              className="p-2.5 text-[#8C857D] hover:text-red-600 hover:bg-red-50 border border-[#E5E1DB] transition-colors"
                              title="Remove this card from dashboard view (keeps database history safe)"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function RoomGroupCard({ 
  roomId, 
  requests, 
  onComplete, 
  onDelete, 
  isPending 
}: { 
  roomId: string, 
  requests: RoomRequest[], 
  onComplete: (id: string) => void, 
  onDelete: (id: string) => void,
  isPending: boolean
}) {
  return (
    <div className={`bg-white p-6 border ${isPending ? 'border-[#A68966]' : 'border-[#E5E1DB]'} flex flex-col h-full relative`}>
      {isPending && <div className="absolute top-0 left-0 w-full h-[2px] bg-[#A68966]"></div>}
      
      <div className="flex justify-between items-center pb-4 border-b border-dashed border-[#E5E1DB] mb-6">
        <div className="flex items-center text-[#2D2926] font-serif text-xl">
          <BedDouble className="w-5 h-5 mr-3 text-[#A68966]" />
          Room {roomId}
        </div>
        <div className="text-[10px] uppercase tracking-widest text-[#8C857D] font-medium bg-[#F9F7F4] px-2 py-1 border border-[#E5E1DB]">
          {requests.length} Request{requests.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="flex-1 space-y-6">
        {requests.map((request, idx) => (
          <div key={request.id || idx} className="relative">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center text-[10px] uppercase tracking-widest text-[#8C857D] font-medium">
                <Clock className="w-3 h-3 mr-1.5" />
                {formatDistanceToNow(request.createdAt, { addSuffix: true })}
              </div>
            </div>
            
            <div className="space-y-3 pl-4 border-l-2 border-[#E5E1DB]">
              {request.items && request.items.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {request.items.map((item, itemIdx) => (
                    <span key={itemIdx} className="bg-[#F9F7F4] border border-[#E5E1DB] text-[#2D2926] px-3 py-1 text-[10px] font-medium uppercase tracking-widest">
                      {item}
                    </span>
                  ))}
                </div>
              )}
              
              {request.customMessage && (
                <p className="text-[#2D2926] text-sm bg-[#F9F7F4] p-3 border border-[#E5E1DB] italic">
                  "{request.customMessage}"
                </p>
              )}
            </div>

            <div className="mt-3 flex gap-2 justify-end">
              {isPending && (
                <button 
                  onClick={() => onComplete(request.id!)}
                  className="bg-[#A68966] text-white px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] font-medium hover:bg-[#8E7455] transition-colors flex items-center"
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Mark Done
                </button>
              )}
              <button 
                onClick={() => onDelete(request.id!)}
                className={`p-1.5 text-[#8C857D] hover:text-red-500 hover:bg-[#F9F7F4] border border-transparent hover:border-[#E5E1DB] transition-colors ${!isPending ? 'border border-[#E5E1DB]' : ''}`}
                title="Delete request"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            
            {idx < requests.length - 1 && <div className="my-4 border-b border-dashed border-[#E5E1DB]" />}
          </div>
        ))}
      </div>
    </div>
  );
}
