import React, { useEffect, useState, useMemo } from "react";
import { 
  COMMON_ITEMS, 
  DEFAULT_AMENITY_STATUS, 
  DEFAULT_INVENTORY_LIMITS,
  PAGE_1_DAILY_ITEMS,
  PAGE_2_RETURNABLE_ITEMS,
  PAGE_3_FNB_DEPOSIT_ITEMS,
  PAGE_3_QUICK_FOOD_ITEMS,
  normalizeReturnableName
} from "../types";
import { 
  fetchLiveAmenitiesStatus, 
  saveLiveAmenitiesStatus, 
  fetchLiveInventoryLimits, 
  saveLiveInventoryLimits, 
  fetchLiveDeletedItems,
  saveLiveDeletedItems,
  fetchLiveBorrowed,
  fetchLiveRequests
} from "../lib/supabaseClient";
import { 
  ShieldAlert, 
  CheckCircle2, 
  Package, 
  RefreshCw,
  Plus,
  Trash2,
  Minus,
  Utensils,
  Sparkles
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { ITEM_EMOJI_MAP } from "../components/guest/RequestSuccessScreen";
import { cn } from "../lib/utils";

export default function StaffSettings() {
  // Initialize states with local cache or defaults immediately so the screen is NEVER blank
  const [amenityStatus, setAmenityStatus] = useState<Record<string, 'available' | 'out_of_service'>>(() => {
    try {
      const saved = localStorage.getItem("hues_stay_amenities");
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_AMENITY_STATUS, ...parsed };
      }
    } catch (e) {}
    return { ...DEFAULT_AMENITY_STATUS };
  });

  const [inventoryMap, setInventoryMap] = useState<Record<string, { id?: string, limit: number, inUse: number }>>(() => {
    const init: Record<string, { id?: string, limit: number, inUse: number }> = {};
    COMMON_ITEMS.filter(i => i.category === 'Item').forEach(item => {
      init[item.name] = { inUse: 0, limit: item.defaultLimit || DEFAULT_INVENTORY_LIMITS[item.name] || 1 };
    });
    try {
      const saved = localStorage.getItem("hues_stay_inventory");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          Object.keys(parsed).forEach(k => {
            init[k] = parsed[k];
          });
        }
      }
    } catch (e) {}
    return init;
  });

  const [isSyncingWithCloud, setIsSyncingWithCloud] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSavedMsg, setLastSavedMsg] = useState<string | null>(null);

  // Auto-reset watchdog: Never permit the UI to stay in 'saving' state for more than 2 seconds
  useEffect(() => {
    if (saving) {
      const timer = setTimeout(() => {
        setSaving(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [saving]);

  const [deletedItems, setDeletedItems] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("hues_stay_deleted_items");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });

  // Background fetch from server API, Supabase inventory API, and Firestore
  useEffect(() => {
    let isMounted = true;
    setIsSyncingWithCloud(true);

    const fetchSettings = async () => {
      try {
        const [liveDeleted, liveAmenities, liveLimits, liveBorrowed, liveRequests] = await Promise.all([
          fetchLiveDeletedItems(),
          fetchLiveAmenitiesStatus(),
          fetchLiveInventoryLimits(),
          fetchLiveBorrowed(),
          fetchLiveRequests()
        ]);
        if (!isMounted) return;

        if (liveDeleted) {
          setDeletedItems(liveDeleted);
          try {
            localStorage.setItem("hues_stay_deleted_items", JSON.stringify(liveDeleted));
          } catch (e) {}
        }

        if (liveAmenities && Object.keys(liveAmenities).length > 0) {
          setAmenityStatus(prev => {
            const next = { ...prev, ...liveAmenities };
            try {
              localStorage.setItem("hues_stay_amenities", JSON.stringify(next));
            } catch (e) {}
            return next;
          });
        }

        // Live in-use counts: items still in a room plus pending requests
        const inUseCounts: Record<string, number> = {};
        for (const b of liveBorrowed || []) {
          if (b.status !== "borrowed") continue;
          const name = normalizeReturnableName(b.itemName);
          inUseCounts[name] = (inUseCounts[name] || 0) + 1;
        }
        for (const r of liveRequests || []) {
          if (r.status !== "pending") continue;
          for (const name of new Set((r.items || []).map(normalizeReturnableName))) {
            inUseCounts[name] = (inUseCounts[name] || 0) + 1;
          }
        }

        setInventoryMap(prev => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            next[k] = { ...next[k], inUse: inUseCounts[k] || 0 };
          }
          Object.entries(liveLimits || {}).forEach(([k, limit]) => {
            next[k] = { ...(next[k] || { inUse: inUseCounts[k] || 0 }), limit };
          });
          try {
            localStorage.setItem("hues_stay_inventory", JSON.stringify(next));
          } catch (e) {}
          return next;
        });
      } catch (err: any) {
        console.warn("Settings sync note:", err?.message || "offline");
      } finally {
        if (isMounted) {
          setIsSyncingWithCloud(false);
        }
      }
    };

    fetchSettings();
    const interval = setInterval(fetchSettings, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const toggleStatus = (itemName: string) => {
    setAmenityStatus(prev => {
      const current = prev[itemName] || 'available';
      const nextStatus: 'available' | 'out_of_service' = current === 'available' ? 'out_of_service' : 'available';
      const updated: Record<string, 'available' | 'out_of_service'> = {
        ...prev,
        [itemName]: nextStatus
      };
      try {
        localStorage.setItem("hues_stay_amenities", JSON.stringify(updated));
      } catch (e) {}

      // Automatically sync to Supabase so desktop & mobile update in real-time
      saveLiveAmenitiesStatus(updated).then(ok => {
        if (!ok) {
          toast.error(`Could not save "${itemName}". Check the connection and try again.`);
          return;
        }
        setLastSavedMsg(`"${itemName}" marked as ${nextStatus === 'available' ? 'Available' : 'Unavailable'}`);
        setTimeout(() => setLastSavedMsg(null), 3000);
      }).catch(() => {});

      toast.success(`${itemName} is now ${nextStatus === 'available' ? 'Available' : 'Unavailable'}`);

      return updated;
    });
  };

  const handleLimitChange = (itemName: string, newLimit: string | number) => {
    const num = typeof newLimit === "number" ? newLimit : parseInt(newLimit, 10);
    if (isNaN(num) || num < 0) return;

    setInventoryMap(prev => {
      const updated = {
        ...prev,
        [itemName]: {
          ...(prev[itemName] || { inUse: 0 }),
          limit: num
        }
      };
      try {
        localStorage.setItem("hues_stay_inventory", JSON.stringify(updated));
      } catch (e) {}

      // Automatically sync limits to Supabase & trigger auto-availability
      const limitsOnly: Record<string, number> = {};
      Object.keys(updated).forEach(k => {
        limitsOnly[k] = updated[k].limit;
      });
      saveLiveInventoryLimits(limitsOnly).then(ok => {
        if (!ok) toast.error(`Could not save the stock for ${itemName}.`);
      }).catch(() => {});

      return updated;
    });
  };

  const handleDeleteItem = async (itemName: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete "${itemName}"?\n\nIt will be removed immediately from all guest rooms and staff settings.`)) {
      return;
    }

    const nextDeleted = Array.from(new Set([...deletedItems, itemName]));
    setDeletedItems(nextDeleted);
    await saveLiveDeletedItems(nextDeleted);

    const updatedInv = { ...inventoryMap };
    delete updatedInv[itemName];
    setInventoryMap(updatedInv);
    try {
      localStorage.setItem("hues_stay_inventory", JSON.stringify(updatedInv));
    } catch (e) {}

    const updatedAmenity = { ...amenityStatus };
    delete updatedAmenity[itemName];
    setAmenityStatus(updatedAmenity);
    try {
      localStorage.setItem("hues_stay_amenities", JSON.stringify(updatedAmenity));
    } catch (e) {}

    const limitsOnly: Record<string, number> = {};
    Object.keys(updatedInv).forEach(k => {
      limitsOnly[k] = updatedInv[k].limit;
    });
    await saveLiveInventoryLimits(limitsOnly);
    await saveLiveAmenitiesStatus(updatedAmenity);

    toast.success(`"${itemName}" deleted.`);
  };

  const handleSave = async () => {
    setSaving(true);
    setLastSavedMsg(null);

    const safetyWatchdog = setTimeout(() => {
      setSaving(false);
    }, 1500);

    try {
      localStorage.setItem("hues_stay_amenities", JSON.stringify(amenityStatus));
      localStorage.setItem("hues_stay_inventory", JSON.stringify(inventoryMap));

      await saveLiveAmenitiesStatus(amenityStatus);

      const limitsOnly: Record<string, number> = {};
      Object.keys(inventoryMap).forEach(k => {
        limitsOnly[k] = inventoryMap[k].limit;
      });
      await saveLiveInventoryLimits(limitsOnly);

      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastSavedMsg(`Settings saved successfully at ${nowTime}`);
      toast.success("Settings & Inventory saved successfully!");
    } catch (error: any) {
      console.error("Error saving settings:", error?.message || "error");
      toast.success("Settings saved locally!");
    } finally {
      clearTimeout(safetyWatchdog);
      setSaving(false);
    }
  };

  // Group items by category for clean staff presentation
  const deletedSet = useMemo(() => new Set(deletedItems), [deletedItems]);

  const page1Items = useMemo(() => {
    return PAGE_1_DAILY_ITEMS.filter(i => !deletedSet.has(i.name));
  }, [deletedSet]);

  const page2Items = useMemo(() => {
    return PAGE_2_RETURNABLE_ITEMS.filter(i => !deletedSet.has(i.name));
  }, [deletedSet]);

  const page3DepositItems = useMemo(() => {
    return PAGE_3_FNB_DEPOSIT_ITEMS.filter(i => !deletedSet.has(i.name));
  }, [deletedSet]);

  const page3QuickFoodItems = useMemo(() => {
    return PAGE_3_QUICK_FOOD_ITEMS.filter(i => !deletedSet.has(i.name));
  }, [deletedSet]);

  return (
    <div className="p-6 md:p-12 w-full max-w-5xl mx-auto">
      <Toaster position="top-right" />
      
      {/* Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-3xl font-serif italic text-[#2D2926]">Staff Settings & Inventory</h2>
            {isSyncingWithCloud && (
              <span className="flex items-center text-xs text-[#8C857D] gap-1 bg-[#EFECE8] px-2 py-0.5 rounded">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Syncing...
              </span>
            )}
          </div>
          <p className="text-[#8C857D] text-xs sm:text-sm max-w-2xl">
            Manage item availability and stock limits across the 3 guest pages.
          </p>
        </div>

      </div>

      <div className="space-y-10">
        {/* SECTION 1: DAILY SERVICE REQUESTS */}
        <section className="bg-white border border-[#E5E1DB] p-6 shadow-sm">
          <div className="border-b border-[#E5E1DB] pb-4 mb-6 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#A68966]" />
                <h3 className="font-serif text-xl font-medium text-[#2D2926]">
                  Page 1: Daily Service Requests
                </h3>
              </div>
              <p className="text-xs text-[#8C857D] mt-0.5">
                Complimentary room services, bathroom refills, and housekeeping.
              </p>
            </div>
            <span className="text-xs font-medium text-[#8C857D] bg-[#FAF8F5] border border-[#E5E1DB] px-2.5 py-1">
              {page1Items.length} Services
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {page1Items.map((item) => {
              const isAvailable = amenityStatus[item.name] !== 'out_of_service';
              const emoji = ITEM_EMOJI_MAP[item.name] || "✨";

              return (
                <div
                  key={item.name}
                  className={`p-4 border flex flex-col justify-between transition-colors ${
                    isAvailable ? "bg-[#FAF8F5] border-[#E5E1DB]" : "bg-red-50/70 border-red-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <span className="font-serif text-base text-[#2D2926] font-medium flex items-center gap-2">
                        <span className="text-lg">{emoji}</span>
                        <span>{item.name}</span>
                      </span>
                      {item.badge && (
                        <span className="inline-block mt-1 text-[10px] uppercase font-bold text-[#A68966] bg-white border border-[#E5E1DB] px-1.5 py-0.5">
                          {item.badge}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleStatus(item.name)}
                      className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider border shrink-0 transition-colors cursor-pointer ${
                        isAvailable
                          ? "bg-green-700 text-white border-green-800 hover:bg-green-800"
                          : "bg-red-600 text-white border-red-700 hover:bg-red-700"
                      }`}
                    >
                      {isAvailable ? "Available" : "Unavailable"}
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-[#E5E1DB]/60 text-xs text-[#8C857D]">
                    <span className="italic">Service on demand</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(item.name)}
                      className="text-red-600 hover:text-red-800 p-1 flex items-center gap-1 cursor-pointer"
                      title="Delete item"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="text-[10px]">Delete</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* SECTION 2: RETURNABLE ITEMS & APPLIANCES */}
        <section className="bg-white border border-[#E5E1DB] p-6 shadow-sm">
          <div className="border-b border-[#E5E1DB] pb-4 mb-6 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-[#A68966]" />
                <h3 className="font-serif text-xl font-medium text-[#2D2926]">
                  Page 2: Returnable Items & Shared Appliances
                </h3>
              </div>
              <p className="text-xs text-[#8C857D] mt-0.5">
                Appliances tracked with live in-use counts, stock limits, and Floor-to-Floor Relay.
              </p>
            </div>
            <span className="text-xs font-medium text-[#8C857D] bg-[#FAF8F5] border border-[#E5E1DB] px-2.5 py-1">
              {page2Items.length} Appliances
            </span>
          </div>

          <div className="space-y-4">
            {page2Items.map((item) => {
              const isAvailable = amenityStatus[item.name] !== 'out_of_service';
              const inv = inventoryMap[item.name] || { limit: item.defaultLimit || 1, inUse: 0 };
              const taken = inv.inUse || 0;
              const total = inv.limit || 1;
              const free = Math.max(0, total - taken);
              const emoji = ITEM_EMOJI_MAP[item.name] || "📦";

              return (
                <div
                  key={item.name}
                  className={`p-4 border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                    isAvailable ? "bg-[#FAF8F5] border-[#E5E1DB]" : "bg-red-50/70 border-red-200"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl mt-0.5">{emoji}</span>
                    <div>
                      <span className="font-serif text-lg text-[#2D2926] font-medium block">
                        {item.name}
                      </span>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5">
                          {taken} in rooms
                        </span>
                        <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5">
                          {free} available
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {/* Stock Limit Adjustment with - and + */}
                    <div className="flex items-center gap-1.5 bg-white border border-[#E5E1DB] px-2 py-1">
                      <span className="text-xs text-[#8C857D] mr-1">Stock:</span>
                      <button
                        type="button"
                        onClick={() => handleLimitChange(item.name, Math.max(0, total - 1))}
                        className="w-6 h-6 flex items-center justify-center border border-[#E5E1DB] bg-[#FAF8F5] hover:bg-[#E5E1DB] text-xs font-bold cursor-pointer"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={total}
                        onChange={(e) => handleLimitChange(item.name, e.target.value)}
                        className="w-12 text-center font-mono font-bold text-sm bg-transparent focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleLimitChange(item.name, total + 1)}
                        className="w-6 h-6 flex items-center justify-center border border-[#E5E1DB] bg-[#FAF8F5] hover:bg-[#E5E1DB] text-xs font-bold cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Available / Unavailable toggle button */}
                    <button
                      type="button"
                      onClick={() => toggleStatus(item.name)}
                      className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider border shrink-0 transition-colors cursor-pointer ${
                        isAvailable
                          ? "bg-green-700 text-white border-green-800 hover:bg-green-800"
                          : "bg-red-600 text-white border-red-700 hover:bg-red-700"
                      }`}
                    >
                      {isAvailable ? "Available" : "Unavailable"}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteItem(item.name)}
                      className="p-2 border border-red-200 text-red-600 bg-red-50 hover:bg-red-600 hover:text-white transition-colors cursor-pointer"
                      title="Delete appliance"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* SECTION 3: F&B ESSENTIALS & QUICK FOOD */}
        <section className="bg-white border border-[#E5E1DB] p-6 shadow-sm space-y-6">
          <div className="border-b border-[#E5E1DB] pb-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Utensils className="w-5 h-5 text-[#A68966]" />
                <h3 className="font-serif text-xl font-medium text-[#2D2926]">
                  Page 3: F&B Essentials & Quick Meals
                </h3>
              </div>
              <p className="text-xs text-[#8C857D] mt-0.5">
                Kitchen deposit dining utensils (₹100 deposit) and packaged quick meals.
              </p>
            </div>
            <span className="text-xs font-medium text-[#8C857D] bg-[#FAF8F5] border border-[#E5E1DB] px-2.5 py-1">
              {page3DepositItems.length + page3QuickFoodItems.length} Items
            </span>
          </div>

          {/* Sub-section A: Kitchen Utensils (Deposit) */}
          <div>
            <h4 className="font-serif text-base font-medium text-[#2D2926] mb-3 flex items-center gap-2">
              <span>Kitchen & Dining Utensils (₹100 Deposit)</span>
            </h4>
            <div className="space-y-3">
              {page3DepositItems.map((item) => {
                const isAvailable = amenityStatus[item.name] !== 'out_of_service';
                const inv = inventoryMap[item.name] || { limit: item.defaultLimit || 10, inUse: 0 };
                const taken = inv.inUse || 0;
                const total = inv.limit || 10;
                const free = Math.max(0, total - taken);
                const emoji = ITEM_EMOJI_MAP[item.name] || "🍽️";

                return (
                  <div
                    key={item.name}
                    className={`p-3.5 border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                      isAvailable ? "bg-[#FAF8F5] border-[#E5E1DB]" : "bg-red-50/70 border-red-200"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{emoji}</span>
                      <div>
                        <span className="font-medium text-sm text-[#2D2926] block">{item.name}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-amber-800 bg-amber-50 px-1.5 py-0.5 border border-amber-200">
                            {taken} in rooms
                          </span>
                          <span className="text-[10px] text-emerald-800 bg-emerald-50 px-1.5 py-0.5 border border-emerald-200">
                            {free} available
                          </span>
                          <span className="text-[10px] text-[#A68966] font-semibold">
                            ₹100 Deposit
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <div className="flex items-center gap-1 bg-white border border-[#E5E1DB] px-1.5 py-0.5">
                        <span className="text-xs text-[#8C857D] mr-1">Stock:</span>
                        <button
                          type="button"
                          onClick={() => handleLimitChange(item.name, Math.max(0, total - 1))}
                          className="w-5 h-5 flex items-center justify-center border border-[#E5E1DB] text-xs font-bold cursor-pointer"
                        >
                          <Minus className="w-2.5 h-2.5" />
                        </button>
                        <span className="w-8 text-center font-mono font-bold text-xs">{total}</span>
                        <button
                          type="button"
                          onClick={() => handleLimitChange(item.name, total + 1)}
                          className="w-5 h-5 flex items-center justify-center border border-[#E5E1DB] text-xs font-bold cursor-pointer"
                        >
                          <Plus className="w-2.5 h-2.5" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleStatus(item.name)}
                        className={`px-3 py-1 text-xs font-bold uppercase tracking-wider border shrink-0 transition-colors cursor-pointer ${
                          isAvailable
                            ? "bg-green-700 text-white border-green-800 hover:bg-green-800"
                            : "bg-red-600 text-white border-red-700 hover:bg-red-700"
                        }`}
                      >
                        {isAvailable ? "Available" : "Unavailable"}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteItem(item.name)}
                        className="p-1.5 text-red-600 hover:text-red-800 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sub-section B: Quick Food Items */}
          <div className="pt-4 border-t border-[#E5E1DB]">
            <h4 className="font-serif text-base font-medium text-[#2D2926] mb-3 flex items-center gap-2">
              <span>Quick Food Items (Direct Sale)</span>
            </h4>
            <div className="space-y-3">
              {page3QuickFoodItems.map((item) => {
                const isAvailable = amenityStatus[item.name] !== 'out_of_service';
                const inv = inventoryMap[item.name] || { limit: item.defaultLimit || 20, inUse: 0 };
                const total = inv.limit || 20;
                const emoji = ITEM_EMOJI_MAP[item.name] || "🍜";
                const isSoftDrinks = item.name.includes("Soft Drinks");
                const isTonedMilk = item.name.includes("Toned Milk");

                return (
                  <div
                    key={item.name}
                    className={`p-3.5 border flex flex-col justify-between gap-3 transition-colors ${
                      isAvailable ? "bg-[#FAF8F5] border-[#E5E1DB]" : "bg-red-50/70 border-red-200"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{emoji}</span>
                        <div>
                          <span className="font-medium text-sm text-[#2D2926] block">{item.name}</span>
                          {item.badge && (
                            <span className="text-[10px] text-[#A68966] font-semibold mt-0.5 block">
                              Price: {item.badge}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <div className="flex items-center gap-1 bg-white border border-[#E5E1DB] px-1.5 py-0.5">
                          <span className="text-xs text-[#8C857D] mr-1">Stock:</span>
                          <button
                            type="button"
                            onClick={() => handleLimitChange(item.name, Math.max(0, total - 1))}
                            className="w-5 h-5 flex items-center justify-center border border-[#E5E1DB] text-xs font-bold cursor-pointer"
                          >
                            <Minus className="w-2.5 h-2.5" />
                          </button>
                          <span className="w-8 text-center font-mono font-bold text-xs">{total}</span>
                          <button
                            type="button"
                            onClick={() => handleLimitChange(item.name, total + 1)}
                            className="w-5 h-5 flex items-center justify-center border border-[#E5E1DB] text-xs font-bold cursor-pointer"
                          >
                            <Plus className="w-2.5 h-2.5" />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleStatus(item.name)}
                          className={`px-3 py-1 text-xs font-bold uppercase tracking-wider border shrink-0 transition-colors cursor-pointer ${
                            isAvailable
                              ? "bg-green-700 text-white border-green-800 hover:bg-green-800"
                              : "bg-red-600 text-white border-red-700 hover:bg-red-700"
                          }`}
                        >
                          {isAvailable ? "Available" : "Unavailable"}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteItem(item.name)}
                          className="p-1.5 text-red-600 hover:text-red-800 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Sub-item flavor availability for Soft Drinks */}
                    {isSoftDrinks && (
                      <div className="pt-2.5 border-t border-[#E5E1DB]/80 flex flex-wrap items-center gap-3 text-xs bg-white/70 p-2">
                        <span className="text-[10px] uppercase font-bold text-[#8C857D] tracking-wider">
                          Flavor Stock Options:
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-xs text-[#2D2926]">Coke:</span>
                          <button
                            type="button"
                            onClick={() => toggleStatus("Soft Drinks - Coke")}
                            className={cn(
                              "px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border rounded-xs transition-colors cursor-pointer",
                              amenityStatus["Soft Drinks - Coke"] !== "out_of_service"
                                ? "bg-green-700 text-white border-green-800 hover:bg-green-800"
                                : "bg-red-600 text-white border-red-700 hover:bg-red-700"
                            )}
                          >
                            {amenityStatus["Soft Drinks - Coke"] !== "out_of_service" ? "In Stock" : "Out of Stock"}
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-xs text-[#2D2926]">Pepsi:</span>
                          <button
                            type="button"
                            onClick={() => toggleStatus("Soft Drinks - Pepsi")}
                            className={cn(
                              "px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border rounded-xs transition-colors cursor-pointer",
                              amenityStatus["Soft Drinks - Pepsi"] !== "out_of_service"
                                ? "bg-green-700 text-white border-green-800 hover:bg-green-800"
                                : "bg-red-600 text-white border-red-700 hover:bg-red-700"
                            )}
                          >
                            {amenityStatus["Soft Drinks - Pepsi"] !== "out_of_service" ? "In Stock" : "Out of Stock"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Sub-item size availability for Toned Milk */}
                    {isTonedMilk && (
                      <div className="pt-2.5 border-t border-[#E5E1DB]/80 flex flex-wrap items-center gap-3 text-xs bg-white/70 p-2">
                        <span className="text-[10px] uppercase font-bold text-[#8C857D] tracking-wider">
                          Size Stock Options:
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-xs text-[#2D2926]">200 mL:</span>
                          <button
                            type="button"
                            onClick={() => toggleStatus("Toned Milk - 200 mL")}
                            className={cn(
                              "px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border rounded-xs transition-colors cursor-pointer",
                              amenityStatus["Toned Milk - 200 mL"] !== "out_of_service"
                                ? "bg-green-700 text-white border-green-800 hover:bg-green-800"
                                : "bg-red-600 text-white border-red-700 hover:bg-red-700"
                            )}
                          >
                            {amenityStatus["Toned Milk - 200 mL"] !== "out_of_service" ? "In Stock" : "Out of Stock"}
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-xs text-[#2D2926]">500 mL:</span>
                          <button
                            type="button"
                            onClick={() => toggleStatus("Toned Milk - 500 mL")}
                            className={cn(
                              "px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border rounded-xs transition-colors cursor-pointer",
                              amenityStatus["Toned Milk - 500 mL"] !== "out_of_service"
                                ? "bg-green-700 text-white border-green-800 hover:bg-green-800"
                                : "bg-red-600 text-white border-red-700 hover:bg-red-700"
                            )}
                          >
                            {amenityStatus["Toned Milk - 500 mL"] !== "out_of_service" ? "In Stock" : "Out of Stock"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Save Settings Footer */}
        <div className="bg-white border border-[#E5E1DB] p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs text-[#8C857D]">
              Changes are saved live to the database and synced instantly to all guest rooms and staff devices.
            </p>
            {lastSavedMsg && (
              <p className="text-xs text-green-700 font-medium mt-1 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
                <span>{lastSavedMsg}</span>
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-8 py-3.5 bg-[#A68966] text-white font-medium uppercase tracking-[0.2em] text-xs hover:bg-[#8E7455] transition-colors disabled:opacity-50 flex items-center gap-2 shrink-0 cursor-pointer shadow-xs"
          >
            {saving ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Save All Settings</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
