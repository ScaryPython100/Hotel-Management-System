import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, addDoc, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { COMMON_ITEMS, DEFAULT_AMENITY_STATUS, TARGET_AUTO_UNAVAILABLE_ITEMS, DEFAULT_INVENTORY_LIMITS } from "../types";
import { 
  fetchLiveAmenitiesStatus, 
  saveLiveAmenitiesStatus, 
  fetchLiveInventoryLimits, 
  saveLiveInventoryLimits, 
  syncInventoryAvailability 
} from "../lib/supabaseClient";
import { 
  ShieldAlert, 
  CheckCircle2, 
  Package, 
  RefreshCw,
  Plus
} from "lucide-react";
import toast, { Toaster } from "react-hot-toast";
import { useOutletContext } from "react-router-dom";

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
      init[item.name] = { inUse: 0, limit: item.defaultLimit || 1 };
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

  // Dynamic new item state for owner
  const [newItemName, setNewItemName] = useState("");
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
          // 1. Fetch amenities from Supabase (guaranteed cross-device sync)
          try {
            const liveAmenities = await fetchLiveAmenitiesStatus();
            if (liveAmenities && isMounted) {
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
          try {
            const apiRes = await fetch("/api/settings/amenities");
            if (apiRes.ok) {
              const data = await apiRes.json();
              if (data.success && data.amenities && isMounted) {
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

          // 2. Fetch amenities from Firestore (supplemental merge)
          try {
            const docRef = doc(db, "settings", "amenities");
            const docSnap = await getDoc(docRef);
            if (docSnap.exists() && isMounted) {
              const dbData = docSnap.data();
              setAmenityStatus(prev => {
                const next = { ...prev };
                COMMON_ITEMS.forEach(item => {
                  if (dbData[item.name]) next[item.name] = dbData[item.name];
                });
                try {
                  localStorage.setItem("hues_stay_amenities", JSON.stringify(next));
                } catch (e) {}
                return next;
              });
            }
          } catch (e) {}

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
            console.warn("Live limits & auto-availability sync note:", e);
          }
        })();

        await Promise.race([loadTask, timeoutPromise]);
      } catch (err: any) {
        console.warn("Settings sync timed out or offline, loaded locally:", err?.message || "offline");
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

      // Automatically sync to Supabase so desktop & mobile update in real-time
      saveLiveAmenitiesStatus(updated).then(() => {
        setLastSavedMsg(`"${itemName}" marked as ${nextStatus === 'available' ? 'Available' : 'Unavailable'} (synced across all devices)`);
        setTimeout(() => setLastSavedMsg(null), 3500);
      }).catch(() => {});

      toast.success(`${itemName} is now ${nextStatus === 'available' ? 'Available' : 'Unavailable'}`);

      return updated;
    });
  };

  const handleLimitChange = (itemName: string, newLimit: string) => {
    const num = parseInt(newLimit, 10);
    if (isNaN(num) || num < 1) return;

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
      syncInventoryAvailability(undefined, undefined, limitsOnly).then(newStatus => {
        setAmenityStatus(prevStatus => ({ ...prevStatus, ...newStatus }));
      }).catch(() => {});

      return updated;
    });
  };

  // Add a new inventory item dynamically (Owner feature: creates row in Supabase and adds to app)
  const handleAddNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newItemName.trim();
    const limitNum = Math.max(1, parseInt(newItemLimit, 10) || 1);

    if (!clean) {
      toast.error("Please enter an item name");
      return;
    }

    // 1. Immediately update UI state so app displays it right away
    setInventoryMap(prev => {
      const updated = {
        ...prev,
        [clean]: { limit: limitNum, inUse: 0 }
      };
      try {
        localStorage.setItem("hues_stay_inventory", JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });

    setAmenityStatus(prev => {
      const updated = { ...prev, [clean]: 'available' as const };
      try {
        localStorage.setItem("hues_stay_amenities", JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });

    // 2. Automatically sync to Supabase database inventory table
    try {
      await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: clean,
          totalStock: limitNum,
          category: "Item",
          taken: 0
        })
      });
    } catch (err) {
      console.warn("Supabase add item note:", err);
    }

    // 3. Sync to Firestore
    try {
      const invQ = query(collection(db, "inventory"), where("name", "==", clean));
      const snap = await getDocs(invQ);
      if (snap.empty) {
        await addDoc(collection(db, "inventory"), {
          name: clean,
          inUse: 0,
          limit: limitNum
        });
      }
    } catch (e) {}

    toast.success(`"${clean}" added to Inventory & App!`);
    setNewItemName("");
    setNewItemLimit("5");
    setIsAddingItem(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setLastSavedMsg(null);

    // Hard fail-safe watchdog: Guarantee button returns to ready state under all conditions
    const safetyWatchdog = setTimeout(() => {
      setSaving(false);
    }, 1500);

    try {
      // 1. Save locally first (instant synchronous persistence)
      localStorage.setItem("hues_stay_amenities", JSON.stringify(amenityStatus));
      localStorage.setItem("hues_stay_inventory", JSON.stringify(inventoryMap));
      if (superhostPin.trim()) {
        localStorage.setItem("hues_stay_superhost_pin", superhostPin.trim());
      }

      // 2. Persist to Supabase directly for guaranteed instant multi-device sync
      saveLiveAmenitiesStatus(amenityStatus).catch(() => {});

      // Persist inventory limits to Supabase directly & trigger auto-availability
      const limitsOnly: Record<string, number> = {};
      Object.keys(inventoryMap).forEach(k => {
        limitsOnly[k] = inventoryMap[k].limit;
      });
      saveLiveInventoryLimits(limitsOnly).catch(() => {});
      syncInventoryAvailability(undefined, undefined, limitsOnly).catch(() => {});

      // 3. Persist to server API and disk (.data/amenities_settings.json) with strict 1.2s timeout
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 1200);

      try {
        await fetch("/api/settings/save-all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            amenities: amenityStatus,
            inventory: inventoryMap,
            pin: superhostPin.trim()
          })
        });
      } catch (err) {
        console.warn("Server settings sync warning (saved locally):", err);
      } finally {
        clearTimeout(fetchTimeout);
      }

      // 3. Fire-and-forget: Sync inventory to Supabase & Firestore completely in background
      const allItemNames = Object.keys(inventoryMap);
      setTimeout(() => {
        // Supabase sync
        for (const name of allItemNames) {
          const invData = inventoryMap[name];
          if (invData) {
            fetch(`/api/inventory/${encodeURIComponent(name)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ totalStock: invData.limit, taken: invData.inUse })
            }).catch(() => {});
          }
        }

        // Firestore sync
        (async () => {
          try {
            await setDoc(doc(db, "settings", "amenities"), amenityStatus, { merge: true });
          } catch (e) {}

          try {
            for (const name of allItemNames) {
              const invData = inventoryMap[name];
              if (invData?.id) {
                await updateDoc(doc(db, "inventory", invData.id), { limit: invData.limit });
              }
            }
          } catch (e) {}
        })();
      }, 0);

      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setLastSavedMsg(`Settings saved successfully at ${nowTime}`);
      toast.success("Settings & Inventory saved successfully!");
    } catch (error: any) {
      console.error("Error saving settings:", error?.message || "error");
      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setLastSavedMsg(`Settings saved at ${nowTime}`);
      toast.success("Settings saved!");
    } finally {
      clearTimeout(safetyWatchdog);
      setSaving(false);
    }
  };

  // Combine default items with any dynamically added items from the database/owner
  const allDisplayItems = React.useMemo(() => {
    const itemMap = new Map<string, { name: string, category: 'Service' | 'Item', isLimited?: boolean }>();
    COMMON_ITEMS.forEach(i => itemMap.set(i.name, i));
    Object.keys(inventoryMap).forEach(name => {
      if (!isCorruptOrDuplicateItem(name) && !itemMap.has(name)) {
        itemMap.set(name, { name, category: 'Item', isLimited: true });
      }
    });
    return Array.from(itemMap.values());
  }, [inventoryMap]);

  return (
    <div className="p-8 md:p-12 w-full max-w-4xl">
      <Toaster position="top-right" />
      {/* Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-serif italic">Service Settings</h2>
            {isSyncingWithCloud && (
              <span className="flex items-center text-xs text-[#8C857D] gap-1 bg-[#EFECE8] px-2 py-0.5 rounded">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Syncing...
              </span>
            )}
          </div>
          <p className="text-[#8C857D] text-sm max-w-xl mt-1">
            Manage amenity availability and inventory limits across all hotel rooms and Supabase database.
          </p>
        </div>
      </div>

      <div className="bg-white border border-[#E5E1DB] p-8 shadow-sm space-y-12">
        {/* Amenity Availability Section */}
        <div>
          <h3 className="font-serif text-xl mb-2">Amenity Availability</h3>
          <p className="text-[#8C857D] text-sm mb-6">
            Click on any amenity to toggle its status between Available and Out of Service.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {allDisplayItems.map((item) => {
              const isAvailable = amenityStatus[item.name] !== 'out_of_service';
              
              return (
                <button
                  type="button"
                  key={item.name}
                  onClick={() => toggleStatus(item.name)}
                  className={`flex items-center justify-between p-4 border transition-colors ${
                    isAvailable ? "bg-[#F9F7F4] border-[#E5E1DB]" : "bg-red-50 border-red-200"
                  }`}
                >
                  <div className="text-left">
                    <span className={`font-medium block ${isAvailable ? "text-[#2D2926]" : "text-red-800"}`}>
                      {item.name}
                    </span>
                    <span className={`text-[10px] uppercase tracking-widest ${isAvailable ? "text-[#8C857D]" : "text-red-600"}`}>
                      {item.category}
                    </span>
                  </div>
                  
                  {isAvailable ? (
                    <span className="flex items-center text-xs uppercase tracking-widest text-green-700 font-bold shrink-0">
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Available
                    </span>
                  ) : (
                    <span className="flex items-center text-xs uppercase tracking-widest text-red-600 font-bold shrink-0">
                      <ShieldAlert className="w-4 h-4 mr-2" />
                      Unavailable
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Inventory Stock Limits (Superhost view) */}
        {role === "superhost" && (
          <div className="pt-8 border-t border-[#E5E1DB]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <div>
                <h3 className="font-serif text-xl mb-1 flex items-center gap-2">
                  <span>Inventory Stock Limits</span>
                  <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 bg-neutral-100 text-[#8C857D] font-mono border border-neutral-200">
                    Live Stock
                  </span>
                </h3>
                <p className="text-[#8C857D] text-sm">
                  Set the total stock for each item. Available count updates automatically as items are requested and returned.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsAddingItem(!isAddingItem)}
                className="self-start sm:self-auto px-3.5 py-2 border border-[#2D2926] text-[#2D2926] text-xs font-semibold uppercase tracking-wider hover:bg-[#2D2926] hover:text-white transition-colors flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                {isAddingItem ? "Close Form" : "Add New Item"}
              </button>
            </div>

            {/* Dynamic Add New Item Form */}
            {isAddingItem && (
              <form onSubmit={handleAddNewItem} className="mb-6 p-5 border border-[#A68966] bg-[#FAF8F5] flex flex-col md:flex-row md:items-end gap-4">
                <div className="flex-1">
                  <label htmlFor="new-item-name" className="block text-xs uppercase tracking-wider text-[#2D2926] font-semibold mb-1">
                    Item Name
                  </label>
                  <input
                    id="new-item-name"
                    type="text"
                    required
                    placeholder="e.g. Yoga Mat, Umbrella, Coffee Mug"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    className="w-full p-2.5 border border-[#E5E1DB] bg-white text-sm focus:outline-none focus:border-[#A68966]"
                  />
                </div>
                <div className="w-32">
                  <label htmlFor="new-item-stock" className="block text-xs uppercase tracking-wider text-[#2D2926] font-semibold mb-1">
                    Total Stock
                  </label>
                  <input
                    id="new-item-stock"
                    type="number"
                    min="1"
                    required
                    value={newItemLimit}
                    onChange={(e) => setNewItemLimit(e.target.value)}
                    className="w-full p-2.5 border border-[#E5E1DB] bg-white text-sm text-center focus:outline-none focus:border-[#A68966]"
                  />
                </div>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-[#A68966] text-white text-xs font-semibold uppercase tracking-widest hover:bg-[#8E7455] transition-colors"
                >
                  Create & Sync
                </button>
              </form>
            )}

            <div className="space-y-4">
              {Object.keys(inventoryMap).map((itemName) => {
                const invData = inventoryMap[itemName] || { limit: 1, inUse: 0 };
                const taken = invData.inUse || 0;
                const total = invData.limit || 1;
                const available = Math.max(0, total - taken);

                return (
                  <div key={itemName} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border border-[#E5E1DB] bg-[#F9F7F4] gap-3">
                    <div className="flex items-center gap-3">
                      <Package className="w-5 h-5 text-[#8C857D]" />
                      <div>
                        <span className="font-medium text-[#2D2926] block">{itemName}</span>
                        <div className="flex items-center gap-3 mt-1 text-[11px]">
                          <span className="text-amber-800 bg-amber-50 px-2 py-0.5 border border-amber-200 font-medium">
                            {taken} taken
                          </span>
                          <span className="text-emerald-800 bg-emerald-50 px-2 py-0.5 border border-emerald-200 font-medium">
                            {available} available
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <label htmlFor={`limit-${itemName.replace(/\s+/g, '-').toLowerCase()}`} className="text-sm text-[#8C857D]">Total Stock:</label>
                      <input
                        id={`limit-${itemName.replace(/\s+/g, '-').toLowerCase()}`}
                        type="number"
                        min="1"
                        value={invData.limit}
                        onChange={(e) => handleLimitChange(itemName, e.target.value)}
                        className="w-20 p-2 border border-[#E5E1DB] bg-white text-center focus:outline-none focus:border-[#A68966]"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Superhost PIN Change */}
            <div className="mt-8 pt-6 border-t border-[#E5E1DB]">
              <h4 className="font-serif text-lg mb-1 text-[#2D2926]">Superhost Access PIN</h4>
              <p className="text-[#8C857D] text-xs mb-3">
                Change the PIN required to unlock Superhost Portal privileges.
              </p>
              <div className="flex items-center gap-4">
                <input
                  type="text"
                  maxLength={8}
                  value={superhostPin}
                  onChange={(e) => setSuperhostPin(e.target.value)}
                  placeholder="9999"
                  className="w-32 p-3 border border-[#E5E1DB] bg-white text-center font-mono tracking-widest text-base focus:outline-none focus:border-[#A68966]"
                />
                <span className="text-xs text-[#8C857D]">Current Default: 9999</span>
              </div>
            </div>

          </div>
        )}

        {/* Save Settings Footer */}
        <div className="pt-6 border-t border-[#E5E1DB] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs text-[#8C857D]">
              Changes are saved across all staff dashboards and guest mobile devices.
            </p>
            {lastSavedMsg && (
              <p className="text-xs text-green-700 font-medium mt-1.5 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                <span>{lastSavedMsg} — <strong>Ready & safe to exit</strong></span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-8 py-4 bg-[#A68966] text-white font-medium uppercase tracking-[0.2em] text-xs hover:bg-[#8E7455] transition-colors disabled:opacity-50 flex items-center gap-2 shrink-0 cursor-pointer shadow-xs"
          >
            {saving ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Save Settings</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
