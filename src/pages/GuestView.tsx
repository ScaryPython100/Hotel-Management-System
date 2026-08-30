import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, addDoc, query, where, getDocs, updateDoc, onSnapshot, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { COMMON_ITEMS } from "../types";
import { cn } from "../lib/utils";
import toast, { Toaster } from "react-hot-toast";
import { Check, Loader2, Info, AlertTriangle } from "lucide-react";

export default function GuestView() {
  const { hash } = useParams<{ hash: string }>();
  const [roomNumber, setRoomNumber] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(true);
  
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [customMessage, setCustomMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const [inventory, setInventory] = useState<Record<string, { inUse: number, limit: number }>>({});
  const [amenitiesStatus, setAmenitiesStatus] = useState<Record<string, 'available' | 'out_of_service'>>({});

  useEffect(() => {
    async function validateRoom() {
      if (!hash) {
        setIsValidating(false);
        return;
      }

      try {
        const q = query(collection(db, "rooms"), where("qrCodeHash", "==", hash));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          setRoomNumber(snapshot.docs[0].data().roomNumber);
        }
      } catch (error) {
        console.error("Error validating QR code:", error);
      } finally {
        setIsValidating(false);
      }
    }

    validateRoom();

    const unsubscribeInventory = onSnapshot(collection(db, "inventory"), (invSnapshot) => {
      const invMap: Record<string, { inUse: number, limit: number }> = {};
      invSnapshot.forEach(doc => {
        const data = doc.data();
        invMap[data.name] = { inUse: data.inUse, limit: data.limit };
      });
      setInventory(invMap);
    }, (error) => {
      console.error("Error fetching inventory:", error);
    });

    const unsubscribeAmenities = onSnapshot(doc(db, "settings", "amenities"), (docSnap) => {
      if (docSnap.exists()) {
        setAmenitiesStatus(docSnap.data() as Record<string, 'available' | 'out_of_service'>);
      }
    });

    return () => {
      unsubscribeInventory();
      unsubscribeAmenities();
    };
  }, [hash]);

  const toggleItem = (item: string) => {
    setSelectedItems((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
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
      const limitedItemsRequested = COMMON_ITEMS
        .filter(i => i.isLimited && selectedItems.includes(i.name))
        .map(i => i.name);

      // Verify stock for limited items before proceeding
      for (const item of limitedItemsRequested) {
        const inv = inventory[item];
        if (inv && inv.inUse >= inv.limit) {
           toast.error(`${item} is currently out of stock. Request cancelled.`);
           setIsSubmitting(false);
           return;
        }
      }

      // Create Request
      const requestRef = await addDoc(collection(db, "requests"), {
        roomId: roomNumber,
        qrCodeHash: hash,
        items: selectedItems,
        customMessage: customMessage.trim(),
        status: "pending",
        createdAt: Date.now(),
      });

      // Update inventory and borrowed_items
      for (const item of limitedItemsRequested) {
        // Create borrowed item
        await addDoc(collection(db, "borrowed_items"), {
          roomId: roomNumber,
          itemName: item,
          status: 'borrowed',
          createdAt: Date.now(),
          requestId: requestRef.id
        });
        
        // Find if inventory doc exists
        const invQ = query(collection(db, "inventory"), where("name", "==", item));
        const invSnap = await getDocs(invQ);
        
        if (invSnap.empty) {
          const itemDef = COMMON_ITEMS.find(i => i.name === item);
          const limit = itemDef?.defaultLimit || 1;
          await addDoc(collection(db, "inventory"), {
            name: item,
            inUse: 1,
            limit: limit
          });
        } else {
          // Increment inUse
          const docRef = invSnap.docs[0].ref;
          const currentInUse = invSnap.docs[0].data().inUse || 0;
          await updateDoc(docRef, {
            inUse: currentInUse + 1
          });
        }
      }
      
      // Trigger backend notification (SMS/WhatsApp)
      const notifyResponse = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomNumber,
          items: selectedItems,
          customMessage: customMessage.trim()
        })
      });
      
      if (!notifyResponse.ok) {
        throw new Error("Notification trigger failed on backend");
      }

      setIsSuccess(true);
      toast.success("Request sent successfully!");
    } catch (error) {
      console.error("Error submitting request:", error);
      toast.error("Failed to send request. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isValidating) {
    return (
      <div className="min-h-screen bg-[#F9F7F4] flex flex-col items-center justify-center p-6 text-center text-[#2D2926] font-sans">
        <Loader2 className="w-10 h-10 animate-spin text-[#A68966] mb-4" />
        <p className="text-[#8C857D] uppercase tracking-[0.2em] text-xs">Authenticating Room...</p>
      </div>
    );
  }

  if (!roomNumber) {
    return (
      <div className="min-h-screen bg-[#F9F7F4] flex flex-col items-center justify-center p-6 text-center text-[#2D2926] font-sans">
        <AlertTriangle className="w-12 h-12 text-[#A68966] mb-4" />
        <h2 className="text-3xl font-serif italic mb-2">Invalid QR Code</h2>
        <p className="text-[#8C857D] max-w-md text-sm">
          We couldn't identify this room. Please ensure you scanned the QR code provided in your room, or contact the front desk.
        </p>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-[#F9F7F4] flex flex-col items-center justify-center p-6 text-center text-[#2D2926] font-sans">
        <div className="w-20 h-20 bg-[#F2EFE9] text-[#A68966] rounded-full flex items-center justify-center mb-6 border border-[#E5E1DB]">
          <Check className="w-10 h-10" />
        </div>
        <h2 className="text-3xl font-serif italic mb-2">Request Received</h2>
        <p className="text-[#8C857D] mb-8 max-w-md text-sm">
          Our housekeeping team has been notified via email and will attend to Room {roomNumber} shortly.
        </p>
        <button
          onClick={() => {
            setIsSuccess(false);
            setSelectedItems([]);
            setCustomMessage("");
          }}
          className="px-8 py-4 bg-[#A68966] text-white font-medium uppercase tracking-[0.2em] text-xs hover:bg-[#8E7455] transition-colors rounded-none"
        >
          Make Another Request
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F9F7F4] text-[#2D2926] pb-20 font-sans">
      <Toaster position="top-center" />
      
      {/* Header */}
      <header className="h-48 bg-[#1A1A1A] text-white p-8 flex flex-col justify-end relative mb-8">
        <div className="absolute top-8 left-8 text-[11px] uppercase tracking-[0.2em] opacity-60">
          Hues Stay Luxury Rooms
        </div>
        <div className="max-w-4xl mx-auto w-full text-left">
          <h1 className="text-4xl font-serif italic mb-2">Room {roomNumber}</h1>
          <p className="text-sm opacity-80 max-w-md">Enjoy your stay. Request amenities instantly below.</p>
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
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      if (!isDisabled) toggleItem(item);
                    }}
                    disabled={isDisabled}
                    className={cn(
                      "bg-white border p-6 flex flex-col justify-between text-left transition-all duration-200 min-h-[112px] h-auto cursor-pointer rounded-none relative gap-4",
                      isSelected
                        ? "bg-[#F2EFE9] border-[#A68966] text-[#2D2926]"
                        : "border-[#E5E1DB] text-[#2D2926] hover:bg-[#F2EFE9]",
                      isDisabled && "opacity-50 cursor-not-allowed hover:bg-white border-[#E5E1DB]"
                    )}
                  >
                    <div className="flex justify-between items-start w-full gap-2">
                      <span className="font-serif text-base md:text-lg leading-tight">{item}</span>
                      <div
                        className={cn(
                          "w-5 h-5 flex items-center justify-center shrink-0 border rounded-sm mt-0.5",
                          isSelected ? "border-[#A68966] bg-[#A68966]" : "border-[#E5E1DB]",
                          isDisabled && "border-[#E5E1DB] bg-gray-100"
                        )}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </div>
                    {isOutOfService && (
                      <span className="text-[10px] text-red-500 uppercase tracking-widest font-bold mt-2">
                        Unavailable
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-serif mb-4 flex items-center">
              Inventory Item Requests
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {COMMON_ITEMS.filter(i => i.category === 'Item').map((itemObj) => {
                const item = itemObj.name;
                const isSelected = selectedItems.includes(item);
                const inv = inventory[item];
                const isOutOfStock = itemObj.isLimited && inv && inv.inUse >= inv.limit;
                const isOutOfService = amenitiesStatus[item] === 'out_of_service';
                const isDisabled = isOutOfStock || isOutOfService;

                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      if (!isDisabled) toggleItem(item);
                    }}
                    disabled={isDisabled}
                    className={cn(
                      "bg-white border p-6 flex flex-col justify-between text-left transition-all duration-200 min-h-[112px] h-auto cursor-pointer rounded-none relative gap-4",
                      isSelected
                        ? "bg-[#F2EFE9] border-[#A68966] text-[#2D2926]"
                        : "border-[#E5E1DB] text-[#2D2926] hover:bg-[#F2EFE9]",
                      isDisabled && "opacity-50 cursor-not-allowed hover:bg-white border-[#E5E1DB]"
                    )}
                  >
                    <div className="flex justify-between items-start w-full gap-2">
                      <span className="font-serif text-base md:text-lg leading-tight">{item}</span>
                      <div
                        className={cn(
                          "w-5 h-5 flex items-center justify-center shrink-0 border rounded-sm mt-0.5",
                          isSelected ? "border-[#A68966] bg-[#A68966]" : "border-[#E5E1DB]",
                          isDisabled && "border-[#E5E1DB] bg-gray-100"
                        )}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </div>
                    {isOutOfService ? (
                      <span className="text-[10px] text-red-500 uppercase tracking-widest font-bold mt-2">
                        Unavailable
                      </span>
                    ) : isOutOfStock ? (
                      <span className="text-[10px] text-red-500 uppercase tracking-widest font-bold mt-2">
                        In Use
                      </span>
                    ) : null}
                  </button>
                );
              })}
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
            className="w-full py-4 bg-[#A68966] text-white font-medium uppercase tracking-[0.2em] text-xs hover:bg-[#8E7455] transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center rounded-none"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-6 h-6 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              "Submit Request"
            )}
          </button>
        </form>
      </main>
    </div>
  );
}
