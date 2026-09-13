import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, setDoc, query, where, getDocs, onSnapshot, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { COMMON_ITEMS, DEFAULT_ROOMS, Room, getItemUnitConsumption } from "../types";
import { cn } from "../lib/utils";
import toast, { Toaster } from "react-hot-toast";
import { Check, Loader2, Info, ArrowRight, BedDouble, Trash2 } from "lucide-react";

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
  const [customMessage, setCustomMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [lastSubmittedId, setLastSubmittedId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem("hues_last_req_id") || null;
    } catch {
      return null;
    }
  });

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

  // Helper to resolve inventory data supporting aliases like "Glasses (Set of 2)" and "Teakettle"
  const getInventoryData = (name: string) => {
    if (inventory[name]) return inventory[name];
    const lower = name.toLowerCase().trim();
    if (lower.includes("glass")) {
      return inventory["Glasses (Set of 2)"] || inventory["Glasses"] || inventory["Water Glasses"];
    }
    if (lower.includes("kettle") || lower.includes("teakettle")) {
      return inventory["Teakettle"] || inventory["Kettle"];
    }
    const foundKey = Object.keys(inventory).find(k => k.toLowerCase().trim() === lower);
    if (foundKey) return inventory[foundKey];
    return undefined;
  };

  // Real-time updates in background (non-blocking)
  useEffect(() => {
    let isMounted = true;

    // Fetch live inventory from API
    const fetchLiveInventory = async () => {
      try {
        const res = await fetch("/api/inventory");
        if (res.ok) {
          const data = await res.json();
          if (data.inventory && Array.isArray(data.inventory) && isMounted) {
            const invMap: Record<string, { inUse: number, limit: number }> = {};
            data.inventory.forEach((item: any) => {
              const itemData = {
                inUse: item.taken ?? item.inUse ?? 0,
                limit: item.totalStock ?? item.limit ?? 1
              };
              invMap[item.name] = itemData;
              if (item.name.toLowerCase().includes("glass")) {
                invMap["Glasses (Set of 2)"] = itemData;
                invMap["Glasses"] = itemData;
              } else if (item.name.toLowerCase().includes("kettle") || item.name.toLowerCase().includes("teakettle")) {
                invMap["Teakettle"] = itemData;
                invMap["Kettle"] = itemData;
              }
            });
            setInventory(prev => ({ ...prev, ...invMap }));
            try {
              localStorage.setItem("hues_stay_inventory", JSON.stringify(invMap));
            } catch (e) {}
          }
        }
      } catch (err) {
        console.warn("Inventory fetch note:", err);
      }
    };

    fetchLiveInventory();
    const interval = setInterval(fetchLiveInventory, 3000);

    const onFocus = () => fetchLiveInventory();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") fetchLiveInventory();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    const unsubscribeInventory = onSnapshot(collection(db, "inventory"), (invSnapshot) => {
      const invMap: Record<string, { inUse: number, limit: number }> = {};
      invSnapshot.forEach(docSnap => {
        const data = docSnap.data();
        const itemData = { inUse: data.inUse || 0, limit: data.limit || 1 };
        invMap[data.name] = itemData;
        if (data.name.toLowerCase().includes("glass")) {
          invMap["Glasses (Set of 2)"] = itemData;
          invMap["Glasses"] = itemData;
        } else if (data.name.toLowerCase().includes("kettle") || data.name.toLowerCase().includes("teakettle")) {
          invMap["Teakettle"] = itemData;
          invMap["Kettle"] = itemData;
        }
      });
      setInventory(prev => ({ ...prev, ...invMap }));
      try {
        localStorage.setItem("hues_stay_inventory", JSON.stringify(invMap));
      } catch (e) {}
    }, (error) => {
      console.warn("Real-time inventory listener error:", error?.message || "offline");
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
      console.warn("Real-time amenities listener error:", error?.message || "offline");
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
        const neededUnits = getItemUnitConsumption(item);
        const availableUnits = inv ? Math.max(0, inv.limit - inv.inUse) : 10;
        const isLimited = COMMON_ITEMS.find(i => i.name === item)?.isLimited ?? (inv !== undefined);
        const isOutOfStock = isLimited && inv && (availableUnits < neededUnits);
        const isOutOfService = amenitiesStatus[item] === 'out_of_service';
        return isOutOfStock || isOutOfService;
      });

      if (unavailableSelected.length > 0) {
        unavailableSelected.forEach(item => {
          toast.error(`${item} is currently unavailable and was deselected.`, {
            id: `unavail-${item}`,
            duration: 4000
          });
        });
        return prev.filter(item => !unavailableSelected.includes(item));
      }
      return prev;
    });
  }, [inventory, amenitiesStatus]);

  const toggleItem = (item: string) => {
    setSelectedItems((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
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
        return inventory[item] !== undefined;
      });

      // Verify stock for limited items using internal unit consumption before proceeding
      for (const item of limitedItemsRequested) {
        const inv = getInventoryData(item);
        const neededUnits = getItemUnitConsumption(item);
        if (inv) {
          const available = Math.max(0, inv.limit - inv.inUse);
          if (available < neededUnits) {
            toast.error(`${item} is currently unavailable. Please remove it from your selection.`);
            setIsSubmitting(false);
            return;
          }
        }
      }

      const finalItems = [...selectedItems];
      const reqId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      const requestData = {
        id: reqId,
        roomId: roomNumber,
        qrCodeHash: hash || roomNumber,
        items: finalItems,
        customMessage: customMessage.trim(),
        status: "pending" as const,
        createdAt: Date.now(),
      };

      setLastSubmittedId(reqId);
      try {
        sessionStorage.setItem("hues_last_req_id", reqId);
      } catch (e) {}

      // 1. Instantly save to local storage cache so it appears on staff dashboard in 0ms
      try {
        const cached = JSON.parse(localStorage.getItem("hues_stay_requests") || "[]");
        cached.unshift(requestData);
        localStorage.setItem("hues_stay_requests", JSON.stringify(cached));
      } catch (e) {}

      // 2. Fire and sync Firestore write non-blockingly using canonical reqId as doc ID
      const firestoreTask = (async () => {
        try {
          await setDoc(doc(db, "requests", reqId), requestData);
        } catch (err: any) {
          console.warn("Firestore sync background notification:", err?.message || "offline");
        }
      })();

      // 3. Trigger server sync & email webhook non-blockingly (handles Supabase + Email dispatch in one shot)
      fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
      }).catch(err => console.warn("Server API sync:", err));

      // Limit waiting time to maximum 600ms so guest gets immediate feedback
      await Promise.race([
        firestoreTask,
        new Promise(r => setTimeout(r, 600))
      ]);

      setIsSuccess(true);
      toast.success("Request sent to front desk!");
    } catch (error) {
      console.error("Error submitting request:", error);
      setIsSuccess(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!lastSubmittedId) {
      setIsSuccess(false);
      return;
    }
    if (!window.confirm("Are you sure you want to cancel and remove this request?")) return;
    
    try {
      await fetch(`/api/requests/${lastSubmittedId}`, { method: 'DELETE' });
    } catch (e) {}

    try {
      const cached = JSON.parse(localStorage.getItem("hues_stay_requests") || "[]");
      const next = cached.filter((r: any) => r.id !== lastSubmittedId);
      localStorage.setItem("hues_stay_requests", JSON.stringify(next));
    } catch (e) {}

    try {
      sessionStorage.removeItem("hues_last_req_id");
    } catch (e) {}

    setLastSubmittedId(null);
    setIsSuccess(false);
    setSelectedItems([]);
    setCustomMessage("");
    toast.success("Your request was cancelled and removed from the active queue.");
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
              {selectedItems.map(item => (
                <li key={item} className="flex justify-between items-center py-1 border-b border-[#F2EFE9] last:border-0">
                  <span className="font-serif">{item}</span>
                  <span className="font-mono text-xs text-[#A68966] bg-[#FAF8F5] px-2 py-0.5 border border-[#EBE7E1] rounded-xs">
                    Requested
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => {
              setIsSuccess(false);
              setSelectedItems([]);
              setCustomMessage("");
            }}
            className="px-8 py-4 bg-[#A68966] text-white font-medium uppercase tracking-[0.2em] text-xs hover:bg-[#8E7455] transition-colors rounded-none cursor-pointer"
          >
            Make Another Request
          </button>
          <button
            type="button"
            onClick={handleCancelRequest}
            className="px-6 py-4 bg-white text-red-700 border border-red-200 font-medium uppercase tracking-[0.2em] text-xs hover:bg-red-50 transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-500" />
            Cancel / Remove Request
          </button>
        </div>
      </div>
    );
  }

  const totalRequestedCount = selectedItems.length;

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

                return (
                  <div
                    key={item}
                    onClick={() => {
                      if (!isDisabled) {
                        toggleItem(item);
                      } else {
                        toast.error(`${item} is currently out of service.`);
                      }
                    }}
                    className={cn(
                      "bg-white border p-5 flex flex-col justify-between text-left transition-all duration-200 min-h-[90px] h-auto rounded-none relative gap-3 select-none",
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

                    {isOutOfService && (
                      <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 uppercase tracking-wider font-semibold rounded-sm inline-block w-fit">
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
                  const neededUnits = getItemUnitConsumption(item);
                  const availableUnits = inv ? Math.max(0, inv.limit - inv.inUse) : 10;
                  const isOutOfStock = (itemObj.isLimited || inv !== undefined) && inv && (availableUnits < neededUnits);
                  const isOutOfService = amenitiesStatus[item] === 'out_of_service';
                  const isDisabled = isOutOfStock || isOutOfService;

                  return (
                    <div
                      key={item}
                      onClick={() => {
                        if (isDisabled) {
                          toast.error(`${item} is currently unavailable.`);
                          return;
                        }
                        toggleItem(item);
                      }}
                      className={cn(
                        "bg-white border p-5 flex flex-col justify-between text-left transition-all duration-200 min-h-[90px] h-auto rounded-none relative gap-3 select-none",
                        isSelected
                          ? "bg-[#F2EFE9] border-[#A68966] text-[#2D2926] shadow-xs"
                          : "border-[#E5E1DB] text-[#2D2926] hover:bg-[#F2EFE9]",
                        isDisabled 
                          ? "opacity-60 cursor-not-allowed bg-[#FAF9F7] border-dashed border-[#D5D1CB] hover:bg-[#FAF9F7]" 
                          : "cursor-pointer"
                      )}
                    >
                      <div className="flex justify-between items-start w-full gap-2">
                        <span className="font-serif text-base md:text-lg leading-tight block">{item}</span>
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

                      {isDisabled && (
                        <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 uppercase tracking-wider font-semibold rounded-sm inline-block w-fit">
                          Unavailable
                        </span>
                      )}
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
