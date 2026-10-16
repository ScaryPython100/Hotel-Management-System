import React, { useEffect, useState, useMemo } from "react";
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, addDoc, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { 
  COMMON_ITEMS, 
  DEFAULT_AMENITY_STATUS, 
  TARGET_AUTO_UNAVAILABLE_ITEMS, 
  DEFAULT_INVENTORY_LIMITS,
  PAGE_1_DAILY_ITEMS,
  PAGE_2_RETURNABLE_ITEMS,
  PAGE_3_FNB_DEPOSIT_ITEMS,
  PAGE_3_QUICK_FOOD_ITEMS,
  isReturnableItem,
  normalizeReturnableName
} from "../types";
import { 
  fetchLiveAmenitiesStatus, 
  saveLiveAmenitiesStatus, 
  fetchLiveInventoryLimits, 
  saveLiveInventoryLimits, 
  fetchLiveAutoDepleted,
  saveLiveAutoDepleted,
  fetchLiveDeletedItems,
  saveLiveDeletedItems,
  syncInventoryAvailability 
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
  Sparkles,
  Coffee,
  X
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { useOutletContext } from "react-router-dom";
import { ITEM_EMOJI_MAP } from "../components/guest/RequestSuccessScreen";

function isCorruptOrDuplicateItem(name: string): boolean {
  if (!name) return true;
  const lower = name.trim().toLowerCase();
  if (lower.includes("(qty:") || lower.includes("qty:") || /\(\d+x?\)/.test(lower) || /x\s*\d+$/.test(lower)) {
    return true;
  }
  if (
    lower === "teakettle" || 
    lower === "glasses" || 
    lower === "water glasses" || 
    lower === "water glass" || 
    lower.includes("usb 2") ||
    lower === "usb 3.0 adaptor + cable" ||
    lower.includes("laundry") ||
    lower === "wifi password request" ||
    lower.includes("extend the stay")
  ) {
    return true;
  }
  return false;
}

export default function StaffSettings() {
  const { role } = useOutletContext<{ role: "superhost" | "staff" }>();
  
  // Initialize states with local cache or defaults immediately so the screen is NEVER blank
  const [amenityStatus, setAmenityStatus] = useState<Record<string, 'available' | 'out_of_service'>>(() => {
    try {
      const saved = localStorage.getItem("hues_stay_amenities");
      if (saved) {
        const parsed = JSON.parse(saved);
        const cleaned: Record<string, 'available' | 'out_of_service'> = { ...DEFAULT_AMENITY_STATUS };
        Object.keys(parsed).forEach(k => {
          if (!isCorruptOrDuplicateItem(k)) {
            cleaned[k] = parsed[k];
          }
        });
        return cleaned;
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
            if (!isCorruptOrDuplicateItem(k)) {
              init[k] = parsed[k];
            }
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

  const [superhostPin, setSuperhostPin] = useState(() => {
    return localStorage.getItem("hues_stay_superhost_pin") || "9999";
  });

  const [deletedItems, setDeletedItems] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("hues_stay_deleted_items");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });

  // Dynamic new item state
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState<"daily" | "returnable" | "fnb_deposit" | "quick_food">("returnable");
  const [newItemLimit, setNewItemLimit] = useState("5");
  const [isAddingItem, setIsAddingItem] = useState(false);

  // Background fetch from server API, Supabase inventory API, and Firestore
  useEffect(() => {
    let isMounted = true;
    setIsSyncingWithCloud(true);

    const fetchSettings = async () => {
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Timeout")), 2500)
        );

        const loadTask = (async () => {
          // 0. Fetch deleted items from Supabase
          try {
            const liveDeleted = await fetchLiveDeletedItems();
            if (liveDeleted && isMounted) {
              setDeletedItems(liveDeleted);
              try {
                localStorage.setItem("hues_stay_deleted_items", JSON.stringify(liveDeleted));
              } catch (e) {}
            }
          } catch (e) {}

          // 1. Fetch amenities from Supabase (guaranteed cross-device sync)
          let liveAmenitiesFetched = false;
          try {
            const liveAmenities = await fetchLiveAmenitiesStatus();
            if (liveAmenities && Object.keys(liveAmenities).length > 0 && isMounted) {
              liveAmenitiesFetched = true;
              setAmenityStatus(prev => {
                const next = { ...prev };
                Object.keys(liveAmenities).forEach(k => {
                  if (!isCorruptOrDuplicateItem(k)) {
                    next[k] = liveAmenities[k];
                  }
                });
                try {
                  localStorage.setItem("hues_stay_amenities", JSON.stringify(next));
                } catch (e) {}
                return next;
              });
            }
          } catch (e) {}

          // 2. Fetch amenities from Server API (fallback)
          if (!liveAmenitiesFetched) {
            try {
              const apiRes = await fetch("/api/settings/amenities");
              if (apiRes.ok) {
                const data = await apiRes.json();
                if (data.success && data.amenities && isMounted) {
                  liveAmenitiesFetched = true;
                  setAmenityStatus(prev => {
                    const next = { ...prev };
                    Object.keys(data.amenities).forEach(k => {
                      if (!isCorruptOrDuplicateItem(k)) {
                        next[k] = data.amenities[k];
                      }
                    });
                    try {
                      localStorage.setItem("hues_stay_amenities", JSON.stringify(next));
                    } catch (e) {}
                    return next;
                  });
                }
              }
            } catch (e) {}
          }

          // 3. Fetch inventory live from Supabase table /api/inventory
          try {
            const supaRes = await fetch("/api/inventory");
            if (supaRes.ok) {
              const data = await supaRes.json();
              if (data.inventory && Array.isArray(data.inventory) && isMounted) {
                setInventoryMap(prev => {
                  const next = { ...prev };
                  data.inventory.forEach((inv: any) => {
                    if (!isCorruptOrDuplicateItem(inv.name)) {
                      next[inv.name] = {
                        id: inv.id,
                        limit: inv.totalStock ?? inv.limit ?? 1,
                        inUse: inv.taken ?? 0
                      };
                    }
                  });
                  try {
                    localStorage.setItem("hues_stay_inventory", JSON.stringify(next));
                  } catch (e) {}
                  return next;
                });
              }
            }
          } catch (e) {
            console.warn("Supabase inventory sync note:", e);
          }

          // 4. Fetch live inventory limits from Supabase & reconcile auto-availability
          try {
            const liveLimits = await fetchLiveInventoryLimits();
            if (liveLimits && isMounted) {
              setInventoryMap(prev => {
                const next = { ...prev };
                Object.keys(liveLimits).forEach(k => {
                  if (!isCorruptOrDuplicateItem(k)) {
                    next[k] = { ...(next[k] || { inUse: 0 }), limit: liveLimits[k] };
                  }
                });
                try {
                  localStorage.setItem("hues_stay_inventory", JSON.stringify(next));
                } catch (e) {}
                return next;
              });
            }

            const freshStatus = await syncInventoryAvailability(undefined, undefined, liveLimits || undefined);
            if (freshStatus && isMounted) {
              setAmenityStatus(prev => ({ ...prev, ...freshStatus }));
            }
          } catch (e) {
            console.warn("Live limits sync note:", e);
          }
        })();

        await Promise.race([loadTask, timeoutPromise]);
      } catch (err: any) {
        console.warn("Settings sync timed out or offline:", err?.message || "offline");
      } finally {
        if (isMounted) {
          setIsSyncingWithCloud(false);
        }
      }
    };

    fetchSettings();

    return () => {
      isMounted = false;
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

      // If staff manually set to available, clear from auto-depleted so system won't undo it
      if (nextStatus === 'available') {
        fetchLiveAutoDepleted().then(autoList => {
          const set = new Set(autoList);
          if (set.has(itemName)) {
            set.delete(itemName);
            saveLiveAutoDepleted(Array.from(set)).catch(() => {});
          }
        }).catch(() => {});
      }

      // Automatically sync to Supabase so desktop & mobile update in real-time
      saveLiveAmenitiesStatus(updated).then(() => {
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
      saveLiveInventoryLimits(limitsOnly).catch(() => {});
      syncInventoryAvailability(undefined, undefined, limitsOnly).catch(() => {});

      return updated;
    });
  };

  const handleAddNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newItemName.trim();
    const limitNum = Math.max(1, parseInt(newItemLimit, 10) || 1);

    if (!clean) {
      toast.error("Please enter an item name");
      return;
    }

    // 1. If previously deleted, un-delete it
    if (deletedItems.includes(clean)) {
      const nextDeleted = deletedItems.filter(d => d !== clean);
      setDeletedItems(nextDeleted);
      await saveLiveDeletedItems(nextDeleted);
    }

    // 2. Immediately update UI state so app displays it right away
    const updatedInv = {
      ...inventoryMap,
      [clean]: { limit: limitNum, inUse: 0 }
    };
    setInventoryMap(updatedInv);
    try {
      localStorage.setItem("hues_stay_inventory", JSON.stringify(updatedInv));
    } catch (e) {}

    const updatedAmenity: Record<string, 'available' | 'out_of_service'> = {
      ...amenityStatus,
      [clean]: 'available'
    };
    setAmenityStatus(updatedAmenity);
    try {
      localStorage.setItem("hues_stay_amenities", JSON.stringify(updatedAmenity));
    } catch (e) {}

    // 3. Immediately persist limits and availability to Supabase
    const limitsOnly: Record<string, number> = {};
    Object.keys(updatedInv).forEach(k => {
      limitsOnly[k] = updatedInv[k].limit;
    });
    await saveLiveInventoryLimits(limitsOnly);
    await saveLiveAmenitiesStatus(updatedAmenity);

    // 4. Also sync to server API
    fetch("/api/settings/save-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amenities: updatedAmenity,
        inventory: updatedInv,
        pin: superhostPin.trim()
      })
    }).catch(() => {});

    toast.success(`"${clean}" added to Inventory & Guest View!`);
    setNewItemName("");
    setNewItemLimit("5");
    setIsAddingItem(false);
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

    fetch("/api/settings/save-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amenities: updatedAmenity,
        inventory: updatedInv,
        pin: superhostPin.trim()
      })
    }).catch(() => {});

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
      if (superhostPin.trim()) {
        localStorage.setItem("hues_stay_superhost_pin", superhostPin.trim());
      }

      await saveLiveAmenitiesStatus(amenityStatus);

      const limitsOnly: Record<string, number> = {};
      Object.keys(inventoryMap).forEach(k => {
        limitsOnly[k] = inventoryMap[k].limit;
      });
      await saveLiveInventoryLimits(limitsOnly);

      fetch("/api/settings/save-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amenities: amenityStatus,
          inventory: inventoryMap,
          pin: superhostPin.trim()
        })
      }).catch(() => {});

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

  // Any custom items added by staff that aren't in canonical lists
  const customItems = useMemo(() => {
    const canonicalNames = new Set(COMMON_ITEMS.map(i => i.name));
    return Object.keys(inventoryMap).filter(k => 
      !deletedSet.has(k) && 
      !isCorruptOrDuplicateItem(k) && 
      !canonicalNames.has(k)
    );
  }, [inventoryMap, deletedSet]);

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
            Easily manage item availability, stock limits, and additions across the 3 guest pages.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsAddingItem(!isAddingItem)}
            className="px-4 py-2 border border-[#2D2926] bg-[#2D2926] text-white hover:bg-neutral-800 text-xs font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            {isAddingItem ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {isAddingItem ? "Close Form" : "Add New Item"}
          </button>
        </div>
      </div>

      {/* Dynamic Add New Item Form */}
      {isAddingItem && (
        <form onSubmit={handleAddNewItem} className="mb-8 p-6 border border-[#A68966] bg-[#FAF8F5] shadow-sm animate-fadeIn">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-serif text-lg font-medium text-[#2D2926] flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#A68966]" />
              Add Item to Guest Menu & Inventory
            </h3>
            <button
              type="button"
              onClick={() => setIsAddingItem(false)}
              className="text-[#8C857D] hover:text-[#2D2926] p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label htmlFor="new-item-category" className="block text-xs uppercase tracking-wider text-[#2D2926] font-semibold mb-1">
                Category / Section
              </label>
              <select
                id="new-item-category"
                value={newItemCategory}
                onChange={(e: any) => setNewItemCategory(e.target.value)}
                className="w-full p-2.5 border border-[#E5E1DB] bg-white text-xs sm:text-sm focus:outline-none focus:border-[#A68966]"
              >
                <option value="daily">Page 1: Daily Service Request</option>
                <option value="returnable">Page 2: Returnable Appliance</option>
                <option value="fnb_deposit">Page 3: F&B Dining Utensil (Deposit)</option>
                <option value="quick_food">Page 3: Quick Food Item</option>
              </select>
            </div>

            <div className="md:col-span-1">
              <label htmlFor="new-item-name" className="block text-xs uppercase tracking-wider text-[#2D2926] font-semibold mb-1">
                Item Name
              </label>
              <input
                id="new-item-name"
                type="text"
                required
                placeholder="e.g. Yoga Mat, Extension Board, Apple Juice"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                className="w-full p-2.5 border border-[#E5E1DB] bg-white text-xs sm:text-sm focus:outline-none focus:border-[#A68966]"
              />
            </div>

            <div>
              <label htmlFor="new-item-stock" className="block text-xs uppercase tracking-wider text-[#2D2926] font-semibold mb-1">
                Total Stock Quantity
              </label>
              <input
                id="new-item-stock"
                type="number"
                min="1"
                required
                value={newItemLimit}
                onChange={(e) => setNewItemLimit(e.target.value)}
                className="w-full p-2.5 border border-[#E5E1DB] bg-white text-xs sm:text-sm text-center focus:outline-none focus:border-[#A68966]"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="px-6 py-2.5 bg-[#A68966] text-white text-xs font-semibold uppercase tracking-widest hover:bg-[#8E7455] transition-colors cursor-pointer"
            >
              Save & Add to System
            </button>
          </div>
        </form>
      )}

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
                );
              })}
            </div>
          </div>
        </section>

        {/* SECTION 4: CUSTOM ITEMS (If any added) */}
        {customItems.length > 0 && (
          <section className="bg-white border border-[#E5E1DB] p-6 shadow-sm">
            <h3 className="font-serif text-xl font-medium text-[#2D2926] mb-4">
              Custom Added Items
            </h3>
            <div className="space-y-3">
              {customItems.map((itemName) => {
                const isAvailable = amenityStatus[itemName] !== 'out_of_service';
                const inv = inventoryMap[itemName] || { limit: 1, inUse: 0 };
                const total = inv.limit || 1;

                return (
                  <div
                    key={itemName}
                    className={`p-3.5 border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                      isAvailable ? "bg-[#FAF8F5] border-[#E5E1DB]" : "bg-red-50/70 border-red-200"
                    }`}
                  >
                    <span className="font-medium text-sm text-[#2D2926]">{itemName}</span>

                    <div className="flex items-center gap-2.5">
                      <div className="flex items-center gap-1 bg-white border border-[#E5E1DB] px-1.5 py-0.5">
                        <span className="text-xs text-[#8C857D] mr-1">Stock:</span>
                        <button
                          type="button"
                          onClick={() => handleLimitChange(itemName, Math.max(0, total - 1))}
                          className="w-5 h-5 flex items-center justify-center border border-[#E5E1DB] text-xs font-bold cursor-pointer"
                        >
                          <Minus className="w-2.5 h-2.5" />
                        </button>
                        <span className="w-8 text-center font-mono font-bold text-xs">{total}</span>
                        <button
                          type="button"
                          onClick={() => handleLimitChange(itemName, total + 1)}
                          className="w-5 h-5 flex items-center justify-center border border-[#E5E1DB] text-xs font-bold cursor-pointer"
                        >
                          <Plus className="w-2.5 h-2.5" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleStatus(itemName)}
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
                        onClick={() => handleDeleteItem(itemName)}
                        className="p-1.5 text-red-600 hover:text-red-800 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Superhost PIN Section (Superhost only) */}
        {role === "superhost" && (
          <section className="bg-white border border-[#E5E1DB] p-6 shadow-sm">
            <h4 className="font-serif text-lg text-[#2D2926] mb-1">Superhost Access PIN</h4>
            <p className="text-xs text-[#8C857D] mb-3">
              Change the PIN required to access the Superhost Portal.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="text"
                maxLength={8}
                value={superhostPin}
                onChange={(e) => setSuperhostPin(e.target.value)}
                placeholder="9999"
                className="w-28 p-2.5 border border-[#E5E1DB] bg-white text-center font-mono tracking-widest text-sm focus:outline-none focus:border-[#A68966]"
              />
              <span className="text-xs text-[#8C857D]">Default PIN: 9999</span>
            </div>
          </section>
        )}

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
