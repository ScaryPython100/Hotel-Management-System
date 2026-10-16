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
  isTargetAutoUnavailableItem,
  isReturnableItem,
  AmenitySection,
  PAGE_1_DAILY_ITEMS,
  PAGE_2_RETURNABLE_ITEMS,
  PAGE_3_FNB_DEPOSIT_ITEMS,
  PAGE_3_QUICK_FOOD_ITEMS,
  extractBaseItemName
} from "../types";
import toast, { Toaster } from "react-hot-toast";
import { 
  Loader2, 
  Info, 
  Copy, 
  Check, 
  QrCode, 
  X, 
  Wifi, 
  Phone, 
  Droplets, 
  Utensils, 
  Clock, 
  ExternalLink, 
  Maximize2,
  Calendar,
  LogOut,
  CheckCircle2,
  AlertTriangle
} from "lucide-react";
import upiQrImage from "../assets/huesstay-upi-qr.jpg";
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

  const [waitlistCounts, setWaitlistCounts] = useState<Record<string, number>>({});
  const [submittedWaitlistInfo, setSubmittedWaitlistInfo] = useState<{ isWaitlist: boolean; waitlistForItem?: string; queuePosition?: number } | null>(null);

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
        const wlCounts: Record<string, number> = {};
        for (const r of liveReqs || []) {
          if (r.status === "pending") {
            const matchedCanonical = new Set<string>();
            for (const i of r.items || []) {
              matchedCanonical.add(normalizeReturnableName(i));
            }
            for (const norm of matchedCanonical) {
              pendingCounts.set(norm, (pendingCounts.get(norm) || 0) + 1);
            }
            if (r.isWaitlist && r.waitlistForItem) {
              const wlNorm = normalizeReturnableName(r.waitlistForItem);
              wlCounts[wlNorm] = (wlCounts[wlNorm] || 0) + 1;
            }
          }
        }
        if (isMounted) {
          setWaitlistCounts(wlCounts);
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
        const isReturnable = isReturnableItem(item);
        const isManualOutOfService = amenitiesStatus[item] === 'out_of_service' || amenitiesStatus[normalizeReturnableName(item)] === 'out_of_service';

        // Do not auto-deselect returnable items that can be waitlisted!
        if (isReturnable && !isManualOutOfService) {
          return false;
        }

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

  const [activeTab, setActiveTab] = useState<AmenitySection>("daily");
  const [showQrModal, setShowQrModal] = useState(false);
  const [copiedWifi, setCopiedWifi] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  const toggleItem = (item: string) => {
    setSelectedItems((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  };

  const handleUpdateItemString = (oldPattern: string, newString: string | null) => {
    setSelectedItems(prev => {
      const filtered = prev.filter(s => s !== oldPattern);
      if (newString && !filtered.includes(newString)) {
        return [...filtered, newString];
      }
      return filtered;
    });
  };

  const handleCopyWifi = () => {
    navigator.clipboard.writeText("HuesStay123@").catch(() => {});
    setCopiedWifi(true);
    toast.success("WiFi password copied: HuesStay123@");
    setTimeout(() => setCopiedWifi(false), 2000);
  };

  const handleCopyUpi = () => {
    navigator.clipboard.writeText("huesstay@okicici").catch(() => {});
    setCopiedUpi(true);
    toast.success("UPI ID copied: huesstay@okicici");
    setTimeout(() => setCopiedUpi(false), 2000);
  };

  const handleQuickAction = (action: "checkout" | "late_checkout" | "extend") => {
    if (action === "checkout") {
      const msg = "Inform Checkout: Room ready for checkout inspection.";
      setCustomMessage(prev => prev ? `${prev}\n${msg}` : msg);
      toast.success("Added 'Inform Checkout' note.");
    } else if (action === "late_checkout") {
      const msg = "Request Late Checkout: Please inform availability and charges.";
      setCustomMessage(prev => prev ? `${prev}\n${msg}` : msg);
      toast.success("Added 'Request Late Checkout' note.");
    } else if (action === "extend") {
      const msg = "Request Stay Extension: Would like to extend stay.";
      setCustomMessage(prev => prev ? `${prev}\n${msg}` : msg);
      toast.success("Added 'Request Stay Extension' note.");
    }
    const el = document.getElementById("other-requests-section");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  const tab1Count = React.useMemo(() => {
    return selectedItems.filter(s => {
      const b = extractBaseItemName(s).toLowerCase();
      return PAGE_1_DAILY_ITEMS.some(p => p.name.toLowerCase().includes(b) || b.includes(p.name.toLowerCase()));
    }).length;
  }, [selectedItems]);

  const tab2Count = React.useMemo(() => {
    return selectedItems.filter(s => {
      const b = extractBaseItemName(s).toLowerCase();
      return PAGE_2_RETURNABLE_ITEMS.some(p => p.name.toLowerCase().includes(b) || b.includes(p.name.toLowerCase()));
    }).length;
  }, [selectedItems]);

  const tab3Count = React.useMemo(() => {
    return selectedItems.filter(s => {
      const b = extractBaseItemName(s).toLowerCase();
      return (
        PAGE_3_FNB_DEPOSIT_ITEMS.some(p => p.name.toLowerCase().includes(b) || b.includes(p.name.toLowerCase())) ||
        PAGE_3_QUICK_FOOD_ITEMS.some(p => p.name.toLowerCase().includes(b) || b.includes(p.name.toLowerCase()))
      );
    }).length;
  }, [selectedItems]);

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

    // Verify no selected item is currently out of service (except waitlistable returnable appliances)
    const outOfServiceSelected = selectedItems.filter(item => {
      const canonical = normalizeReturnableName(item);
      const isReturnable = isReturnableItem(canonical) || isReturnableItem(item);
      const isManualOutOfService = amenitiesStatus[item] === 'out_of_service' || amenitiesStatus[canonical] === 'out_of_service';
      if (isReturnable && !isManualOutOfService) {
        return false;
      }
      return checkIsItemOutOfService(item) || checkIsItemOutOfService(canonical);
    });
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
        const isReturnable = isReturnableItem(item);
        const isManualOutOfService = amenitiesStatus[item] === 'out_of_service' || amenitiesStatus[normalizeReturnableName(item)] === 'out_of_service';
        if (available < neededUnits) {
          if (isReturnable && !isManualOutOfService) {
            // Eligible for Floor-to-Floor smart waitlist reservation!
            continue;
          }
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

      // Check if any requested item is an in-use returnable appliance
      const waitlistCandidate = finalItems.find(item => {
        if (!isReturnableItem(item)) return false;
        const inv = getInventoryData(item);
        const neededUnits = getItemUnitConsumption(item);
        const available = inv ? Math.max(0, inv.limit - inv.inUse) : 10;
        return inv && available < neededUnits;
      });

      const isWaitlist = Boolean(waitlistCandidate);
      const waitlistForItem = waitlistCandidate ? normalizeReturnableName(waitlistCandidate) : undefined;
      const currentQueue = waitlistForItem ? (waitlistCounts[waitlistForItem] || 0) : 0;
      const queuePosition = isWaitlist ? currentQueue + 1 : undefined;

      // Append Name and Phone Number to custom message
      let formattedMessage = [
        `Guest Name: ${guestName.trim()}`,
        `Phone Number: ${phoneNumber.trim()}`,
        customMessage.trim() ? `\nMessage:\n${customMessage.trim()}` : ""
      ].filter(Boolean).join("\n");

      if (isWaitlist && waitlistForItem) {
        formattedMessage = `[WAITLIST: ${waitlistForItem}#${queuePosition}] ${formattedMessage}`;
      }

      const requestData: any = {
        id: reqId,
        roomId: roomNumber,
        qrCodeHash: hash || roomNumber,
        items: finalItems,
        customMessage: formattedMessage,
        status: "pending" as const,
        createdAt: Date.now(),
        isWaitlist,
        waitlistForItem,
        queuePosition
      };

      setSubmittedWaitlistInfo({ isWaitlist, waitlistForItem, queuePosition });
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
          created_at: requestData.createdAt,
          is_waitlist: isWaitlist,
          waitlist_for_item: waitlistForItem || null,
          queue_position: queuePosition || null
        }, { onConflict: "id" }).then(({ error }) => {
          if (error) {
            console.warn("[GUEST] Supabase write retry with base columns:", error.message);
            sb.from("guest_requests").upsert({
              id: reqId,
              room_id: String(roomNumber),
              items: finalItems,
              custom_message: formattedMessage,
              status: "pending",
              created_at: requestData.createdAt
            }, { onConflict: "id" }).catch(() => {});
          }
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
      toast.success(isWaitlist ? `Reserved! You are in line for ${waitlistForItem}.` : "Request sent to front desk!");
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
    setSubmittedWaitlistInfo(null);
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
        isWaitlist={submittedWaitlistInfo?.isWaitlist}
        waitlistForItem={submittedWaitlistInfo?.waitlistForItem}
        queuePosition={submittedWaitlistInfo?.queuePosition}
        onMakeAnotherRequest={() => {
          setIsSuccess(false);
          setSelectedItems([]);
          setCustomMessage("");
          setSubmittedWaitlistInfo(null);
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
    <div className="min-h-screen bg-[#F9F7F4] text-[#2D2926] pb-24 font-sans">
      <Toaster position="top-center" />
      
      {/* Header */}
      <header className="h-44 bg-[#1A1A1A] text-white p-8 flex flex-col justify-end relative mb-6 shadow-md">
        <div className="absolute top-6 left-8 text-[11px] uppercase tracking-[0.25em] text-[#CBB99D] font-medium">
          Hues Stay Luxury Rooms
        </div>
        <div className="max-w-4xl mx-auto w-full text-left">
          <h1 className="text-4xl font-serif italic mb-1 text-white">Room {roomNumber}</h1>
          <p className="text-xs sm:text-sm text-neutral-300 max-w-md">
            Welcome! Select services, borrow appliances, or order F&B essentials below.
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 space-y-6">
        {/* COMMON TOP SECTION */}
        <section className="space-y-4">
          {/* Service Timings Banner */}
          <div className="bg-[#FAF8F5] border border-[#E5E1DB] p-3 sm:p-4 text-center text-[#2D2926] shadow-2xs">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-3 text-xs sm:text-sm">
              <span className="font-semibold uppercase tracking-wider text-[#A68966] flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                Service Timings:
              </span>
              <span className="font-medium text-[#2D2926]">9:00 AM to 8:00 PM</span>
              <span className="text-[#8C857D] hidden sm:inline">•</span>
              <span className="text-xs text-[#8C857D] italic">
                Housekeeping between 10:00 AM – 4:00 PM
              </span>
            </div>
          </div>

          {/* Hotel Key Info Cards: WiFi, Supervisor, Drinking Water, Self Cooking Kitchen */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* WiFi */}
            <div className="bg-[#FAF8F5] border border-[#E5E1DB] p-3 text-center flex flex-col justify-between shadow-2xs">
              <div className="flex items-center justify-center gap-1.5 text-[#A68966] mb-1">
                <Wifi className="w-3.5 h-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">WiFi Password</span>
              </div>
              <div className="font-mono font-bold text-xs sm:text-sm text-[#2D2926] truncate">
                HuesStay123@
              </div>
              <button
                type="button"
                onClick={handleCopyWifi}
                className="mt-2 text-[10px] uppercase font-bold tracking-wider text-[#A68966] hover:text-[#8E7455] flex items-center justify-center gap-1 cursor-pointer"
              >
                {copiedWifi ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                {copiedWifi ? "Copied" : "Copy"}
              </button>
            </div>

            {/* Supervisor */}
            <div className="bg-[#FAF8F5] border border-[#E5E1DB] p-3 text-center flex flex-col justify-between shadow-2xs">
              <div className="flex items-center justify-center gap-1.5 text-[#A68966] mb-1">
                <Phone className="w-3.5 h-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">Supervisor</span>
              </div>
              <a
                href="tel:8431995152"
                className="font-mono font-bold text-xs sm:text-sm text-[#2D2926] hover:underline"
              >
                8431995152
              </a>
              <a
                href="tel:8431995152"
                className="mt-2 text-[10px] uppercase font-bold tracking-wider text-[#A68966] hover:text-[#8E7455] flex items-center justify-center gap-1"
              >
                <Phone className="w-3 h-3" />
                Call Now
              </a>
            </div>

            {/* Drinking Water */}
            <div className="bg-[#FAF8F5] border border-[#E5E1DB] p-3 text-center flex flex-col justify-between shadow-2xs">
              <div className="flex items-center justify-center gap-1.5 text-[#A68966] mb-1">
                <Droplets className="w-3.5 h-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">Water</span>
              </div>
              <div className="font-serif text-xs sm:text-sm text-[#2D2926] font-medium leading-tight">
                G, 3rd & Terrace
              </div>
              <span className="mt-2 text-[10px] text-[#8C857D] italic">
                Water Dispensers
              </span>
            </div>

            {/* Self Cooking Kitchen */}
            <div className="bg-[#FAF8F5] border border-[#E5E1DB] p-3 text-center flex flex-col justify-between shadow-2xs">
              <div className="flex items-center justify-center gap-1.5 text-[#A68966] mb-1">
                <Utensils className="w-3.5 h-3.5" />
                <span className="text-[10px] font-semibold uppercase tracking-wider">Kitchen</span>
              </div>
              <div className="font-serif text-xs sm:text-sm text-[#2D2926] font-medium leading-tight">
                Ground Floor
              </div>
              <span className="mt-2 text-[10px] text-[#8C857D] italic">
                Self Cooking Area
              </span>
            </div>
          </div>

          {/* UPI PAYMENT QR CARD */}
          <div className="bg-white border border-[#E5E1DB] p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs">
            <div className="flex items-center gap-4 w-full sm:w-auto">
              {/* QR Image Thumbnail */}
              <div
                onClick={() => setShowQrModal(true)}
                className="relative group cursor-pointer shrink-0 border border-[#E5E1DB] p-1 bg-white hover:border-[#A68966] transition-colors"
                title="Tap to enlarge QR code"
              >
                <img
                  src={upiQrImage}
                  alt="Hues Stay UPI QR Code"
                  className="w-16 h-16 sm:w-20 sm:h-20 object-contain"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                  <Maximize2 className="w-4 h-4" />
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <QrCode className="w-4 h-4 text-[#A68966]" />
                  <h3 className="font-serif text-base sm:text-lg font-medium text-[#2D2926]">
                    Hues Stay UPI Payment
                  </h3>
                </div>
                <p className="text-xs text-[#8C857D] mb-1">
                  Scan to pay deposit, room charges, or groceries via any UPI app.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-semibold bg-[#FAF8F5] border border-[#E5E1DB] px-2 py-0.5 text-[#2D2926] select-all">
                    huesstay@okicici
                  </span>
                  <span className="text-[10px] text-[#8C857D]">
                    GPay • PhonePe • Paytm • BHIM
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
              <button
                type="button"
                onClick={() => setShowQrModal(true)}
                className="px-3.5 py-2 border border-[#2D2926] bg-[#2D2926] text-white hover:bg-neutral-800 text-xs font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                Scan QR
              </button>
              <button
                type="button"
                onClick={handleCopyUpi}
                className="px-3.5 py-2 border border-[#E5E1DB] bg-[#FAF8F5] hover:bg-[#F2EFE9] text-[#2D2926] text-xs font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {copiedUpi ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5 text-[#A68966]" />}
                {copiedUpi ? "Copied" : "Copy UPI"}
              </button>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8C857D] w-full sm:w-auto mb-1 sm:mb-0">
              Quick Actions:
            </span>
            <button
              type="button"
              onClick={() => handleQuickAction("checkout")}
              className="flex-1 sm:flex-none px-3.5 py-2 border border-[#E5E1DB] bg-white hover:bg-[#FAF8F5] text-xs font-medium text-[#2D2926] flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            >
              <LogOut className="w-3.5 h-3.5 text-[#A68966]" />
              Inform Checkout
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction("late_checkout")}
              className="flex-1 sm:flex-none px-3.5 py-2 border border-[#E5E1DB] bg-white hover:bg-[#FAF8F5] text-xs font-medium text-[#2D2926] flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            >
              <Clock className="w-3.5 h-3.5 text-[#A68966]" />
              Request Late Checkout
            </button>
            <button
              type="button"
              onClick={() => handleQuickAction("extend")}
              className="flex-1 sm:flex-none px-3.5 py-2 border border-[#E5E1DB] bg-white hover:bg-[#FAF8F5] text-xs font-medium text-[#2D2926] flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            >
              <Calendar className="w-3.5 h-3.5 text-[#A68966]" />
              Request Stay Extension
            </button>
          </div>
        </section>

        {/* 3 DISTINCT PAGES / TABS NAVIGATION BAR */}
        <div className="sticky top-0 z-30 bg-[#F9F7F4] pt-2 pb-1">
          <div className="flex border border-[#E5E1DB] bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setActiveTab("daily")}
              className={`flex-1 py-3 px-2 text-xs font-semibold tracking-wider uppercase transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === "daily"
                  ? "bg-[#2D2926] text-white shadow-xs"
                  : "text-[#8C857D] hover:text-[#2D2926] hover:bg-[#FAF8F5]"
              }`}
            >
              <span>1. Daily Services</span>
              {tab1Count > 0 && (
                <span className={`text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold ${
                  activeTab === "daily" ? "bg-[#A68966] text-white" : "bg-[#2D2926] text-white"
                }`}>
                  {tab1Count}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("returnable")}
              className={`flex-1 py-3 px-2 text-xs font-semibold tracking-wider uppercase transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === "returnable"
                  ? "bg-[#2D2926] text-white shadow-xs"
                  : "text-[#8C857D] hover:text-[#2D2926] hover:bg-[#FAF8F5]"
              }`}
            >
              <span>2. Returnable Items</span>
              {tab2Count > 0 && (
                <span className={`text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold ${
                  activeTab === "returnable" ? "bg-[#A68966] text-white" : "bg-[#2D2926] text-white"
                }`}>
                  {tab2Count}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("fnb")}
              className={`flex-1 py-3 px-2 text-xs font-semibold tracking-wider uppercase transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === "fnb"
                  ? "bg-[#2D2926] text-white shadow-xs"
                  : "text-[#8C857D] hover:text-[#2D2926] hover:bg-[#FAF8F5]"
              }`}
            >
              <span>3. F&B Essentials</span>
              {tab3Count > 0 && (
                <span className={`text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold ${
                  activeTab === "fnb" ? "bg-[#A68966] text-white" : "bg-[#2D2926] text-white"
                }`}>
                  {tab3Count}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* MAIN REQUEST FORM */}
        <form onSubmit={handleProceedToGuestForm} className="space-y-8">
          <AmenityGridSection
            activeTab={activeTab}
            deletedItems={deletedItems}
            selectedItems={selectedItems}
            inventory={inventory}
            getInventoryData={getInventoryData}
            checkIsItemOutOfService={checkIsItemOutOfService}
            onToggleItem={toggleItem}
            onUpdateItemString={handleUpdateItemString}
            waitlistCounts={waitlistCounts}
            amenitiesStatus={amenitiesStatus}
          />

          <section id="other-requests-section">
            <h2 className="text-xl font-serif mb-2 text-[#2D2926]">Other Requests & Notes</h2>
            <p className="text-xs text-[#8C857D] mb-3">
              Need anything specific? Mention custom checkout times, grocery items, or special instructions.
            </p>
            <textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              placeholder="E.g., Please send fresh towels, or let me know late checkout availability..."
              className="w-full p-4 sm:p-5 border border-[#E5E1DB] bg-white text-[#2D2926] placeholder:text-[#8C857D] focus:outline-none focus:border-[#A68966] min-h-[110px] resize-none rounded-none text-sm"
            ></textarea>
          </section>

          <div className="bg-white border border-[#E5E1DB] p-4 sm:p-5 flex gap-3 text-[#8C857D] text-xs">
            <Info className="w-5 h-5 shrink-0 text-[#A68966]" />
            <p className="italic leading-relaxed">
              Your request will be dispatched instantly to our on-duty housekeeping team. Returnable appliances and dining utensils will be brought to Room {roomNumber} promptly.
            </p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 bg-[#A68966] text-white font-semibold uppercase tracking-[0.2em] text-xs hover:bg-[#8E7455] transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center rounded-none shadow-sm cursor-pointer"
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

        {/* Footer with Terms and Conditions Link */}
        <footer className="pt-6 border-t border-[#E5E1DB] text-center text-xs text-[#8C857D]">
          <button
            type="button"
            onClick={() => setShowTermsModal(true)}
            className="text-[#A68966] hover:underline font-medium uppercase tracking-wider text-[11px] cursor-pointer"
          >
            Terms and Conditions • House Rules
          </button>
          <p className="mt-2 text-[11px] text-[#A8A29E]">
            Hues Stay Luxury Rooms • Direct Guest Concierge
          </p>
        </footer>
      </main>

      {/* FULL-SIZE PAYMENT QR LIGHTBOX MODAL */}
      {showQrModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowQrModal(false)}
        >
          <div
            className="bg-white max-w-sm w-full p-6 text-center shadow-2xl relative border border-[#E5E1DB]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowQrModal(false)}
              className="absolute top-4 right-4 p-1.5 text-[#8C857D] hover:text-[#2D2926] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#A68966] mb-1">
              Google Pay • PhonePe • Paytm
            </div>
            <h3 className="font-serif text-2xl font-bold text-[#2D2926] mb-4">
              Hues Stay Payment QR
            </h3>

            <div className="bg-[#FAF8F5] border border-[#E5E1DB] p-4 mb-4 flex justify-center">
              <img
                src={upiQrImage}
                alt="Hues Stay Google Pay QR Code"
                className="w-64 h-auto object-contain max-h-72"
              />
            </div>

            <div className="mb-4">
              <span className="text-xs text-[#8C857D] block mb-1">Official UPI ID:</span>
              <div className="font-mono font-bold text-sm bg-[#FAF8F5] border border-[#E5E1DB] py-2 px-3 text-[#2D2926] select-all">
                huesstay@okicici
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCopyUpi}
                className="flex-1 py-3 bg-[#A68966] text-white text-xs font-semibold uppercase tracking-wider hover:bg-[#8E7455] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {copiedUpi ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copiedUpi ? "UPI ID Copied!" : "Copy UPI ID"}
              </button>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="px-5 py-3 border border-[#E5E1DB] text-[#2D2926] text-xs font-semibold uppercase tracking-wider hover:bg-neutral-100 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TERMS & CONDITIONS / HOUSE RULES MODAL */}
      {showTermsModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowTermsModal(false)}
        >
          <div
            className="bg-white max-w-lg w-full p-6 sm:p-8 text-left shadow-2xl relative border border-[#E5E1DB] max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowTermsModal(false)}
              className="absolute top-4 right-4 p-1.5 text-[#8C857D] hover:text-[#2D2926] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#A68966] mb-1">
              Hues Stay Policies
            </div>
            <h3 className="font-serif text-2xl font-bold text-[#2D2926] mb-4">
              Terms & Conditions • House Rules
            </h3>

            <div className="space-y-4 text-xs text-[#2D2926] leading-relaxed">
              <div className="border-b border-[#E5E1DB] pb-3">
                <h4 className="font-semibold text-sm mb-1 text-[#2D2926]">1. Service Timings</h4>
                <p className="text-[#8C857D]">
                  Daily room service and front desk assistance are available between <strong>9:00 AM and 8:00 PM</strong>. Daily housekeeping is conducted strictly between <strong>10:00 AM and 4:00 PM</strong>.
                </p>
              </div>

              <div className="border-b border-[#E5E1DB] pb-3">
                <h4 className="font-semibold text-sm mb-1 text-[#2D2926]">2. Returnable Appliances (Shared Inventory)</h4>
                <p className="text-[#8C857D]">
                  Appliances (Iron Box, Kettle, Hair Dryer, Laptop Table, Hot Pack) are shared property. Please return them promptly when finished so other guests can use them. If all units are taken, guests are added to the Smart Waitlist and items are relayed directly.
                </p>
              </div>

              <div className="border-b border-[#E5E1DB] pb-3">
                <h4 className="font-semibold text-sm mb-1 text-[#2D2926]">3. Dining Utensils & Refundable Deposit</h4>
                <p className="text-[#8C857D]">
                  A refundable deposit of <strong>₹100/- per item</strong> is collected for kitchen and dining utensils (Plates, Cups, Bowls, Glasses, Bottles, Oil Dispensers). Guests must self-clean utensils after use before returning; uncleaned items will have cleaning charges deducted from the deposit amount.
                </p>
              </div>

              <div className="border-b border-[#E5E1DB] pb-3">
                <h4 className="font-semibold text-sm mb-1 text-[#2D2926]">4. Checkout & Stay Extension</h4>
                <p className="text-[#8C857D]">
                  Standard checkout is by 11:00 AM. Please inform the team prior to checking out for a quick room clearance. Late checkouts and stay extensions are subject to room availability and nominal charges.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-1 text-[#2D2926]">5. General Decorum</h4>
                <p className="text-[#8C857D]">
                  Quiet hours are observed between 10:00 PM and 7:00 AM. Smoking inside rooms is strictly prohibited. For any urgent support, reach our supervisor directly at <strong>8431995152</strong>.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowTermsModal(false)}
              className="mt-6 w-full py-3 bg-[#2D2926] text-white text-xs font-semibold uppercase tracking-wider hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              I Understand & Agree
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
