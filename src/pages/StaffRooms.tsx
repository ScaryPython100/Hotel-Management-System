import React, { useEffect, useState, useMemo } from "react";
import { collection, query, orderBy, onSnapshot, setDoc, deleteDoc, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Room, DEFAULT_ROOMS } from "../types";
import { QRCodeSVG } from "qrcode.react";
import { toast, Toaster } from "sonner";
import { Plus, Trash2, Printer, ExternalLink, Copy, Check, Search, Layers, RefreshCw } from "lucide-react";
import { useOutletContext, Navigate } from "react-router-dom";

// Safe merger that NEVER drops default or existing rooms
function mergeRoomsWithDefaults(incomingRooms: Room[] = []): Room[] {
  const map = new Map<string, Room>();

  // 1. Add all standard 22 rooms first
  DEFAULT_ROOMS.forEach(r => {
    map.set(r.roomNumber, { ...r });
  });

  // 2. Add or override with any stored / incoming rooms
  incomingRooms.forEach(r => {
    if (r && r.roomNumber) {
      map.set(r.roomNumber, {
        id: r.id || `room-${r.roomNumber}`,
        roomNumber: String(r.roomNumber),
        qrCodeHash: String(r.qrCodeHash || r.roomNumber),
        status: r.status || "vacant"
      });
    }
  });

  // 3. Filter out explicitly user-deleted rooms
  try {
    const deletedList: string[] = JSON.parse(localStorage.getItem("hues_stay_deleted_rooms") || "[]");
    deletedList.forEach(num => map.delete(num));
  } catch (e) {}

  return Array.from(map.values()).sort((a, b) => 
    a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
  );
}

export default function StaffRooms() {
  const { role } = useOutletContext<{ role: "superhost" | "staff" }>();
  
  // Instant local initialization guaranteeing all 22 rooms are visible immediately
  const [rooms, setRooms] = useState<Room[]>(() => {
    let savedRooms: Room[] = [];
    try {
      const saved = localStorage.getItem("hues_stay_rooms");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          savedRooms = parsed;
        }
      }
    } catch (e) {}
    const initial = mergeRoomsWithDefaults(savedRooms);
    try {
      localStorage.setItem("hues_stay_rooms", JSON.stringify(initial));
    } catch (e) {}
    return initial;
  });

  const [loading, setLoading] = useState(false);
  const [newRoomNumber, setNewRoomNumber] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [activeFloorFilter, setActiveFloorFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);

  if (role !== "superhost") {
    return <Navigate to="/staff" replace />;
  }

  useEffect(() => {
    let isMounted = true;
    setIsSyncing(true);

    // 1. Fetch from server API
    fetch("/api/rooms")
      .then(r => r.json())
      .then(data => {
        if (data.success && Array.isArray(data.rooms) && isMounted) {
          setRooms(prev => {
            const merged = mergeRoomsWithDefaults([...prev, ...data.rooms]);
            try {
              localStorage.setItem("hues_stay_rooms", JSON.stringify(merged));
            } catch (e) {}
            return merged;
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setIsSyncing(false);
      });

    // 2. Firestore listener - MERGE documents rather than overwriting
    const q = query(collection(db, "rooms"), orderBy("roomNumber", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const firestoreRooms: Room[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        firestoreRooms.push({
          id: docSnap.id,
          roomNumber: String(d.roomNumber || ""),
          qrCodeHash: String(d.qrCodeHash || d.roomNumber || ""),
          status: d.status || "vacant"
        });
      });

      if (isMounted) {
        setRooms(prev => {
          const merged = mergeRoomsWithDefaults([...prev, ...firestoreRooms]);
          try {
            localStorage.setItem("hues_stay_rooms", JSON.stringify(merged));
          } catch (e) {}
          return merged;
        });
      }
      setLoading(false);
    }, (error) => {
      console.warn("Real-time rooms listener (using cached):", error?.message || "offline");
      setLoading(false);
    });

    // 3. Seed missing default rooms to Firestore in background
    DEFAULT_ROOMS.forEach(async (defRoom) => {
      try {
        await setDoc(doc(db, "rooms", `room-${defRoom.roomNumber}`), {
          roomNumber: defRoom.roomNumber,
          qrCodeHash: defRoom.qrCodeHash,
          status: defRoom.status
        }, { merge: true });
      } catch (e) {}
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newRoomNumber.trim();
    if (!trimmed) return;

    if (rooms.some(r => r.roomNumber.toLowerCase() === trimmed.toLowerCase())) {
      toast.error(`Room ${trimmed} already exists`);
      return;
    }

    setIsAdding(true);

    // Unmark as deleted if it was deleted previously
    try {
      const deletedList: string[] = JSON.parse(localStorage.getItem("hues_stay_deleted_rooms") || "[]");
      const updatedDeleted = deletedList.filter(n => n.toLowerCase() !== trimmed.toLowerCase());
      localStorage.setItem("hues_stay_deleted_rooms", JSON.stringify(updatedDeleted));
    } catch (e) {}

    const qrCodeHash = trimmed;
    const newRoom: Room = {
      id: `room-${trimmed}`,
      roomNumber: trimmed,
      qrCodeHash,
      status: "vacant"
    };

    // Safe merge: keep all existing rooms AND add the new room
    setRooms(prev => {
      const merged = mergeRoomsWithDefaults([...prev, newRoom]);
      try {
        localStorage.setItem("hues_stay_rooms", JSON.stringify(merged));
      } catch (e) {}
      return merged;
    });

    setNewRoomNumber("");
    toast.success(`Room ${trimmed} added successfully!`);

    // Persist to server API
    try {
      await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRoom)
      });
    } catch (err) {
      console.warn("Server room sync note:", err);
    }

    // Persist to Firestore with stable document ID
    try {
      await setDoc(doc(db, "rooms", `room-${trimmed}`), {
        roomNumber: trimmed,
        qrCodeHash,
        status: "vacant"
      }, { merge: true });
    } catch (error: any) {
      console.warn("Firestore room save note:", error?.message || "offline");
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteRoom = async (id: string, roomNumber: string) => {
    if (!window.confirm(`Delete Room ${roomNumber} and its QR code?`)) return;

    // Record in deleted rooms list so it isn't resurrected
    try {
      const deletedList: string[] = JSON.parse(localStorage.getItem("hues_stay_deleted_rooms") || "[]");
      if (!deletedList.includes(roomNumber)) {
        deletedList.push(roomNumber);
        localStorage.setItem("hues_stay_deleted_rooms", JSON.stringify(deletedList));
      }
    } catch (e) {}

    // Update state
    setRooms(prev => {
      const updated = prev.filter(r => r.roomNumber !== roomNumber);
      try {
        localStorage.setItem("hues_stay_rooms", JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });

    toast.success(`Room ${roomNumber} deleted`);

    // Delete from server API
    try {
      await fetch(`/api/rooms/${roomNumber}`, { method: "DELETE" });
    } catch (e) {}

    // Delete from Firestore
    try {
      await deleteDoc(doc(db, "rooms", `room-${roomNumber}`));
      if (id && id !== `room-${roomNumber}`) {
        await deleteDoc(doc(db, "rooms", id));
      }
    } catch (error: any) {
      console.warn("Deleted locally:", error?.message || "offline");
    }
  };

  const copyGuestLink = (room: Room) => {
    const url = `${window.location.origin}/room/${room.qrCodeHash || room.roomNumber}`;
    navigator.clipboard.writeText(url);
    setCopiedHash(room.qrCodeHash);
    toast.success(`Copied link for Room ${room.roomNumber}`);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const printQR = (room: Room) => {
    const url = `${window.location.origin}/room/${room.qrCodeHash || room.roomNumber}`;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error("Please allow popups to print QR codes");
      return;
    }
    
    const svgElement = document.getElementById(`qr-svg-${room.roomNumber}`);
    const svgHtml = svgElement ? svgElement.outerHTML : '';

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Room ${room.roomNumber} - Hues Stay QR Code</title>
          <style>
            body { font-family: 'Playfair Display', Georgia, serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 90vh; margin: 0; background: #faf9f6; }
            .card { text-align: center; border: 1.5px solid #2D2926; padding: 48px; background: white; max-width: 360px; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
            h1 { font-size: 32px; font-weight: 400; font-style: italic; margin: 0 0 8px 0; color: #2D2926; }
            .tagline { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 11px; letter-spacing: 0.25em; text-transform: uppercase; color: #8C857D; margin-bottom: 28px; }
            .qr-box { padding: 16px; background: white; border: 1px solid #E5E1DB; display: inline-block; margin-bottom: 24px; }
            .instructions { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 13px; color: #555; line-height: 1.5; margin: 0; }
            .url { font-family: monospace; font-size: 10px; color: #8C857D; margin-top: 16px; word-break: break-all; }
            @media print {
              body { background: white; }
              .card { box-shadow: none; border-color: #000; }
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Room ${room.roomNumber}</h1>
            <div class="tagline">Hues Stay Luxury Guest Service</div>
            <div class="qr-box">
              ${svgHtml}
            </div>
            <p class="instructions">Scan with your smartphone camera to order amenities and request housekeeping service.</p>
            <p class="url">${url}</p>
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 300);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Filtered rooms by floor and search
  const filteredRooms = useMemo(() => {
    return rooms.filter(room => {
      const matchesSearch = searchQuery.trim() === "" || 
        room.roomNumber.toLowerCase().includes(searchQuery.toLowerCase().trim());
      
      if (!matchesSearch) return false;

      if (activeFloorFilter === "all") return true;
      const floorPrefix = activeFloorFilter; // e.g. "1", "2", "3", "4", "5", "6"
      return room.roomNumber.startsWith(floorPrefix);
    });
  }, [rooms, activeFloorFilter, searchQuery]);

  // Floor counts
  const floorCounts = useMemo(() => {
    const counts: Record<string, number> = { all: rooms.length };
    for (let f = 1; f <= 6; f++) {
      counts[String(f)] = rooms.filter(r => r.roomNumber.startsWith(String(f))).length;
    }
    return counts;
  }, [rooms]);

  return (
    <>
      <Toaster position="top-right" />
      <div className="p-8 md:p-12">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <header className="mb-10 flex flex-col sm:flex-row sm:items-end justify-between border-b border-[#E5E1DB] pb-6 gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-4xl font-serif italic text-[#2D2926]">Rooms & QR Codes</h2>
                {isSyncing && (
                  <span className="flex items-center text-xs text-[#8C857D] gap-1 bg-[#EFECE8] px-2 py-0.5 rounded font-sans">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Syncing...
                  </span>
                )}
              </div>
              <p className="text-sm text-[#8C857D] mt-2 italic">
                Manage all hotel rooms and generate guest service QR codes. Total rooms: {rooms.length}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase tracking-widest px-3 py-1.5 bg-[#F9F7F4] border border-[#E5E1DB] text-[#2D2926]">
                {rooms.length} Rooms Active
              </span>
            </div>
          </header>

          {/* Add New Room Form */}
          <form onSubmit={handleAddRoom} className="mb-8 bg-white p-6 border border-[#E5E1DB] shadow-sm flex flex-col sm:flex-row gap-4 sm:items-end">
            <div className="flex-1">
              <label htmlFor="add-room-input" className="block text-[10px] uppercase tracking-[0.2em] font-bold text-[#8C857D] mb-2">
                Add New Room
              </label>
              <input 
                id="add-room-input"
                type="text" 
                value={newRoomNumber}
                onChange={(e) => setNewRoomNumber(e.target.value)}
                placeholder="e.g. 105 or 701"
                className="w-full border-b border-[#E5E1DB] py-2 focus:outline-none focus:border-[#A68966] text-[#2D2926] text-base placeholder:text-[#BBB]"
              />
            </div>
            <button 
              type="submit" 
              disabled={isAdding || !newRoomNumber.trim()}
              className="bg-[#1A1A1A] text-white px-7 py-3 text-[10px] uppercase tracking-[0.2em] font-medium hover:bg-[#333] transition-colors disabled:opacity-50 flex items-center justify-center shrink-0"
            >
              <Plus className="w-4 h-4 mr-2" />
              {isAdding ? "Adding..." : "Add Room"}
            </button>
          </form>

          {/* Floor Filters & Search Toolbar */}
          <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#FAF8F5] p-3 border border-[#E5E1DB]">
            {/* Floor tabs */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-[#8C857D] mr-2 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5" /> Floor:
              </span>
              <button
                type="button"
                onClick={() => setActiveFloorFilter("all")}
                className={`px-3 py-1.5 text-xs uppercase tracking-wider transition-colors ${
                  activeFloorFilter === "all"
                    ? "bg-[#2D2926] text-white font-medium"
                    : "bg-white text-[#2D2926] border border-[#E5E1DB] hover:bg-[#EFECE8]"
                }`}
              >
                All ({floorCounts.all || 0})
              </button>
              {[1, 2, 3, 4, 5, 6].map(floor => (
                <button
                  key={floor}
                  type="button"
                  onClick={() => setActiveFloorFilter(String(floor))}
                  className={`px-3 py-1.5 text-xs uppercase tracking-wider transition-colors ${
                    activeFloorFilter === String(floor)
                      ? "bg-[#2D2926] text-white font-medium"
                      : "bg-white text-[#2D2926] border border-[#E5E1DB] hover:bg-[#EFECE8]"
                  }`}
                >
                  Floor {floor} ({floorCounts[String(floor)] || 0})
                </button>
              ))}
            </div>

            {/* Search room */}
            <div className="relative w-full md:w-56">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#8C857D]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search room (e.g. 203)..."
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-[#E5E1DB] text-xs focus:outline-none focus:border-[#A68966]"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin h-12 w-12 border-t-2 border-b-2 border-[#A68966]"></div>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredRooms.map((room) => {
                const guestUrl = `${window.location.origin}/room/${room.qrCodeHash || room.roomNumber}`;
                return (
                  <div 
                    key={room.roomNumber} 
                    className="bg-white border border-[#E5E1DB] p-6 flex flex-col items-center text-center hover:border-[#A68966] transition-all shadow-sm"
                  >
                    <div className="w-full flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-[0.2em] font-mono text-[#8C857D]">
                        Floor {room.roomNumber.charAt(0)}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-[#FAF8F5] border border-[#E5E1DB] text-[#8C857D]">
                        Room #{room.roomNumber}
                      </span>
                    </div>

                    <h3 className="text-3xl font-serif text-[#2D2926] mb-1">Room {room.roomNumber}</h3>
                    <p className="text-[10px] uppercase tracking-[0.15em] text-[#8C857D] mb-5">
                      QR: /room/{room.qrCodeHash || room.roomNumber}
                    </p>
                    
                    <div className="bg-white p-3.5 border border-[#E5E1DB] mb-5 shadow-inner">
                      <QRCodeSVG id={`qr-svg-${room.roomNumber}`} value={guestUrl} size={140} />
                    </div>

                    <div className="w-full grid grid-cols-2 gap-2 mb-3">
                      <button 
                        type="button"
                        onClick={() => printQR(room)}
                        className="bg-[#F9F7F4] text-[#2D2926] border border-[#E5E1DB] py-2.5 px-3 text-[10px] uppercase tracking-[0.15em] font-medium hover:bg-[#E5E1DB] transition-colors flex items-center justify-center"
                      >
                        <Printer className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                        Print QR
                      </button>
                      <button 
                        type="button"
                        onClick={() => copyGuestLink(room)}
                        className="bg-[#F9F7F4] text-[#2D2926] border border-[#E5E1DB] py-2.5 px-3 text-[10px] uppercase tracking-[0.15em] font-medium hover:bg-[#E5E1DB] transition-colors flex items-center justify-center"
                      >
                        {copiedHash === (room.qrCodeHash || room.roomNumber) ? (
                          <>
                            <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-600 shrink-0" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 mr-1.5 shrink-0" />
                            Copy Link
                          </>
                        )}
                      </button>
                    </div>

                    <div className="w-full flex items-center justify-between pt-3 border-t border-dashed border-[#E5E1DB]">
                      <a 
                        href={guestUrl} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="text-[10px] uppercase tracking-[0.15em] text-[#A68966] font-semibold hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Open Guest View
                      </a>
                      <button 
                        type="button"
                        onClick={() => handleDeleteRoom(room.id || `room-${room.roomNumber}`, room.roomNumber)}
                        className="p-1.5 text-[#8C857D] hover:text-red-600 transition-colors"
                        title={`Delete Room ${room.roomNumber}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              
              {filteredRooms.length === 0 && (
                <div className="col-span-full py-16 text-center text-[#8C857D] bg-[#FAF8F5] border border-dashed border-[#E5E1DB]">
                  <p className="font-serif text-lg mb-1">No rooms match your filter.</p>
                  <p className="text-xs">Try switching floors or clearing your search query.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
