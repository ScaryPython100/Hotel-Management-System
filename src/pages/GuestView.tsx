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
  fetchLiveDeletedItems
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
import toast, { Toaster } from "react-hot-toast";
import { Loader2, Info } from "lucide-react";
import RoomSelectorScreen from "../components/guest/RoomSelectorScreen";
import RequestSuccessScreen from "../components/guest/RequestSuccessScreen";
import GuestDetailsForm from "../components/guest/GuestDetailsForm";
import AmenityGridSection from "../components/guest/AmenityGridSection";

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

        // Pre-aggregate borrowed and pending request counts in a single pass
        const borrowedCounts = new Map<string, number>();
        for (const b of liveBor || []) {
          if (b.status === "borrowed") {
            const norm = normalizeReturnableName(b.itemName);
            borrowedCounts.set(norm, (borrowedCounts.get(norm) || 0) + 1);
          }
        }

        const pendingCounts = new Map<string, number>();
        for (const r of liveReqs || []) {
          if (r.status === "pending") {
            const matchedCanonical = new Set<string>();
            for (const i of r.items || []) {
              matchedCanonical.add(normalizeReturnableName(i));
            }
            for (const norm of matchedCanonical) {
              pendingCounts.set(norm, (pendingCounts.get(norm) || 0) + 1);
            }
          }
        }

        const invMap: Record<string, { inUse: number, limit: number }> = {};

        // Include ALL items: default items + target items + custom items added via limits
        const allItemKeys = Array.from(new Set([
          ...COMMON_ITEMS.filter(i => i.category === 'Item').map(i => i.name),
          ...TARGET_AUTO_UNAVAILABLE_ITEMS,
          ...Object.keys(limits)
        ])).filter(name => !deletedSet.has(name));

        for (const itemKey of allItemKeys) {
          const canonical = normalizeReturnableName(itemKey);
          const borrowedCount =
            (borrowedCounts.get(canonical) || 0) +
            (canonical !== itemKey ? borrowedCounts.get(itemKey) || 0 : 0);
          const pendingCount =
            (pendingCounts.get(canonical) || 0) +
            (canonical !== itemKey ? pendingCounts.get(itemKey) || 0 : 0);

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

  // If room number couldn't be auto-detected, show elegant room selector
  if (!roomNumber) {
    return (
      <RoomSelectorScreen
        manualRoomInput={manualRoomInput}
        onManualRoomInputChange={setManualRoomInput}
        onSelectRoom={handleManualRoomSelect}
      />
    );
  }

  if (isSuccess) {
    return (
      <RequestSuccessScreen
        roomNumber={roomNumber}
        selectedItems={selectedItems}
        onMakeAnotherRequest={() => {
          setIsSuccess(false);
          setSelectedItems([]);
          setCustomMessage("");
        }}
        onCancelRequest={handleCancelRequest}
      />
    );
  }

  if (showGuestForm) {
    return (
      <GuestDetailsForm
        roomNumber={roomNumber}
        guestName={guestName}
        onGuestNameChange={setGuestName}
        phoneNumber={phoneNumber}
        onPhoneNumberChange={setPhoneNumber}
        isSubmitting={isSubmitting}
        onBack={() => setShowGuestForm(false)}
        onSubmit={handleFinalSubmit}
      />
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
            Service Timings (Perferably): 9:00 AM to 8:00 PM 
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
          <AmenityGridSection
            deletedItems={deletedItems}
            selectedItems={selectedItems}
            inventory={inventory}
            getInventoryData={getInventoryData}
            checkIsItemOutOfService={checkIsItemOutOfService}
            onToggleItem={toggleItem}
          />

          <section>
            <h2 className="text-xl font-serif mb-4">Other Requests</h2>
            <textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              placeholder="E.g., Let me know late checkout charges..."
              className="w-full p-6 border border-[#E5E1DB] bg-white text-[#2D2926] placeholder:text-[#8C857D] focus:outline-none focus:border-[#A68966] min-h-[120px] resize-none rounded-none"
            ></textarea>
          </section>

          <div className="bg-white border border-[#E5E1DB] p-6 flex gap-3 text-[#8C857D]">
            <Info className="w-5 h-5 shrink-0 text-[#A68966]" />
            <p className="text-sm italic">
              Your request will be sent instantly to our housekeeping team. We aim to fulfill ASAP.
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
