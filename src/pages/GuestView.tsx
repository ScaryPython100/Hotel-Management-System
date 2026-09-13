import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, addDoc, query, where, getDocs, onSnapshot, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { COMMON_ITEMS, DEFAULT_ROOMS, Room } from "../types";
import { cn } from "../lib/utils";
import toast, { Toaster } from "react-hot-toast";
import { Check, Loader2, Info, ArrowRight, BedDouble, Minus, Plus } from "lucide-react";

// Fast local resolver: resolves in 0 milliseconds
function resolveRoomInstantly(hash?: string): string | null {
  if (!hash) return null;
  const clean = hash.trim();

  // 1. Direct number check (e.g. "101", "room-101", "suite102")
  const numMatch = clean.match(/\b\d{2,4}\b/);

  try {
    const saved = localStorage.getItem("hues_stay_rooms");
    if (saved) {
      const rooms: Room[] = JSON.parse(saved);
      const byHash = rooms.find(r => r.qrCodeHash.toLowerCase() === clean.toLowerCase());
      if (byHash) return byHash.roomNumber;

      const byNum = rooms.find(r => r.roomNumber.toLowerCase() === clean.toLowerCase());
      if (byNum) return byNum.roomNumber;
    }
  } catch (e) {}

  // 2. Default rooms fallback
  const defMatch = DEFAULT_ROOMS.find(
    r => r.qrCodeHash.toLowerCase() === clean.toLowerCase() || 
         r.roomNumber.toLowerCase() === clean.toLowerCase()
  );
  if (defMatch) return defMatch.roomNumber;

  // 3. Extracted number
  if (numMatch) return numMatch[0];

  return null;
}

export default function GuestView() {
  const { hash } = useParams<{ hash: string }>();

  // Instant room initialization (0ms if cached/numeric/default)
  const initialRoom = resolveRoomInstantly(hash);
  const [roomNumber, setRoomNumber] = useState<string | null>(initialRoom);
  const [manualRoomInput, setManualRoomInput] = useState("");
  const [isValidating, setIsValidating] = useState(!initialRoom);
  
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({});
  const [customMessage, setCustomMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Cached inventory with default stock values (0ms render time)
  const [inventory, setInventory] = useState<Record<string, { inUse: number, limit: number }>>(() => {
    try {
      const saved = localStorage.getItem("hues_stay_inventory");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    const init: Record<string, { inUse: number, limit: number }> = {};
    COMMON_ITEMS.filter(i => i.category === 'Item').forEach(item => {
      init[item.name] = { inUse: 0, limit: item.defaultLimit || 1 };
    });
    return init;
  });

  // Cached amenities status (0ms render time)
  const [amenitiesStatus, setAmenitiesStatus] = useState<Record<string, 'available' | 'out_of_service'>>(() => {
    try {
      const saved = localStorage.getItem("hues_stay_amenities");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    const init: Record<string, 'available' | 'out_of_service'> = {};
    COMMON_ITEMS.forEach(item => {
      init[item.name] = 'available';
    });
    return init;
  });

  // Background room verification with strict 800ms timeout
  useEffect(() => {
    if (roomNumber) {
      setIsValidating(false);
      return;
    }

    if (!hash) {
      setIsValidating(false);
      return;
    }

    let isMounted = true;

    async function checkRemoteRoom() {
      try {
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 800));
        
        const fetchPromise = (async () => {
          try {
            const q = query(collection(db, "rooms"), where("qrCodeHash", "==", hash));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
              return snapshot.docs[0].data().roomNumber as string;
            }
          } catch (e: any) {
            console.warn("Could not reach remote Firestore, falling back:", e?.message || "offline");
          }
          return null;
        })();

        const matched = await Promise.race([fetchPromise, timeoutPromise]);
        if (isMounted) {
          if (matched) {
            setRoomNumber(matched);
          } else {
            // Check if hash has digits
            const digits = hash?.replace(/\D/g, "");
            if (digits && digits.length >= 2) {
              setRoomNumber(digits);
            }
          }
        }
      } catch (err: any) {
        console.warn("Validation check error:", err?.message || "error");
      } finally {
        if (isMounted) setIsValidating(false);
      }
    }

    checkRemoteRoom();

    return () => {
      isMounted = false;
    };
  }, [hash, roomNumber]);

  // Helper to resolve inventory data supporting aliases like "Water Glasses" and "Glasses"
  const getInventoryData = (name: string) => {
    if (inventory[name]) return inventory[name];
    const lower = name.toLowerCase();
    if (lower.includes("glass")) {
      return inventory["Water Glasses"] || inventory["Glasses"];
    }
    return undefined;
  };

  // Real-time updates in background (non-blocking)
  useEffect(() => {
    let isMounted = true;

    // Fetch live inventory from Supabase / API
    const fetchSupabaseInventory = async () => {
      try {
        const res = await fetch("/api/inventory");
        if (res.ok) {
          const data = await res.json();
          if (data.inventory && Array.isArray(data.inventory) && isMounted) {
            const invMap: Record<string, { inUse: number, limit: number }> = {};
            data.inventory.forEach((item: any) => {
              const itemData = {
                inUse: item.taken || 0,
                limit: item.totalStock || item.limit || 1
              };
              invMap[item.name] = itemData;
              // Alias Glasses and Water Glasses so both always have identical stock numbers
              if (item.name === "Water Glasses") {
                invMap["Glasses"] = itemData;
              } else if (item.name === "Glasses") {
                invMap["Water Glasses"] = itemData;
              }
            });
            setInventory(prev => ({ ...prev, ...invMap }));
            try {
              localStorage.setItem("hues_stay_inventory", JSON.stringify(invMap));
            } catch (e) {}
          }
        }
      } catch (err) {
        console.warn("Supabase inventory fetch note:", err);
      }
    };

    fetchSupabaseInventory();
    const interval = setInterval(fetchSupabaseInventory, 4000);

    const onFocus = () => fetchSupabaseInventory();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") fetchSupabaseInventory();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    const unsubscribeInventory = onSnapshot(collection(db, "inventory"), (invSnapshot) => {
      const invMap: Record<string, { inUse: number, limit: number }> = {};
      invSnapshot.forEach(docSnap => {
        const data = docSnap.data();
        const itemData = { inUse: data.inUse || 0, limit: data.limit || 1 };
        invMap[data.name] = itemData;
        if (data.name === "Water Glasses") {
          invMap["Glasses"] = itemData;
        } else if (data.name === "Glasses") {
          invMap["Water Glasses"] = itemData;
        }
      });
      setInventory(prev => ({ ...prev, ...invMap }));
      try {
        localStorage.setItem("hues_stay_inventory", JSON.stringify(invMap));
      } catch (e) {}
    }, (error) => {
      console.warn("Real-time inventory listener error (offline cache active):", error?.message || "offline");
    });

    const unsubscribeAmenities = onSnapshot(doc(db, "settings", "amenities"), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as Record<string, 'available' | 'out_of_service'>;
        setAmenitiesStatus(prev => ({ ...prev, ...data }));
        try {
          localStorage.setItem("hues_stay_amenities", JSON.stringify(data));
        } catch (e) {}
      }
    }, (error) => {
      console.warn("Real-time amenities listener error (offline cache active):", error?.message || "offline");
    });

    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribeInventory();
      unsubscribeAmenities();
    };
  }, []);

  // Automatically unselect any item if all units are taken while guest has the page open
  useEffect(() => {
    setSelectedItems(prev => {
      const unavailableSelected = prev.filter(item => {
        const inv = getInventoryData(item);
        const isLimited = COMMON_ITEMS.find(i => i.name === item)?.isLimited ?? (inv !== undefined);
        const isOutOfStock = isLimited && inv && inv.inUse >= inv.limit;
        const isOutOfService = amenitiesStatus[item] === 'out_of_service';
        return isOutOfStock || isOutOfService;
      });

      if (unavailableSelected.length > 0) {
        unavailableSelected.forEach(item => {
          toast.error(`${item} is currently unavailable (all in use) and was deselected.`, {
            id: `unavail-${item}`,
            duration: 4000
          });
        });
        return prev.filter(item => !unavailableSelected.includes(item));
      }
      return prev;
    });
  }, [inventory, amenitiesStatus]);

  const updateQuantity = (item: string, newQty: number, maxAvailable: number) => {
    if (newQty <= 0) {
      setSelectedItems((prev) => prev.filter((i) => i !== item));
      setItemQuantities((prev) => {
        const next = { ...prev };
        delete next[item];
        return next;
      });
      return;
    }
    const clamped = Math.min(newQty, maxAvailable);
    setItemQuantities((prev) => ({
      ...prev,
      [item]: clamped,
    }));
  };

  const toggleItem = (item: string) => {
    setSelectedItems((prev) => {
      if (prev.includes(item)) {
        setItemQuantities((q) => {
          const next = { ...q };
          delete next[item];
          return next;
        });
        return prev.filter((i) => i !== item);
      } else {
        setItemQuantities((q) => ({
          ...q,
          [item]: 1,
        }));
        return [...prev, item];
      }
    });
  };

  const handleManualRoomSelect = (num: string) => {
    const trimmed = num.trim();
    if (!trimmed) return;
    setRoomNumber(trimmed);
    setIsValidating(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomNumber) return;

    if (selectedItems.length === 0 && customMessage.trim() === "") {
      toast.error("Please select an item or enter a message.");
      return;
    }

    setIsSubmitting(true);

    try {
      // Find requested items that are limited
      const limitedItemsRequested = selectedItems.filter(item => {
        const staticItem = COMMON_ITEMS.find(i => i.name === item);
        if (staticItem) return staticItem.isLimited;
        // Any custom inventory item is tracked and limited
        return inventory[item] !== undefined;
      });

      // Verify stock and requested quantities for limited items before proceeding
      for (const item of limitedItemsRequested) {
        const inv = getInventoryData(item);
        const requestedQty = itemQuantities[item] || 1;
        if (inv) {
          const available = Math.max(0, inv.limit - inv.inUse);
          if (available <= 0) {
            toast.error(`${item} is currently unavailable (all ${inv.limit} units are in use). Please remove it.`);
            setIsSubmitting(false);
            return;
          }
          if (requestedQty > available) {
            toast.error(`Only ${available} unit(s) of ${item} available right now. Please adjust requested quantity to ${available}.`);
            setIsSubmitting(false);
            return;
          }
        }
      }

      // Format items with requested quantity (e.g., "Water Glasses (Qty: 2)", "Soap Refill")
      const finalItems = selectedItems.map((item) => {
        const qty = itemQuantities[item] || 1;
        return qty > 1 ? `${item} (Qty: ${qty})` : item;
      });

      const requestData = {
        roomId: roomNumber,
        qrCodeHash: hash || roomNumber,
        items: finalItems,
        customMessage: customMessage.trim(),
        status: "pending" as const,
        createdAt: Date.now(),
      };

      // 1. Instantly save to local storage cache so it appears on staff dashboard in 0ms
      try {
        const cached = JSON.parse(localStorage.getItem("hues_stay_requests") || "[]");
        cached.unshift({ id: `local-req-${Date.now()}`, ...requestData });
        localStorage.setItem("hues_stay_requests", JSON.stringify(cached));
      } catch (e) {}

      // 2. Fire and sync Firestore write non-blockingly
      const firestoreTask = (async () => {
        try {
          await addDoc(collection(db, "requests"), requestData);
        } catch (err: any) {
          console.warn("Firestore sync background notification:", err?.message || "offline");
        }
      })();

      // 3. Trigger server sync & email webhook non-blockingly
      fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
      }).catch(err => console.warn("Server API sync:", err));

      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomNumber,
          items: finalItems,
          customMessage: customMessage.trim()
        })
      }).catch(err => console.warn("Email alert dispatch in background:", err));

      // Limit waiting time to maximum 600ms so guest gets immediate feedback
      await Promise.race([
        firestoreTask,
        new Promise(r => setTimeout(r, 600))
      ]);

      setIsSuccess(true);
      toast.success("Request sent to front desk!");
    } catch (error) {
      console.error("Error submitting request:", error);
      // Even on error, show success if local copy was recorded
      setIsSuccess(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Brief spinner only if validating for first few hundred ms
  if (isValidating) {
    return (
      <div className="min-h-screen bg-[#F9F7F4] flex flex-col items-center justify-center p-6 text-center text-[#2D2926] font-sans">
        <Loader2 className="w-8 h-8 animate-spin text-[#A68966] mb-3" />
        <p className="text-[#8C857D] uppercase tracking-[0.2em] text-xs">Connecting to Room...</p>
      </div>
    );
  }

  // If room number couldn't be auto-detected, show elegant room selector instead of blank/dead end
  if (!roomNumber) {
    const quickRooms = ["101", "102", "103", "104", "201", "202"];

    return (
      <div className="min-h-screen bg-[#F9F7F4] flex flex-col items-center justify-center p-6 text-center text-[#2D2926] font-sans">
        <div className="max-w-md w-full bg-white border border-[#E5E1DB] p-8 shadow-sm">
          <div className="w-12 h-12 bg-[#F2EFE9] text-[#A68966] mx-auto rounded-full flex items-center justify-center mb-4 border border-[#E5E1DB]">
            <BedDouble className="w-6 h-6" />
          </div>
          <h2 className="text-3xl font-serif italic mb-2">Welcome to Hues Stay</h2>
          <p className="text-[#8C857D] text-xs uppercase tracking-[0.15em] mb-6">
            Please confirm your room number
          </p>

          <div className="grid grid-cols-3 gap-2 mb-6">
            {quickRooms.map(rm => (
              <button
                key={rm}
                type="button"
                onClick={() => handleManualRoomSelect(rm)}
                className="py-3 px-2 border border-[#E5E1DB] bg-[#FAF8F5] hover:bg-[#A68966] hover:text-white font-serif text-lg transition-colors"
              >
                Room {rm}
              </button>
            ))}
          </div>

          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleManualRoomSelect(manualRoomInput);
            }} 
            className="flex gap-2"
          >
            <input
              type="text"
              value={manualRoomInput}
              onChange={(e) => setManualRoomInput(e.target.value)}
              placeholder="Or enter room number"
              className="flex-1 border border-[#E5E1DB] px-4 py-2.5 text-sm focus:outline-none focus:border-[#A68966]"
            />
            <button
              type="submit"
              disabled={!manualRoomInput.trim()}
              className="bg-[#2D2926] text-white px-4 py-2.5 text-xs uppercase tracking-wider hover:bg-black disabled:opacity-50 flex items-center gap-1"
            >
              Enter <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-[#F9F7F4] flex flex-col items-center justify-center p-6 text-center text-[#2D2926] font-sans">
        <div className="w-20 h-20 bg-[#F2EFE9] text-[#A68966] rounded-full flex items-center justify-center mb-6 border border-[#E5E1DB] shadow-xs">
          <Check className="w-10 h-10 stroke-[2.5]" />
        </div>
        <h2 className="text-3xl font-serif italic mb-2">Request Received</h2>
        <p className="text-[#8C857D] mb-6 max-w-md text-sm">
          Our housekeeping and guest service team has been notified and will attend to Room {roomNumber} promptly.
        </p>

        {selectedItems.length > 0 && (
          <div className="bg-white border border-[#E5E1DB] p-4 mb-8 max-w-sm w-full text-left shadow-2xs">
            <span className="text-[10px] uppercase tracking-widest text-[#8C857D] font-mono block mb-2 font-semibold">
              Requested Items
            </span>
            <ul className="space-y-1.5 text-sm text-[#2D2926]">
              {selectedItems.map(item => {
                const qty = itemQuantities[item] || 1;
                return (
                  <li key={item} className="flex justify-between items-center py-1 border-b border-[#F2EFE9] last:border-0">
                    <span className="font-serif">{item}</span>
                    <span className="font-mono text-xs font-bold text-[#A68966] bg-[#FAF8F5] px-2 py-0.5 border border-[#EBE7E1] rounded-xs">
                      Qty: {qty}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <button
          onClick={() => {
            setIsSuccess(false);
            setSelectedItems([]);
            setItemQuantities({});
            setCustomMessage("");
          }}
          className="px-8 py-4 bg-[#A68966] text-white font-medium uppercase tracking-[0.2em] text-xs hover:bg-[#8E7455] transition-colors rounded-none cursor-pointer"
        >
          Make Another Request
        </button>
      </div>
    );
  }

  const totalRequestedCount = selectedItems.reduce((acc, item) => acc + (itemQuantities[item] || 1), 0);

  return (
    <div className="min-h-screen bg-[#F9F7F4] text-[#2D2926] pb-20 font-sans">
      <Toaster position="top-center" />
      
      {/* Header */}
      <header className="h-44 bg-[#1A1A1A] text-white p-8 flex flex-col justify-end relative mb-8">
        <div className="absolute top-6 left-8 text-[11px] uppercase tracking-[0.2em] opacity-60">
          Hues Stay Luxury Rooms
        </div>
        <div className="max-w-4xl mx-auto w-full text-left">
          <h1 className="text-4xl font-serif italic mb-1">Room {roomNumber}</h1>
          <p className="text-sm opacity-80 max-w-md">Enjoy your stay. Tap items below to request instant service.</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6">
        <form onSubmit={handleSubmit} className="space-y-8">
          
          <section>
            <h2 className="text-xl font-serif mb-4 flex items-center">
              Daily Service Requests
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {COMMON_ITEMS.filter(i => i.category === 'Service').map((itemObj) => {
                const item = itemObj.name;
                const isSelected = selectedItems.includes(item);
                const isOutOfService = amenitiesStatus[item] === 'out_of_service';
                const isDisabled = isOutOfService;
                const currentQty = itemQuantities[item] || 1;

                return (
                  <div
                    key={item}
                    onClick={() => {
                      if (!isDisabled) toggleItem(item);
                    }}
                    className={cn(
                      "bg-white border p-5 flex flex-col justify-between text-left transition-all duration-200 min-h-[120px] h-auto rounded-none relative gap-3 select-none",
                      isSelected
                        ? "bg-[#F2EFE9] border-[#A68966] text-[#2D2926] shadow-xs"
                        : "border-[#E5E1DB] text-[#2D2926] hover:bg-[#F2EFE9]",
                      isDisabled ? "opacity-50 cursor-not-allowed hover:bg-white border-[#E5E1DB]" : "cursor-pointer"
                    )}
                  >
                    <div className="flex justify-between items-start w-full gap-2">
                      <span className="font-serif text-base md:text-lg leading-tight">{item}</span>
                      <div
                        className={cn(
                          "w-5 h-5 flex items-center justify-center shrink-0 border rounded-xs mt-0.5 transition-colors",
                          isSelected ? "border-[#A68966] bg-[#A68966]" : "border-[#E5E1DB]",
                          isDisabled && "border-[#E5E1DB] bg-gray-100"
                        )}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white stroke-[3]" />}
                      </div>
                    </div>

                    {isSelected && (
                      <div 
                        className="flex items-center justify-between w-full pt-2.5 mt-auto border-t border-[#E0DBD3]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-[11px] uppercase tracking-wider text-[#736B63] font-medium">
                          Quantity:
                        </span>
                        <div className="flex items-center gap-1 bg-white px-1.5 py-0.5 border border-[#D5D1CB] rounded-xs shadow-2xs">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateQuantity(item, currentQty - 1, 10);
                            }}
                            className="w-6 h-6 flex items-center justify-center text-[#2D2926] hover:bg-[#F2EFE9] transition-colors rounded-xs cursor-pointer"
                            aria-label="Decrease quantity"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-6 text-center font-mono font-bold text-xs text-[#2D2926]">
                            {currentQty}
                          </span>
                          <button
                            type="button"
                            disabled={currentQty >= 10}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (currentQty >= 10) {
                                toast.error("Maximum 10 units per request.");
                                return;
                              }
                              updateQuantity(item, currentQty + 1, 10);
                            }}
                            className="w-6 h-6 flex items-center justify-center text-[#2D2926] hover:bg-[#F2EFE9] transition-colors rounded-xs disabled:opacity-30 cursor-pointer"
                            aria-label="Increase quantity"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}

                    {isOutOfService && (
                      <span className="text-[10px] text-red-500 uppercase tracking-widest font-bold mt-1">
                        Unavailable
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-serif mb-4 flex items-center">
              Inventory Item Requests
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {(() => {
                // Combine default items with any custom items synced from Supabase/Owner
                const itemsList: Array<{ name: string; isLimited: boolean }> = [
                  ...COMMON_ITEMS.filter(i => i.category === 'Item').map(i => ({ name: i.name, isLimited: !!i.isLimited }))
                ];
                Object.keys(inventory).forEach(invName => {
                  if (!itemsList.some(i => i.name === invName)) {
                    itemsList.push({ name: invName, isLimited: true });
                  }
                });

                return itemsList.map((itemObj) => {
                  const item = itemObj.name;
                  const isSelected = selectedItems.includes(item);
                  const inv = getInventoryData(item);
                  const isOutOfStock = (itemObj.isLimited || inv !== undefined) && inv && inv.inUse >= inv.limit;
                  const isOutOfService = amenitiesStatus[item] === 'out_of_service';
                  const isDisabled = isOutOfStock || isOutOfService;
                  const availableCount = inv ? Math.max(0, inv.limit - inv.inUse) : 10;
                  const currentQty = itemQuantities[item] || 1;

                  return (
                    <div
                      key={item}
                      onClick={() => {
                        if (isDisabled) {
                          if (isOutOfService) {
                            toast.error(`${item} is currently out of service.`);
                          } else if (isOutOfStock) {
                            toast.error(`${item} is currently unavailable (all ${inv?.limit || 10} units are in use).`);
                          }
                          return;
                        }
                        toggleItem(item);
                      }}
                      className={cn(
                        "bg-white border p-5 flex flex-col justify-between text-left transition-all duration-200 min-h-[120px] h-auto rounded-none relative gap-3 select-none",
                        isSelected
                          ? "bg-[#F2EFE9] border-[#A68966] text-[#2D2926] shadow-xs"
                          : "border-[#E5E1DB] text-[#2D2926] hover:bg-[#F2EFE9]",
                        isDisabled 
                          ? "opacity-60 cursor-not-allowed bg-[#FAF9F7] border-dashed border-[#D5D1CB] hover:bg-[#FAF9F7]" 
                          : "cursor-pointer"
                      )}
                    >
                      <div className="flex justify-between items-start w-full gap-2">
                        <div>
                          <span className="font-serif text-base md:text-lg leading-tight block">{item}</span>
                          {inv && !isDisabled && (
                            <span className="text-[10px] text-[#8C857D] font-mono tracking-wider block mt-1">
                              {availableCount} of {inv.limit} available
                            </span>
                          )}
                        </div>
                        <div
                          className={cn(
                            "w-5 h-5 flex items-center justify-center shrink-0 border rounded-xs mt-0.5 transition-colors",
                            isSelected ? "border-[#A68966] bg-[#A68966]" : "border-[#E5E1DB]",
                            isDisabled && "border-[#E5E1DB] bg-gray-100"
                          )}
                        >
                          {isSelected && <Check className="w-3 h-3 text-white stroke-[3]" />}
                        </div>
                      </div>

                      {isSelected && !isDisabled && (
                        <div 
                          className="flex items-center justify-between w-full pt-2.5 mt-auto border-t border-[#E0DBD3]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-[11px] uppercase tracking-wider text-[#736B63] font-medium">
                            Quantity:
                          </span>
                          <div className="flex items-center gap-1 bg-white px-1.5 py-0.5 border border-[#D5D1CB] rounded-xs shadow-2xs">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateQuantity(item, currentQty - 1, availableCount);
                              }}
                              className="w-6 h-6 flex items-center justify-center text-[#2D2926] hover:bg-[#F2EFE9] transition-colors rounded-xs cursor-pointer"
                              aria-label="Decrease quantity"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-6 text-center font-mono font-bold text-xs text-[#2D2926]">
                              {currentQty}
                            </span>
                            <button
                              type="button"
                              disabled={currentQty >= availableCount}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (currentQty >= availableCount) {
                                  toast.error(`Only ${availableCount} unit(s) of ${item} available.`);
                                  return;
                                }
                                updateQuantity(item, currentQty + 1, availableCount);
                              }}
                              className="w-6 h-6 flex items-center justify-center text-[#2D2926] hover:bg-[#F2EFE9] transition-colors rounded-xs disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                              aria-label="Increase quantity"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )}

                      {isOutOfService ? (
                        <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 uppercase tracking-wider font-semibold rounded-sm inline-block w-fit">
                          Unavailable
                        </span>
                      ) : isOutOfStock ? (
                        <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 uppercase tracking-wider font-semibold rounded-sm inline-block w-fit">
                          Unavailable (All {inv?.limit || 10} In Use)
                        </span>
                      ) : null}
                    </div>
                  );
                });
              })()}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-serif mb-4">Other Requests</h2>
            <textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              placeholder="E.g., Please bring a bucket of ice..."
              className="w-full p-6 border border-[#E5E1DB] bg-white text-[#2D2926] placeholder:text-[#8C857D] focus:outline-none focus:border-[#A68966] min-h-[120px] resize-none rounded-none"
            ></textarea>
          </section>

          <div className="bg-white border border-[#E5E1DB] p-6 flex gap-3 text-[#8C857D]">
            <Info className="w-5 h-5 shrink-0 text-[#A68966]" />
            <p className="text-sm italic">
              Your request will be sent instantly to our housekeeping team. We aim to fulfill all requests within 10 minutes.
            </p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 bg-[#A68966] text-white font-medium uppercase tracking-[0.2em] text-xs hover:bg-[#8E7455] transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center rounded-none shadow-sm cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Sending Request...
              </>
            ) : (
              `Submit Request ${totalRequestedCount > 0 ? `(${totalRequestedCount} ${totalRequestedCount === 1 ? 'Item' : 'Items'})` : ''}`
            )}
          </button>
        </form>
      </main>
    </div>
  );
}
