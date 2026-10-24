import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { cn } from "../lib/utils";
import { 
  COMMON_ITEMS, 
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

const SUPERVISOR_PHONE = "8431995152";

// Room links already confirmed by the server on this phone, so reloads render instantly
function readKnownRoomLink(link?: string): string | null {
  if (!link) return null;
  try {
    const known = JSON.parse(localStorage.getItem("hues_stay_room_links") || "{}");
    return typeof known[link] === "string" ? known[link] : null;
  } catch {
    return null;
  }
}

function rememberRoomLink(link: string, room: string) {
  try {
    const known = JSON.parse(localStorage.getItem("hues_stay_room_links") || "{}");
    known[link] = room;
    localStorage.setItem("hues_stay_room_links", JSON.stringify(known));
  } catch {}
}

export default function GuestView() {
  const { hash } = useParams<{ hash: string }>();

  // The signed link from the QR code identifies the room; the server confirms it
  const [roomLink, setRoomLink] = useState<string | null>(hash?.trim() || null);
  const [roomNumber, setRoomNumber] = useState<string | null>(() => readKnownRoomLink(hash?.trim()));
  const [manualRoomInput, setManualRoomInput] = useState("");
  const [isValidating, setIsValidating] = useState(() => Boolean(hash?.trim()) && !readKnownRoomLink(hash?.trim()));
  
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

  const getInventoryData = (name: string) => {
    if (inventory[name]) return inventory[name];
    const canonical = normalizeReturnableName(name);
    if (inventory[canonical]) return inventory[canonical];
    const lower = name.toLowerCase().trim();
    const foundKey = Object.keys(inventory).find(k => k.toLowerCase().trim() === lower);
    if (foundKey) return inventory[foundKey];
    return undefined;
  };

  // Live availability from the server every 2 seconds (no other guests' details are sent)
  useEffect(() => {
    if (!roomLink) {
      setIsValidating(false);
      return;
    }
    let isMounted = true;

    const refresh = async () => {
      try {
        const res = await fetch(`/api/guest?token=${encodeURIComponent(roomLink)}`);
        if (!isMounted) return;
        if (res.status === 404) {
          // Not a valid room link: ask the guest to scan the QR code (or pick a room in legacy mode)
          setRoomNumber(null);
          setRoomLink(null);
          setIsValidating(false);
          return;
        }
        if (!res.ok) return;
        const state = await res.json();
        if (!isMounted || !state?.success) return;

        setRoomNumber(state.room);
        rememberRoomLink(roomLink, state.room);
        setIsValidating(false);

        const deletedSet = new Set<string>(state.deletedItems || []);
        setDeletedItems(state.deletedItems || []);
        setWaitlistCounts(state.waitlistCounts || {});
        setAmenitiesStatus({ ...DEFAULT_AMENITY_STATUS, ...(state.amenityStatus || {}) });

        const limits: Record<string, number> = { ...DEFAULT_INVENTORY_LIMITS, ...(state.limits || {}) };
        const invMap: Record<string, { inUse: number, limit: number }> = {};
        const itemKeys = new Set([...TARGET_AUTO_UNAVAILABLE_ITEMS, ...Object.keys(limits)]);
        for (const itemKey of itemKeys) {
          if (deletedSet.has(itemKey)) continue;
          invMap[itemKey] = { inUse: state.inUse?.[itemKey] || 0, limit: limits[itemKey] ?? 1 };
        }
        setInventory(invMap);
        try {
          localStorage.setItem("hues_stay_inventory", JSON.stringify(invMap));
          localStorage.setItem("hues_stay_amenities", JSON.stringify(state.amenityStatus || {}));
          localStorage.setItem("hues_stay_deleted_items", JSON.stringify(state.deletedItems || []));
        } catch (e) {}
      } catch (err) {
        console.warn("Live availability refresh:", err);
        if (isMounted) setIsValidating(false);
      }
    };

    refresh();
    const interval = setInterval(refresh, 2000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      isMounted = false;
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [roomLink]);

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
        const neededUnits = 1;
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
    let itemName = "Inform Checkout";
    if (action === "late_checkout") itemName = "Request Late Checkout";
    if (action === "extend") itemName = "Request Stay Extension";

    setSelectedItems(prev => {
      if (prev.includes(itemName)) {
        toast(`Removed "${itemName}" from your request.`, { icon: "↩️" });
        return prev.filter(i => i !== itemName);
      } else {
        toast.success(`Selected "${itemName}"`);
        return [...prev, itemName];
      }
    });
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

  const handleManualRoomSelect = async (num: string) => {
    const trimmed = num.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`/api/guest?token=${encodeURIComponent(trimmed)}`);
      if (res.ok) {
        setRoomLink(trimmed);
        return;
      }
    } catch (e) {}
    toast.error("Please scan the QR code in your room to open this page.");
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
      const neededUnits = 1;
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
        const neededUnits = 1;
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

      // The server saves the request and emails the staff
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestData, roomToken: roomLink })
      });
      if (!res.ok) {
        throw new Error(`Request was not saved (status ${res.status})`);
      }

      setIsSuccess(true);
      toast.success(isWaitlist ? `Reserved! You are in line for ${waitlistForItem}.` : "Request sent to front desk!");
    } catch (error) {
      console.error("Error submitting request:", error);
      setLastSubmittedId(null);
      setSubmittedWaitlistInfo(null);
      try {
        sessionStorage.removeItem("hues_last_req_id");
      } catch (e) {}
      toast.error(`Your request could not be sent. Please try again or call the supervisor on ${SUPERVISOR_PHONE}.`, { duration: 8000 });
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
      const res = await fetch(`/api/requests/${encodeURIComponent(lastSubmittedId)}`, {
        method: 'DELETE',
        headers: { 'x-room-token': roomLink || '' }
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
    } catch (e) {
      toast.error(`Could not cancel the request. Please call the supervisor on ${SUPERVISOR_PHONE}.`);
      return;
    }

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
      <header className="bg-[#1A1A1A] text-white py-3.5 px-4 sm:px-6 mb-4 shadow-xs">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-xl sm:text-2xl font-serif italic text-white tracking-wide">
            Room {roomNumber}
          </h1>
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

          {/* Hotel Key Info Cards: WiFi, Supervisor, Water Dispensers, Self Service Kitchen */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            {/* WiFi */}
            <div className="bg-[#FAF8F5] border border-[#E5E1DB] p-2 sm:p-3 text-center flex flex-col items-center justify-center shadow-2xs min-w-0">
              <div className="flex items-center justify-center gap-1 text-[#A68966] mb-1 min-w-0 w-full">
                <Wifi className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[9.5px] sm:text-[10px] font-semibold uppercase tracking-wider truncate">WiFi Password</span>
              </div>
              <div className="flex items-center justify-center gap-1 font-mono font-bold text-xs sm:text-sm text-[#2D2926]">
                <span>HuesStay123@</span>
                <button
                  type="button"
                  onClick={handleCopyWifi}
                  title="Copy WiFi Password"
                  aria-label="Copy WiFi Password"
                  className="p-1 text-[#A68966] hover:text-[#8E7455] transition-colors cursor-pointer inline-flex items-center shrink-0"
                >
                  {copiedWifi ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Supervisor */}
            <div className="bg-[#FAF8F5] border border-[#E5E1DB] p-2 sm:p-3 text-center flex flex-col items-center justify-center shadow-2xs min-w-0">
              <div className="flex items-center justify-center gap-1 text-[#A68966] mb-1 min-w-0 w-full">
                <Phone className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[9.5px] sm:text-[10px] font-semibold uppercase tracking-wider truncate">Supervisor</span>
              </div>
              <div className="flex items-center justify-center gap-1 font-mono font-bold text-xs sm:text-sm text-[#2D2926]">
                <a href={`tel:${SUPERVISOR_PHONE}`} className="hover:underline">
                  8431995152
                </a>
                <a
                  href={`tel:${SUPERVISOR_PHONE}`}
                  title="Call Supervisor"
                  aria-label="Call Supervisor"
                  className="p-1 text-[#A68966] hover:text-[#8E7455] transition-colors inline-flex items-center shrink-0"
                >
                  <Phone className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* Water Dispensers */}
            <div className="bg-[#FAF8F5] border border-[#E5E1DB] p-2 sm:p-3 text-center flex flex-col items-center justify-center shadow-2xs min-w-0">
              <div className="flex items-center justify-center gap-1 text-[#A68966] mb-1 min-w-0 w-full">
                <Droplets className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[9.5px] sm:text-[10px] font-semibold uppercase tracking-wider truncate">Water Dispensers</span>
              </div>
              <div className="font-serif text-xs sm:text-sm text-[#2D2926] font-medium leading-tight">
                G, 3rd & Terrace
              </div>
            </div>

            {/* Self Service Kitchen */}
            <div className="bg-[#FAF8F5] border border-[#E5E1DB] p-2 sm:p-3 text-center flex flex-col items-center justify-center shadow-2xs min-w-0">
              <div className="flex items-center justify-center gap-1 text-[#A68966] mb-1 min-w-0 w-full">
                <Utensils className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[9.5px] sm:text-[10px] font-semibold uppercase tracking-wider truncate">Self Service Kitchen</span>
              </div>
              <div className="font-serif text-xs sm:text-sm text-[#2D2926] font-medium leading-tight">
                Ground Floor
              </div>
            </div>
          </div>

          {/* QUICK ACTION BUTTONS */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8C857D] block">
              Quick Actions:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => handleQuickAction("checkout")}
                className={cn(
                  "py-3.5 px-4 border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs select-none",
                  selectedItems.includes("Inform Checkout")
                    ? "bg-[#2D2926] text-white border-[#2D2926]"
                    : "bg-white hover:bg-[#FAF8F5] text-[#2D2926] border-[#E5E1DB]"
                )}
              >
                <LogOut className={cn("w-4 h-4", selectedItems.includes("Inform Checkout") ? "text-white" : "text-[#A68966]")} />
                <span>Inform Checkout</span>
                {selectedItems.includes("Inform Checkout") && <Check className="w-3.5 h-3.5 text-white ml-auto" />}
              </button>

              <button
                type="button"
                onClick={() => handleQuickAction("late_checkout")}
                className={cn(
                  "py-3.5 px-4 border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs select-none",
                  selectedItems.includes("Request Late Checkout")
                    ? "bg-[#2D2926] text-white border-[#2D2926]"
                    : "bg-white hover:bg-[#FAF8F5] text-[#2D2926] border-[#E5E1DB]"
                )}
              >
                <Clock className={cn("w-4 h-4", selectedItems.includes("Request Late Checkout") ? "text-white" : "text-[#A68966]")} />
                <span>Request Late Checkout</span>
                {selectedItems.includes("Request Late Checkout") && <Check className="w-3.5 h-3.5 text-white ml-auto" />}
              </button>

              <button
                type="button"
                onClick={() => handleQuickAction("extend")}
                className={cn(
                  "py-3.5 px-4 border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs select-none",
                  selectedItems.includes("Request Stay Extension")
                    ? "bg-[#2D2926] text-white border-[#2D2926]"
                    : "bg-white hover:bg-[#FAF8F5] text-[#2D2926] border-[#E5E1DB]"
                )}
              >
                <Calendar className={cn("w-4 h-4", selectedItems.includes("Request Stay Extension") ? "text-white" : "text-[#A68966]")} />
                <span>Request Stay Extension</span>
                {selectedItems.includes("Request Stay Extension") && <Check className="w-3.5 h-3.5 text-white ml-auto" />}
              </button>
            </div>
          </div>
        </section>

        {/* 3 DISTINCT PAGES / TABS NAVIGATION BAR */}
        <div className="sticky top-0 z-30 bg-[#F9F7F4] pt-2 pb-1">
          <div className="flex border border-[#E5E1DB] bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setActiveTab("daily")}
              className={`flex-1 min-w-0 py-2.5 sm:py-3 px-1 sm:px-2 text-[10px] sm:text-xs font-semibold tracking-tight sm:tracking-wider uppercase transition-all flex items-center justify-center gap-1 cursor-pointer text-center ${
                activeTab === "daily"
                  ? "bg-[#2D2926] text-white shadow-xs"
                  : "text-[#8C857D] hover:text-[#2D2926] hover:bg-[#FAF8F5]"
              }`}
            >
              <span className="truncate">1. Daily Services</span>
              {tab1Count > 0 && (
                <span className={`text-[9px] sm:text-[10px] min-w-4 h-4 px-1 rounded-full flex items-center justify-center font-bold shrink-0 ${
                  activeTab === "daily" ? "bg-[#A68966] text-white" : "bg-[#2D2926] text-white"
                }`}>
                  {tab1Count}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("returnable")}
              className={`flex-1 min-w-0 py-2.5 sm:py-3 px-1 sm:px-2 text-[10px] sm:text-xs font-semibold tracking-tight sm:tracking-wider uppercase transition-all flex items-center justify-center gap-1 cursor-pointer text-center ${
                activeTab === "returnable"
                  ? "bg-[#2D2926] text-white shadow-xs"
                  : "text-[#8C857D] hover:text-[#2D2926] hover:bg-[#FAF8F5]"
              }`}
            >
              <span className="truncate hidden xs:inline">2. Returnables</span>
              <span className="truncate xs:hidden">2. Returnables</span>
              {tab2Count > 0 && (
                <span className={`text-[9px] sm:text-[10px] min-w-4 h-4 px-1 rounded-full flex items-center justify-center font-bold shrink-0 ${
                  activeTab === "returnable" ? "bg-[#A68966] text-white" : "bg-[#2D2926] text-white"
                }`}>
                  {tab2Count}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("fnb")}
              className={`flex-1 min-w-0 py-2.5 sm:py-3 px-1 sm:px-2 text-[10px] sm:text-xs font-semibold tracking-tight sm:tracking-wider uppercase transition-all flex items-center justify-center gap-1 cursor-pointer text-center ${
                activeTab === "fnb"
                  ? "bg-[#2D2926] text-white shadow-xs"
                  : "text-[#8C857D] hover:text-[#2D2926] hover:bg-[#FAF8F5]"
              }`}
            >
              <span className="truncate">3. F&B Essentials</span>
              {tab3Count > 0 && (
                <span className={`text-[9px] sm:text-[10px] min-w-4 h-4 px-1 rounded-full flex items-center justify-center font-bold shrink-0 ${
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
