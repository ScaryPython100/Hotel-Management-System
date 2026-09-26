import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, setDoc, query, where, getDocs, onSnapshot, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { 
  getClientSupabase, 
  fetchLiveAmenitiesStatus, 
  fetchLiveBorrowed, 
  fetchLiveRequests, 
  fetchLiveInventoryLimits,
  fetchLiveDeletedItems,
  syncInventoryAvailability 
} from "../lib/supabaseClient";
import { 
  COMMON_ITEMS, 
  DEFAULT_ROOMS, 
  Room, 
  getItemUnitConsumption, 
  DEFAULT_AMENITY_STATUS,
  TARGET_AUTO_UNAVAILABLE_ITEMS,
  DEFAULT_INVENTORY_LIMITS,
  normalizeReturnableName,
  isTargetAutoUnavailableItem
} from "../types";
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
  const [showGuestForm, setShowGuestForm] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
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
      if (saved) {
        return { ...DEFAULT_AMENITY_STATUS, ...JSON.parse(saved) };
      }
    } catch (e) {}
    return { ...DEFAULT_AMENITY_STATUS };
  });

  const [deletedItems, setDeletedItems] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("hues_stay_deleted_items");
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
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

    // Fetch live inventory directly from Supabase borrowed items, requests, limits, and deleted items
    const fetchLiveInventory = async () => {
      try {
        const [liveBor, liveReqs, liveLimits, liveDeleted] = await Promise.all([
          fetchLiveBorrowed(),
          fetchLiveRequests(),
          fetchLiveInventoryLimits(),
          fetchLiveDeletedItems()
        ]);

        const deletedSet = new Set(liveDeleted || []);
        if (isMounted && liveDeleted) {
          setDeletedItems(liveDeleted);
          try {
            localStorage.setItem("hues_stay_deleted_items", JSON.stringify(liveDeleted));
          } catch (e) {}
        }

        const limits: Record<string, number> = {
          ...DEFAULT_INVENTORY_LIMITS,
          ...(liveLimits || {})
        };

        const activeBorrowed = (liveBor || []).filter(b => b.status === "borrowed");
        const pendingReqs = (liveReqs || []).filter(r => r.status === "pending");

        const invMap: Record<string, { inUse: number, limit: number }> = {};

        // Include ALL items: default items + target items + custom items added via limits
        const allItemKeys = Array.from(new Set([
          ...COMMON_ITEMS.filter(i => i.category === 'Item').map(i => i.name),
          ...TARGET_AUTO_UNAVAILABLE_ITEMS,
          ...Object.keys(limits)
        ])).filter(name => !deletedSet.has(name));

        for (const itemKey of allItemKeys) {
          const canonical = normalizeReturnableName(itemKey);
          const borrowedCount = activeBorrowed.filter(b => 
            normalizeReturnableName(b.itemName) === canonical || normalizeReturnableName(b.itemName) === itemKey
          ).length;
          const pendingCount = pendingReqs.filter(r => 
            (r.items || []).some(i => normalizeReturnableName(i) === canonical || normalizeReturnableName(i) === itemKey)
          ).length;

          const inUse = borrowedCount + pendingCount;
          const limit = limits[itemKey] ?? limits[canonical] ?? DEFAULT_INVENTORY_LIMITS[itemKey] ?? 1;

          invMap[itemKey] = { inUse, limit };
          if (itemKey === "Glasses (Set of 2)") {
            invMap["Glasses"] = { inUse, limit };
          } else if (itemKey === "Kettle") {
            invMap["Teakettle"] = { inUse, limit };
          }
        }

        if (isMounted) {
          setInventory(prev => ({ ...prev, ...invMap }));
          try {
            localStorage.setItem("hues_stay_inventory", JSON.stringify(invMap));
          } catch (e) {}
        }
      } catch (err) {
        console.warn("Live inventory fetch note:", err);
      }
    };

    // Fetch live amenities status from Supabase & API (guaranteed instant sync across mobile & desktop)
    const fetchLiveAmenities = async () => {
      try {
        const liveStatus = await fetchLiveAmenitiesStatus();
        if (liveStatus && isMounted) {
          setAmenitiesStatus(prev => ({ ...prev, ...liveStatus }));
          try {
            localStorage.setItem("hues_stay_amenities", JSON.stringify(liveStatus));
          } catch (e) {}
          return;
        }

        const res = await fetch("/api/settings/amenities");
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.amenities && isMounted) {
            setAmenitiesStatus(prev => ({ ...prev, ...data.amenities }));
            try {
              localStorage.setItem("hues_stay_amenities", JSON.stringify(data.amenities));
            } catch (e) {}
          }
        }
      } catch (err) {
        console.warn("Amenities fetch note:", err);
      }
    };

    fetchLiveInventory();
    fetchLiveAmenities();
    const interval = setInterval(() => {
      fetchLiveInventory();
      fetchLiveAmenities();
    }, 2000);

    const onFocus = () => {
      fetchLiveInventory();
      fetchLiveAmenities();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchLiveInventory();
        fetchLiveAmenities();
      }
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

  const checkIsItemOutOfService = (item: string): boolean => {
    if (!item) return false;
    const canonical = normalizeReturnableName(item);

    // 1. Direct status from Supabase / state
    if (amenitiesStatus[item] === 'out_of_service' || amenitiesStatus[canonical] === 'out_of_service') {
      return true;
    }

    // 2. Real-time automatic check for the 8 target inventory items:
    // If active in-use items (borrowed + pending requests) >= limit, mark unavailable immediately
    if (isTargetAutoUnavailableItem(canonical)) {
      const inv = getInventoryData(canonical) || getInventoryData(item);
      if (inv && inv.limit > 0 && inv.inUse >= inv.limit) {
        return true;
      }
    }

    const lower = item.toLowerCase().trim();
    if (lower.includes("glass")) {
      if (amenitiesStatus["Glasses (Set of 2)"] === 'out_of_service' || amenitiesStatus["Glasses"] === 'out_of_service') return true;
    }
    if (lower.includes("kettle") || lower.includes("teakettle")) {
      if (amenitiesStatus["Teakettle"] === 'out_of_service' || amenitiesStatus["Kettle"] === 'out_of_service') return true;
    }
    for (const [key, val] of Object.entries(amenitiesStatus)) {
      if (val === 'out_of_service' && (key.toLowerCase().trim() === lower || lower.includes(key.toLowerCase().trim()))) {
        return true;
      }
    }
    return false;
  };

  // Automatically unselect any item if all units are taken while guest has the page open
  useEffect(() => {
    setSelectedItems(prev => {
      const unavailableSelected = prev.filter(item => {
        const inv = getInventoryData(item);
        const neededUnits = getItemUnitConsumption(item);
        const availableUnits = inv ? Math.max(0, inv.limit - inv.inUse) : 10;
        const isLimited = COMMON_ITEMS.find(i => i.name === item)?.isLimited ?? (inv !== undefined);
        const isOutOfStock = isLimited && inv && (availableUnits < neededUnits);
        const isOutOfService = checkIsItemOutOfService(item);
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

  const handleProceedToGuestForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomNumber) return;

    if (selectedItems.length === 0 && customMessage.trim() === "") {
      toast.error("Please select an item or enter a message.");
      return;
    }

    // Verify no selected item is currently out of service
    const outOfServiceSelected = selectedItems.filter(item => checkIsItemOutOfService(item));
    if (outOfServiceSelected.length > 0) {
      toast.error(`${outOfServiceSelected.join(", ")} ${outOfServiceSelected.length > 1 ? 'are' : 'is'} currently unavailable. Please remove from your selection.`);
      return;
    }

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
          return;
        }
      }
    }

    setShowGuestForm(true);
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim() || !phoneNumber.trim()) {
      toast.error("Guest Name and Phone Number are required.");
      return;
    }

    setIsSubmitting(true);

    try {
      const finalItems = [...selectedItems];
      const reqId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      // Append Name and Phone Number to custom message
      const formattedMessage = [
        `Guest Name: ${guestName.trim()}`,
        `Phone Number: ${phoneNumber.trim()}`,
        customMessage.trim() ? `\nMessage:\n${customMessage.trim()}` : ""
      ].filter(Boolean).join("\n");

      const requestData = {
        id: reqId,
        roomId: roomNumber,
        qrCodeHash: hash || roomNumber,
        items: finalItems,
        customMessage: formattedMessage,
        status: "pending" as const,
        createdAt: Date.now(),
      };

      setLastSubmittedId(reqId);
      try {
        sessionStorage.setItem("hues_last_req_id", reqId);
      } catch (e) {}

      // 1. Direct Supabase write (cross-device real-time sync across mobile, laptop, preview)
      const sb = getClientSupabase();
      if (sb) {
        sb.from("guest_requests").upsert({
          id: reqId,
          room_id: String(roomNumber),
          items: finalItems,
          custom_message: formattedMessage,
          status: "pending",
          created_at: requestData.createdAt
        }, { onConflict: "id" }).then(({ error }) => {
          if (error) console.warn("[GUEST] Supabase write error:", error.message);
        });
      }

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

      // 4. Also trigger /api/notify non-blockingly to guarantee instant email delivery on Vercel
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomNumber: String(roomNumber),
          items: finalItems,
          customMessage: formattedMessage,
          id: reqId
        })
      }).catch(err => console.warn("Notify API dispatch:", err));

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
              {selectedItems.map(item => {
                const comingSoonItems = [
                  "Laptop Table",
                  "Hair Dryer",
                  "Leg Massager (Paid)",
                  "Infrared Heat Therapy Lamp (Paid)",
                  "Glasses (Set of 2)"
                ];
                const displayName = comingSoonItems.includes(item) ? `${item} (Coming Soon)` : item;
                
                const emojiMap: Record<string, string> = {
                  "Iron Box": "👕",
                  "Kettle": "🫖",
                  "Hair Dryer": "💇‍♀️",
                  "Laptop Table": "💻",
                  "Leg Massager (Paid)": "🦵",
                  "Glasses (Set of 2)": "🥃",
                  "USB 3.0 Cable + Adaptor": "🔌",
                  "Infrared Heat Therapy Lamp (Paid)": "💡"
                };
                const emoji = emojiMap[item];

                return (
                  <li key={item} className="flex justify-between items-center py-1 border-b border-[#F2EFE9] last:border-0">
                    <span className="font-serif">
                      {emoji && <span className="mr-1.5">{emoji}</span>}
                      {displayName}
                    </span>
                    <span className="font-mono text-xs text-[#A68966] bg-[#FAF8F5] px-2 py-0.5 border border-[#EBE7E1] rounded-xs">
                      Requested
                    </span>
                  </li>
                );
              })}
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

  if (showGuestForm) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex flex-col items-center pt-12 px-6">
        <Toaster position="top-center" />
        <div className="max-w-md w-full bg-white border border-[#E5E1DB] p-8 shadow-sm text-center">
          <h2 className="text-3xl font-serif italic mb-2">Guest Details</h2>
          <p className="text-[#8C857D] text-sm mb-6">
            Please provide your details to confirm your request for Room {roomNumber}.
          </p>
          <form onSubmit={handleFinalSubmit}>
            <div className="space-y-4 mb-8 text-left">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#8C857D] font-mono mb-2 font-semibold">Guest Name</label>
                <input
                  type="text"
                  required
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  className="w-full border border-[#E5E1DB] p-3 text-sm focus:outline-none focus:border-[#A68966] bg-[#FAF8F5] transition-colors"
                  placeholder="Enter your name"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[#8C857D] font-mono mb-2 font-semibold">Phone Number</label>
                <input
                  type="tel"
                  required
                  value={phoneNumber}
                  onChange={e => setPhoneNumber(e.target.value)}
                  className="w-full border border-[#E5E1DB] p-3 text-sm focus:outline-none focus:border-[#A68966] bg-[#FAF8F5] transition-colors"
                  placeholder="Enter your phone number"
                />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => setShowGuestForm(false)}
                className="flex-1 py-4 bg-white text-[#2D2926] border border-[#E5E1DB] font-medium uppercase tracking-[0.2em] text-xs hover:bg-[#F2EFE9] transition-colors cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-4 bg-[#A68966] text-white font-medium uppercase tracking-[0.2em] text-xs hover:bg-[#8E7455] transition-colors flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSubmitting ? "Sending..." : "Confirm Request"}
              </button>
            </div>
          </form>
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
        {/* Info Tiles: Service Timings, WiFi, Supervisor Details */}
        <div className="space-y-3 mb-8">
          <div className="bg-[#FAF8F5] border border-[#E5E1DB] p-4 text-center text-[#8C857D] text-sm uppercase tracking-widest font-mono select-none">
            Service Timings: 9:00 AM to 8:00 PM
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-[#FAF8F5] border border-[#E5E1DB] p-4 text-center font-mono select-none">
              <span className="text-[#A68966] font-semibold block text-[11px] uppercase tracking-widest mb-1">WiFi Network & Password</span>
              <span className="font-semibold text-[#2D2926] text-sm sm:text-base tracking-normal select-all">HuesStay123@</span>
            </div>
            <div className="bg-[#FAF8F5] border border-[#E5E1DB] p-4 text-center font-mono select-none">
              <span className="text-[#A68966] font-semibold block text-[11px] uppercase tracking-widest mb-1">Supervisor Contact Number</span>
              <a href="tel:8431995152" className="font-semibold text-[#2D2926] text-sm sm:text-base tracking-normal hover:underline">8431995152</a>
            </div>
          </div>
        </div>
        <form onSubmit={handleProceedToGuestForm} className="space-y-8">
          
          <section>
            <h2 className="text-xl font-serif mb-4 flex items-center">
              Daily Service Requests
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {COMMON_ITEMS.filter(i => 
                i.category === 'Service' && 
                !deletedItems.includes(i.name) &&
                !i.name.toLowerCase().includes('wifi') && 
                !i.name.toLowerCase().includes('supervisor')
              ).map((itemObj) => {
                const item = itemObj.name;
                const isSelected = selectedItems.includes(item);
                const isOutOfService = checkIsItemOutOfService(item);
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
                const deletedSet = new Set(deletedItems);
                const itemsList: Array<{ name: string; isLimited: boolean }> = [
                  ...COMMON_ITEMS.filter(i => i.category === 'Item' && !deletedSet.has(i.name)).map(i => ({ name: i.name, isLimited: !!i.isLimited }))
                ];
                Object.keys(inventory).forEach(invName => {
                  // Filter out duplicate aliases, deleted items, and corrupt data from showing up in the UI
                  const lower = invName.toLowerCase().trim();
                  if (
                    deletedSet.has(invName) ||
                    lower === "teakettle" || 
                    lower === "glasses" || 
                    lower === "water glasses" || 
                    lower === "water glass" ||
                    lower.includes("(qty:") ||
                    lower.includes("qty:")
                  ) return;

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
                  const isOutOfService = checkIsItemOutOfService(item);
                  const isDisabled = isOutOfStock || isOutOfService;

                  const comingSoonItems = [
                    "Laptop Table",
                    "Hair Dryer",
                    "Leg Massager (Paid)",
                    "Infrared Heat Therapy Lamp (Paid)",
                    "Glasses (Set of 2)"
                  ];
                  const isComingSoon = comingSoonItems.includes(item);
                  const displayName = isComingSoon ? `${item} (Coming Soon)` : item;

                  const emojiMap: Record<string, string> = {
                    "Iron Box": "👕",
                    "Kettle": "🫖",
                    "Hair Dryer": "💇‍♀️",
                    "Laptop Table": "💻",
                    "Leg Massager (Paid)": "🦵",
                    "Glasses (Set of 2)": "🥃",
                    "USB 3.0 Cable + Adaptor": "🔌",
                    "Infrared Heat Therapy Lamp (Paid)": "💡"
                  };
                  const emoji = emojiMap[item];

                  return (
                    <div
                      key={item}
                      onClick={() => {
                        if (isDisabled) {
                          toast.error(`${displayName} is currently unavailable.`);
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
                        <span className="font-serif text-base md:text-lg leading-tight block">
                          {emoji && <span className="mr-2 text-xl inline-block">{emoji}</span>}
                          {displayName}
                        </span>
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
