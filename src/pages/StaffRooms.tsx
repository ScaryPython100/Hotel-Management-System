import React, { useEffect, useState, useMemo } from "react";
import { collection, query, orderBy, onSnapshot, setDoc, deleteDoc, doc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Room, DEFAULT_ROOMS } from "../types";
import { toast, Toaster } from "sonner";
import { Plus, Search, Layers, RefreshCw } from "lucide-react";
import { useOutletContext, Navigate } from "react-router-dom";
import RoomQRCard from "../components/staff/RoomQRCard";
import { mergeRoomsWithDefaults, printRoomQR, getSuperhostPinHeader } from "../components/staff/roomQrUtils";

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

    // 3. Seed missing default rooms to Firestore concurrently in background
    Promise.allSettled(
      DEFAULT_ROOMS.map((defRoom) =>
        setDoc(doc(db, "rooms", `room-${defRoom.roomNumber}`), {
          roomNumber: defRoom.roomNumber,
          qrCodeHash: defRoom.qrCodeHash,
          status: defRoom.status
        }, { merge: true })
      )
    );

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

    setRooms(prev => {
      const merged = mergeRoomsWithDefaults([...prev, newRoom]);
      try {
        localStorage.setItem("hues_stay_rooms", JSON.stringify(merged));
      } catch (e) {}
      return merged;
    });

    setNewRoomNumber("");
    toast.success(`Room ${trimmed} added successfully!`);

    try {
      await fetch("/api/rooms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getSuperhostPinHeader()
        },
        body: JSON.stringify(newRoom)
      });
    } catch (err) {
      console.warn("Server room sync note:", err);
    }

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

    try {
      const deletedList: string[] = JSON.parse(localStorage.getItem("hues_stay_deleted_rooms") || "[]");
      if (!deletedList.includes(roomNumber)) {
        deletedList.push(roomNumber);
        localStorage.setItem("hues_stay_deleted_rooms", JSON.stringify(deletedList));
      }
    } catch (e) {}

    setRooms(prev => {
      const updated = prev.filter(r => r.roomNumber !== roomNumber);
      try {
        localStorage.setItem("hues_stay_rooms", JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });

    toast.success(`Room ${roomNumber} deleted`);

    try {
      await fetch(`/api/rooms/${encodeURIComponent(roomNumber)}`, {
        method: "DELETE",
        headers: getSuperhostPinHeader()
      });
    } catch (e) {}

    try {
      const deleteTasks = [deleteDoc(doc(db, "rooms", `room-${roomNumber}`))];
      if (id && id !== `room-${roomNumber}`) {
        deleteTasks.push(deleteDoc(doc(db, "rooms", id)));
      }
      await Promise.all(deleteTasks);
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

  const filteredRooms = useMemo(() => {
    const queryLower = searchQuery.toLowerCase().trim();
    return rooms.filter(room => {
      if (queryLower && !room.roomNumber.toLowerCase().includes(queryLower)) return false;
      if (activeFloorFilter === "all") return true;
      return room.roomNumber.startsWith(activeFloorFilter);
    });
  }, [rooms, activeFloorFilter, searchQuery]);

  const floorCounts = useMemo(() => {
    const counts: Record<string, number> = { all: rooms.length };
    for (let f = 1; f <= 6; f++) {
      counts[String(f)] = 0;
    }
    for (const r of rooms) {
      const firstChar = r.roomNumber.charAt(0);
      if (counts[firstChar] !== undefined) {
        counts[firstChar]++;
      }
    }
    return counts;
  }, [rooms]);

  return (
    <>
      <Toaster position="top-right" />
      <div className="p-8 md:p-12">
        <div className="max-w-6xl mx-auto">
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

          <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#FAF8F5] p-3 border border-[#E5E1DB]">
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
              {filteredRooms.map((room) => (
                <RoomQRCard
                  key={room.roomNumber}
                  room={room}
                  copiedHash={copiedHash}
                  onPrint={printRoomQR}
                  onCopy={copyGuestLink}
                  onDelete={handleDeleteRoom}
                />
              ))}

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
