import React, { useEffect, useState, useMemo } from "react";
import { Room, DEFAULT_ROOMS } from "../types";
import { toast, Toaster } from "sonner";
import { Plus, Search, Layers, RefreshCw } from "lucide-react";
import { useOutletContext, Navigate } from "react-router-dom";
import RoomQRCard from "../components/staff/RoomQRCard";
import { printRoomQR, sortRooms } from "../components/staff/roomQrUtils";
import { fetchLiveRooms, saveLiveRooms } from "../lib/supabaseClient";

const DEFAULT_ROOM_NUMBERS = DEFAULT_ROOMS.map(r => r.roomNumber);

// QR codes open /room/<room number>, the same links as the cards already printed
function toRoom(roomNumber: string): Room {
  return { id: `room-${roomNumber}`, roomNumber, qrCodeHash: roomNumber, status: "vacant" };
}

export default function StaffRooms() {
  const { role } = useOutletContext<{ role: "superhost" | "staff" }>();

  const [roomNumbers, setRoomNumbers] = useState<string[]>(DEFAULT_ROOM_NUMBERS);
  const [isSyncing, setIsSyncing] = useState(true);
  const [newRoomNumber, setNewRoomNumber] = useState("");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [activeFloorFilter, setActiveFloorFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Room list is shared across devices through Supabase
  useEffect(() => {
    let isMounted = true;
    fetchLiveRooms()
      .then(saved => {
        if (isMounted && saved && saved.length > 0) setRoomNumbers(saved);
      })
      .finally(() => {
        if (isMounted) setIsSyncing(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const rooms = useMemo(() => sortRooms(roomNumbers.map(r => toRoom(r))), [roomNumbers]);

  const floors = useMemo(
    () => Array.from(new Set(rooms.map(r => r.roomNumber.charAt(0)))).sort(),
    [rooms]
  );

  const filteredRooms = useMemo(() => {
    const queryLower = searchQuery.toLowerCase().trim();
    return rooms.filter(room => {
      if (queryLower && !room.roomNumber.toLowerCase().includes(queryLower)) return false;
      if (activeFloorFilter === "all") return true;
      return room.roomNumber.startsWith(activeFloorFilter);
    });
  }, [rooms, activeFloorFilter, searchQuery]);

  if (role !== "superhost") {
    return <Navigate to="/staff" replace />;
  }

  const saveRooms = async (next: string[], successMessage: string) => {
    const previous = roomNumbers;
    setRoomNumbers(next);
    if (await saveLiveRooms(next)) {
      toast.success(successMessage);
    } else {
      setRoomNumbers(previous);
      toast.error("Could not save the room list. Please try again.");
    }
  };

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newRoomNumber.trim();
    if (!/^[A-Za-z0-9-]{1,20}$/.test(trimmed)) {
      toast.error("Use letters, numbers or dashes only (e.g. 105).");
      return;
    }
    if (roomNumbers.some(r => r.toLowerCase() === trimmed.toLowerCase())) {
      toast.error(`Room ${trimmed} already exists`);
      return;
    }
    setNewRoomNumber("");
    await saveRooms([...roomNumbers, trimmed], `Room ${trimmed} added`);
  };

  const handleDeleteRoom = async (_id: string, roomNumber: string) => {
    if (!window.confirm(`Delete Room ${roomNumber} and its QR code?`)) return;
    await saveRooms(roomNumbers.filter(r => r !== roomNumber), `Room ${roomNumber} deleted`);
  };

  const copyGuestLink = (room: Room) => {
    navigator.clipboard.writeText(`${window.location.origin}/room/${room.qrCodeHash}`);
    setCopiedHash(room.qrCodeHash);
    toast.success(`Copied link for Room ${room.roomNumber}`);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const floorButtonClass = (active: boolean) =>
    `px-3 py-1.5 text-xs uppercase tracking-wider transition-colors ${
      active
        ? "bg-[#2D2926] text-white font-medium"
        : "bg-white text-[#2D2926] border border-[#E5E1DB] hover:bg-[#EFECE8]"
    }`;

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
            <span className="text-xs font-mono uppercase tracking-widest px-3 py-1.5 bg-[#F9F7F4] border border-[#E5E1DB] text-[#2D2926]">
              {rooms.length} Rooms Active
            </span>
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
              disabled={!newRoomNumber.trim()}
              className="bg-[#1A1A1A] text-white px-7 py-3 text-[10px] uppercase tracking-[0.2em] font-medium hover:bg-[#333] transition-colors disabled:opacity-50 flex items-center justify-center shrink-0"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Room
            </button>
          </form>

          <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#FAF8F5] p-3 border border-[#E5E1DB]">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-[#8C857D] mr-2 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5" /> Floor:
              </span>
              <button type="button" onClick={() => setActiveFloorFilter("all")} className={floorButtonClass(activeFloorFilter === "all")}>
                All ({rooms.length})
              </button>
              {floors.map(floor => (
                <button
                  key={floor}
                  type="button"
                  onClick={() => setActiveFloorFilter(floor)}
                  className={floorButtonClass(activeFloorFilter === floor)}
                >
                  Floor {floor} ({rooms.filter(r => r.roomNumber.startsWith(floor)).length})
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
        </div>
      </div>
    </>
  );
}
